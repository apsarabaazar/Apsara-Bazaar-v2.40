const express = require("express");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const dotenv = require("dotenv").config();
const bodyParser = require("body-parser");
const cron = require('node-cron');
const bot = require('./telegramBot'); // Import the bot instance
const socketIo = require("socket.io");
const mongoose = require('mongoose');
const axios = require('axios');
const { pipeline } = require("stream");
const multer = require('multer');
const upload = multer().array('images', 10);
const NodeCache = require('node-cache');
const { SitemapStream } = require('sitemap');
const { createGzip } = require('zlib');
const https = require('https');




const app = express();

// Middleware setup
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '60mb', extended: true }));
app.use(express.static("public"));
app.set("view engine", "ejs");

// Session setup
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    store: MongoStore.create({
      mongoUrl: process.env.MONGO_DB,
      collectionName: "sessions",
      ttl: 30 * 24 * 60 * 60, // 30 Days
    }),
    cookie: {
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days in milliseconds
      secure: false, // Set true if using HTTPS
      httpOnly: true // Protect against XSS attacks
    }
  })
);

// Connect to MongoDB
mongoose.connect(process.env.MONGO_DB, {
  maxpoolSize: 20,             // Keep 10 connections in the pool
  socketTimeoutMS: 30000,   // Close idle connections after 30 seconds of inactivity
  connectTimeoutMS: 5000,   // Max time to wait for a connection to be established
})
  //mongoose.connect("mongodb://0.0.0.0:27017/ApsaraBazaar")
  .then(() => {
    console.log("Database connected");
  })
  .catch(err => {
    console.error("Connection error", err);
  });

// Models
const User = require('./models/User');
const Post = require("./models/Post");
const Comment = require('./models/Comment');
const Image = require('./models/Image');
const Room = require('./models/Room')
const Message = require("./models/Message");


// Routes
const authRoutes = require("./routes/auth");
const postRoutes = require("./routes/post");
const userRoutes = require("./routes/user");
const botRoutes = require('./routes/bot');
const roomsRoutes = require("./routes/rooms");

app.use("/rooms", roomsRoutes);
app.use("/auth", authRoutes);
app.use("/post", postRoutes);
app.use("/user", userRoutes)

// Render the index page immediately with basic data
app.get("/", async (req, res) => {
  let user = null;
  if (req.session.user) {
    user = await User.findById(req.session.user._id).lean().exec();
    updateUserActivity(req.session.user.email);
  }

  let nuser = getActiveUserCount();
  res.render("index", { user, nuser });
});

const activeUsers = new Map(); // Stores userID -> lastActiveTimestamp

//---------------------------------------------------------------------------------------------------------------------------------------

const pLimit = require('p-limit').default;


// Concurrency control (max 5 concurrent requests)
const limit = pLimit(5);

// Cache for posts and tags
const postCache = new Map();
const tagCache = new Map();

// Tags for caching
const tags = ["Bazaar", "Admire Apsara", "Influencers", "Kinks and Fantasies", "Apsara Fakes"];
tags.forEach(tag => tagCache.set(tag, []));

const httpsAgent = new https.Agent({
  family: 4, // Force IPv4
  keepAlive: true
});


// Helper function to fetch fresh filePath from Telegram for a given fileId with retries
const getTelegramFilePath = async (fileId) => {
  const maxRetries = 3;
  let retryCount = 0;

  while (retryCount < maxRetries) {
    try {
      const response = await axios.get(
        `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`,
        { timeout: 5000 } // 5-second timeout
      );
      return response.data.result.file_path;
    } catch (error) {
      if (retryCount === maxRetries - 1) {
        console.error(`Final attempt failed for ${fileId}:`, error.message);
        return null;
      }
      console.log(`Retrying ${fileId} (attempt ${retryCount + 1})`);
      await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1))); // Exponential backoff
      retryCount++;
    }
  }
};

