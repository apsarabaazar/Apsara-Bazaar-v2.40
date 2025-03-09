const express = require('express');
const router = express.Router();
const Post = require('../models/Post');
const User = require('../models/User');
const Image = require('../models/Image');
const Comments = require('../models/Comment');
const axios = require('axios');
const { pipeline } = require("stream");
const pLimit = require('p-limit').default;
// Concurrency control (max 5 concurrent requests)
const limit = pLimit(5);

// Define the route to get comments by username
router.post('/comments', async (req, res) => {
    const { username } = req.body;

    try {
        // Find comments where the Author is the username or any subBody item has the username
        const comments = await Comments.find({
            $or: [
                { Author: username },
                { 'subBody.username': username }
            ]
        }).sort({ _id: -1 }); // Sorts in descending order by _id (newest first)

        // Send back the comments
        res.json(comments);
    } catch (error) {
        console.error("Error fetching User comments:");
        res.status(500).json({ message: "Error fetching comments" });
    }
});

// Function to retry axios requests a number of times with timeout handling
const fetchWithRetry = async (url, options, retries = 2, delay = 750, attempt = 1) => {
    try {

        const timeout = 2000;
        // Add timeout to the request options
        const response = await axios({
            url,
            method: options.method,
            timeout, // Timeout option
            responseType: options.responseType || 'json', // Default to JSON if not provided
        });

        if (attempt === 1) {
            // No log for the first successful attempt
        } else {
            console.log(`Fetch successful on attempt ${attempt}.`);
        }

        return response;
    } catch (error) {
        if (retries === 0) {
            console.error(`Request failed after multiple attempts.`);
            throw error; // If retries are exhausted, throw error
        }

        // Check if the error is due to a timeout
        if (error.code === 'ECONNABORTED') {
            console.warn(`Timeout occurred on attempt ${attempt}, retrying... (${retries} retries left)`);
        } else {
            console.warn(`Attempt ${attempt} failed, retrying... (${retries} retries left)`);
        }

        // Retry after delay
        await new Promise(resolve => setTimeout(resolve, delay)); // Wait before retrying
        return fetchWithRetry(url, options, retries - 1, delay, attempt + 1); // Recursive retry with updated attempt count
    }
};


// Route to get paginated posts by username
router.post('/posts', async (req, res) => {
    const { username, skip, limit } = req.body;

    try {
        // Fetch posts by username with pagination
        const posts = await Post.find({ author: username })
            .sort({ uploadTime: -1 })
            .skip(skip)
            .limit(limit)
            .exec();

        // Fetch associated images for each post
        const postsWithImages = await Promise.all(posts.map(async (post) => {
            try {
                const images = await Image.find({ postId: post._id }).exec();
                const imageData = images.map(img => ({
                    fileId: img.fileId,
                    caption: img.caption,
                    src: `/user/images/${img.fileId}`  // Endpoint for serving images
                }));
                return { post, images: imageData };
            } catch (err) {
                console.error(`Error fetching images for post ${post._id}:`);
                // Return post without images if there's an error
                return { post, images: [] };
            }
        }));

        // Send the posts with images to the client
        res.json(postsWithImages);
    } catch (error) {
        console.error("Error fetching user posts:");
        res.status(500).json({ message: "Error fetching user posts" });
    }
});

// Route to fetch images from Telegram by file ID
router.get('/images/:fileId', async (req, res) => {
    const { fileId } = req.params;

    // Check if Telegram bot token is available
    if (!process.env.TELEGRAM_BOT_TOKEN) {
        return res.status(500).send("Telegram bot token is not configured.");
    }

    try {
        // Fetch file path from Telegram API with retry logic
        const response = await fetchWithRetry(
            `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`,
            { method: 'GET' }
        );
        const filePath = response.data.result.file_path;

        // Stream the file from Telegram to the client
        const fileStreamResponse = await fetchWithRetry(
            `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${filePath}`,
            { method: 'GET', responseType: 'stream' }
        );

        const fileStream = fileStreamResponse.data;

        // Set headers for image streaming based on file extension (if available)
        const extension = filePath.split('.').pop();
        const contentType = extension === 'png' ? 'image/png' : 'image/jpeg';
        res.setHeader("Content-Type", contentType);

        // Stream the file directly to the client
        fileStream.pipe(res);
    } catch (error) {
        console.error("Error fetching image:");
        res.status(500).send("Failed to fetch image after retries.");
    }
});

// Assuming session middleware is set up to store user info
router.get('/profile/:username', async (req, res) => {
    const { username } = req.params;

    try {
        if (!req.session.user) {
            return res.render("login"); // Renders login.ejs if user is not logged in
        }
        // Check if the session user is the same as the requested username
        if (req.session.user && req.session.user.username === username) {
            return res.redirect('/my-profile');
        }

        // Fetch the user details from the database
        const user = await User.findOne({ username }).exec();
        if (!user) {
            return res.status(404).send('User not found');
        }

        // Render the my-profile.ejs view with the user's details
        res.render('profile', { user });
    } catch (error) {
        console.error("Error fetching user profile:", error);
        res.status(500).send("Server error");
    }
});

router.get("/liked-posts", async (req, res) => {
    try {
        // Check if user is authenticated
        if (!req.session.user) {
            return res.status(401).redirect("/auth/login"); // Or handle differently
        }

        // Parse pagination parameters
        const skip = parseInt(req.query.skip) || 0;
        const limit = parseInt(req.query.limit) || 10;

        // Get user with likes array
        const user = await User.findById(req.session.user._id).lean();
        if (!user) {
            return res.status(404).send("User not found");
        }

        // Handle case where user has no likes
        if (!user.likes || user.likes.length === 0) {
            return res.render("user-likes", { posts: [] });
        }

        // Create a reversed copy of user.likes so that the last items become the first
        const reversedLikes = [...user.likes].reverse();

        // Get paginated post IDs from the reversed array
        const slicedIds = reversedLikes.slice(skip, skip + limit);

        // Get posts maintaining order from slicedIds
        const posts = await Post.find({ _id: { $in: slicedIds } }).lean();

        // Sort posts to match slicedIds order
        const postMap = {};
        posts.forEach(post => postMap[post._id.toString()] = post);
        const orderedPosts = slicedIds.map(id => postMap[id.toString()]).filter(Boolean);

        // Get images for these posts
        const postIds = orderedPosts.map(post => post._id);
        const images = await Image.find({ postId: { $in: postIds } }).lean();
        const imagesByPostId = await mapImagesByPostIdAsync(images);

        // Combine posts with images
        const postsWithImages = orderedPosts.map(post => ({
            ...post,
            images: imagesByPostId[post._id] || [],
        }));

        res.render("user-personalised-posts", {
            posts: postsWithImages,
            pagination: {
                skip: skip + limit,
                limit,
                hasMore: user.likes.length > skip + limit
            }
        });

    } catch (error) {
        console.error("Error fetching liked posts:", error);
        res.status(500).send("Internal Server Error");
    }
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
        }
        catch (error) {
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
            console.log(`Error fetching file path for ${image.fileId}`);
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




module.exports = router;