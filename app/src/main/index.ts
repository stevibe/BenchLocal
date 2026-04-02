import { app, BrowserWindow } from "electron";
import path from "node:path";
import { loadOrCreateConfig } from "@core";
import { registerIpcHandlers } from "./ipc";

const isDev = !app.isPackaged;

async function createMainWindow(): Promise<void> {
  await loadOrCreateConfig();

  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1280,
    minHeight: 820,
    title: "BenchLocal",
    backgroundColor: "#f1f2f4",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  window.webContents.on("console-message", (_event, level, message) => {
    console.log(`[renderer:${level}] ${message}`);
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    await window.loadURL(process.env.VITE_DEV_SERVER_URL);
    const bridgeStatus = await window.webContents.executeJavaScript(
      "({ hasBenchLocal: typeof window.benchlocal !== 'undefined', keys: window.benchlocal ? Object.keys(window.benchlocal) : [] })"
    );
    console.log("[benchlocal] preload bridge status", bridgeStatus);
    return;
  }

  await window.loadFile(path.join(__dirname, "../renderer/index.html"));
}

app.whenReady().then(async () => {
  registerIpcHandlers();
  await createMainWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

if (isDev) {
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = "true";
}