// Map images by postId with concurrency control
const mapImagesByPostIdAsync = async (images) => {
  const processImage = async (image) => {
    try {
      const filePath = await limit(() => getTelegramFilePath(image.fileId));
      return { ...image, filePath };
    } catch (error) {
      console.error(`Error fetching file path for ${image.fileId}:`, error);
      return image; // Return the original image if fetching fails
    }
  };

  const refreshedImages = await Promise.all(images.map(image => processImage(image)));

  // Group the refreshed images by postId
  const imagesByPostId = refreshedImages.reduce((acc, image) => {
    if (!acc[image.postId]) {
      acc[image.postId] = [];
    }
    const src = image.filePath
      ? `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${image.filePath}`
      : `/api/images/${image.fileId}`; // Fallback to local API if filePath is null
    acc[image.postId].push({
      fileId: image.fileId,
      caption: image.caption,
      src,
    });
    return acc;
  }, {});

  return imagesByPostId;
};

// Refresh the latest posts cache
const refreshLatestCache = async () => {
  try {
    const latestPosts = await Post.find({})
      .sort({ uploadTime: -1 })
      .limit(30)
      .lean()
      .exec();

    const postIds = latestPosts.map(post => post._id);
    const images = await Image.find({ postId: { $in: postIds } }).lean().exec();
    const imagesByPostId = await mapImagesByPostIdAsync(images);

    const postsWithImages = latestPosts.map(post => ({
      ...post,
      images: imagesByPostId[post._id] || [],
    }));

    postCache.set("latest", postsWithImages);
    console.log("Latest posts cache refreshed.");
  } catch (error) {
    console.error("Error refreshing latest cache:", error);
  }
};

// Refresh caches for each tag
const refreshTagCache = async () => {
  try {
    await Promise.all(tags.map(async (tag) => {
      const posts = await Post.find({ tags: tag })
        .sort({ uploadTime: -1 })
        .limit(10)
        .lean()
        .exec();

      const postIds = posts.map(post => post._id);
      const images = await Image.find({ postId: { $in: postIds } }).lean().exec();
      const imagesByPostId = await mapImagesByPostIdAsync(images);

      const postsWithImages = posts.map(post => ({
        ...post,
        images: imagesByPostId[post._id] || [],
      }));

      tagCache.set(tag, postsWithImages);
      console.log(`Cache refreshed for tag: ${tag}`);
    }));

    // Refresh special tags: Hot, Top, Rising
    const specialTags = ['Hot', 'Top', 'Rising'];
    await Promise.all(specialTags.map(async (specialTag) => {
      let posts;
      if (specialTag === 'Top') {
        // Use aggregation for likes + comments
        const aggregation = [
          { $addFields: { total: { $add: ["$likes", "$comments"] } } },
          { $sort: { total: -1 } },
          { $limit: 10 },
          { $project: { total: 0 } } // Exclude computed field
        ];
        posts = await Post.aggregate(aggregation).exec();
      } else {
        let sortCriteria = {};
        if (specialTag === 'Hot') sortCriteria = { likes: -1 };
        else if (specialTag === 'Rising') sortCriteria = { comments: -1 };

        posts = await Post.find()
          .sort(sortCriteria)
          .limit(10)
          .lean()
          .exec();
      }

      // Fetch images and cache posts (existing logic)
      const postIds = posts.map(post => post._id);
      const images = await Image.find({ postId: { $in: postIds } }).lean().exec();
      const imagesByPostId = await mapImagesByPostIdAsync(images);

      const postsWithImages = posts.map(post => ({
        ...post,
        images: imagesByPostId[post._id] || [],
      }));

      tagCache.set(specialTag, postsWithImages);
      console.log(`Cache refreshed for special tag: ${specialTag}`);
    }));




  } catch (error) {
    console.error("Error refreshing tag caches:", error);
  }
};

// Refresh all caches with error handling
const refreshAllCaches = async () => {
  try {
    await Promise.allSettled([refreshLatestCache(), refreshTagCache()]);
    console.log('Cache refresh completed (with possible partial failures)');
  } catch (error) {
    console.error('Critical error during cache refresh:', error);
  }
};

