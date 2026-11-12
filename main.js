
const { app, BrowserWindow, session } = require("electron");
const path = require("path");
const fs = require("fs");

// ==================================================
// CONFIGURATION
// ==================================================

const APP_TITLE = "MeetScreen";
const APP_BACKGROUND = "#111318";

// ==================================================
// MEDIA PERMISSIONS
// ==================================================

function setupMediaPermissions() {
    const appSession = session.defaultSession;

    appSession.setPermissionCheckHandler(
        (webContents, permission, requestingOrigin, details) => {
            if (permission !== "media") {
                return false;
            }

            const isAppPage =
                webContents &&
                webContents.getURL().startsWith("file://");

            const mediaType = details?.mediaType;

            return (
                isAppPage &&
                (mediaType === "audio" || mediaType === "video")
            );
        }
    );

    appSession.setPermissionRequestHandler(
        (webContents, permission, callback, details) => {
            const isAppPage =
                webContents &&
                webContents.getURL().startsWith("file://");

            const mediaTypes = details?.mediaTypes || [];

            const validMedia =
                mediaTypes.length > 0 &&
                mediaTypes.every(type =>
                    type === "audio" || type === "video"
                );

            callback(
                permission === "media" &&
                isAppPage &&
                validMedia
            );
        }
    );
}

// ==================================================
// CREATE WINDOW
// ==================================================

function createWindow() {
    const indexPath = path.join(__dirname, "index.html");

    if (!fs.existsSync(indexPath)) {
        console.error("MeetScreen: index.html not found!");
        console.error("Expected path:", indexPath);
        app.quit();
        return;
    }

    const mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,

        minWidth: 900,
        minHeight: 600,

        title: APP_TITLE,
        backgroundColor: APP_BACKGROUND,
        autoHideMenuBar: true,

        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
        }
    });

    mainWindow.removeMenu();

    mainWindow.loadFile(indexPath);

    mainWindow.webContents.on("did-fail-load", (event, errorCode, errorDescription) => {
        console.error(
            "MeetScreen loading error:",
            errorCode,
            errorDescription
        );
    });

    mainWindow.on("closed", () => {
        // Window closed
    });

    return mainWindow;
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

// ==================================================
// QUIT
// ==================================================

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});
