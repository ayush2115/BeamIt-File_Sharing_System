// server.js
const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Rooms map
const rooms = new Map();

// WebSocket connection handler
wss.on('connection', (ws) => {
    console.log('Client connected');
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            handleMessage(ws, data);
        } catch (error) {
            console.error('Error parsing message:', error);
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Invalid message format'
            }));
        }
    });
    
    ws.on('close', () => {
        console.log('Client disconnected');
        // Find and remove client from any room
        for (const [roomId, roomData] of rooms.entries()) {
            if (roomData.clients.has(ws)) {
                roomData.clients.delete(ws);
                
                // Notify other clients in the room
                for (const client of roomData.clients) {
                    if (client !== ws && client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({
                            type: 'peer_left',
                            roomId
                        }));
                    }
                }
                
                // Remove room if empty
                if (roomData.clients.size === 0) {
                    rooms.delete(roomId);
                    console.log(`Room ${roomId} removed (empty)`);
                }
                
                break;
            }
        }
    });
});

// Message handler
function handleMessage(ws, data) {
    switch (data.type) {
        case 'create_room':
            createRoom(ws);
            break;
        case 'join_room':
            joinRoom(ws, data.roomId);
            break;
        case 'offer':
        case 'answer':
        case 'ice_candidate':
            relayMessage(ws, data);
            break;
        default:
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Unknown message type'
            }));
    }
}

// Create a new room
function createRoom(ws) {
    const roomId = uuidv4().substring(0, 8);
    rooms.set(roomId, {
        clients: new Set([ws]),
        created: Date.now()
    });
    
    console.log(`Room ${roomId} created`);
    
    ws.send(JSON.stringify({
        type: 'room_created',
        roomId
    }));
}

// Join an existing room
function joinRoom(ws, roomId) {
    const room = rooms.get(roomId);
    
    if (!room) {
        ws.send(JSON.stringify({
            type: 'error',
            message: 'Room not found'
        }));
        return;
    }
    
    if (room.clients.size >= 2) {
        ws.send(JSON.stringify({
            type: 'error',
            message: 'Room is full'
        }));
        return;
    }
    
    // Add client to room
    room.clients.add(ws);
    
    console.log(`Client joined room ${roomId}`);
    
    // Notify the joining client
    ws.send(JSON.stringify({
        type: 'room_joined',
        roomId
    }));
    
    // Notify the other client
    for (const client of room.clients) {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
                type: 'peer_joined',
                roomId
            }));
        }
    }
}

// Relay WebRTC signaling messages
function relayMessage(ws, data) {
    const { roomId } = data;
    const room = rooms.get(roomId);
    
    if (!room) {
        ws.send(JSON.stringify({
            type: 'error',
            message: 'Room not found'
        }));
        return;
    }
    
    // Relay the message to the other peer in the room
    for (const client of room.clients) {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    }
}

// Clean up old rooms periodically (room expires after 1 hour)
setInterval(() => {
    const now = Date.now();
    for (const [roomId, roomData] of rooms.entries()) {
        if (now - roomData.created > 60 * 60 * 1000) {
            // Notify clients
            for (const client of roomData.clients) {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({
                        type: 'error',
                        message: 'Room expired'
                    }));
                }
            }
            
            // Remove room
            rooms.delete(roomId);
            console.log(`Room ${roomId} removed (expired)`);
        }
    }
}, 15 * 60 * 1000); // Check every 15 minutes

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});