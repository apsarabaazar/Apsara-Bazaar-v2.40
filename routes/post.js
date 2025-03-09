// routes/post.js
const express = require('express');
const router = express.Router();
const multer = require('multer');

const Post = require('../models/Post');
const User = require('../models/User');
const Image=require('../models/Image');
const Comments=require('../models/Comment');


const bot = require('../telegramBot');
const axios = require('axios');
const { pipeline } = require("stream");
const upload = multer().array('images', 10);

const compression = require('compression');
router.use(compression()); // Add at top of middleware chain

const https = require('https');


  
router.get("/comments/:postId", async (req, res) => {
    if (!req.session.user) {
      // User not authenticated; send 401 status
      return res.status(401).json({ message: 'User not authenticated' });
    }
  
    const postId = req.params.postId;
  
    try {
      // Find the post by postId
      const post = await Post.findById(postId).exec();
      if (!post) {
        return res.status(404).json({ message: "Post not found" });
      }
  
      // Find comments associated with the postId
      const comments = await Comments.find({ postId }).exec();

       // Fetch images associated with the post
       const images = await Image.find({ postId }).exec();
       const imageData = images.map(img => ({
         fileId: img.fileId,
         caption: img.caption,
         src: `/post/images/${img.fileId}` // Endpoint for serving images
       }));
       let user = null;
    if (req.session.user){
      user = await User.findById(req.session.user._id).lean().exec();
    }
  
      // If user is authenticated and post is found, render the comment page
      res.render("comment", { post,images: imageData ,user,comments });
    } catch (error) {
      console.error("Error fetching comments:", error);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

router.post("/comments/:postId/new", async (req, res) => {
    const postId = req.params.postId;
    const { commentBody } = req.body;

    try {
        // Create and save the new comment
        const newComment = new Comments({
            postId,
            Author: req.session.user.username, // Store the author's username
            body: commentBody,
        });
        await newComment.save();
         
        // Increment the comments count on the post
        await Post.findByIdAndUpdate(postId, { $inc: { comments: 1 } }); // Increment comments by 1
         //console.logh("New Comment added"+newComment)
        res.redirect(`/post/comments/${postId}`); // Redirect to the comments page
    } catch (error) {
        console.error("Error adding comment:", error);
        res.status(500).send("Internal Server Error");
    }
});

router.post("/comments/:postId/reply", async (req, res) => {
    const postId = req.params.postId;
    const { parentCommentId, replyBody } = req.body;

    try {
        // Find the parent comment by ID
        const parentComment = await Comments.findById(parentCommentId);
        
        if (!parentComment) {
            return res.status(404).send("Parent comment not found");
        }

        // Create the reply object
        const reply = {
            username: req.session.user.username, // Username of the replier
            content: replyBody // Content of the reply
        };

        // Push the reply into the parent's subBody array
        parentComment.subBody.push(reply);
        await parentComment.save();

        // Increment the comments count on the post
        await Post.findByIdAndUpdate(postId, { $inc: { comments: 1 } }); // Increment comments by 1
        console.log("Reply to Comment Added"+reply)
        res.redirect(`/post/comments/${postId}`);
    } catch (error) {
        console.error("Error adding reply:", error);
        res.status(500).send("Internal Server Error");
    }
});

router.get("/details/:postId", async (req, res) => {
  // if (!req.session.user) return res.render("login");

  try {
    const { postId } = req.params;
    
    // Fetch post and images
    const [post, images] = await Promise.all([
      Post.findById(postId).lean(),
      Image.find({ postId }).lean()
    ]);

    if (!post) return res.status(404).json({ error: "Post not found" });

    // For each image, fetch the fresh filePath from Telegram and update locally only
    const refreshedImages = await Promise.all(
      images.map(async (img) => {
        try {
          const response = await axios.get(
            `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${img.fileId}`
          );
          const newFilePath = response.data.result.file_path;
          return { ...img, filePath: newFilePath };
        } catch (error) {
          console.error(`Error fetching file path for ${img.fileId}:`, error);
          // Return the image object as-is in case of an error
          return img;
        }
      })
    );

    // Map the images to the data needed for rendering
    const imageData = refreshedImages.map(img => ({
      fileId: img.fileId,
      caption: img.caption,
      src: img.filePath 
        ? `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${img.filePath}`
        : `/post/images/${img.fileId}` // Fallback route if filePath is missing
    }));


    let user = null;
    if (req.session.user){
      user = await User.findById(req.session.user._id).lean().exec();
    }
    

    res.render("post-details", {
      post,
      images: imageData,
      user
    });

  } catch (error) {
    console.error("Error fetching post details:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});




// router.get("/details/:postId", async (req, res) => {
//   if (!req.session.user) return res.render("login");

//   try {
//     const { postId } = req.params;
    
//     // Fetch post and images in parallel
//     const [post, images] = await Promise.all([
//       Post.findById(postId).lean(),
//       Image.find({ postId }).lean()
//     ]);

//     if (!post) return res.status(404).json({ error: "Post not found" });

//     const imageData = images.map(img => ({
//       fileId: img.fileId,
//       caption: img.caption,
//       src: `/post/images/${img.fileId}`
//     }));

//     let user = await User.findById(req.session.user._id).lean().exec();

//     res.render("post-details", {
//       post,
//       images: imageData,
//       user: user
//     });

//   } catch (error) {
//     console.error("Error fetching post details:", error);
//     res.status(500).json({ error: "Internal Server Error" });
//   }
// });
  
  router.get("/images/:fileId", async (req, res) => {
    const { fileId } = req.params;
  
    try {
      // 1. Try to find image in database
      let image = await Image.findOne({ fileId });
      
      // 2. If image doesn't exist at all
      if (!image) {
        return res.status(404).send("Image not found");
      }
  
      // 3. If image exists but lacks filePath
      if (!image.filePath) {
        console.log(`Fetching filePath for ${fileId} from Telegram...`);
        const response = await axios.get(
          `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`
        );
        
        // 4. Extract and save filePath to DB
        image.filePath = response.data.result.file_path;
        await image.save();
        console.log(`Updated filePath for ${fileId} in database`);
      }
  
      // 5. Stream using either existing or newly stored filePath
      const imageUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${image.filePath}`;
      
      // 6. Stream with native HTTPS for better performance
      https.get(imageUrl, (telegramRes) => {
        // Set dynamic Content-Type based on file extension
        const extension = image.filePath.split('.').pop();
        res.setHeader("Content-Type", `image/${extension === 'jpg' ? 'jpeg' : extension}`);
        
        telegramRes.pipe(res);
      }).on('error', (err) => {
        console.error("Stream error:", err);
        if (!res.headersSent) res.status(500).send("Failed to fetch image");
      });
  
    } catch (error) {
      console.error("Error in image retrieval:", error);
      
      // Handle specific Telegram API errors
      if (error.response?.data?.description?.includes("file not found")) {
        if (!res.headersSent) res.status(404).send("Image not found on Telegram");
        return;
      }
  
      if (!res.headersSent) {
        res.status(500).send("Internal Server Error");
      }
    }
  });
  
  
  

module.exports = router;
