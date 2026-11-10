
import MeetNetwork from "../MeetNetwork.js";

// ==================================================
// MEETSCREEN — ELECTRON CLIENT
// PRIVATE DEFAULTS + WEBRTC AUDIO/VIDEO
// ==================================================

const COLORS = {
    BG: "#111318",
    PANEL: "#191C23",
    CARD: "#242936",
    INPUT_BG: "#171B23",
    GREEN: "#A5E6B5",
    WHITE: "#F5F6FA",
    GRAY: "#AEB4C2",
    MUTED: "#9299A8",
    RED: "#F16D76"
};

const AVATAR_COLORS = [
    "#E57373", "#BA68C8", "#7986CB", "#4FC3F7",
    "#4DB6AC", "#81C784", "#FFD54F", "#FF8A65",
    "#A1887F", "#90A4AE"
];

const SETTINGS_KEY = "meetscreen_settings";

const RTC_CONFIGURATION = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" }
    ]
};

const CAMERA_CONSTRAINTS = {
    audio: false,
    video: {
        width: { ideal: 1280, min: 640 },
        height: { ideal: 720, min: 360 },
        frameRate: { ideal: 30, max: 30 }
    }
};

const MICROPHONE_CONSTRAINTS = {
    audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1
    },
    video: false
};

// ==================================================
// STATE
// ==================================================

let serverConnected = false;
let creatingMeeting = false;

let pendingAction = "create";
let pendingRoomId = "";

let currentRoomId = "";
let currentPlayerId = "";
let currentUserName = "";
let currentUserIsHost = false;

// PRIVACY: BOTH DEVICES START DISABLED.
let microphoneEnabled = false;
let cameraEnabled = false;

let localVideoStream = null;
let localAudioStream = null;

let cameraStarting = false;
let microphoneStarting = false;

let cameraRequestVersion = 0;
let microphoneRequestVersion = 0;

let currentParticipants = [];
let waitingParticipants = [];

let avatarColors = {};

let rememberedName = "";
let hasSavedName = false;

let meetingOverlay = null;
let waitingApprovalOverlay = null;
let loadingOverlay = null;
let nameDialog = null;

let statusTimeout = null;

// ==================================================
// WEBRTC STATE
// ==================================================

const peerConnections = new Map();
const peerTrackUpdateQueues = new Map();

const remoteVideoStreams = new Map();
const remoteAudioStreams = new Map();
const remoteAudioElements = new Map();

const pendingIceCandidates = new Map();

const makingOffers = new Set();
const ignoreOffer = new Set();

// ==================================================
// NETWORK
// ==================================================

const meetNetwork = new MeetNetwork();

function setupNetwork() {
    meetNetwork.on("connected", onServerConnected);
    meetNetwork.on("disconnected", onServerDisconnected);
    meetNetwork.on("message_received", onServerMessage);
    meetNetwork.on("connection_error", onServerError);
    meetNetwork.on("webrtc_signal_received", onWebRTCSignal);

    showLoading("Connecting to MeetScreen server...");
    meetNetwork.connect_to_server();
}

function sendNetworkMessage(data) {
    if (!serverConnected) {
        showStatus("Not connected to MeetScreen server.");
        return false;
    }

    return meetNetwork.send_json(data);
}

function sendWebRTCSignal(targetId, signal) {
    if (!serverConnected || !targetId || !signal) return false;

    if (typeof meetNetwork.send_webrtc_signal !== "function") {
        console.error("MeetNetwork.send_webrtc_signal() is missing.");
        showStatus("WebRTC signaling method is missing.");
        return false;
    }

    return meetNetwork.send_webrtc_signal(targetId, signal);
}

// ==================================================
// DOM HELPERS
// ==================================================

function createElement(tag, className = "", text = "") {
    const element = document.createElement(tag);

    if (className) element.className = className;
    if (text !== "") element.textContent = text;

    return element;
}

function add(parent, child) {
    parent.appendChild(child);
    return child;
}

function button(text, className, callback) {
    const element = createElement("button", className, text);

    element.type = "button";
    element.addEventListener("click", callback);

    return element;
}

function clear(element) {
    if (element) element.replaceChildren();
}

// ==================================================
// STYLES
// ==================================================

