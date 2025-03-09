// models/Comment.js
const mongoose = require("mongoose");

const commentSchema = new mongoose.Schema({
  postId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true, // Reference to the post
    ref: "Post", // Reference to the Post model
  },
  Author: {
    type: String, // Store the session user's ID or email
    required: false, // Author is required
  },
  body: {
    type: String,
    required: false, // Body is required
    validate: {
      validator: function (value) {
        return value.trim().length > 0; // Ensure body is not empty
      },
      message: "Comment body cannot be empty.",
    },
  },
  subBody:[{
        username: { type: String, required: false }, // Email of the sub-author
        content: { type: String, required: false } // Content of the reply
    }]
   

});

module.exports =mongoose.model('Comment',commentSchema);