// Initial cache refresh and periodic refresh every 5 hours
refreshAllCaches();
setInterval(refreshAllCaches, 5 * 60 * 60 * 1000); // every 5 hours

app.get("/api/posts", async (req, res) => {
  try {
    const { skip = 0, limit = 10, tag } = req.query;
    const skipInt = parseInt(skip, 10);
    const limitInt = parseInt(limit, 10);

    // Check if the tag is a special one
    const isSpecialTag = ['Hot', 'Top', 'Rising'].includes(tag);

    // Determine cache key and store
    const cacheKey = tag || 'latest';
    const cacheStore = tag ? tagCache : postCache;
    const cachedPosts = cacheStore.get(cacheKey) || [];

    // Serve from cache if possible
    if (cachedPosts.length >= skipInt + limitInt) {
      return res.json({ posts: cachedPosts.slice(skipInt, skipInt + limitInt) });
    }

    let posts;
    if (isSpecialTag) {
      if (tag === 'Top') {
        // Aggregate for likes + comments sum
        const aggregation = [
          { $addFields: { total: { $add: ["$likes", "$comments"] } } },
          { $sort: { total: -1 } },
          { $skip: skipInt },
          { $limit: limitInt },
          { $project: { total: 0 } }
        ];
        posts = await Post.aggregate(aggregation).exec();
      } 
      else {
        let sortCriteria = {};
        if (tag === 'Hot') 
          {sortCriteria = { likes: -1 };}
        
        else if (tag === 'Rising') 
          {sortCriteria = { comments: -1 };}

        posts = await Post.find()
          .sort(sortCriteria)
          .skip(skipInt)
          .limit(limitInt)
          .lean()
          .exec();
      }
    } else {
      // Regular tag or no tag
      const query = tag ? { tags: tag } : {};
      
      posts = await Post.find(query)
        .sort({ uploadTime: -1 })
        .skip(skipInt)
        .limit(limitInt)
        .lean()
        .exec();
    }

    // Attach images to posts (existing logic)
    const postIds = posts.map(post => post._id);
    const images = await Image.find({ postId: { $in: postIds } }).lean().exec();
    const imagesByPostId = await mapImagesByPostIdAsync(images);

    const postsWithImages = posts.map(post => ({
      ...post,
      images: imagesByPostId[post._id] || [],
    }));

    res.json({ posts: postsWithImages });
  } catch (error) {
    console.error("Error fetching posts:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Improved fetchWithRetry function
const fetchWithRetry = async (url, options, retries = 2, delay = 750, attempt = 1) => {
  try {
    const timeout = 3500; // Timeout in milliseconds
    const response = await axios({
      url,
      method: options.method,
      timeout,
      responseType: options.responseType || 'json',
    });
    if (attempt > 1) {
      console.log(`Fetch successful on attempt ${attempt}.`);
    }
    return response;
  } catch (error) {
    if (retries === 0) throw error;
    if (error.code === 'ECONNABORTED') {
      console.log(`Timeout on attempt ${attempt}, retrying... (${retries} retries left)`);
    } else {
      console.log(`Attempt ${attempt} failed, retrying... (${retries} retries left)`);
    }
    await new Promise(resolve => setTimeout(resolve, delay));
    return fetchWithRetry(url, options, retries - 1, delay, attempt + 1);
  }
};


// Endpoint to fetch and stream an image from Telegram
app.get("/api/images/:fileId", async (req, res) => {
  const { fileId } = req.params;
  try {
    // 1. Try to find image in database
    let image = await Image.findOne({ fileId });

    // 2. If image doesn't exist at all
    if (!image) {
      return res.status(404).send("Image not found");
    }
    let filePath = "";

    const response = await fetchWithRetry(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`,
      { method: 'GET' }
    );
    filePath = response.data.result.file_path;
    // 4. Extract and save filePath to DB
    image.filePath = response.data.result.file_path;
    await image.save();


    // Fetch the image file stream
    const fileStreamResponse = await fetchWithRetry(
      `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${filePath}`,
      { method: 'GET', responseType: 'stream' }
    );

    res.setHeader("Content-Type", "image/jpeg"); // Adjust MIME type if necessary
    pipeline(fileStreamResponse.data, res, (error) => {
      if (error) {
        console.error("Error streaming image: Premature Closure");
        if (!res.headersSent) res.status(500).send("Failed to fetch image");
      }
    });
  } catch (error) {
    console.error("Error fetching image from Telegram");
    if (!res.headersSent) res.status(500).send("Failed to fetch image");
  }
});

//---------------------------------------------------------------------------------------------------------------------------------------


//API which trigger the Chache Refresh

app.post('/post/addlike/:postId', async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ message: 'User not authenticated' });
  }

  const postId = req.params.postId;
  const userId = req.session.user._id;

  try {
    // 1. Find the post
    const post = await Post.findById(postId);
    if (!post) {
      return res.status(404).json({ message: 'Post not found' });
    }

    // 2. Atomic update: Add like if not exists + enforce 4000 limit
    const updateResult = await User.updateOne(
      { 
        _id: userId, 
        likes: { $ne: postId } // Check if not already liked
      },
      { 
        $push: { 
          likes: { 
            $each: [postId], // Add the new like
            $slice: -4000    // Keep only the last 4000 entries
          } 
        } 
      }
    );

    // 3. If no documents were updated, the user already liked the post
    if (updateResult.modifiedCount === 0) {
      return res.status(400).json({ message: 'You have already liked this post.' });
    }

    // 4. Update post likes count
    post.likes += 1;
    await post.save();
    await refreshAllCaches();

    res.status(200).json({ message: 'Like added successfully!', likes: post.likes });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error adding like', error });
  }
});


app.post('/post/create', upload, async (req, res) => {
  if (!req.session.user) {
    return res.status(401).send({ message: 'Unauthorized' });
  }

  const { title, bodyText, tag } = req.body;

  try {
    // Create the post first
    const post = new Post({
      title,
      bodyText,
      media: "", // This can be updated later if needed
      author: req.session.user.username,
      createdAt: new Date(),
      tags: ["recent", tag]
    });
    await post.save();

    // Use the post ID as the caption for images
    const postId = post._id.toString(); // Get the post ID as a string

    const images = req.files;

    // Send images to Telegram and save to MongoDB
    for (const image of images) {
      // Send the photo to the Telegram group
      const response = await bot.sendPhoto(
        process.env.TELEGRAM_GROUP_ID,
        image.buffer,
        {
          caption: `Post ID: ${postId}` // Only the post ID as caption
        }
      );
      // Check if the response contains a photo
      if (response.photo && response.photo.length > 0) {
        // Extract the highest resolution photo's file_id
        const highestResolutionPhotoId = response.photo[response.photo.length - 1].file_id;
        const messageId = response.message_id; // Get the message_id from the message
        const fileInfo = await bot.getFile(highestResolutionPhotoId);
        const imageDoc = new Image({
          postId: postId,
          fileId: highestResolutionPhotoId,
          caption: messageId, // Store messageId in the caption field
        });
        await imageDoc.save();
      } else {
        console.error("No photo found in message response:", response);
      }
    }
    await refreshAllCaches();

    console.log("New post made by " + req.session.user.username);
    res.status(201).json({ success: true, message: 'Posted', postId });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Failed to post', error });
  }
});



//---------------------------------------------------------------------------------------------------------------------------------------

// Donation route
app.get("/donation", (req, res) => {
  res.render("donation");
});

//Profile Route
app.get("/my-profile", async (req, res) => {

  if (!req.session.user) {
    return res.render("login"); // Renders login.ejs if user is not logged in
  }
  let user = null;
  user = await User.findById(req.session.user._id).exec();

  res.render("profile", { user });
});

const posts = require('./ApsaraBaazar.posts.json'); // make sure this file is in the same directory

// Replace with your actual domain
const baseUrl = 'https://apsarabazaar.onrender.com';

app.get('/sitemap.xml', (req, res) => {
  try {
    let sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    sitemap += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" `;
    sitemap += `xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" `;
    sitemap += `xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9 `;
    sitemap += `http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd">\n`; // Fixed typo here

    const staticPages = [
      { path: '/', lastmod: '2025-01-01' }, // Update date as needed
      { path: '/about', lastmod: '2025-01-01' },
      { path: '/donation', lastmod: '2025-01-01' },
      { path: '/contact', lastmod: '2025-01-01' }
    ];

    staticPages.forEach(({ path, lastmod }) => {
      sitemap += `
        <url>
          <loc>${baseUrl}${path}</loc>
          <lastmod>${lastmod}</lastmod>
          <changefreq>monthly</changefreq>
          <priority>0.8</priority>
        </url>`;
    });

    posts.forEach(post => {
      if (post._id?.$oid) {
        sitemap += `
          <url>
            <loc>${baseUrl}/post/details/${post._id.$oid}</loc>
            <changefreq>weekly</changefreq>
            <priority>0.5</priority>
          </url>`;
      }
    });

    sitemap += `\n</urlset>`;

    res.header('Content-Type', 'application/xml');
    res.send(sitemap);
  } catch (error) {
    console.error('Error generating sitemap:', error);
    res.status(500).send('Internal Server Error');
  }
});






const PORT = process.env.PORT || 3000;
const HOST = '::'; // Listen on all IPv6 addresses

const server = app.listen(PORT, HOST, () => {
  console.log(`Server running on http://[${HOST}]:${PORT}`);
});




// Function to update user activity
const updateUserActivity = (email) => {
  if (email) {
    activeUsers.set(email, Date.now());
  }
};

// Function to clean up inactive users (not active for 30 minutes)
const removeInactiveUsers = () => {
  const now = Date.now();
  const inactiveThreshold = 30 * 60 * 1000; // 30 minutes

  for (const [email, lastActive] of activeUsers.entries()) {
    if (now - lastActive > inactiveThreshold) {
      activeUsers.delete(email); // Use the 'email' variable from the loop
    }
  }
};

// Schedule cleanup every 10 minutes
setInterval(removeInactiveUsers, 10 * 60 * 1000);

// Function to get the current active user count
const getActiveUserCount = () => activeUsers.size;



const io = socketIo(server);
const users = new Map(); // To keep track of online users in different rooms


app.get("/chats", async (req, res) => {
  try {
    let user = null;
    let rooms = []; // Initialize rooms to an empty array

    if (req.session.user && req.session.user._id) {
      user = await User.findById(req.session.user._id).exec();
      updateUserActivity(req.session.user.email);

      if (user.rooms) {
        let roomCodes = user.rooms.split(','); // Assuming user.rooms is a comma-separated string of room codes

        // Fetch rooms that exist
        let existingRooms = await Room.find({ code: { $in: roomCodes } }).exec();
        let existingRoomCodes = new Set(existingRooms.map(room => room.code)); // Convert to Set for fast lookup

        // Remove room codes that don't exist from user's rooms
        let validRoomCodes = roomCodes.filter(code => existingRoomCodes.has(code));

        if (validRoomCodes.length !== roomCodes.length) {
          user.rooms = validRoomCodes.join(','); // Update user.rooms with only valid rooms
          await user.save(); // Save the updated user document
        }

        // Fetch the latest message for each room and filter rooms that have messages
        let filteredRooms = [];
        for (let room of existingRooms) {
          const hasMessages = await Message.exists({ roomCode: room.code });
          if (hasMessages) {
            const latestMessage = await Message.findOne({ roomCode: room.code }).sort({ timestamp: -1 }).exec();
            filteredRooms.push({ room, latestMessage });
          }
        }

        // Sort rooms based on the latest message timestamp (newest first)
        filteredRooms.sort((a, b) => b.latestMessage.timestamp - a.latestMessage.timestamp);

        // Extract sorted rooms from filteredRooms array
        rooms = filteredRooms.map(item => item.room);
      }
      let nuser = getActiveUserCount();

      return res.render("chat-lobby", { user, rooms, nuser }); // Pass sorted rooms
    }
    else {
      return res.render("login")
    }


  } catch (err) {
    console.error("Error fetching user", err);
    res.status(500).send("Server error");
  }
});




// API endpoint for sending messages
app.post("/send-message", (req, res) => {
  const { message, user, roomCode,name } = req.body;

  const timestamp = new Date();
  const offset = 5.5 * 60 * 60 * 1000; // IST offset in milliseconds
  timestamp.setTime(timestamp.getTime() + offset);
  console.log(message)

  if (!message) {
    return res.json({
      success: false,
      error: "Message cannot be empty",
    });
  }
  let msg;
  if(roomCode==="7UI3IX"){
    msg = new Message({
      user,
      name,
      msg: message,
      timestamp,
      roomCode,
    });

    msg.save().then(() => {
      io.to(roomCode).emit("chat message", {
        _id: msg._id,
        user,
        name,
        msg: message,
        timestamp,
      });

      // Notify users in the room
      users.get(roomCode).forEach((userName, username) => {
        io.to(username).emit("notification", {
          title: "New Message",
          body: `${user} sent a new message`,
        });
      });

      res.json({ success: true, _id: msg._id });
    })
    .catch((err) => {
      console.error("Error saving message:", err);
      res.json({ success: false, error: err.message });
    });

    
  }
  else{
    msg = new Message({
      user,
      msg: message,
      timestamp,
      roomCode,
    });

    msg.save().then(() => {
      io.to(roomCode).emit("chat message", {
        _id: msg._id,
        user,
        msg: message,
        timestamp,
      });

      // Notify users in the room
      users.get(roomCode).forEach((userName, username) => {
        io.to(username).emit("notification", {
          title: "New Message",
          body: `${user} sent a new message`,
        });
      });

      res.json({ success: true, _id: msg._id });
    })
    .catch((err) => {
      console.error("Error saving message:", err);
      res.json({ success: false, error: err.message });
    });
  }

  
});

// Endpoint for deleting messages
app.delete('/delete-message/:id', async (req, res) => {
  const { id } = req.params;

  try {
    // Find and delete the message by ID
    const message = await Message.findByIdAndDelete(id).exec();

    if (!message) {
      return res.status(404).json({ success: false, error: 'Message not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting message:', error);
    res.status(500).json({ success: false, error: 'An error occurred while deleting the message' });
  }
});

io.on("connection", (socket) => {
  console.log("A user connected");

  socket.on("join room", async ({ username, roomCode }) => {
    socket.join(roomCode);
    socket.username = username;
    socket.roomCode = roomCode;

    if (!users.has(roomCode)) {
      users.set(roomCode, new Map()); // Use a Map to store usernames and their real names
    }

    // Fetch the user's real name
    const user = await User.findOne({ username });
    const userName = user ? user.name : username; // Fallback to username if name is not found

    users.get(roomCode).set(username, userName);

    console.log(`${userName} has joined room ${roomCode}`);

    // Send message history for the room to the new user
    Message.find({ roomCode })
      .sort({ timestamp: 1 })
      .then((messages) => {
        socket.emit("message history", messages);
      })
      .catch((err) => {
        console.error("Error retrieving message history:", err);
      });

    // Broadcast updated user list to the room
    io.to(roomCode).emit("update users", Array.from(users.get(roomCode).values()));
  });

  socket.on("disconnect", () => {
    const { username, roomCode } = socket;

    if (roomCode && users.has(roomCode)) {
      const userMap = users.get(roomCode);
      if (userMap) {
        userMap.delete(username);

        if (userMap.size === 0) {
          users.delete(roomCode);
        }

        console.log(`${username} has left room ${roomCode}`);

        // Broadcast updated user list to the room
        io.to(roomCode).emit("update users", Array.from(userMap.values()));
      }
    }
  });
});









