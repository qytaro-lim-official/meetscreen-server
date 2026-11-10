
const { app, BrowserWindow, session } = require("electron");
const path = require("path");

// ==================================================
// MEDIA PERMISSIONS
// ==================================================

function setupMediaPermissions() {
    const appSession = session.defaultSession;

    // Check media permissions
    appSession.setPermissionCheckHandler(
        (webContents, permission, requestingOrigin, details) => {
            if (permission !== "media") {
                return false;
            }

            const isAppPage =
                webContents &&
                webContents.getURL().startsWith("file://");

            const mediaType = details?.mediaType;

            const isAllowedMedia =
                mediaType === "audio" ||
                mediaType === "video";

            return isAppPage && isAllowedMedia;
        }
    );

    // Grant camera and microphone access
    appSession.setPermissionRequestHandler(
        (webContents, permission, callback, details) => {
            const isAppPage =
                webContents &&
                webContents.getURL().startsWith("file://");

            const mediaTypes = details?.mediaTypes || [];

            const hasValidMediaTypes =
                mediaTypes.length > 0 &&
                mediaTypes.every(type =>
                    type === "audio" || type === "video"
                );

            const canUseMedia =
                permission === "media" &&
                isAppPage &&
                hasValidMediaTypes;

            callback(canUseMedia);
        }
    );
}

// ==================================================
// WINDOW
// ==================================================

function createWindow() {
    const mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 900,
        minHeight: 600,
        title: "MeetScreen",
        backgroundColor: "#111318",
        autoHideMenuBar: true,

        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    mainWindow.removeMenu();

    mainWindow.loadFile(
        path.join(__dirname, "webrtc", "src", "index.html")
    );
}

// ==================================================
// APP LIFECYCLE
// ==================================================

app.whenReady().then(() => {
    setupMediaPermissions();

    createWindow();

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});
