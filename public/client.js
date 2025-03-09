document.addEventListener('DOMContentLoaded', () => {
    const socket = io();

    const name = document.querySelector('meta[name="name"]').getAttribute('content');
    const username = document.querySelector('meta[name="username"]').getAttribute('content');
    const roomCode = document.querySelector('meta[name="room-code"]').getAttribute('content');

    if (!username || !roomCode) {
        console.error('Username or room code not found in meta tags.');
        return;
    }

    socket.emit('join room', { username, roomCode });

    socket.on('update users', (users) => {
        const onlineUserDiv = document.querySelector('.online-users');
        if (onlineUserDiv) {
            onlineUserDiv.innerHTML = '';
    
            const header = document.createElement('div');
            header.innerHTML = `<div class="active-user-logo"></div> `;
            onlineUserDiv.appendChild(header);
    
            const userList = document.createElement('div');
            userList.className = 'user-list';
    
            // Extract first names
            const displayNames = users.map(user => {
                const firstName = user.split(" ")[0]; // Get first part of the name
                return firstName === username.split(" ")[0] ? name.split(" ")[0] : firstName;
            });
    
            userList.textContent = displayNames.join(', ');
            onlineUserDiv.appendChild(userList);
        } else {
            console.error('Element with class "online-users" not found.');
        }
    });
    

    let lastDate = null;

    socket.on('message history', (messages) => {
        console.log('Message history received:', messages);
        messages.forEach((message) => {
            const messageDate = extractDateFromTimestamp(message.timestamp);
            if (lastDate !== messageDate) {
                addDateLog(messageDate);
                lastDate = messageDate;
            }
            addMessage(message._id, message.user, message.msg, new Date(message.timestamp));
        });
    });

    socket.on('chat message', (data) => {
        console.log('Incoming message:', data);
        const messageDate = extractDateFromTimestamp(data.timestamp);
        
        addMessage(data._id, data.user, data.msg, new Date(data.timestamp), data.image);
    });

    function addMessage(id, user, msg, timestamp, media) {
        const item = document.createElement('li');
        item.className = user === username ? 'user-message' : 'other-message';
        item.dataset.id = id;

        if (msg) {
            const isImage = /\.(png|jpg|jpeg)$/.test(msg);
            const isVideo = /\.(mp4|webm|ogg)$/.test(msg);
            if (isImage) {
                const imageElement = document.createElement('img');
                imageElement.src = msg;
                imageElement.className = 'chat-image';
                imageElement.loading = 'lazy';
                item.appendChild(imageElement);
                imageElement.addEventListener('click', () => {
                    openFullPageImage(msg);
                });
            } else if (isVideo) {
                const videoElement = document.createElement('video');
                videoElement.src = msg;
                videoElement.className = 'chat-video';
                videoElement.controls = true;
                videoElement.loading = 'lazy';
                item.appendChild(videoElement);
                item.classList.add('video-view');
                videoElement.addEventListener('click', () => {
                    openFullPageVideo(msg);
                });
            } else {
                const messageText = document.createElement('span');
                if (msg.length > 28) {
                    messageText.style.width = "100%";
                    messageText.style.marginRight = "12px";
                    messageText.style.paddingBottom = "6px";
                }
                
                
                messageText.textContent = msg;
                item.appendChild(messageText);
            }
        }

        const timeElement = document.createElement('p');
        timeElement.className = 'm-time';
        const timeString = getFormattedTime(timestamp);
        timeElement.textContent = timeString;
        item.appendChild(timeElement);

        const messagesContainer = document.getElementById('messages');
        if (messagesContainer) {
            messagesContainer.appendChild(item);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        } else {
            console.error('Element with ID "messages" not found.');
        }

        let holdTimeout;

        function showDeleteConfirmation() {
            const deleteConfirmed = confirm('Do you want to delete this message?');
            if (deleteConfirmed) {
                deleteMessage(id, msg);
            }
        }

        item.addEventListener('mousedown', () => {
            holdTimeout = setTimeout(showDeleteConfirmation, 750);
        });

        item.addEventListener('mouseup', () => {
            clearTimeout(holdTimeout);
        });

        item.addEventListener('mouseleave', () => {
            clearTimeout(holdTimeout);
        });

        item.addEventListener('touchstart', () => {
            holdTimeout = setTimeout(showDeleteConfirmation, 750);
        });

        item.addEventListener('touchend', () => {
            clearTimeout(holdTimeout);
        });

        item.addEventListener('touchmove', () => {
            clearTimeout(holdTimeout);
        });
    }

    function deleteMessage(id, mediaUrl) {
        fetch(`/delete-message/${id}?mediaUrl=${encodeURIComponent(mediaUrl)}`, {
            method: 'DELETE'
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                const messageItem = document.querySelector(`li[data-id="${id}"]`);
                if (messageItem) {
                    messageItem.remove();
                }
            } else {
                console.error('Error deleting message:', data.error);
            }
        })
        .catch(error => {
            console.error('Error deleting message:', error);
        });
    }

    function extractDateFromTimestamp(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleString('en-US', { month: 'short', day: '2-digit' }).toUpperCase();
    }
    
    function getFormattedTime(date) {
        let hours = date.getUTCHours();
        const minutes = date.getUTCMinutes();
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12;
        hours = hours ? hours : 12;
        const minutesStr = minutes < 10 ? '0' + minutes : minutes;
        return hours + ':' + minutesStr + ' ' + ampm;
    }

    function addDateLog(date) {
        const item = document.createElement('li');
        item.className = 'date-log';
        item.textContent = date;
        const messagesContainer = document.getElementById('messages');
        if (messagesContainer) {
            messagesContainer.appendChild(item);
        } else {
            console.error('Element with ID "messages" not found.');
        }
    }

    document.getElementById('form').addEventListener('submit', (event) => {
        event.preventDefault();
        const input = document.getElementById('input');
    
        if (input.value) {   
            console.log(input.value)
            fetch('/send-message', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json' // Add this line
                },
                body: JSON.stringify({
                    message: document.getElementById("input").value,
                    user: username,
                    roomCode: roomCode,
                  })
            })
            .then(response => {
                if (!response.ok) {
                    throw new Error('Network response was not ok');
                }
                return response.json();
            })
            .then(data => {
                if (data.success) {
                    const messageDate = extractDateFromTimestamp(new Date().toISOString());
                    if (lastDate !== messageDate) {
                        lastDate = messageDate;
                    }
                    socket.emit('chat message', { 
                        _id: data._id, 
                        user: username, 
                        msg: input.value, 
                        timestamp: new Date().toISOString(), 
                        roomCode 
                    });
                    input.value = '';
                } else {
                    console.error('Error sending message:', data.error);
                }
            })
            .catch(error => {
                console.error('Error sending message:', error);
            });
        }
    });
    

});

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/service-worker.js')
        .then(registration => {
          console.log('Service Worker registered with scope:', registration.scope);
        })
        .catch(error => {
          console.log('Service Worker registration failed:', error);
        });
    });
  }
  


