
const http = require("http");
const WebSocket = require("ws");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
        status: "online",
        service: "MeetScreen Server"
    }));
});

const wss = new WebSocket.Server({ server });

const rooms = new Map();

function send(socket, data) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(data));
    }
}

function sendError(socket, message) {
    send(socket, {
        type: "error",
        message: message
    });
}

//==================================================
// ROOM ID GENERATOR
// Format: NNNN X N DD YYYY
// Example: 7294X8072026
//==================================================

function generateRoomId() {
    const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";

    let id;

    do {
        const randomNumbers =
            crypto.randomInt(0, 10000).toString().padStart(4, "0");

        const randomLetter =
            letters[crypto.randomInt(0, letters.length)];

        const randomDigit =
            crypto.randomInt(0, 10).toString();

        const now = new Date();

        const day = now.getUTCDate().toString().padStart(2, "0");
        const year = now.getUTCFullYear().toString();

        id = randomNumbers + randomLetter + randomDigit + day + year;

    } while (rooms.has(id));

    return id;
}

//==================================================
// PARTICIPANTS
//==================================================

function getParticipants(room) {
    return Array.from(room.participants.values()).map(player => ({
        id: player.id,
        name: player.name,
        is_host: player.is_host
    }));
}

function getWaitingParticipants(room) {
    return Array.from(room.waiting.values()).map(request => ({
        id: request.id,
        name: request.name
    }));
}

function updateParticipants(room) {
    const message = {
        type: "participants_updated",
        participants: getParticipants(room)
    };

    for (const player of room.participants.values()) {
        send(player.socket, message);
    }
}

function updateWaiting(room) {
    const host = room.participants.get(room.hostId);

    if (!host) return;

    send(host.socket, {
        type: "waiting_participants_updated",
        waiting_participants: getWaitingParticipants(room)
    });
}

//==================================================
// WAITING REQUEST CLEANUP
//==================================================

function removeWaitingRequest(socket) {
    if (!socket.pendingRoomId || !socket.pendingRequestId) {
        return;
    }

    const room = rooms.get(socket.pendingRoomId);

    if (room) {
        room.waiting.delete(socket.pendingRequestId);
        updateWaiting(room);
    }

    socket.pendingRoomId = null;
    socket.pendingRequestId = null;
}

//==================================================
// LEAVE ROOM
//==================================================

function leaveRoom(socket) {

    // Remove a pending request if the user was waiting.

    if (socket.pendingRoomId) {
        removeWaitingRequest(socket);
        return;
    }

    if (!socket.roomId || !socket.playerId) {
        return;
    }

    const room = rooms.get(socket.roomId);

    if (!room) {
        socket.roomId = null;
        socket.playerId = null;
        return;
    }

    const player = room.participants.get(socket.playerId);

    if (!player) {
        socket.roomId = null;
        socket.playerId = null;
        return;
    }

    room.participants.delete(socket.playerId);

    console.log("Participant left:", player.name);

    // Delete room when the last participant leaves.

    if (room.participants.size === 0) {
        rooms.delete(socket.roomId);

        console.log("Room deleted:", socket.roomId);
    } else {

        // Transfer host rights if the host leaves.

        if (room.hostId === socket.playerId) {
            const newHost = room.participants.values().next().value;

            room.hostId = newHost.id;
            newHost.is_host = true;

            console.log("New host:", newHost.name);
        }

        updateParticipants(room);
        updateWaiting(room);
    }

    socket.roomId = null;
    socket.playerId = null;
}

//==================================================
// WEBSOCKET CONNECTION
//==================================================

