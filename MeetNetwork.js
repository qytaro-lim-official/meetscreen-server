
const SERVER_URL = "wss://meetscreen-server.onrender.com";

class MeetNetwork {
    constructor() {
        this.socket = null;

        this.was_connected = false;
        this.is_connecting = false;

        this.listeners = {
            connected: [],
            disconnected: [],
            message_received: [],
            connection_error: [],
            webrtc_signal_received: []
        };

        this._socketVersion = 0;
    }

    // ==================================================
    // SIGNALS
    // ==================================================

    on(signal, callback) {
        if (!this.listeners[signal]) {
            console.warn(`Unknown MeetNetwork signal: ${signal}`);
            return;
        }

        if (typeof callback !== "function") {
            console.warn("MeetNetwork callback must be a function.");
            return;
        }

        this.listeners[signal].push(callback);
    }

    off(signal, callback) {
        if (!this.listeners[signal]) return;

        this.listeners[signal] =
            this.listeners[signal].filter(fn => fn !== callback);
    }

    emit(signal, data = undefined) {
        if (!this.listeners[signal]) return;

        for (const callback of [...this.listeners[signal]]) {
            try {
                callback(data);
            } catch (error) {
                console.error(
                    `MeetNetwork listener error (${signal}):`,
                    error
                );
            }
        }
    }

    // ==================================================
    // CONNECTION
    // ==================================================

    connect_to_server() {
        if (this.is_connecting || this.was_connected) {
            console.log("Already connected or connecting.");
            return;
        }

        if (
            this.socket &&
            (
                this.socket.readyState === WebSocket.OPEN ||
                this.socket.readyState === WebSocket.CONNECTING
            )
        ) {
            console.log("WebSocket is already active.");
            return;
        }

        let socket;

        try {
            socket = new WebSocket(SERVER_URL);
        } catch (error) {
            const message =
                "Could not create WebSocket: " + error.message;

            console.error(message);
            this.emit("connection_error", message);
            return;
        }

        this.socket = socket;

        const version = ++this._socketVersion;

        this.is_connecting = true;
        this.was_connected = false;

        console.log("Connecting to MeetScreen server...");

        // --------------------------------------------------
        // OPEN
        // --------------------------------------------------

        socket.addEventListener("open", () => {
            if (version !== this._socketVersion) return;

            this.was_connected = true;
            this.is_connecting = false;

            console.log("Connected to MeetScreen server!");

            this.emit("connected");
        });

        // --------------------------------------------------
        // MESSAGE
        // --------------------------------------------------

        socket.addEventListener("message", event => {
            if (version !== this._socketVersion) return;

            this._receive_packet(event.data);
        });

        // --------------------------------------------------
        // CLOSE
        // --------------------------------------------------

        socket.addEventListener("close", event => {
            if (version !== this._socketVersion) return;

            const wasConnected = this.was_connected;
            const wasConnecting = this.is_connecting;

            this.was_connected = false;
            this.is_connecting = false;

            this.socket = null;

            if (wasConnected) {
                console.log("Disconnected from MeetScreen server.");

                this.emit("disconnected", {
                    code: event.code,
                    reason: event.reason
                });
            } else if (wasConnecting) {
                let errorMessage = "Connection failed.";

                if (event.code !== 1000) {
                    errorMessage += `\nCode: ${event.code}`;
                }

                if (event.reason) {
                    errorMessage += `\nReason: ${event.reason}`;
                }

                console.error(errorMessage);

                this.emit("connection_error", errorMessage);
            }
        });

        // --------------------------------------------------
        // ERROR
        // --------------------------------------------------

        socket.addEventListener("error", () => {
            if (version !== this._socketVersion) return;

            const errorMessage =
                "MeetScreen WebSocket connection error.";

            console.error(errorMessage);

            this.emit("connection_error", errorMessage);
        });
    }

    // ==================================================
    // RECEIVE MESSAGES
    // ==================================================

