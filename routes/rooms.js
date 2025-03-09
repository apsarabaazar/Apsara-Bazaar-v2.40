
const express = require('express');
const router = express.Router();
const Room = require('../models/Room'); // Import the Room model
const User = require('../models/User'); // Import the User model


router.post('/join', async (req, res) => {
    const { username } = req.body;

    try {
        const requser = await User.findOne({ username }).exec();
        if (!requser) {
            return res.json({ success: false, error: 'User not Found' });
        }

        const sessionUser = await User.findById(req.session.user._id).exec();

        const room = await Room.findOne({
            "users.email": { $all: [requser.email, sessionUser.email] }
        }).lean().exec();

        if(sessionUser.email===requser.email){
            return res.json({ success: false, error: `Can't chat with yourself.` });
        }



        if (!room) {
            // Create a new room
            const newRoom = new Room({
                name: `${requser.name} - ${sessionUser.name}`,
                code: generateRoomCode(),
                users: [{ email: requser.email }, { email: sessionUser.email }]
            });

            await newRoom.save();

            sessionUser.rooms = [...(sessionUser.rooms?.split(',') || []), newRoom.code].join(',');
            requser.rooms = [...(requser.rooms?.split(',') || []), newRoom.code].join(',');

            await sessionUser.save();
            await requser.save();
             // Extract the other user's name
         const otherUserName = newRoom.name.split(' - ').find(n => n !== sessionUser.name);

            return res.json({
                success: true,
                room: true,
                name:sessionUser.name,
                username: sessionUser.username,
                roomName: otherUserName,  // Sending only the other user's name
                roomCode: newRoom.code
            });
        }

        
         // Extract the other user's name
         const otherUserName = room.name.split(' - ').find(n => n !== sessionUser.name);
    
         return res.json({
             success: true,
             room: true,
             name:sessionUser.name,
             username: sessionUser.username,
             roomName: otherUserName,  // Sending only the other user's name
             roomCode: room.code
         });

    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});


// Chat Routes
router.get('/chat', async (req, res) => {
    if (!req.session.user) { // Assuming 'user' is stored in session after login
        res.redirect('/'); // Redirect to the homepage if logged in
    } else {
        const { username, name, roomCode, roomName } = req.query;
        
        try {
            // Fetch room details using roomCode from the database
            const room = await Room.findOne({ code: roomCode });
            
            if (!room) {
                return res.status(404).send('Room not found'); // Handle case where room is not found
            }
            if(roomName==="General Chat Room"){
                return  res.render('general-chat', { 
                    username, 
                    name, 
                    roomCode, 
                    roomName, 
                    // room:roomDetails 
                });
            }

            // Extract the user who is not the session user
            const sessionUserEmail = req.session.user.email;
            const otherUser = room.users.find(user => user.email !== sessionUserEmail);

            // If no other user is found, handle the case appropriately
            if (!otherUser) {
                return res.status(404).send('No other user found in this room');
            }

            // Fetch the username of the other user using their email
            const otherUserDetails = await User.findOne({ email: otherUser.email });

            if (!otherUserDetails) {
                return res.status(404).send('User not found');
            }

            // Prepare the data to send to the view
            const roomDetails = {
                roomname: room.name,
                name:otherUserDetails.name,
                username: otherUserDetails.username // Send the username of the other user
            };

            // Render the chat page with the room details and the other user's username
            res.render('chat', { 
                username, 
                name, 
                roomCode, 
                roomName, 
                room:roomDetails 
            });
        } catch (error) {
            console.error('Error fetching room details:', error);
            res.status(500).send('Server error');
        }
    }
});




// Function to generate a unique room code
function generateRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}



module.exports = router;