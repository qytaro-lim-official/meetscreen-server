
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

const wss = new WebSocket.Server({
    server,
    maxPayload: 1024 * 1024
});

const rooms = new Map();

//==================================================
// AVATAR COLORS
//==================================================

const AVATAR_COLORS = [
    "#E57373",
    "#BA68C8",
    "#7986CB",
    "#4FC3F7",
    "#4DB6AC",
    "#81C784",
    "#FFD54F",
    "#FF8A65",
    "#A1887F",
    "#90A4AE"
];

function getAvatarColor(playerId) {
    const hash = crypto
        .createHash("sha256")
        .update(playerId)
        .digest();

    return AVATAR_COLORS[
        hash.readUInt32BE(0) % AVATAR_COLORS.length
    ];
}

//==================================================
// BASIC FUNCTIONS
//==================================================

function send(socket, data) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        return;
    }

    try {
        socket.send(JSON.stringify(data));
    } catch (error) {
        console.error("Send error:", error.message);
    }
}

function sendError(socket, message) {
    send(socket, {
        type: "error",
        message
    });
}

function generatePlayerId() {
    return crypto.randomUUID();
}

//==================================================
// ROOM ID GENERATOR
// Format: NNNN X N DD YYYY
//==================================================

function generateRoomId() {
    const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";

    let id;

    do {
        const numbers = crypto.randomInt(0, 10000)
            .toString()
            .padStart(4, "0");

        const letter = letters[
            crypto.randomInt(0, letters.length)
        ];

        const digit = crypto.randomInt(0, 10).toString();

        const now = new Date();
        const day = now.getUTCDate().toString().padStart(2, "0");
        const year = now.getUTCFullYear().toString();

        id = numbers + letter + digit + day + year;

    } while (rooms.has(id));

    return id;
}

//==================================================
// PARTICIPANT DATA
//==================================================

function createParticipant(id, name, socket, isHost = false) {
    return {
        id,
        name,
        socket,
        is_host: isHost,

        microphone_enabled: true,
        camera_enabled: true,

        avatar_color: getAvatarColor(id)
    };
}

function getParticipantData(player) {
    return {
        id: player.id,
        name: player.name,
        is_host: player.is_host,
        microphone_enabled: player.microphone_enabled,
        camera_enabled: player.camera_enabled,
        avatar_color: player.avatar_color
    };
}

function getParticipants(room) {
    return Array.from(room.participants.values())
        .map(getParticipantData);
}

function getWaitingParticipants(room) {
    return Array.from(room.waiting.values()).map(request => ({
        id: request.id,
        name: request.name
    }));
}

//==================================================
// PARTICIPANT UPDATES
//==================================================

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
// BROADCAST MEDIA STATE
//==================================================

function broadcastParticipantState(room, player) {
    const message = {
        type: "participant_state_updated",
        participant: getParticipantData(player)
    };

    for (const participant of room.participants.values()) {
        send(participant.socket, message);
    }
}

//==================================================
// WEBRTC SIGNALING
//==================================================