function injectStyles() {
    const style = document.createElement("style");

    style.textContent = `
        * { box-sizing: border-box; }

        html, body {
            margin: 0;
            width: 100%;
            height: 100%;
            overflow: hidden;
            background: ${COLORS.BG};
            color: ${COLORS.WHITE};
            font-family: Arial, sans-serif;
        }

        button, input { font: inherit; }
        button { cursor: pointer; }

        .app {
            width: 100%;
            height: 100%;
            display: flex;
            flex-direction: column;
            background: ${COLORS.BG};
        }

        .topbar {
            height: 64px;
            min-height: 64px;
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 0 25px;
            background: ${COLORS.PANEL};
            border-bottom: 1px solid #292E39;
        }

        .brand { font-size: 21px; font-weight: 600; }
        .brand-icon { width: 30px; height: 30px; color: ${COLORS.GREEN}; }

        .body { flex: 1; min-height: 0; display: flex; }

        .sidebar {
            width: 112px;
            min-width: 112px;
            background: ${COLORS.PANEL};
            border-right: 1px solid #292E39;
        }

        .main-scroll { flex: 1; min-width: 0; overflow-y: auto; }

        .main-content {
            width: 100%;
            min-height: 100%;
            padding: 35px;
        }

        .page-title { font-size: 30px; font-weight: 600; margin-bottom: 8px; }
        .page-subtitle { font-size: 15px; color: ${COLORS.GRAY}; }
        .content-gap { height: 21px; }

        .card {
            width: 100%;
            display: flex;
            flex-direction: column;
            gap: 11px;
            padding: 20px 22px;
            margin-bottom: 14px;
            background: ${COLORS.CARD};
            border-radius: 15px;
        }

        .card-icon { width: 38px; height: 38px; color: ${COLORS.GREEN}; }
        .card-title { font-size: 20px; font-weight: 600; }
        .card-description { font-size: 14px; color: ${COLORS.GRAY}; }

        .primary-button, .outline-button, .danger-button, .neutral-button {
            min-height: 44px;
            border-radius: 9px;
            padding: 0 15px;
            font-size: 14px;
            transition: background .15s, border-color .15s;
        }

        .primary-button {
            color: #14251A;
            background: ${COLORS.GREEN};
            border: 1px solid ${COLORS.GREEN};
            font-weight: 600;
        }

        .primary-button:hover { background: #BDF0CA; }

        .outline-button {
            color: ${COLORS.GREEN};
            background: ${COLORS.CARD};
            border: 1px solid ${COLORS.GREEN};
        }

        .outline-button:hover { background: #303B35; color: ${COLORS.WHITE}; }

        .neutral-button {
            color: ${COLORS.GRAY};
            background: ${COLORS.INPUT_BG};
            border: 1px solid #343B48;
        }

        .neutral-button:hover { background: #303541; color: ${COLORS.WHITE}; }

        .danger-button {
            color: ${COLORS.RED};
            background: ${COLORS.CARD};
            border: 1px solid #63383F;
        }

        .danger-button:hover { background: #63383F; color: ${COLORS.WHITE}; }

        .text-input {
            width: 100%;
            height: 44px;
            padding: 0 13px;
            color: ${COLORS.WHITE};
            background: ${COLORS.INPUT_BG};
            border: 1px solid #343B48;
            border-radius: 9px;
            outline: none;
            font-size: 14px;
        }

        .text-input:focus { border-color: ${COLORS.GREEN}; }
        .text-input::placeholder { color: ${COLORS.MUTED}; }

        #meeting-overlay {
            position: fixed;
            inset: 0;
            z-index: 60;
            width: 100%;
            height: 100%;
            display: flex;
            flex-direction: column;
            background: ${COLORS.BG};
            overflow: hidden;
        }

        .meeting-layout {
            flex: 1;
            min-height: 0;
            min-width: 0;
            display: flex;
            overflow: hidden;
        }

        .camera-panel {
            width: 205px;
            min-width: 205px;
            max-width: 205px;
            height: 100%;
            display: flex;
            flex-direction: column;
            gap: 12px;
            padding: 17px 13px;
            background: ${COLORS.PANEL};
            border-right: 1px solid #292E39;
            overflow: hidden;
        }

        .camera-panel-heading {
            flex-shrink: 0;
            font-size: 12px;
            font-weight: 600;
            letter-spacing: 1px;
            color: ${COLORS.MUTED};
            padding: 2px 3px 5px;
        }

        .camera-tiles {
            flex: 1;
            min-height: 0;
            display: flex;
            flex-direction: column;
            gap: 11px;
            overflow-x: hidden;
            overflow-y: auto;
            padding-right: 4px;
            scrollbar-width: thin;
            scrollbar-color: #454C59 transparent;
        }

        .camera-tiles::-webkit-scrollbar { width: 5px; }
        .camera-tiles::-webkit-scrollbar-thumb {
            background: #454C59;
            border-radius: 10px;
        }

        .camera-tile {
            position: relative;
            flex-shrink: 0;
            width: 100%;
            aspect-ratio: 16 / 10;
            min-height: 105px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 7px;
            padding: 10px;
            overflow: hidden;
            border: 1px solid #343B48;
            border-radius: 13px;
            background: #202530;
        }

        .camera-tile.organizer-tile {
            border: 1px solid ${COLORS.GREEN};
            background: #222D29;
        }

        .camera-tile-avatar {
            width: 42px;
            height: 42px;
            min-width: 42px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: ${COLORS.WHITE};
            font-size: 18px;
            font-weight: 600;
            position: relative;
            z-index: 1;
        }

        .camera-tile-name {
            width: 100%;
            font-size: 11px;
            color: ${COLORS.WHITE};
            text-align: center;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            position: relative;
            z-index: 2;
        }

        .camera-tile-status {
            position: absolute;
            top: 7px;
            right: 7px;
            width: 22px;
            height: 22px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 6px;
            background: #111318B8;
            z-index: 3;
        }

        .camera-tile-status svg { width: 14px; height: 14px; }

        .camera-tile-role {
            color: ${COLORS.GREEN};
            font-size: 9px;
            position: relative;
            z-index: 2;
        }

        .camera-empty {
            padding: 15px 5px;
            color: ${COLORS.MUTED};
            font-size: 11px;
            text-align: center;
        }

        .camera-tile-video {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            object-fit: cover;
            background: #111318;
            z-index: 0;
        }

        .camera-tile.camera-live .camera-tile-avatar { display: none; }
        .camera-tile.camera-live { justify-content: flex-end; }

        .camera-tile.camera-live .camera-tile-name {
            text-align: left;
            padding: 5px 7px;
            border-radius: 5px;
            background: #111318B8;
        }

        .meeting-center {
            flex: 1;
            min-width: 0;
            min-height: 0;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 15px;
            padding: 25px;
            overflow: hidden;
        }

        .meeting-center h1 {
            font-size: 27px;
            margin: 0;
            text-align: center;
        }

        .meeting-center p {
            color: ${COLORS.GRAY};
            font-size: 14px;
            margin: 0;
            text-align: center;
        }

        .organizer-video {
            position: relative;
            width: 100%;
            max-width: 900px;
            flex: 1;
            min-height: 180px;
            max-height: 620px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 15px;
            overflow: hidden;
            border: 1px solid #343B48;
            border-radius: 17px;
            background: radial-gradient(circle at center, #252C38 0%, #171B23 65%, #13161D 100%);
        }

        .organizer-video-avatar {
            width: 105px;
            height: 105px;
            min-width: 105px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: ${COLORS.WHITE};
            font-size: 42px;
            font-weight: 600;
            box-shadow: 0 8px 35px #0005;
            position: relative;
            z-index: 1;
        }

        .organizer-video-name {
            font-size: 17px;
            font-weight: 600;
            position: relative;
            z-index: 1;
        }

        .organizer-video-status {
            color: ${COLORS.GRAY};
            font-size: 12px;
            position: relative;
            z-index: 1;
        }

        .organizer-video-label {
            position: absolute;
            left: 14px;
            bottom: 14px;
            padding: 8px 11px;
            border-radius: 8px;
            background: #111318CC;
            color: ${COLORS.WHITE};
            font-size: 12px;
            z-index: 3;
        }

        .organizer-video-camera-icon {
            position: absolute;
            top: 14px;
            right: 14px;
            width: 30px;
            height: 30px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 8px;
            background: #111318CC;
            z-index: 3;
        }

        .organizer-video-camera-icon svg { width: 18px; height: 18px; }

        .organizer-video-stream {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            object-fit: contain;
            background: #111318;
            z-index: 0;
        }

        .organizer-video.camera-live .organizer-video-avatar,
        .organizer-video.camera-live .organizer-video-name,
        .organizer-video.camera-live .organizer-video-status {
            display: none;
        }

        .participants-panel {
            width: 290px;
            min-width: 290px;
            max-width: 290px;
            height: 100%;
            display: flex;
            flex-direction: column;
            padding: 22px 18px 15px;
            background: ${COLORS.PANEL};
            border-left: 1px solid #292E39;
            overflow-x: hidden;
            overflow-y: auto;
        }

        .section-label {
            font-size: 11px;
            color: ${COLORS.MUTED};
            letter-spacing: 1px;
            margin-bottom: 8px;
        }

        .meeting-code {
            color: ${COLORS.GREEN};
            font-size: 20px;
            margin-bottom: 10px;
            word-break: break-all;
        }

        .panel-separator {
            height: 1px;
            background: #343B48;
            margin: 16px 0;
            flex-shrink: 0;
        }

        .panel-heading { font-size: 15px; margin-bottom: 13px; }

        .participant-row {
            min-height: 48px;
            display: flex;
            align-items: center;
            gap: 9px;
            margin-bottom: 7px;
        }

        .avatar {
            width: 36px;
            height: 36px;
            min-width: 36px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: ${COLORS.WHITE};
            font-size: 15px;
            font-weight: 600;
        }

        .participant-info { flex: 1; min-width: 0; }

        .participant-name {
            font-size: 13px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .participant-role {
            color: ${COLORS.GREEN};
            font-size: 10px;
            margin-top: 3px;
        }

        .participant-icons { display: flex; gap: 7px; align-items: center; }
        .participant-icons svg { width: 19px; height: 19px; }

        .waiting-row {
            min-height: 43px;
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 7px;
        }

        .waiting-row .avatar {
            width: 34px;
            height: 34px;
            min-width: 34px;
            color: #D2D5DC;
        }

        .waiting-info { flex: 1; min-width: 0; }
        .waiting-info .participant-name { color: #A0A6B2; font-size: 12px; }
        .waiting-info small { color: #777F8D; font-size: 9px; }

        .small-action {
            width: 28px;
            height: 28px;
            border: 0;
            background: transparent;
            font-size: 17px;
        }

        .accept-action { color: ${COLORS.GREEN}; }
        .reject-action { color: ${COLORS.RED}; }

        .bottom-controls {
            height: 64px;
            min-height: 64px;
            flex-shrink: 0;
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 24px 8px 14px;
            background: ${COLORS.PANEL};
            border-top: 1px solid #292E39;
            z-index: 2;
        }

        .control-button {
            width: 40px;
            height: 40px;
            flex-shrink: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            border: 0;
            border-radius: 8px;
            background: transparent;
            color: ${COLORS.WHITE};
        }

        .control-button:hover { background: ${COLORS.CARD}; }
        .control-button svg { width: 24px; height: 24px; }

        .control-separator {
            width: 1px;
            height: 24px;
            flex-shrink: 0;
            background: #454C59;
        }

        .control-spacer { flex: 1; min-width: 0; }

        .overlay {
            position: fixed;
            inset: 0;
            z-index: 40;
            display: flex;
            align-items: center;
            justify-content: center;
            background: rgba(0,0,0,.58);
        }

        .dialog {
            width: 390px;
            max-width: calc(100vw - 32px);
            padding: 24px 25px;
            border-radius: 15px;
            border: 1px solid #343B48;
            background: ${COLORS.CARD};
            display: flex;
            flex-direction: column;
            gap: 13px;
        }

        .dialog-title { font-size: 22px; font-weight: 600; }
        .dialog-subtitle { color: ${COLORS.GRAY}; font-size: 14px; }

        .checkbox-row {
            display: flex;
            align-items: center;
            gap: 9px;
            color: ${COLORS.GRAY};
            font-size: 13px;
        }

        .checkbox-row input { accent-color: ${COLORS.GREEN}; }
        .dialog-buttons { display: flex; gap: 10px; }
        .dialog-buttons button { flex: 1; }
        .error-text { color: #FF8585; font-size: 12px; }

        .loading-overlay {
            position: fixed;
            inset: 0;
            z-index: 50;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-direction: column;
            gap: 22px;
            background: ${COLORS.BG};
            color: ${COLORS.GRAY};
            font-size: 14px;
        }

        .spinner {
            width: 52px;
            height: 52px;
            border: 3px solid #303541;
            border-top-color: ${COLORS.GREEN};
            border-radius: 50%;
            animation: spin .8s linear infinite;
        }

        .waiting-approval {
            position: fixed;
            inset: 0;
            z-index: 40;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-direction: column;
            gap: 18px;
            padding: 25px;
            background: ${COLORS.BG};
            text-align: center;
        }

        .waiting-approval h2 { font-size: 25px; margin: 0; }

        .waiting-approval p {
            max-width: 340px;
            color: ${COLORS.GRAY};
            font-size: 14px;
            line-height: 1.5;
        }

        .waiting-approval .room-code { color: ${COLORS.GREEN}; font-size: 13px; }

        .status-message {
            position: fixed;
            z-index: 100;
            left: 50%;
            bottom: 22px;
            transform: translateX(-50%);
            padding: 12px 18px;
            border: 1px solid #343B48;
            border-radius: 9px;
            background: ${COLORS.CARD};
            color: ${COLORS.WHITE};
            font-size: 13px;
            box-shadow: 0 8px 30px #0005;
            max-width: calc(100vw - 30px);
            overflow-wrap: anywhere;
        }

        .hidden { display: none !important; }

        @keyframes spin { to { transform: rotate(360deg); } }

        @media (max-width: 1100px) {
            .camera-panel {
                width: 170px;
                min-width: 170px;
                max-width: 170px;
            }

            .participants-panel {
                width: 250px;
                min-width: 250px;
                max-width: 250px;
            }

            .meeting-center { padding: 16px; }
        }

        @media (max-width: 850px) {
            .camera-panel {
                width: 145px;
                min-width: 145px;
                max-width: 145px;
                padding: 12px 9px;
            }

            .participants-panel {
                width: 215px;
                min-width: 215px;
                max-width: 215px;
                padding: 15px 12px;
            }

            .camera-tile { min-height: 90px; }

            .organizer-video-avatar {
                width: 75px;
                height: 75px;
                min-width: 75px;
                font-size: 30px;
            }
        }

        @media (max-width: 650px) {
            .sidebar { display: none; }
            .main-content { padding: 22px; }

            .meeting-layout {
                flex-direction: column;
                overflow: hidden;
            }

            .camera-panel {
                order: 1;
                width: 100%;
                min-width: 0;
                max-width: none;
                height: 150px;
                min-height: 150px;
                max-height: 150px;
                border-right: 0;
                border-bottom: 1px solid #292E39;
            }

            .camera-tiles {
                flex-direction: row;
                overflow-x: auto;
                overflow-y: hidden;
            }

            .camera-tile {
                width: 125px;
                min-width: 125px;
                min-height: 95px;
                aspect-ratio: auto;
            }

            .meeting-center {
                order: 2;
                flex: 1;
                min-height: 180px;
            }

            .participants-panel {
                order: 3;
                width: 100%;
                min-width: 0;
                max-width: none;
                height: 150px;
                min-height: 150px;
                max-height: 150px;
                border-left: 0;
                border-top: 1px solid #292E39;
            }

            .organizer-video { min-height: 120px; }
            .meeting-center h1 { font-size: 21px; }
        }

        @media (max-width: 400px) {
            .topbar { padding: 0 14px; }
            .bottom-controls { padding: 8px 12px; }

            .camera-panel {
                height: 130px;
                min-height: 130px;
                max-height: 130px;
            }

            .participants-panel {
                height: 125px;
                min-height: 125px;
                max-height: 125px;
            }
        }
    `;

    document.head.appendChild(style);
}

// ==================================================
// SVG ICONS
// ==================================================

