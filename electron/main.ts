import { app, BrowserWindow, ipcMain } from "electron";
import * as path from "path";
import { config } from "dotenv";
import { registerAllHandlers } from "./ipc-handlers";

const envPath = path.resolve(__dirname, '../../../.env');
console.log('__dirname:', __dirname);
console.log('.env path:', envPath);
const envResult = config({ path: envPath });
console.log('dotenv result:', envResult.error ? envResult.error.message : 'loaded', 'GOOGLE_CLIENT_ID set:', !!process.env.GOOGLE_CLIENT_ID);

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

process.on('uncaughtException', (error) => {
  console.error('[uncaughtException]', error);
});

const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:8080");
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, "../../renderer/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  console.log(`Deep Problem Scanner v${app.getVersion()}`);
  try {
    registerAllHandlers();
    console.log('IPC handlers registered successfully');
  } catch (err) {
    console.error('Failed to register IPC handlers:', err);
  }
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
