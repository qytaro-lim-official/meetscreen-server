
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
    if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(data));
    }
}

function generateRoomId() {
    const characters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    let id;

    do {
        id = "";

        for (let i = 0; i < 6; i++) {
            id += characters[
                Math.floor(Math.random() * characters.length)
            ];
        }
    } while (rooms.has(id));

    return id;
}

function getParticipants(room) {
    return Array.from(room.participants.values()).map(player => ({
        id: player.id,
        name: player.name,
        is_host: player.is_host
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

function leaveRoom(socket) {
    if (!socket.roomId) return;

    const room = rooms.get(socket.roomId);

    if (room) {
        room.participants.delete(socket.playerId);

        if (room.participants.size === 0) {
            rooms.delete(socket.roomId);
        } else {
            if (room.hostId === socket.playerId) {
                const newHost = room.participants.values().next().value;

                room.hostId = newHost.id;
                newHost.is_host = true;
            }

            updateParticipants(room);
        }
    }

    socket.roomId = null;
    socket.playerId = null;
}

wss.on("connection", socket => {
    socket.roomId = null;
    socket.playerId = null;

    send(socket, {
        type: "connected",
        message: "Connected to MeetScreen Server"
    });

    socket.on("message", rawData => {
        let data;

        try {
            data = JSON.parse(rawData.toString());
        } catch {
            send(socket, {
                type: "error",
                message: "Invalid JSON"
            });
            return;
        }

        if (!data || typeof data.type !== "string") {
            send(socket, {
                type: "error",
                message: "Invalid message"
            });
            return;
        }

        if (data.type === "create_room") {
            if (socket.roomId) {
                send(socket, {
                    type: "error",
                    message: "You are already in a room"
                });
                return;
            }

            const name = String(data.name || "").trim();

            if (name.length < 3 || name.length > 25) {
                send(socket, {
                    type: "error",
                    message: "Name must be 3-25 characters"
                });
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
                hostId: playerId,
                participants: new Map()
            };

            room.participants.set(playerId, player);
            rooms.set(roomId, room);

            socket.roomId = roomId;
            socket.playerId = playerId;

            send(socket, {
                type: "room_created",
                room_id: roomId,
                self_id: playerId,
                participants: getParticipants(room)
            });

            updateParticipants(room);
            return;
        }

        if (data.type === "join_room") {
            if (socket.roomId) {
                send(socket, {
                    type: "error",
                    message: "You are already in a room"
                });
                return;
            }

            const roomId = String(data.room_id || "")
                .trim()
                .toUpperCase();

            const name = String(data.name || "").trim();
            const room = rooms.get(roomId);

            if (name.length < 3 || name.length > 25) {
                send(socket, {
                    type: "error",
                    message: "Name must be 3-25 characters"
                });
                return;
            }

            if (!room) {
                send(socket, {
                    type: "error",
                    message: "Room not found"
                });
                return;
            }

            const playerId = crypto.randomUUID();

            const player = {
                id: playerId,
                name: name,
                is_host: false,
                socket: socket
            };

            room.participants.set(playerId, player);

            socket.roomId = roomId;
            socket.playerId = playerId;

            send(socket, {
                type: "joined",
                room_id: roomId,
                self_id: playerId,
                participants: getParticipants(room)
            });

            updateParticipants(room);
            return;
        }

        if (data.type === "leave_room") {
            leaveRoom(socket);

            send(socket, {
                type: "left"
            });

            return;
        }

        send(socket, {
            type: "error",
            message: "Unknown message type"
        });
    });

    socket.on("close", () => {
        leaveRoom(socket);
    });

    socket.on("error", error => {
        console.error("WebSocket error:", error.message);
        leaveRoom(socket);
    });
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(`MeetScreen server running on port ${PORT}`);
});