function svgVideo(color = COLORS.GREEN) {
    return `
    <svg class="brand-icon" xmlns="http://www.w3.org/2000/svg"
         viewBox="0 0 48 48" fill="none">
        <rect x="5" y="12" width="25" height="24" rx="5"
              stroke="${color}" stroke-width="2.5"/>
        <path d="M30 20 L42 13 V35 L30 28 Z"
              stroke="${color}" stroke-width="2.5"
              stroke-linejoin="round"/>
    </svg>`;
}

function svgKeyboard(color = COLORS.GREEN) {
    return `
    <svg class="card-icon" xmlns="http://www.w3.org/2000/svg"
         viewBox="0 0 48 48" fill="none">
        <rect x="5" y="10" width="38" height="28" rx="5"
              stroke="${color}" stroke-width="2.3"/>
        <path d="M12 18 H14 M20 18 H22 M28 18 H30 M36 18 H38
                 M12 25 H14 M20 25 H22 M28 25 H30 M36 25 H38
                 M17 32 H31"
              stroke="${color}" stroke-width="2.5"
              stroke-linecap="round"/>
    </svg>`;
}

function svgCamera(color, crossed = false) {
    return `
    <svg xmlns="http://www.w3.org/2000/svg"
         viewBox="0 0 24 24" fill="none">
        <rect x="2.5" y="6" width="13" height="12" rx="2.5"
              stroke="${color}" stroke-width="1.8"/>
        <path d="M15.5 10 L21.5 6.8 V17.2 L15.5 14 Z"
              stroke="${color}" stroke-width="1.8"
              stroke-linejoin="round"/>
        ${crossed ? `<path d="M3 3 L21 21" stroke="${COLORS.RED}"
        stroke-width="2" stroke-linecap="round"/>` : ""}
    </svg>`;
}

function svgMicrophone(color, crossed = false) {
    return `
    <svg xmlns="http://www.w3.org/2000/svg"
         viewBox="0 0 24 24" fill="none">
        <rect x="9" y="2" width="6" height="13" rx="3"
              stroke="${color}" stroke-width="1.8"/>
        <path d="M5 11 C5 16 8 19 12 19 C16 19 19 16 19 11
                 M12 19 V22 M8.5 22 H15.5"
              stroke="${color}" stroke-width="1.8"
              stroke-linecap="round"/>
        ${crossed ? `<path d="M3 3 L21 21" stroke="${COLORS.RED}"
        stroke-width="2" stroke-linecap="round"/>` : ""}
    </svg>`;
}

// ==================================================
// SETTINGS
// ==================================================

function loadUserSettings() {
    try {
        const settings = JSON.parse(
            localStorage.getItem(SETTINGS_KEY) || "{}"
        );

        rememberedName = String(settings.name || "");

        hasSavedName =
            rememberedName.length >= 3 &&
            rememberedName.length <= 25;
    } catch (error) {
        console.warn("Could not load user settings:", error);
        rememberedName = "";
        hasSavedName = false;
    }
}

function saveUserName(name) {
    try {
        localStorage.setItem(
            SETTINGS_KEY,
            JSON.stringify({ name })
        );

        rememberedName = name;
        hasSavedName = true;

        return true;
    } catch (error) {
        console.warn("Could not save user name:", error);
        return false;
    }
}

function removeSavedUserName() {
    try {
        localStorage.removeItem(SETTINGS_KEY);

        rememberedName = "";
        hasSavedName = false;

        return true;
    } catch (error) {
        console.warn("Could not remove saved name:", error);
        return false;
    }
}

// ==================================================
// NETWORK EVENTS
// ==================================================

function onServerConnected() {
    console.log("MeetScreen: server connection successful.");

    serverConnected = true;
    hideLoading();
}

function onServerDisconnected() {
    console.log("MeetScreen: server disconnected.");

    serverConnected = false;
    creatingMeeting = false;

    closeAllPeerConnections();

    stopLocalCamera();
    stopLocalMicrophone();

    microphoneEnabled = false;
    cameraEnabled = false;

    hideLoading();
    hideWaitingApproval();

    if (meetingOverlay) {
        meetingOverlay.remove();
        meetingOverlay = null;
    }

    showStatus("Disconnected from MeetScreen server.");
}

function onServerError(message) {
    console.error("MeetScreen connection error:", message);

    creatingMeeting = false;

    hideLoading();
    hideWaitingApproval();

    showStatus(String(message));
}

function onServerMessage(data) {
    if (!data || typeof data !== "object") return;

    console.log("MeetScreen received:", JSON.stringify(data, null, 2));

    switch (String(data.type || "")) {
        case "connected":
            break;

        case "room_created":
            onRoomCreated(data);
            break;

        case "join_pending":
            onJoinPending(data);
            break;

        case "joined":
            onRoomJoined(data);
            break;

        case "join_rejected":
            onJoinRejected(data);
            break;

        case "participants_updated":
            onParticipantsUpdated(data);
            break;

        case "participant_state_updated":
            onParticipantStateUpdated(data);
            break;

        case "waiting_participants_updated":
            onWaitingParticipantsUpdated(data);
            break;

        case "error":
            creatingMeeting = false;
            hideLoading();
            showStatus(String(data.message || "Unknown server error"));
            break;

        case "left":
            onRoomLeft();
            break;

        default:
            console.warn("Unknown server message:", data.type);
    }
}

// ==================================================
// ROOM EVENTS
// ==================================================

function resetLocalPrivacyState() {
    microphoneEnabled = false;
    cameraEnabled = false;

    if (localAudioStream) {
        localAudioStream.getTracks().forEach(track => track.stop());
        localAudioStream = null;
    }

    if (localVideoStream) {
        localVideoStream.getTracks().forEach(track => track.stop());
        localVideoStream = null;
    }

    microphoneStarting = false;
    cameraStarting = false;

    microphoneRequestVersion++;
    cameraRequestVersion++;
}

function onRoomCreated(data) {
    creatingMeeting = false;
    hideLoading();

    currentRoomId = String(data.room_id || "");
    currentPlayerId = String(data.self_id || "");
    currentUserIsHost = true;

    if (!currentRoomId || !currentPlayerId) {
        showStatus("Server returned an invalid meeting response.");
        return;
    }

    resetLocalPrivacyState();

    currentParticipants = Array.isArray(data.participants)
        ? structuredClone(data.participants)
        : [];

    waitingParticipants = [];

    openMeetingScreen(currentParticipants);

    // Tell the server explicitly that both devices are disabled.
    sendMediaState();
}

function onJoinPending(data) {
    creatingMeeting = false;
    hideLoading();

    currentRoomId = String(data.room_id || pendingRoomId);
    currentPlayerId = "";
    currentUserIsHost = false;

    showWaitingApproval(
        String(data.message || "Waiting for host approval.")
    );
}

function onRoomJoined(data) {
    creatingMeeting = false;

    hideLoading();
    hideWaitingApproval();

    currentRoomId = String(data.room_id || "");
    currentPlayerId = String(data.self_id || "");
    currentUserIsHost = false;

    if (!currentRoomId || !currentPlayerId) {
        showStatus("Server returned an invalid meeting response.");
        return;
    }

    resetLocalPrivacyState();

    currentParticipants = Array.isArray(data.participants)
        ? structuredClone(data.participants)
        : [];

    waitingParticipants = [];

    openMeetingScreen(currentParticipants);

    // Explicitly synchronize the private defaults.
    sendMediaState();
}

function onJoinRejected(data) {
    creatingMeeting = false;

    hideLoading();
    hideWaitingApproval();

    currentRoomId = "";
    currentPlayerId = "";
    pendingRoomId = "";

    showStatus(
        String(data.message || "The host rejected your request.")
    );
}

// ==================================================
// PARTICIPANTS EVENTS
// ==================================================

function onParticipantsUpdated(data) {
    const participants = Array.isArray(data.participants)
        ? data.participants
        : [];

    for (const participant of participants) {
        if (String(participant.id || "") === currentPlayerId) {
            currentUserIsHost = Boolean(participant.is_host);
        }
    }

    currentParticipants = structuredClone(participants);

    const self = currentParticipants.find(
        participant => String(participant.id || "") === currentPlayerId
    );

    if (self) {
        self.microphone_enabled = microphoneEnabled;
        self.camera_enabled = cameraEnabled;
    }

    applyLocalMicrophoneState();

    if (!cameraEnabled && localVideoStream) {
        stopLocalCamera();
    }

    synchronizePeerConnections();

    if (meetingOverlay) {
        updateParticipantsList(currentParticipants);
        updateCameraPanel(currentParticipants);
        updateOrganizerVideo(currentParticipants);
        updateControlIcons();
    }
}

function onParticipantStateUpdated(data) {
    const updatedPlayer = data.participant || {};
    const updatedId = String(updatedPlayer.id || "");

    if (!updatedId) return;

    const participant = structuredClone(updatedPlayer);

    if (updatedId === currentPlayerId) {
        participant.microphone_enabled = microphoneEnabled;
        participant.camera_enabled = cameraEnabled;
    }

    const index = currentParticipants.findIndex(
        player => String(player.id || "") === updatedId
    );

    if (index >= 0) {
        currentParticipants[index] = participant;
    } else {
        currentParticipants.push(participant);
    }

    if (updatedId === currentPlayerId) {
        applyLocalMicrophoneState();

        if (!cameraEnabled && localVideoStream) {
            stopLocalCamera();
        }

        updateControlIcons();
    }

    synchronizePeerConnections();

    if (meetingOverlay) {
        updateParticipantsList(currentParticipants);
        updateCameraPanel(currentParticipants);
        updateOrganizerVideo(currentParticipants);
    }
}

function onWaitingParticipantsUpdated(data) {
    waitingParticipants = Array.isArray(data.waiting_participants)
        ? structuredClone(data.waiting_participants)
        : [];

    updateWaitingRoomList();
}

// ==================================================
// WEBRTC — PARTICIPANT SYNCHRONIZATION
// ==================================================

function synchronizePeerConnections() {
    if (!currentRoomId || !currentPlayerId) return;

    const activeIds = new Set(
        currentParticipants
            .map(player => String(player.id || ""))
            .filter(id => id && id !== currentPlayerId)
    );

    for (const [participantId] of peerConnections) {
        if (!activeIds.has(participantId)) {
            closePeerConnection(participantId);
        }
    }

    for (const participantId of activeIds) {
        ensurePeerConnection(participantId);
    }
}

