
const http = require("http");
const WebSocket = require("ws");
const crypto = require("crypto");

//==================================================
// CONFIGURATION
//==================================================

const PORT = Number(process.env.PORT) || 3000;
const MAX_PAYLOAD = 1024 * 1024;
const MAX_SIGNAL_SIZE = 64 * 1024;
const MAX_ROOM_PARTICIPANTS = 50;

const server = http.createServer((req, res) => {
    res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store"
    });

    res.end(JSON.stringify({
        status: "online",
        service: "MeetScreen Server"
    }));
});

const wss = new WebSocket.Server({
    server,
    maxPayload: MAX_PAYLOAD
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
        return false;
    }

    try {
        socket.send(JSON.stringify(data));
        return true;
    } catch (error) {
        console.error("Send error:", error.message);
        return false;
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

function isSocketOpen(socket) {
    return socket && socket.readyState === WebSocket.OPEN;
}

function getValidName(value) {
    const name = String(value || "").trim();

    if (name.length < 3 || name.length > 25) {
        return null;
    }

    return name;
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

        const day = now
            .getUTCDate()
            .toString()
            .padStart(2, "0");

        const year = now
            .getUTCFullYear()
            .toString();

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

        // Devices are OFF until the client actually enables them.
        microphone_enabled: false,
        camera_enabled: false,

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
// ROOM HELPERS
//==================================================

function getRoomForSocket(socket) {
    if (!socket.roomId || !socket.playerId) {
        return null;
    }

    const room = rooms.get(socket.roomId);

    if (!room) {
        return null;
    }

    const player = room.participants.get(socket.playerId);

    if (!player || player.socket !== socket) {
        return null;
    }

    return room;
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

    if (!host || !isSocketOpen(host.socket)) {
        return;
    }

    send(host.socket, {
        type: "waiting_participants_updated",
        waiting_participants: getWaitingParticipants(room)
    });
}

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
// WEBRTC SIGNAL VALIDATION
//==================================================

function validateWebRTCSignal(signal) {
    if (
        !signal ||
        typeof signal !== "object" ||
        Array.isArray(signal)
    ) {
        return false;
    }

    if (!["offer", "answer", "candidate"].includes(signal.type)) {
        return false;
    }

    let serialized;

    try {
        serialized = JSON.stringify(signal);
    } catch {
        return false;
    }

    if (serialized.length > MAX_SIGNAL_SIZE) {
        return false;
    }

    if (signal.type === "offer" || signal.type === "answer") {
        return (
            typeof signal.sdp === "string" &&
            signal.sdp.length > 0
        );
    }

    if (signal.type === "candidate") {
        // A null candidate can indicate the end of ICE gathering.
        if (signal.candidate === null) {
            return true;
        }

        return (
            signal.candidate &&
            typeof signal.candidate === "object" &&
            !Array.isArray(signal.candidate) &&
            typeof signal.candidate.candidate === "string"
        );
    }

    return false;
}

//==================================================
// WEBRTC SIGNAL RELAY
//==================================================

function relayWebRTCSignal(socket, data) {
    const room = getRoomForSocket(socket);

    if (!room) {
        sendError(socket, "You are not in a room");
        return;
    }

    const sender = room.participants.get(socket.playerId);

    const targetId = String(data.target_id || "");

    if (!targetId || targetId === sender.id) {
        sendError(socket, "Invalid signal target");
        return;
    }

    const target = room.participants.get(targetId);

    if (!target || !isSocketOpen(target.socket)) {
        sendError(socket, "Signal recipient is unavailable");
        return;
    }

    if (!validateWebRTCSignal(data.signal)) {
        sendError(socket, "Invalid WebRTC signal");
        return;
    }

    const delivered = send(target.socket, {
        type: "webrtc_signal",
        from_id: sender.id,
        signal: data.signal
    });

    if (!delivered) {
        sendError(socket, "Could not deliver WebRTC signal");
    }
}

//==================================================
// LEAVE ROOM
//==================================================

function leaveRoom(socket) {
    // A participant may leave while waiting for approval.
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

    socket.roomId = null;
    socket.playerId = null;

    if (!room) {
        return;
    }

    const player = room.participants.get(playerId);

    if (!player || player.socket !== socket) {
        return;
    }

    room.participants.delete(playerId);

    console.log(
        "Participant left:",
        player.name,
        "| Room:",
        roomId
    );

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

    // Transfer host rights if necessary.
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
// CREATE ROOM
//==================================================

function handleCreateRoom(socket, data) {
    if (socket.roomId || socket.pendingRoomId) {
        sendError(
            socket,
            "You are already in a room or waiting for approval"
        );
        return;
    }

    const name = getValidName(data.name);

    if (!name) {
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
}

//==================================================
// REQUEST TO JOIN ROOM
//==================================================

function handleJoinRoom(socket, data) {
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

    const name = getValidName(data.name);

    if (!name) {
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

    if (!host || !isSocketOpen(host.socket)) {
        sendError(socket, "Host is currently unavailable");
        return;
    }

    const requestId = crypto.randomUUID();

    room.waiting.set(requestId, {
        id: requestId,
        name,
        socket
    });

    socket.pendingRoomId = roomId;
    socket.pendingRequestId = requestId;

    console.log(
        "Join request:",
        name,
        "->",
        roomId
    );

    send(socket, {
        type: "join_pending",
        room_id: roomId,
        request_id: requestId,
        message: "Waiting for host approval"
    });

    updateWaiting(room);
}

//==================================================
// APPROVE JOIN REQUEST
//==================================================

function handleApproveJoin(socket, data) {
    const room = getRoomForSocket(socket);

    if (!room) {
        sendError(socket, "You are not in a room");
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

    if (!isSocketOpen(joiningSocket)) {
        room.waiting.delete(requestId);
        joiningSocket.pendingRoomId = null;
        joiningSocket.pendingRequestId = null;

        updateWaiting(room);
        return;
    }

    if (
        joiningSocket.pendingRoomId !== room.id ||
        joiningSocket.pendingRequestId !== requestId
    ) {
        room.waiting.delete(requestId);
        updateWaiting(room);
        return;
    }

    if (room.participants.size >= MAX_ROOM_PARTICIPANTS) {
        send(joiningSocket, {
            type: "join_rejected",
            message: "This meeting is full"
        });

        joiningSocket.pendingRoomId = null;
        joiningSocket.pendingRequestId = null;

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

    // Send the initial room state to the joining participant.
    send(joiningSocket, {
        type: "joined",
        room_id: room.id,
        self_id: playerId,
        participants: getParticipants(room)
    });

    updateParticipants(room);
    updateWaiting(room);
}

//==================================================
// REJECT JOIN REQUEST
//==================================================

function handleRejectJoin(socket, data) {
    const room = getRoomForSocket(socket);

    if (!room) {
        sendError(socket, "You are not in a room");
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
}

//==================================================
// UPDATE MICROPHONE AND CAMERA
//==================================================

function handleMediaState(socket, data) {
    const room = getRoomForSocket(socket);

    if (!room) {
        sendError(socket, "You are not in a room");
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
}

//==================================================
// MESSAGE HANDLER
//==================================================

function handleMessage(socket, data) {
    switch (data.type) {
        case "create_room":
            handleCreateRoom(socket, data);
            break;

        case "join_room":
            handleJoinRoom(socket, data);
            break;

        case "approve_join":
            handleApproveJoin(socket, data);
            break;

        case "reject_join":
            handleRejectJoin(socket, data);
            break;

        case "update_media_state":
            handleMediaState(socket, data);
            break;

        case "webrtc_signal":
            relayWebRTCSignal(socket, data);
            break;

        case "leave_room":
            leaveRoom(socket);

            send(socket, {
                type: "left"
            });
            break;

        default:
            sendError(socket, "Unknown message type");
            break;
    }
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

        if (
            !data ||
            typeof data !== "object" ||
            Array.isArray(data) ||
            typeof data.type !== "string"
        ) {
            sendError(socket, "Invalid message");
            return;
        }

        try {
            handleMessage(socket, data);
        } catch (error) {
            console.error("Message handling error:", error);

            sendError(
                socket,
                "An internal server error occurred"
            );
        }
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
// SERVER ERRORS
//==================================================

server.on("error", error => {
    console.error("HTTP server error:", error);
});

wss.on("error", error => {
    console.error("WebSocket server error:", error);
});

//==================================================
// START SERVER
//==================================================

server.listen(PORT, "0.0.0.0", () => {
    console.log(
        `MeetScreen server running on port ${PORT}`
    );
});