    _receive_packet(text) {
        if (typeof text !== "string" || text.length === 0) {
            return;
        }

        let data;

        try {
            data = JSON.parse(text);
        } catch (error) {
            console.warn(
                "MeetScreen received invalid JSON.",
                error
            );
            return;
        }

        if (
            data === null ||
            typeof data !== "object" ||
            Array.isArray(data)
        ) {
            console.warn(
                "MeetScreen received unexpected message format."
            );
            return;
        }

        console.log("Server message:", data);

        // --------------------------------------------------
        // WEBRTC SIGNAL
        // --------------------------------------------------

        if (data.type === "webrtc_signal") {
            if (
                typeof data.from_id !== "string" ||
                !data.signal ||
                typeof data.signal !== "object"
            ) {
                console.warn("Invalid incoming WebRTC signal.");
                return;
            }

            console.log(
                "WebRTC signal received from:",
                data.from_id,
                data.signal.type
            );

            this.emit("webrtc_signal_received", {
                from_id: data.from_id,
                signal: data.signal
            });
        }

        // --------------------------------------------------
        // GENERAL MESSAGE
        // --------------------------------------------------

        this.emit("message_received", data);
    }

    // ==================================================
    // SEND JSON
    // ==================================================

    send_json(data) {
        if (
            !this.socket ||
            this.socket.readyState !== WebSocket.OPEN
        ) {
            console.warn("Cannot send message: not connected.");
            return false;
        }

        if (
            !data ||
            typeof data !== "object" ||
            Array.isArray(data)
        ) {
            console.warn("Invalid message data.");
            return false;
        }

        let jsonText;

        try {
            jsonText = JSON.stringify(data);
        } catch (error) {
            console.error(
                "Message serialization failed:",
                error
            );
            return false;
        }

        try {
            this.socket.send(jsonText);

            console.log("Sent message:", data);

            return true;
        } catch (error) {
            const errorMessage =
                "Message sending failed: " + error.message;

            console.error(errorMessage);

            this.emit("connection_error", errorMessage);

            return false;
        }
    }

    // ==================================================
    // WEBRTC SIGNALING
    // ==================================================

    send_webrtc_signal(target_id, signal) {
        if (
            typeof target_id !== "string" ||
            !target_id.trim()
        ) {
            console.warn("Invalid WebRTC target ID.");
            return false;
        }

        if (
            !signal ||
            typeof signal !== "object" ||
            Array.isArray(signal)
        ) {
            console.warn("Invalid WebRTC signal.");
            return false;
        }

        const allowedTypes = [
            "offer",
            "answer",
            "candidate"
        ];

        if (!allowedTypes.includes(signal.type)) {
            console.warn(
                "Unsupported WebRTC signal type:",
                signal.type
            );
            return false;
        }

        return this.send_json({
            type: "webrtc_signal",
            target_id,
            signal
        });
    }

    // ==================================================
    // SEND OFFER
    // ==================================================

    send_webrtc_offer(target_id, description) {
        if (!description || typeof description.sdp !== "string") {
            console.warn("Invalid WebRTC offer.");
            return false;
        }

        return this.send_webrtc_signal(target_id, {
            type: "offer",
            sdp: description.sdp
        });
    }

    // ==================================================
    // SEND ANSWER
    // ==================================================

    send_webrtc_answer(target_id, description) {
        if (!description || typeof description.sdp !== "string") {
            console.warn("Invalid WebRTC answer.");
            return false;
        }

        return this.send_webrtc_signal(target_id, {
            type: "answer",
            sdp: description.sdp
        });
    }

    // ==================================================
    // SEND ICE CANDIDATE
    // ==================================================

    send_webrtc_candidate(target_id, candidate) {
        let candidateData = null;

        if (candidate) {
            if (typeof candidate.toJSON === "function") {
                candidateData = candidate.toJSON();
            } else {
                candidateData = candidate;
            }
        }

        return this.send_webrtc_signal(target_id, {
            type: "candidate",
            candidate: candidateData
        });
    }

    // ==================================================
    // DISCONNECT
    // ==================================================

    disconnect_from_server() {
        const socket = this.socket;

        if (!socket) {
            this.was_connected = false;
            this.is_connecting = false;
            return;
        }

        console.log("Disconnecting from MeetScreen server...");

        if (
            socket.readyState === WebSocket.OPEN ||
            socket.readyState === WebSocket.CONNECTING
        ) {
            socket.close(1000, "Client disconnected");
        }

        this.was_connected = false;
        this.is_connecting = false;

        this.socket = null;

        // Invalidate old socket events.
        this._socketVersion++;

        console.log("Disconnected from MeetScreen server.");
    }

    // ==================================================
    // CONNECTION STATUS
    // ==================================================

    is_server_connected() {
        return (
            this.socket !== null &&
            this.socket.readyState === WebSocket.OPEN
        );
    }

    is_server_connecting() {
        return (
            this.socket !== null &&
            this.socket.readyState === WebSocket.CONNECTING
        );
    }
}

window.MeetNetwork = MeetNetwork;