function shouldCreateOffer(remoteId) {
    if (!currentPlayerId || !remoteId) return false;

    // Exactly one participant creates the initial offer.
    return currentPlayerId.localeCompare(remoteId) < 0;
}

function ensurePeerConnection(remoteId) {
    remoteId = String(remoteId || "");

    if (!remoteId || remoteId === currentPlayerId) return null;

    const existing = peerConnections.get(remoteId);

    if (existing && existing.connectionState !== "closed") {
        return existing;
    }

    if (!window.RTCPeerConnection) {
        showStatus("This environment does not support WebRTC.");
        return null;
    }

    console.log("[WebRTC] Creating connection for:", remoteId);

    const pc = new RTCPeerConnection(RTC_CONFIGURATION);

    peerConnections.set(remoteId, pc);

    // Keep both media sections alive even when local devices are off.
    pc.addTransceiver("video", { direction: "sendrecv" });
    pc.addTransceiver("audio", { direction: "sendrecv" });

    pc.onicecandidate = event => {
        if (!event.candidate) return;

        sendWebRTCSignal(remoteId, {
            type: "candidate",
            candidate: event.candidate.toJSON()
        });
    };

    pc.ontrack = event => {
        console.log(
            "[WebRTC] Remote track:",
            remoteId,
            event.track.kind,
            event.track.id
        );

        if (event.track.kind === "video") {
            handleRemoteVideoTrack(remoteId, event);
        } else if (event.track.kind === "audio") {
            handleRemoteAudioTrack(remoteId, event, pc);
        }
    };

    pc.onnegotiationneeded = async () => {
        if (!shouldCreateOffer(remoteId)) return;
        if (makingOffers.has(remoteId)) return;
        if (pc.signalingState !== "stable") return;

        try {
            makingOffers.add(remoteId);

            await attachLocalTracksToPeer(remoteId, pc);

            const offer = await pc.createOffer();

            if (peerConnections.get(remoteId) !== pc) return;
            if (pc.signalingState !== "stable") return;

            await pc.setLocalDescription(offer);

            if (!pc.localDescription) return;

            sendWebRTCSignal(remoteId, {
                type: "offer",
                sdp: pc.localDescription.sdp
            });

            console.log("[WebRTC] Offer sent:", remoteId);

        } catch (error) {
            console.error("[WebRTC] Offer creation failed:", error);
        } finally {
            makingOffers.delete(remoteId);
        }
    };

    pc.onconnectionstatechange = () => {
        console.log(
            "[WebRTC] Connection state:",
            remoteId,
            pc.connectionState
        );

        if (pc.connectionState === "connected") {
            console.log("[WebRTC] Media connected to:", remoteId);
        }

        if (pc.connectionState === "failed") {
            showStatus(
                "Media connection failed. Check network connectivity."
            );
        }

        if (pc.connectionState === "closed") {
            remoteVideoStreams.delete(remoteId);
            removeRemoteAudio(remoteId);
            refreshVideoUI();
        }
    };

    pc.oniceconnectionstatechange = () => {
        console.log(
            "[WebRTC] ICE state:",
            remoteId,
            pc.iceConnectionState
        );
    };

    // If a local track already exists, attach it to the permanent sender.
    attachLocalTracksToPeer(remoteId, pc);

    return pc;
}

async function attachLocalTracksToPeer(remoteId, pc) {
    if (!pc || pc.connectionState === "closed") return;

    await queuePeerTrackUpdate(pc, async () => {
        if (pc.connectionState === "closed") return;

        const videoTransceiver = pc.getTransceivers().find(
            item => item.receiver?.track?.kind === "video"
        );

        const audioTransceiver = pc.getTransceivers().find(
            item => item.receiver?.track?.kind === "audio"
        );

        if (videoTransceiver) {
            const videoTrack = localVideoStream?.getVideoTracks()[0] || null;

            try {
                await videoTransceiver.sender.replaceTrack(videoTrack);

                if (videoTrack) {
                    await applyVideoSenderQuality(videoTransceiver.sender);
                }
            } catch (error) {
                console.warn("[WebRTC] Video attach failed:", error);
            }
        }

        if (audioTransceiver) {
            const audioTrack = localAudioStream?.getAudioTracks()[0] || null;

            if (audioTrack) {
                audioTrack.enabled = microphoneEnabled;
            }

            try {
                await audioTransceiver.sender.replaceTrack(audioTrack);

                console.log("[Audio] Sender track attached:", remoteId, {
                    hasTrack: Boolean(audioTransceiver.sender.track),
                    enabled: audioTransceiver.sender.track?.enabled,
                    readyState: audioTransceiver.sender.track?.readyState,
                    direction: audioTransceiver.direction,
                    currentDirection: audioTransceiver.currentDirection
                });

                if (audioTrack?.enabled) {
                    inspectPeerAudioStats(remoteId, pc, "sender");
                }
            } catch (error) {
                console.warn("[WebRTC] Audio attach failed:", error);
            }
        }
    });
}

async function queuePeerTrackUpdate(pc, update) {
    const previousUpdate = peerTrackUpdateQueues.get(pc) || Promise.resolve();
    const currentUpdate = previousUpdate
        .catch(error => {
            console.error("[WebRTC] Previous track update failed:", error);
        })
        .then(update);

    peerTrackUpdateQueues.set(pc, currentUpdate);

    try {
        await currentUpdate;
    } finally {
        if (peerTrackUpdateQueues.get(pc) === currentUpdate) {
            peerTrackUpdateQueues.delete(pc);
        }
    }
}

// ==================================================
// VIDEO QUALITY
// ==================================================

async function applyVideoSenderQuality(sender) {
    if (!sender || typeof sender.getParameters !== "function") return;

    try {
        const parameters = sender.getParameters();

        if (!parameters.encodings || parameters.encodings.length === 0) {
            return;
        }

        parameters.encodings[0].maxBitrate = 2500000;
        parameters.encodings[0].maxFramerate = 30;
        parameters.degradationPreference = "maintain-resolution";

        await sender.setParameters(parameters);

        console.log("[Video] Sender quality configured.");
    } catch (error) {
        console.warn("[Video] Could not configure sender quality:", error);
    }
}

async function applyVideoQualityToAllPeers() {
    for (const pc of peerConnections.values()) {
        if (pc.connectionState === "closed") continue;

        const transceiver = pc.getTransceivers().find(
            item => item.receiver?.track?.kind === "video"
        );

        if (transceiver) {
            await applyVideoSenderQuality(transceiver.sender);
        }
    }
}

// ==================================================
// WEBRTC — REMOTE VIDEO
// ==================================================

function handleRemoteVideoTrack(remoteId, event) {
    let stream = remoteVideoStreams.get(remoteId);

    if (!stream) {
        stream = new MediaStream();
        remoteVideoStreams.set(remoteId, stream);
    }

    if (!stream.getTracks().some(track => track.id === event.track.id)) {
        stream.addTrack(event.track);
    }

    event.track.onended = () => {
        const currentStream = remoteVideoStreams.get(remoteId);

        if (
            currentStream &&
            !currentStream.getVideoTracks().some(
                track => track.readyState === "live"
            )
        ) {
            remoteVideoStreams.delete(remoteId);
        }

        refreshVideoUI();
    };

    event.track.onmute = refreshVideoUI;
    event.track.onunmute = refreshVideoUI;

    refreshVideoUI();
}

// ==================================================
// WEBRTC — REMOTE AUDIO
// ==================================================

function handleRemoteAudioTrack(remoteId, event, pc) {
    let stream = remoteAudioStreams.get(remoteId);

    if (!stream) {
        stream = new MediaStream();
        remoteAudioStreams.set(remoteId, stream);
    }

    if (!stream.getAudioTracks().some(track => track.id === event.track.id)) {
        stream.addTrack(event.track);

        console.log(
            "[Audio] Remote audio track added:",
            remoteId,
            event.track.id
        );
    }

    event.track.onended = () => {
        const currentStream = remoteAudioStreams.get(remoteId);

        if (!currentStream) return;

        const liveTracks = currentStream.getAudioTracks().filter(
            track => track.readyState === "live"
        );

        if (liveTracks.length === 0) {
            removeRemoteAudio(remoteId);
        }
    };

    event.track.onmute = () => {
        console.log("[Audio] Remote track muted:", remoteId);
    };

    event.track.onunmute = () => {
        console.log("[Audio] Remote track unmuted:", remoteId);
        playRemoteAudio(remoteId);
    };

    inspectPeerAudioStats(remoteId, pc, "receiver");
    attachRemoteAudio(remoteId, stream);
}

function inspectPeerAudioStats(remoteId, pc, side) {
    setTimeout(async () => {
        if (
            peerConnections.get(remoteId) !== pc ||
            pc.connectionState === "closed"
        ) {
            return;
        }

        try {
            const stats = await pc.getStats();
            const audioStats = [];

            stats.forEach(report => {
                if (
                    (report.type === "inbound-rtp" ||
                        report.type === "outbound-rtp") &&
                    (report.kind === "audio" ||
                        report.mediaType === "audio")
                ) {
                    audioStats.push({
                        type: report.type,
                        bytesSent: report.bytesSent,
                        bytesReceived: report.bytesReceived,
                        packetsSent: report.packetsSent,
                        packetsReceived: report.packetsReceived,
                        packetsLost: report.packetsLost,
                        audioLevel: report.audioLevel
                    });
                }
            });

            console.log("[Audio] Peer stats:", remoteId, side, audioStats);
        } catch (error) {
            console.error("[Audio] Could not inspect peer stats:", remoteId, error);
        }
    }, 3000);
}

function attachRemoteAudio(remoteId, stream) {
    let audio = remoteAudioElements.get(remoteId);

    if (!audio) {
        audio = document.createElement("audio");

        audio.autoplay = true;
        audio.playsInline = true;
        audio.muted = false;
        audio.volume = 1;
        audio.controls = false;

        audio.style.position = "fixed";
        audio.style.width = "1px";
        audio.style.height = "1px";
        audio.style.opacity = "0";
        audio.style.pointerEvents = "none";

        audio.setAttribute("autoplay", "");
        audio.setAttribute("playsinline", "");

        document.body.appendChild(audio);

        remoteAudioElements.set(remoteId, audio);
    }

    if (audio.srcObject !== stream) {
        audio.srcObject = stream;
    }

    playRemoteAudio(remoteId);
}

