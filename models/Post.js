// models/Post.js
const mongoose = require("mongoose");

const postSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true, // Title is required
  },
  bodyText: {
    type: String,
    required: true, // Body text is required
  },
  author: {
    type: String, // Store the session user's username
    required: true, // Author is required
  },
  uploadTime: {
    type: Date,
    default: Date.now, // Default to current date and time
  },
  status:{
    type:String,
    default:"Ok"
  },
  likes: {
    type: Number,
    default: 0, // Default likes
  },
  comments: {
    type: Number,
    default: 0, // Default number of comments
  },
  tags: {
    type: [String], // Array of strings for tags
    default: [], // Default to an empty array
  },
});

// Export the schema itself if you want to create the model elsewhere
module.exports =mongoose.model('Post',postSchema);