wss.on("connection", socket => {
    socket.roomId = null;
    socket.playerId = null;

    socket.pendingRoomId = null;
    socket.pendingRequestId = null;

    console.log("New client connected.");

    send(socket, {
        type: "connected",
        message: "Connected to MeetScreen Server"
    });

    socket.on("message", rawData => {
        let data;

        try {
            data = JSON.parse(rawData.toString());
        } catch {
            sendError(socket, "Invalid JSON");
            return;
        }

        if (!data || typeof data.type !== "string") {
            sendError(socket, "Invalid message");
            return;
        }

        //==================================================
        // CREATE ROOM
        //==================================================

        if (data.type === "create_room") {

            if (socket.roomId || socket.pendingRoomId) {
                sendError(socket, "You are already in a room or waiting for approval");
                return;
            }

            const name = String(data.name || "").trim();

            if (name.length < 3 || name.length > 25) {
                sendError(socket, "Name must be 3-25 characters");
                return;
            }

            const roomId = generateRoomId();
            const playerId = crypto.randomUUID();

            const player = {
                id: playerId,
                name: name,
                is_host: true,
                socket: socket
            };

            const room = {
                id: roomId,
                hostId: playerId,
                participants: new Map(),
                waiting: new Map()
            };

            room.participants.set(playerId, player);
            rooms.set(roomId, room);

            socket.roomId = roomId;
            socket.playerId = playerId;

            console.log("Room created:", roomId);

            send(socket, {
                type: "room_created",
                room_id: roomId,
                self_id: playerId,
                participants: getParticipants(room)
            });

            updateParticipants(room);
            updateWaiting(room);

            return;
        }

        //==================================================
        // REQUEST TO JOIN ROOM
        //==================================================

        if (data.type === "join_room") {

            if (socket.roomId || socket.pendingRoomId) {
                sendError(socket, "You are already in a room or waiting for approval");
                return;
            }

            const roomId = String(data.room_id || "")
                .trim()
                .toUpperCase();

            const name = String(data.name || "").trim();

            if (name.length < 3 || name.length > 25) {
                sendError(socket, "Name must be 3-25 characters");
                return;
            }

            if (!roomId) {
                sendError(socket, "Enter a meeting ID");
                return;
            }

            const room = rooms.get(roomId);

            if (!room) {
                sendError(socket, "Room not found");
                return;
            }

            const host = room.participants.get(room.hostId);

            if (!host || host.socket.readyState !== WebSocket.OPEN) {
                sendError(socket, "Host is currently unavailable");
                return;
            }

            const requestId = crypto.randomUUID();

            const request = {
                id: requestId,
                name: name,
                socket: socket
            };

            room.waiting.set(requestId, request);

            socket.pendingRoomId = roomId;
            socket.pendingRequestId = requestId;

            console.log(
                "Join request:",
                name,
                "->",
                roomId
            );

            // Tell the joining user that the request was received.

            send(socket, {
                type: "join_pending",
                room_id: roomId,
                request_id: requestId,
                message: "Waiting for host approval"
            });

            // Notify the host.

            updateWaiting(room);

            return;
        }

        //==================================================
        // APPROVE JOIN REQUEST
        //==================================================

        if (data.type === "approve_join") {

            if (!socket.roomId || !socket.playerId) {
                sendError(socket, "You are not in a room");
                return;
            }

            const room = rooms.get(socket.roomId);

            if (!room) {
                sendError(socket, "Room not found");
                return;
            }

            if (room.hostId !== socket.playerId) {
                sendError(socket, "Only the host can approve requests");
                return;
            }

            const requestId = String(data.request_id || "");
            const request = room.waiting.get(requestId);

            if (!request) {
                sendError(socket, "Join request not found");
                updateWaiting(room);
                return;
            }

            const joiningSocket = request.socket;

            if (joiningSocket.readyState !== WebSocket.OPEN) {
                room.waiting.delete(requestId);
                updateWaiting(room);
                return;
            }

            const playerId = crypto.randomUUID();

            const player = {
                id: playerId,
                name: request.name,
                is_host: false,
                socket: joiningSocket
            };

            // Remove from waiting list.

            room.waiting.delete(requestId);

            joiningSocket.pendingRoomId = null;
            joiningSocket.pendingRequestId = null;

            // Add to actual participants.

            room.participants.set(playerId, player);

            joiningSocket.roomId = room.id;
            joiningSocket.playerId = playerId;

            console.log(
                "Join request approved:",
                request.name,
                "->",
                room.id
            );

            // Notify the accepted user.

            send(joiningSocket, {
                type: "joined",
                room_id: room.id,
                self_id: playerId,
                participants: getParticipants(room)
            });

            // Update room participants and host waiting list.

            updateParticipants(room);
            updateWaiting(room);

            return;
        }

        //==================================================
        // REJECT JOIN REQUEST
        //==================================================

        if (data.type === "reject_join") {

            if (!socket.roomId || !socket.playerId) {
                sendError(socket, "You are not in a room");
                return;
            }

            const room = rooms.get(socket.roomId);

            if (!room) {
                sendError(socket, "Room not found");
                return;
            }

            if (room.hostId !== socket.playerId) {
                sendError(socket, "Only the host can reject requests");
                return;
            }

            const requestId = String(data.request_id || "");
            const request = room.waiting.get(requestId);

            if (!request) {
                sendError(socket, "Join request not found");
                updateWaiting(room);
                return;
            }

            room.waiting.delete(requestId);

            request.socket.pendingRoomId = null;
            request.socket.pendingRequestId = null;

            send(request.socket, {
                type: "join_rejected",
                message: "The host rejected your request"
            });

            console.log(
                "Join request rejected:",
                request.name,
                "->",
                room.id
            );

            updateWaiting(room);

            return;
        }

        //==================================================
        // LEAVE ROOM
        //==================================================

        if (data.type === "leave_room") {

            leaveRoom(socket);

            send(socket, {
                type: "left"
            });

            return;
        }

        //==================================================
        // UNKNOWN MESSAGE
        //==================================================

        sendError(socket, "Unknown message type");
    });

    //==================================================
    // DISCONNECT
    //==================================================

    socket.on("close", () => {
        console.log("Client disconnected.");
        leaveRoom(socket);
    });

    socket.on("error", error => {
        console.error("WebSocket error:", error.message);
        leaveRoom(socket);
    });
});

//==================================================
// START SERVER
//==================================================

server.listen(PORT, "0.0.0.0", () => {
    console.log(`MeetScreen server running on port ${PORT}`);
});