function playRemoteAudio(remoteId) {
    const audio = remoteAudioElements.get(remoteId);

    if (!audio || !audio.srcObject || !audio.paused) return;

    audio.play().then(() => {
        console.log("[Audio] Playback active:", remoteId);
    }).catch(error => {
        console.warn("[Audio] Playback blocked:", remoteId, error);
    });
}

function resumeRemoteAudio() {
    for (const remoteId of remoteAudioElements.keys()) {
        playRemoteAudio(remoteId);
    }
}

function removeRemoteAudio(remoteId) {
    const audio = remoteAudioElements.get(remoteId);

    if (audio) {
        audio.pause();
        audio.srcObject = null;
        audio.remove();
    }

    remoteAudioElements.delete(remoteId);
    remoteAudioStreams.delete(remoteId);
}

// ==================================================
// WEBRTC — LOCAL TRACK MANAGEMENT
// ==================================================

async function attachLocalVideoToPeers() {
    for (const [remoteId, pc] of peerConnections) {
        if (pc.connectionState === "closed") continue;

        await attachLocalTracksToPeer(remoteId, pc);
    }
}

async function attachLocalAudioToPeers() {
    for (const [remoteId, pc] of peerConnections) {
        if (pc.connectionState === "closed") continue;

        await attachLocalTracksToPeer(remoteId, pc);
    }
}

function applyLocalMicrophoneState() {
    const track = localAudioStream?.getAudioTracks()[0];

    if (track) {
        track.enabled = microphoneEnabled;
    }

    updateControlIcons();
}

function refreshVideoUI() {
    if (!meetingOverlay) return;

    updateCameraPanel(currentParticipants);
    updateOrganizerVideo(currentParticipants);
}

// ==================================================
// WEBRTC — SIGNAL HANDLING
// ==================================================

async function onWebRTCSignal(packet) {
    if (!packet || typeof packet !== "object") return;
    if (!currentRoomId || !currentPlayerId) return;

    const remoteId = String(packet.from_id || "");
    const signal = packet.signal;

    if (!remoteId || remoteId === currentPlayerId || !signal) return;

    console.log("[WebRTC] Signal received:", remoteId, signal.type);

    const pc = ensurePeerConnection(remoteId);

    if (!pc) return;

    try {
        if (signal.type === "offer") {
            if (!signal.sdp) return;

            const offerCollision =
                makingOffers.has(remoteId) ||
                pc.signalingState !== "stable";

            const polite = !shouldCreateOffer(remoteId);

            if (offerCollision && !polite) {
                ignoreOffer.add(remoteId);

                console.warn(
                    "[WebRTC] Ignoring colliding offer from:",
                    remoteId
                );

                return;
            }

            if (offerCollision && polite) {
                await pc.setLocalDescription({ type: "rollback" });
            }

            await pc.setRemoteDescription(
                new RTCSessionDescription({
                    type: "offer",
                    sdp: signal.sdp
                })
            );

            await attachLocalTracksToPeer(remoteId, pc);
            await flushPendingIceCandidates(remoteId, pc);

            const answer = await pc.createAnswer();

            await pc.setLocalDescription(answer);

            sendWebRTCSignal(remoteId, {
                type: "answer",
                sdp: pc.localDescription.sdp
            });

            console.log("[WebRTC] Answer sent:", remoteId);

            return;
        }

        if (signal.type === "answer") {
            if (pc.signalingState !== "have-local-offer") {
                console.warn(
                    "[WebRTC] Unexpected answer:",
                    remoteId,
                    pc.signalingState
                );

                return;
            }

            await pc.setRemoteDescription(
                new RTCSessionDescription({
                    type: "answer",
                    sdp: signal.sdp
                })
            );

            await attachLocalTracksToPeer(remoteId, pc);
            await flushPendingIceCandidates(remoteId, pc);

            console.log("[WebRTC] Answer accepted:", remoteId);

            return;
        }

        if (signal.type === "candidate") {
            if (!signal.candidate) return;

            const candidate = new RTCIceCandidate(signal.candidate);

            if (pc.remoteDescription) {
                try {
                    await pc.addIceCandidate(candidate);
                } catch (error) {
                    if (!ignoreOffer.has(remoteId)) throw error;
                }
            } else {
                const queue = pendingIceCandidates.get(remoteId) || [];

                queue.push(candidate);
                pendingIceCandidates.set(remoteId, queue);
            }

            return;
        }

        console.warn("[WebRTC] Unknown signal type:", signal.type);

    } catch (error) {
        console.error(
            "[WebRTC] Signal processing failed:",
            remoteId,
            error
        );
    }
}

async function flushPendingIceCandidates(remoteId, pc) {
    const queue = pendingIceCandidates.get(remoteId) || [];

    pendingIceCandidates.delete(remoteId);

    for (const candidate of queue) {
        try {
            await pc.addIceCandidate(candidate);
        } catch (error) {
            if (!ignoreOffer.has(remoteId)) {
                console.warn(
                    "[WebRTC] Could not add queued ICE candidate:",
                    error
                );
            }
        }
    }

    ignoreOffer.delete(remoteId);
}

// ==================================================
// WEBRTC — CLEANUP
// ==================================================

function closePeerConnection(remoteId) {
    const pc = peerConnections.get(remoteId);

    if (pc) {
        pc.onicecandidate = null;
        pc.ontrack = null;
        pc.onnegotiationneeded = null;
        pc.onconnectionstatechange = null;
        pc.oniceconnectionstatechange = null;

        try {
            pc.close();
        } catch (error) {
            console.warn("[WebRTC] Error closing connection:", error);
        }
    }

    peerConnections.delete(remoteId);
    remoteVideoStreams.delete(remoteId);
    removeRemoteAudio(remoteId);

    pendingIceCandidates.delete(remoteId);
    makingOffers.delete(remoteId);
    ignoreOffer.delete(remoteId);
    if (pc) peerTrackUpdateQueues.delete(pc);

    refreshVideoUI();
}

function closeAllPeerConnections() {
    for (const remoteId of [...peerConnections.keys()]) {
        closePeerConnection(remoteId);
    }

    peerConnections.clear();
    remoteVideoStreams.clear();

    for (const remoteId of [...remoteAudioElements.keys()]) {
        removeRemoteAudio(remoteId);
    }

    remoteAudioStreams.clear();
    pendingIceCandidates.clear();
    makingOffers.clear();
    ignoreOffer.clear();
}

// ==================================================
// VIDEO STREAM HELPERS
// ==================================================

function getParticipantVideoStream(participant) {
    const id = String(participant.id || "");
    const isSelf = id === currentPlayerId;

    if (isSelf) {
        if (!cameraEnabled || !localVideoStream) return null;

        const tracks = localVideoStream.getVideoTracks();

        if (!tracks.some(
            track => track.readyState === "live" && track.enabled
        )) {
            return null;
        }

        return localVideoStream;
    }

    if (!Boolean(participant.camera_enabled ?? false)) {
        return null;
    }

    const remoteStream = remoteVideoStreams.get(id);

    if (!remoteStream) return null;

    const hasLiveVideo = remoteStream.getVideoTracks().some(
        track => track.readyState === "live" && track.enabled
    );

    return hasLiveVideo ? remoteStream : null;
}

function attachVideoElement(video, stream, muted = false) {
    video.autoplay = true;
    video.playsInline = true;
    video.muted = muted;

    video.setAttribute("playsinline", "");
    video.setAttribute("autoplay", "");

    video.srcObject = stream;

    video.play().catch(error => {
        console.warn("[Video] Playback error:", error);
    });
}

// ==================================================
// AVATAR COLORS
// ==================================================

function getAvatarColor(playerId, serverColor = "") {
    if (serverColor) return serverColor;

    if (avatarColors[playerId]) {
        return avatarColors[playerId];
    }

    let hash = 0;

    for (let i = 0; i < playerId.length; i++) {
        hash = ((hash << 5) - hash) + playerId.charCodeAt(i);
        hash |= 0;
    }

    const index = Math.abs(hash) % AVATAR_COLORS.length;

    avatarColors[playerId] = AVATAR_COLORS[index];

    return avatarColors[playerId];
}

function createAvatar(name, color) {
    const avatar = createElement("div", "avatar");

    avatar.style.background = color;
    avatar.textContent = name
        ? name.charAt(0).toUpperCase()
        : "?";

    return avatar;
}

// ==================================================
// WAITING FOR HOST APPROVAL
// ==================================================

function showWaitingApproval(message) {
    hideWaitingApproval();

    waitingApprovalOverlay = createElement(
        "div",
        "waiting-approval"
    );

    add(waitingApprovalOverlay, createElement("div", "spinner"));
    add(
        waitingApprovalOverlay,
        createElement("h2", "", "Waiting for approval")
    );
    add(waitingApprovalOverlay, createElement("p", "", message));

    add(
        waitingApprovalOverlay,
        createElement(
            "div",
            "room-code",
            "Meeting ID: " + currentRoomId
        )
    );

    add(
        waitingApprovalOverlay,
        button(
            "Cancel request",
            "danger-button",
            cancelJoinRequest
        )
    );

    document.body.appendChild(waitingApprovalOverlay);
}

function hideWaitingApproval() {
    if (waitingApprovalOverlay) {
        waitingApprovalOverlay.remove();
    }

    waitingApprovalOverlay = null;
}

function cancelJoinRequest() {
    if (!serverConnected) {
        hideWaitingApproval();
        pendingRoomId = "";
        currentRoomId = "";
        return;
    }

    sendNetworkMessage({ type: "leave_room" });

    hideWaitingApproval();

    pendingRoomId = "";
    currentRoomId = "";

    showStatus("Join request cancelled.");
}

// ==================================================
// PARTICIPANTS LIST
// ==================================================

function updateParticipantsList(participants) {
    const container = document.getElementById("participants-list");
    const heading = document.getElementById("participants-heading");

    if (!container) return;

    currentParticipants = structuredClone(participants);
    clear(container);

    for (const participant of currentParticipants) {
        createParticipantRow(container, participant);
    }

    if (heading) {
        heading.textContent =
            "Participants  ·  " + currentParticipants.length;
    }
}