function relayWebRTCSignal(socket, data) {
    if (!socket.roomId || !socket.playerId) {
        sendError(socket, "You are not in a room");
        return;
    }

    const room = rooms.get(socket.roomId);

    if (!room) {
        sendError(socket, "Room not found");
        return;
    }

    const sender = room.participants.get(socket.playerId);

    if (!sender || sender.socket !== socket) {
        sendError(socket, "Invalid signal sender");
        return;
    }

    const targetId = String(data.target_id || "");

    if (!targetId || targetId === socket.playerId) {
        sendError(socket, "Invalid signal target");
        return;
    }

    const target = room.participants.get(targetId);

    if (!target || target.socket.readyState !== WebSocket.OPEN) {
        sendError(socket, "Signal recipient is unavailable");
        return;
    }

    const signal = data.signal;

    if (
        !signal ||
        typeof signal !== "object" ||
        Array.isArray(signal)
    ) {
        sendError(socket, "Invalid WebRTC signal");
        return;
    }

    const allowedTypes = [
        "offer",
        "answer",
        "candidate"
    ];

    if (!allowedTypes.includes(signal.type)) {
        sendError(socket, "Unsupported WebRTC signal type");
        return;
    }

    let signalSize;

    try {
        signalSize = JSON.stringify(signal).length;
    } catch {
        sendError(socket, "Invalid WebRTC signal");
        return;
    }

    if (signalSize > 64 * 1024) {
        sendError(socket, "WebRTC signal is too large");
        return;
    }

    if (
        (signal.type === "offer" || signal.type === "answer") &&
        (
            typeof signal.sdp !== "string" ||
            signal.sdp.length === 0
        )
    ) {
        sendError(socket, "Invalid WebRTC description");
        return;
    }

    if (
        signal.type === "candidate" &&
        signal.candidate !== null &&
        (
            !signal.candidate ||
            typeof signal.candidate !== "object" ||
            typeof signal.candidate.candidate !== "string"
        )
    ) {
        sendError(socket, "Invalid ICE candidate");
        return;
    }

    send(target.socket, {
        type: "webrtc_signal",
        from_id: sender.id,
        signal
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

function closeWaitingRequests(room, message) {
    for (const request of room.waiting.values()) {
        const waitingSocket = request.socket;

        waitingSocket.pendingRoomId = null;
        waitingSocket.pendingRequestId = null;

        send(waitingSocket, {
            type: "join_rejected",
            message
        });
    }

    room.waiting.clear();
}

//==================================================
// LEAVE ROOM
//==================================================

function leaveRoom(socket) {
    if (socket.pendingRoomId) {
        removeWaitingRequest(socket);
        return;
    }

    if (!socket.roomId || !socket.playerId) {
        return;
    }

    const roomId = socket.roomId;
    const playerId = socket.playerId;

    const room = rooms.get(roomId);

    if (!room) {
        socket.roomId = null;
        socket.playerId = null;
        return;
    }

    const player = room.participants.get(playerId);

    if (!player) {
        socket.roomId = null;
        socket.playerId = null;
        return;
    }

    room.participants.delete(playerId);

    console.log("Participant left:", player.name);

    socket.roomId = null;
    socket.playerId = null;

    // Delete room when empty.

    if (room.participants.size === 0) {
        closeWaitingRequests(
            room,
            "The meeting has been closed"
        );

        rooms.delete(roomId);

        console.log("Room deleted:", roomId);
        return;
    }

    // Transfer host rights.

    if (room.hostId === playerId) {
        const newHost = room.participants.values().next().value;

        room.hostId = newHost.id;
        newHost.is_host = true;

        console.log("New host:", newHost.name);
    }

    updateParticipants(room);
    updateWaiting(room);
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
                sendError(
                    socket,
                    "You are already in a room or waiting for approval"
                );
                return;
            }

            const name = String(data.name || "").trim();

            if (name.length < 3 || name.length > 25) {
                sendError(socket, "Name must be 3-25 characters");
                return;
            }

            const roomId = generateRoomId();
            const playerId = generatePlayerId();

            const player = createParticipant(
                playerId,
                name,
                socket,
                true
            );

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
                sendError(
                    socket,
                    "You are already in a room or waiting for approval"
                );
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
                name,
                socket
            };

            room.waiting.set(requestId, request);

            socket.pendingRoomId = roomId;
            socket.pendingRequestId = requestId;

            console.log("Join request:", name, "->", roomId);

            send(socket, {
                type: "join_pending",
                room_id: roomId,
                request_id: requestId,
                message: "Waiting for host approval"
            });

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

            const playerId = generatePlayerId();

            const player = createParticipant(
                playerId,
                request.name,
                joiningSocket,
                false
            );

            room.waiting.delete(requestId);

            joiningSocket.pendingRoomId = null;
            joiningSocket.pendingRequestId = null;

            room.participants.set(playerId, player);

            joiningSocket.roomId = room.id;
            joiningSocket.playerId = playerId;

            console.log(
                "Join request approved:",
                request.name,
                "->",
                room.id
            );

            send(joiningSocket, {
                type: "joined",
                room_id: room.id,
                self_id: playerId,
                participants: getParticipants(room)
            });

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
        // UPDATE MICROPHONE AND CAMERA
        //==================================================

        if (data.type === "update_media_state") {
            if (!socket.roomId || !socket.playerId) {
                sendError(socket, "You are not in a room");
                return;
            }

            const room = rooms.get(socket.roomId);

            if (!room) {
                sendError(socket, "Room not found");
                return;
            }

            const player = room.participants.get(socket.playerId);

            if (!player) {
                sendError(socket, "Participant not found");
                return;
            }

            if (
                typeof data.microphone_enabled !== "boolean" ||
                typeof data.camera_enabled !== "boolean"
            ) {
                sendError(socket, "Invalid media state");
                return;
            }

            player.microphone_enabled = data.microphone_enabled;
            player.camera_enabled = data.camera_enabled;

            console.log(
                "Media state updated:",
                player.name,
                "| Microphone:",
                player.microphone_enabled,
                "| Camera:",
                player.camera_enabled
            );

            broadcastParticipantState(room, player);

            return;
        }

        //==================================================
        // WEBRTC SIGNAL RELAY
        //==================================================

        if (data.type === "webrtc_signal") {
            relayWebRTCSignal(socket, data);
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
