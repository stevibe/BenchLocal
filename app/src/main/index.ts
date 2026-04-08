import { app, BrowserWindow, nativeTheme } from "electron";
import path from "node:path";
import { loadOrCreateConfig } from "@core";
import { registerIpcHandlers } from "./ipc";
import { loadAvailableTheme } from "./themes";

const isDev = !app.isPackaged;

async function createMainWindow(): Promise<void> {
  const loadState = await loadOrCreateConfig();
  const effectiveThemeId =
    loadState.config.ui.theme === "system"
      ? (nativeTheme.shouldUseDarkColors ? "dark" : "light")
      : loadState.config.ui.theme;
  const theme = await loadAvailableTheme(effectiveThemeId);
  const backgroundColor = theme?.variables["--bg"] ?? "#f1f2f4";

  const window = new BrowserWindow({
    width: 1500,
    height: 920,
    minWidth: 1280,
    minHeight: 820,
    title: "BenchLocal",
    backgroundColor,
    titleBarStyle: process.platform === "darwin" ? "hidden" : undefined,
    trafficLightPosition:
      process.platform === "darwin"
        ? {
            x: 18,
            y: 29
          }
        : undefined,
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