function createParticipantRow(container, participant) {
    const playerId = String(participant.id || "");
    const playerName = String(participant.name || "Unknown");

    const isHost = Boolean(participant.is_host);

    const micEnabled = Boolean(
        participant.microphone_enabled ?? false
    );

    const playerCameraEnabled = Boolean(
        participant.camera_enabled ?? false
    );

    const row = createElement("div", "participant-row");

    add(
        row,
        createAvatar(
            playerName,
            getAvatarColor(
                playerId,
                participant.avatar_color || ""
            )
        )
    );

    const info = createElement("div", "participant-info");

    add(
        info,
        createElement("div", "participant-name", playerName)
    );

    if (isHost) {
        add(
            info,
            createElement("div", "participant-role", "Organizer")
        );
    }

    add(row, info);

    const icons = createElement("div", "participant-icons");

    icons.innerHTML =
        svgMicrophone(
            micEnabled ? COLORS.WHITE : COLORS.RED,
            !micEnabled
        ) +
        svgCamera(
            playerCameraEnabled ? COLORS.WHITE : COLORS.RED,
            !playerCameraEnabled
        );

    add(row, icons);
    add(container, row);
}

// ==================================================
// CAMERA PANEL
// ==================================================

function updateCameraPanel(participants) {
    const container = document.getElementById("camera-tiles");

    if (!container) return;

    clear(container);

    const participantList = Array.isArray(participants)
        ? participants
        : [];

    const organizer = participantList.find(
        participant => Boolean(participant.is_host)
    );

    const sortedParticipants = [];

    if (organizer) {
        sortedParticipants.push(organizer);
    }

    for (const participant of participantList) {
        if (
            String(participant.id || "") !==
            String(organizer?.id || "")
        ) {
            sortedParticipants.push(participant);
        }
    }

    if (sortedParticipants.length === 0) {
        add(
            container,
            createElement(
                "div",
                "camera-empty",
                "Waiting for participants..."
            )
        );

        return;
    }

    for (const participant of sortedParticipants) {
        createCameraTile(container, participant);
    }
}

function createCameraTile(container, participant) {
    const playerId = String(participant.id || "");
    const playerName = String(participant.name || "Unknown");

    const isHost = Boolean(participant.is_host);
    const stream = getParticipantVideoStream(participant);

    const playerCameraEnabled = playerId === currentPlayerId
        ? cameraEnabled
        : Boolean(participant.camera_enabled ?? false);

    const tile = createElement(
        "div",
        "camera-tile" + (isHost ? " organizer-tile" : "")
    );

    tile.title = playerName;

    const avatar = createElement("div", "camera-tile-avatar");

    avatar.style.background = getAvatarColor(
        playerId,
        participant.avatar_color || ""
    );

    avatar.textContent = playerName
        ? playerName.charAt(0).toUpperCase()
        : "?";

    add(tile, avatar);

    if (stream) {
        const video = createElement("video", "camera-tile-video");

        attachVideoElement(video, stream, playerId === currentPlayerId);

        add(tile, video);
        tile.classList.add("camera-live");
    }

    add(
        tile,
        createElement("div", "camera-tile-name", playerName)
    );

    if (isHost) {
        add(
            tile,
            createElement("div", "camera-tile-role", "ORGANIZER")
        );
    }

    const status = createElement("div", "camera-tile-status");

    status.innerHTML = playerCameraEnabled
        ? svgCamera(COLORS.GREEN)
        : svgCamera(COLORS.RED, true);

    add(tile, status);
    add(container, tile);
}

// ==================================================
// ORGANIZER MAIN VIDEO
// ==================================================

function updateOrganizerVideo(participants) {
    const container = document.getElementById("organizer-video");

    if (!container) return;

    const participantList = Array.isArray(participants)
        ? participants
        : [];

    let organizer = participantList.find(
        participant => Boolean(participant.is_host)
    );

    if (!organizer && currentUserIsHost) {
        organizer = participantList.find(
            participant =>
                String(participant.id || "") === currentPlayerId
        );
    }

    if (!organizer) {
        organizer = {
            id: currentPlayerId,
            name: currentUserName || "Organizer",
            is_host: currentUserIsHost,
            camera_enabled: cameraEnabled
        };
    }

    const playerId = String(organizer.id || "");
    const playerName = String(organizer.name || "Organizer");

    const playerCameraEnabled = playerId === currentPlayerId
        ? cameraEnabled
        : Boolean(organizer.camera_enabled ?? false);

    const stream = getParticipantVideoStream(organizer);

    clear(container);
    container.classList.remove("camera-live");

    if (stream) {
        const video = createElement(
            "video",
            "organizer-video-stream"
        );

        attachVideoElement(video, stream, playerId === currentPlayerId);

        add(container, video);
        container.classList.add("camera-live");
    }

    const avatar = createElement(
        "div",
        "organizer-video-avatar"
    );

    avatar.style.background = getAvatarColor(
        playerId,
        organizer.avatar_color || ""
    );

    avatar.textContent = playerName
        ? playerName.charAt(0).toUpperCase()
        : "?";

    add(container, avatar);

    add(
        container,
        createElement(
            "div",
            "organizer-video-name",
            playerName
        )
    );

    let videoStatus = "Waiting for video connection";

    if (!playerCameraEnabled) {
        videoStatus = "Camera is turned off";
    } else if (stream) {
        videoStatus = "Camera is on";
    } else if (playerId === currentPlayerId && cameraStarting) {
        videoStatus = "Starting camera...";
    } else if (playerId === currentPlayerId) {
        videoStatus = "Camera is not available";
    }

    add(
        container,
        createElement(
            "div",
            "organizer-video-status",
            videoStatus
        )
    );

    add(
        container,
        createElement(
            "div",
            "organizer-video-label",
            "Organizer · " + playerName
        )
    );

    const cameraIcon = createElement(
        "div",
        "organizer-video-camera-icon"
    );

    cameraIcon.innerHTML = playerCameraEnabled
        ? svgCamera(COLORS.GREEN)
        : svgCamera(COLORS.RED, true);

    add(container, cameraIcon);
}

// ==================================================
// LOCAL CAMERA
// ==================================================

async function startLocalCamera() {
    if (cameraStarting || localVideoStream) return false;

    if (
        !navigator.mediaDevices ||
        !navigator.mediaDevices.getUserMedia
    ) {
        cameraEnabled = false;
        updateCameraPanel(currentParticipants);
        updateOrganizerVideo(currentParticipants);
        updateControlIcons();
        sendMediaState();

        showStatus("Camera is not available in this environment.");

        return false;
    }

    const requestVersion = ++cameraRequestVersion;

    cameraStarting = true;

    updateOrganizerVideo(currentParticipants);
    showStatus("Requesting camera access...");

    try {
        const stream = await navigator.mediaDevices.getUserMedia(
            CAMERA_CONSTRAINTS
        );

        if (requestVersion !== cameraRequestVersion) {
            stream.getTracks().forEach(track => track.stop());
            return false;
        }

        if (!currentRoomId || !meetingOverlay) {
            stream.getTracks().forEach(track => track.stop());
            return false;
        }

        localVideoStream = stream;

        const videoTrack = stream.getVideoTracks()[0];

        if (videoTrack) {
            videoTrack.contentHint = "motion";

            console.log(
                "[Camera] Actual camera settings:",
                videoTrack.getSettings()
            );

            videoTrack.onended = () => {
                if (localVideoStream !== stream) return;

                localVideoStream = null;
                cameraEnabled = false;

                attachLocalVideoToPeers();

                updateCameraPanel(currentParticipants);
                updateOrganizerVideo(currentParticipants);
                updateControlIcons();
                updateParticipantsList(currentParticipants);

                sendMediaState();

                showStatus("Camera was disconnected.");
            };
        }

        cameraEnabled = true;

        await attachLocalVideoToPeers();
        await applyVideoQualityToAllPeers();

        updateCameraPanel(currentParticipants);
        updateOrganizerVideo(currentParticipants);
        updateControlIcons();
        updateParticipantsList(currentParticipants);

        sendMediaState();

        showStatus("Camera enabled.");

        return true;

    } catch (error) {
        console.error("Could not start camera:", error);

        if (requestVersion !== cameraRequestVersion) return false;

        cameraEnabled = false;

        await attachLocalVideoToPeers();

        updateCameraPanel(currentParticipants);
        updateOrganizerVideo(currentParticipants);
        updateControlIcons();
        updateParticipantsList(currentParticipants);

        sendMediaState();

        if (
            error.name === "NotAllowedError" ||
            error.name === "PermissionDeniedError"
        ) {
            showStatus("Camera permission was denied.");
        } else if (
            error.name === "NotFoundError" ||
            error.name === "DevicesNotFoundError"
        ) {
            showStatus("No camera was found on this device.");
        } else if (
            error.name === "NotReadableError" ||
            error.name === "TrackStartError"
        ) {
            showStatus("Camera is already being used by another application.");
        } else {
            showStatus(
                "Could not start camera: " +
                String(error.message || error)
            );
        }

        return false;

    } finally {
        if (requestVersion === cameraRequestVersion) {
            cameraStarting = false;
            updateOrganizerVideo(currentParticipants);
        }
    }
}

async function stopLocalCamera() {
    cameraRequestVersion++;
    cameraStarting = false;

    if (localVideoStream) {
        for (const track of localVideoStream.getTracks()) {
            track.onended = null;
            track.stop();
        }

        localVideoStream = null;
    }

    await attachLocalVideoToPeers();

    updateCameraPanel(currentParticipants);
    updateOrganizerVideo(currentParticipants);
    updateControlIcons();
}

// ==================================================
// LOCAL MICROPHONE
// ==================================================

