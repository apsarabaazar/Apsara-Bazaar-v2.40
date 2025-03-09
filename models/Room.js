// models/Room.js
const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema({
    name: { type: String, required: true }, // Name of the room
    users:[{
        email: { type:String },
    }],
    code: { type: String, unique: true, required: true } // Unique code for the room
});

const Room = mongoose.model('Room', roomSchema);
module.exports = Room;
