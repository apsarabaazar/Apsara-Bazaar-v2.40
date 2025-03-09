// models/Message.js
const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    user: { type: String, required: true },
    name:{ type: String,  required:false , default:""},
    msg: { type: String, required: true }, // Store both text and image URL
    timestamp: { type: Date, default: Date.now },
    roomCode: { type: String, required: true } // Store room code here
});

const Message = mongoose.model('Message', messageSchema);
module.exports = Message;