async function startLocalMicrophone() {
    if (microphoneStarting || localAudioStream) return false;

    if (
        !navigator.mediaDevices ||
        !navigator.mediaDevices.getUserMedia
    ) {
        microphoneEnabled = false;

        updateControlIcons();
        updateParticipantsList(currentParticipants);
        sendMediaState();

        showStatus("Microphone is not available in this environment.");

        return false;
    }

    const requestVersion = ++microphoneRequestVersion;

    microphoneStarting = true;

    showStatus("Requesting microphone access...");

    try {
        const stream = await navigator.mediaDevices.getUserMedia(
            MICROPHONE_CONSTRAINTS
        );

        if (requestVersion !== microphoneRequestVersion) {
            stream.getTracks().forEach(track => track.stop());
            return false;
        }

        if (!currentRoomId || !meetingOverlay) {
            stream.getTracks().forEach(track => track.stop());
            return false;
        }

        localAudioStream = stream;

        const audioTrack = stream.getAudioTracks()[0];

        if (!audioTrack) {
            throw new Error("No audio track was created.");
        }

        audioTrack.enabled = microphoneEnabled;

        audioTrack.onended = () => {
            if (localAudioStream !== stream) return;

            localAudioStream = null;
            microphoneEnabled = false;

            attachLocalAudioToPeers();

            updateControlIcons();
            updateParticipantsList(currentParticipants);

            sendMediaState();

            showStatus("Microphone was disconnected.");
        };

        await attachLocalAudioToPeers();

        updateControlIcons();
        updateParticipantsList(currentParticipants);

        sendMediaState();

        showStatus(
            microphoneEnabled
                ? "Microphone enabled."
                : "Microphone is muted."
        );

        return true;

    } catch (error) {
        console.error("Could not start microphone:", error);

        if (requestVersion !== microphoneRequestVersion) return false;

        microphoneEnabled = false;

        await attachLocalAudioToPeers();

        updateControlIcons();
        updateParticipantsList(currentParticipants);

        sendMediaState();

        if (
            error.name === "NotAllowedError" ||
            error.name === "PermissionDeniedError"
        ) {
            showStatus("Microphone permission was denied.");
        } else if (
            error.name === "NotFoundError" ||
            error.name === "DevicesNotFoundError"
        ) {
            showStatus("No microphone was found on this device.");
        } else if (
            error.name === "NotReadableError" ||
            error.name === "TrackStartError"
        ) {
            showStatus("Microphone is already being used by another application.");
        } else {
            showStatus(
                "Could not start microphone: " +
                String(error.message || error)
            );
        }

        return false;

    } finally {
        if (requestVersion === microphoneRequestVersion) {
            microphoneStarting = false;
        }
    }
}

async function stopLocalMicrophone() {
    microphoneRequestVersion++;
    microphoneStarting = false;

    if (localAudioStream) {
        for (const track of localAudioStream.getTracks()) {
            track.onended = null;
            track.stop();
        }

        localAudioStream = null;
    }

    await attachLocalAudioToPeers();

    updateControlIcons();
}

// ==================================================
// WAITING ROOM LIST
// ==================================================

function updateWaitingRoomList() {
    const container = document.getElementById("waiting-list");
    const heading = document.getElementById("waiting-heading");

    if (!container) return;

    clear(container);

    for (const request of waitingParticipants) {
        createWaitingParticipantRow(
            container,
            String(request.id || ""),
            String(request.name || "Unknown")
        );
    }

    if (heading) {
        heading.textContent =
            "Waiting room  ·  " + waitingParticipants.length;
    }

    if (waitingParticipants.length === 0) {
        add(
            container,
            createElement(
                "div",
                "card-description",
                "No pending requests"
            )
        );
    }
}

function createWaitingParticipantRow(
    container,
    requestId,
    playerName
) {
    const row = createElement("div", "waiting-row");

    add(
        row,
        createAvatar(
            playerName,
            getAvatarColor(requestId)
        )
    );

    const info = createElement("div", "waiting-info");

    add(
        info,
        createElement("div", "participant-name", playerName)
    );

    add(
        info,
        createElement("small", "", "Requesting to join")
    );

    add(row, info);

    add(
        row,
        button(
            "✓",
            "small-action accept-action",
            () => acceptWaitingParticipant(requestId)
        )
    );

    add(
        row,
        button(
            "✕",
            "small-action reject-action",
            () => rejectWaitingParticipant(requestId)
        )
    );

    add(container, row);
}

// ==================================================
// WAITING ROOM ACTIONS
// ==================================================

function acceptWaitingParticipant(requestId) {
    if (!serverConnected) {
        showStatus("Not connected to MeetScreen server.");
        return;
    }

    if (!currentUserIsHost) {
        showStatus("Only the host can accept requests.");
        return;
    }

    if (!requestId) return;

    sendNetworkMessage({
        type: "approve_join",
        request_id: requestId
    });
}

function rejectWaitingParticipant(requestId) {
    if (!serverConnected) {
        showStatus("Not connected to MeetScreen server.");
        return;
    }

    if (!currentUserIsHost) {
        showStatus("Only the host can reject requests.");
        return;
    }

    if (!requestId) return;

    sendNetworkMessage({
        type: "reject_join",
        request_id: requestId
    });
}

// ==================================================
// MAIN INTERFACE
// ==================================================

function buildInterface() {
    const app = createElement("div", "app");
    app.id = "app";

    const topbar = createElement("header", "topbar");

    const brandIcon = createElement("span");
    brandIcon.innerHTML = svgVideo();

    add(topbar, brandIcon);
    add(topbar, createElement("div", "brand", "MeetScreen"));
    add(app, topbar);

    const body = createElement("div", "body");

    add(body, createElement("aside", "sidebar"));

    const scroll = createElement("main", "main-scroll");
    const content = createElement("div", "main-content");

    add(
        content,
        createElement("div", "page-title", "Ready to meet?")
    );

    add(
        content,
        createElement(
            "div",
            "page-subtitle",
            "Connect with people, anywhere."
        )
    );

    add(content, createElement("div", "content-gap"));

    createNewMeetingCard(content);
    createJoinCard(content);

    add(scroll, content);
    add(body, scroll);
    add(app, body);

    add(document.body, app);
}

function createNewMeetingCard(parent) {
    const card = createElement("section", "card");

    const icon = createElement("div");
    icon.innerHTML = svgVideo();

    add(card, icon);

    add(card, createElement("div", "card-title", "New meeting"));

    add(
        card,
        createElement(
            "div",
            "card-description",
            "Start an instant video conference."
        )
    );

    add(
        card,
        button("Start meeting", "primary-button", onStartMeeting)
    );

    add(parent, card);
}

function createJoinCard(parent) {
    const card = createElement("section", "card");

    const icon = createElement("div");
    icon.innerHTML = svgKeyboard();

    add(card, icon);

    add(card, createElement("div", "card-title", "Join a meeting"));

    const input = createElement("input", "text-input");

    input.id = "meeting-input";
    input.placeholder = "Enter meeting ID...";
    input.autocomplete = "off";

    add(card, input);

    add(
        card,
        button("Join", "outline-button", onJoinMeeting)
    );

    input.addEventListener("keydown", event => {
        if (event.key === "Enter") onJoinMeeting();
    });

    add(parent, card);
}

// ==================================================
// NAME DIALOG
// ==================================================

function openNameDialog() {
    if (nameDialog) return;

    nameDialog = createElement("div", "overlay");

    const panel = createElement("div", "dialog");

    const title = pendingAction === "create"
        ? "Create a meeting"
        : "Join a meeting";

    add(panel, createElement("div", "dialog-title", title));

    add(
        panel,
        createElement(
            "div",
            "dialog-subtitle",
            "Enter your name to continue."
        )
    );

    const input = createElement("input", "text-input");

    input.placeholder = "Your name...";
    input.maxLength = 25;
    input.value = rememberedName;

    add(panel, input);

    const checkboxRow = createElement("label", "checkbox-row");
    const checkbox = createElement("input");

    checkbox.type = "checkbox";
    checkbox.checked = hasSavedName;

    add(checkboxRow, checkbox);

    add(
        checkboxRow,
        createElement("span", "", "Remember me on this device")
    );

    add(panel, checkboxRow);

    const error = createElement("div", "error-text hidden");

    add(panel, error);

    const buttons = createElement("div", "dialog-buttons");

    add(
        buttons,
        button("Cancel", "neutral-button", closeNameDialog)
    );

    add(
        buttons,
        button(
            "Continue",
            "primary-button",
            () => confirmMeetingName(input, checkbox, error)
        )
    );

    add(panel, buttons);
    add(nameDialog, panel);

    document.body.appendChild(nameDialog);

    input.addEventListener("keydown", event => {
        if (event.key === "Enter") {
            confirmMeetingName(input, checkbox, error);
        }
    });

    input.focus();
}

function closeNameDialog() {
    if (nameDialog) nameDialog.remove();
    nameDialog = null;
}

function confirmMeetingName(input, checkbox, error) {
    const enteredName = input.value.trim();

    if (enteredName.length < 3) {
        error.textContent = "Name must contain at least 3 characters.";
        error.classList.remove("hidden");
        input.focus();
        return;
    }

    if (enteredName.length > 25) {
        error.textContent = "Name cannot exceed 25 characters.";
        error.classList.remove("hidden");
        input.focus();
        return;
    }

    if (checkbox.checked) {
        if (!saveUserName(enteredName)) {
            error.textContent = "Could not save your name.";
            error.classList.remove("hidden");
            return;
        }
    } else {
        if (!removeSavedUserName()) {
            error.textContent = "Could not update saved settings.";
            error.classList.remove("hidden");
            return;
        }
    }

    closeNameDialog();

    currentUserName = enteredName;

    if (pendingAction === "join") {
        prepareJoinMeeting(enteredName);
    } else {
        prepareMeeting(enteredName);
    }
}

// ==================================================
// PREPARE MEETING
// ==================================================

function prepareMeeting(userName) {
    if (creatingMeeting) return;

    if (!serverConnected) {
        showStatus("Not connected to MeetScreen server.");
        return;
    }

    currentUserName = userName;
    creatingMeeting = true;
    pendingAction = "create";

    showLoading("Creating your meeting...");

    if (!sendNetworkMessage({
        type: "create_room",
        name: userName
    })) {
        creatingMeeting = false;
        hideLoading();
    }
}

function prepareJoinMeeting(userName) {
    if (creatingMeeting) return;

    if (!serverConnected) {
        showStatus("Not connected to MeetScreen server.");
        return;
    }

    if (!pendingRoomId) {
        showStatus("Please enter a meeting ID.");
        return;
    }

    currentUserName = userName;
    creatingMeeting = true;

    showLoading("Sending join request...");

    if (!sendNetworkMessage({
        type: "join_room",
        room_id: pendingRoomId,
        name: userName
    })) {
        creatingMeeting = false;
        hideLoading();
    }
}

// ==================================================
// MEETING SCREEN
// ==================================================

function openMeetingScreen(participants) {
    hideWaitingApproval();

    closeAllPeerConnections();

    if (meetingOverlay) {
        meetingOverlay.remove();
        meetingOverlay = null;
    }

    meetingOverlay = createElement("div", "app");
    meetingOverlay.id = "meeting-overlay";

    const topbar = createElement("header", "topbar");

    const icon = createElement("span");
    icon.innerHTML = svgVideo();

    add(topbar, icon);
    add(topbar, createElement("div", "brand", "MeetScreen"));
    add(meetingOverlay, topbar);

    const body = createElement("div", "meeting-layout");

    add(body, createCameraPanel());

    const center = createElement("section", "meeting-center");

    add(center, createElement("h1", "", "Your meeting is ready"));

    add(
        center,
        createElement(
            "p",
            "",
            currentUserIsHost
                ? "You are the meeting organizer."
                : "You joined the meeting."
        )
    );

    const organizerVideo = createElement("div", "organizer-video");
    organizerVideo.id = "organizer-video";

    add(center, organizerVideo);

    add(
        center,
        createElement("p", "", "Your camera and microphone are off.")
    );

    add(body, center);
    add(body, createParticipantsPanel());

    add(meetingOverlay, body);
    add(meetingOverlay, createMeetingControls());

    document.body.appendChild(meetingOverlay);

    currentParticipants = structuredClone(participants);

    updateParticipantsList(currentParticipants);
    updateCameraPanel(currentParticipants);
    updateOrganizerVideo(currentParticipants);
    updateWaitingRoomList();
    updateControlIcons();

    // Create receive-capable connections without requesting devices.
    synchronizePeerConnections();

    // Intentionally no startLocalCamera() or startLocalMicrophone() here.
    resumeRemoteAudio();
}

// ==================================================
// CAMERA PANEL
// ==================================================

function createCameraPanel() {
    const panel = createElement("aside", "camera-panel");

    add(
        panel,
        createElement("div", "camera-panel-heading", "CAMERAS")
    );

    const tiles = createElement("div", "camera-tiles");
    tiles.id = "camera-tiles";

    add(panel, tiles);

    return panel;
}

// ==================================================
// PARTICIPANTS PANEL
// ==================================================

function createParticipantsPanel() {
    const panel = createElement("aside", "participants-panel");

    if (currentUserIsHost) {
        add(
            panel,
            createElement("div", "section-label", "MEETING CODE")
        );

        const code = createElement("div", "meeting-code", currentRoomId);
        code.id = "meeting-code";

        add(panel, code);

        add(
            panel,
            button("Copy code", "outline-button", copyMeetingId)
        );

        add(panel, createElement("div", "panel-separator"));

        const waitingHeading = createElement(
            "div",
            "panel-heading",
            "Waiting room  ·  0"
        );

        waitingHeading.id = "waiting-heading";

        add(panel, waitingHeading);

        const waitingList = createElement("div");
        waitingList.id = "waiting-list";

        add(panel, waitingList);

        add(panel, createElement("div", "panel-separator"));
    }

    const heading = createElement(
        "div",
        "panel-heading",
        "Participants  ·  0"
    );

    heading.id = "participants-heading";

    add(panel, heading);

    const participants = createElement("div");
    participants.id = "participants-list";

    add(panel, participants);

    return panel;
}

// ==================================================
// MEETING CONTROLS
// ==================================================

function createMeetingControls() {
    const bottom = createElement("footer", "bottom-controls");

    const mic = button("", "control-button", toggleMicrophone);

    mic.id = "microphone-button";
    mic.title = "Turn microphone on";

    add(bottom, mic);

    add(bottom, createElement("div", "control-separator"));

    const camera = button("", "control-button", toggleCamera);

    camera.id = "camera-button";
    camera.title = "Turn camera on";

    add(bottom, camera);

    add(bottom, createElement("div", "control-spacer"));

    add(
        bottom,
        button("Leave", "danger-button", leaveCurrentMeeting)
    );

    return bottom;
}

function updateControlIcons() {
    const mic = document.getElementById("microphone-button");
    const camera = document.getElementById("camera-button");

    if (mic) {
        mic.innerHTML = svgMicrophone(
            microphoneEnabled ? COLORS.WHITE : COLORS.RED,
            !microphoneEnabled
        );

        mic.title = microphoneEnabled
            ? "Turn microphone off"
            : "Turn microphone on";
    }

    if (camera) {
        camera.innerHTML = svgCamera(
            cameraEnabled ? COLORS.WHITE : COLORS.RED,
            !cameraEnabled
        );

        camera.title = cameraEnabled
            ? "Turn camera off"
            : "Turn camera on";
    }
}

// ==================================================
// MEDIA STATE
// ==================================================

function sendMediaState() {
    if (
        !serverConnected ||
        !currentRoomId ||
        !currentPlayerId
    ) {
        return;
    }

    sendNetworkMessage({
        type: "update_media_state",
        microphone_enabled: microphoneEnabled,
        camera_enabled: cameraEnabled
    });
}

async function toggleMicrophone() {
    if (!currentRoomId || !currentPlayerId) return;

    if (microphoneEnabled) {
        microphoneEnabled = false;

        if (microphoneStarting) {
            microphoneRequestVersion++;
            microphoneStarting = false;
        }

        applyLocalMicrophoneState();

        if (localAudioStream) {
            localAudioStream.getAudioTracks().forEach(
                track => track.enabled = false
            );
        }

        sendMediaState();
        updateParticipantsList(currentParticipants);
        updateControlIcons();

        showStatus("Microphone muted.");
        return;
    }

    microphoneEnabled = true;

    if (!localAudioStream) {
        await startLocalMicrophone();
    } else {
        applyLocalMicrophoneState();
        await attachLocalAudioToPeers();
        sendMediaState();
    }

    updateControlIcons();
    updateParticipantsList(currentParticipants);
}

async function toggleCamera() {
    if (!currentRoomId || !currentPlayerId) return;

    if (cameraEnabled || cameraStarting || localVideoStream) {
        cameraEnabled = false;

        if (cameraStarting) {
            cameraRequestVersion++;
            cameraStarting = false;
        }

        await stopLocalCamera();

        updateControlIcons();
        sendMediaState();
        updateParticipantsList(currentParticipants);
        updateCameraPanel(currentParticipants);
        updateOrganizerVideo(currentParticipants);

        showStatus("Camera turned off.");

        return;
    }

    cameraEnabled = true;
    await startLocalCamera();
}

// ==================================================
// COPY / LEAVE
// ==================================================

async function copyMeetingId() {
    if (!currentRoomId) return;

    try {
        await navigator.clipboard.writeText(currentRoomId);
        showStatus("Meeting ID copied.");
    } catch (error) {
        console.error("Clipboard error:", error);
        showStatus("Could not copy meeting ID.");
    }
}

async function leaveCurrentMeeting() {
    if (!serverConnected) {
        showStatus("Cannot leave: server is disconnected.");
        return;
    }

    microphoneEnabled = false;
    cameraEnabled = false;

    await stopLocalCamera();
    await stopLocalMicrophone();

    closeAllPeerConnections();

    sendNetworkMessage({
        type: "leave_room"
    });
}

async function onRoomLeft() {
    microphoneEnabled = false;
    cameraEnabled = false;

    await stopLocalCamera();
    await stopLocalMicrophone();

    closeAllPeerConnections();

    currentRoomId = "";
    currentPlayerId = "";
    currentUserName = "";
    currentUserIsHost = false;

    currentParticipants = [];
    waitingParticipants = [];
    avatarColors = {};

    hideWaitingApproval();

    if (meetingOverlay) {
        meetingOverlay.remove();
    }

    meetingOverlay = null;

    creatingMeeting = false;
    pendingRoomId = "";
    pendingAction = "create";

    showStatus("You left the meeting.");
}

// ==================================================
// LOADING
// ==================================================

function showLoading(message) {
    if (!loadingOverlay) {
        loadingOverlay = createElement("div", "loading-overlay");

        add(loadingOverlay, createElement("div", "spinner"));
        add(loadingOverlay, createElement("div", "", message));

        document.body.appendChild(loadingOverlay);
    }

    loadingOverlay.lastElementChild.textContent = message;
    loadingOverlay.classList.remove("hidden");
}

function hideLoading() {
    if (loadingOverlay) {
        loadingOverlay.remove();
    }

    loadingOverlay = null;
}

// ==================================================
// ACTIONS
// ==================================================

function onStartMeeting() {
    if (creatingMeeting) return;

    pendingAction = "create";
    pendingRoomId = "";

    if (
        hasSavedName &&
        rememberedName.length >= 3 &&
        rememberedName.length <= 25
    ) {
        prepareMeeting(rememberedName);
    } else {
        openNameDialog();
    }
}

function onJoinMeeting() {
    if (creatingMeeting) return;

    if (!serverConnected) {
        showStatus("Not connected to MeetScreen server.");
        return;
    }

    const input = document.getElementById("meeting-input");

    const meetingId = String(input?.value || "")
        .trim()
        .toUpperCase();

    if (!meetingId) {
        showStatus("Please enter a meeting ID.");
        return;
    }

    pendingAction = "join";
    pendingRoomId = meetingId;

    if (
        hasSavedName &&
        rememberedName.length >= 3 &&
        rememberedName.length <= 25
    ) {
        prepareJoinMeeting(rememberedName);
    } else {
        openNameDialog();
    }
}

// ==================================================
// AUDIO AUTOPLAY RECOVERY
// ==================================================

document.addEventListener("pointerdown", resumeRemoteAudio);
document.addEventListener("keydown", resumeRemoteAudio);

// ==================================================
// STATUS
// ==================================================

function showStatus(message) {
    console.log("[MeetScreen]", message);

    const oldStatus = document.querySelector(".status-message");

    if (oldStatus) oldStatus.remove();

    const status = createElement("div", "status-message", message);

    document.body.appendChild(status);

    if (statusTimeout) {
        clearTimeout(statusTimeout);
    }

    statusTimeout = setTimeout(() => {
        status.remove();
        statusTimeout = null;
    }, 3500);
}

// ==================================================
// INITIALIZATION
// ==================================================

function initializeMeetScreen() {
    injectStyles();
    loadUserSettings();
    buildInterface();
    setupNetwork();
}

if (document.readyState === "loading") {
    document.addEventListener(
        "DOMContentLoaded",
        initializeMeetScreen,
        { once: true }
    );
} else {
    initializeMeetScreen();
}
