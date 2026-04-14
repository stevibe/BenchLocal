import { app, BrowserWindow, Menu, nativeTheme, type MenuItemConstructorOptions } from "electron";
import path from "node:path";
import { loadOrCreateConfig } from "@core";
import { loadAppMetadata } from "./app-metadata";
import { APP_OPEN_ABOUT_CHANNEL, APP_OPEN_SETTINGS_CHANNEL, registerIpcHandlers } from "./ipc";
import { loadAvailableTheme } from "./themes";

const isDev = !app.isPackaged;
const shouldOpenDevTools = process.env.BENCHLOCAL_OPEN_DEVTOOLS === "1";
const isMac = process.platform === "darwin";

if (isMac) {
  app.setName("BenchLocal");
}

function buildApplicationMenu(appName: string): void {
  const openAbout = () => {
    if (isMac) {
      app.showAboutPanel();
      return;
    }

    const target = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    target?.webContents.send(APP_OPEN_ABOUT_CHANNEL);
  };

  const openSettings = () => {
    const target = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    target?.webContents.send(APP_OPEN_SETTINGS_CHANNEL);
  };

  const appSubmenu: MenuItemConstructorOptions[] = isMac
    ? [
        { role: "about" },
        { type: "separator" },
        {
          label: "Settings",
          accelerator: "CmdOrCtrl+,",
          click: openSettings
        },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" }
      ]
    : [
        {
          label: `About ${appName}`,
          click: openAbout
        },
        {
          label: "Settings",
          accelerator: "CmdOrCtrl+,",
          click: openSettings
        },
        ...(isDev
          ? [
              { type: "separator" as const },
              { role: "toggleDevTools" as const }
            ]
          : []),
        { type: "separator" },
        { role: "quit" }
      ];
  const windowSubmenu: MenuItemConstructorOptions[] = isMac
    ? [{ role: "minimize" }, { role: "zoom" }, { type: "separator" }, { role: "front" }]
    : [{ role: "minimize" }, { role: "zoom" }, { role: "close" }];
  const template: MenuItemConstructorOptions[] = [
    {
      label: appName,
      submenu: appSubmenu
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" }
      ]
    },
    ...(isMac
      ? [
          {
            label: "View",
            submenu: [
              ...(isDev ? [{ role: "reload" as const }, { role: "forceReload" as const }, { role: "toggleDevTools" as const }, { type: "separator" as const }] : []),
              { role: "resetZoom" as const },
              { role: "zoomIn" as const },
              { role: "zoomOut" as const },
              { type: "separator" as const },
              { role: "togglefullscreen" as const }
            ]
          }
        ]
      : []),
    {
      label: "Window",
      submenu: windowSubmenu
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createMainWindow(): Promise<void> {
  const loadState = await loadOrCreateConfig();
  const effectiveThemeId =
    loadState.config.ui.theme === "system"
      ? (nativeTheme.shouldUseDarkColors ? "dark" : "light")
      : loadState.config.ui.theme;
  const theme = await loadAvailableTheme(effectiveThemeId);
  const backgroundColor = theme?.variables["--bg"] ?? "#1f2227";

  const window = new BrowserWindow({
    width: 1500,
    height: 920,
    minWidth: 1280,
    minHeight: 820,
    title: "BenchLocal",
    show: false,
    backgroundColor,
    titleBarStyle: isMac ? "hidden" : undefined,
    trafficLightPosition:
      isMac
        ? {
            x: 18,
            y: 25
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

  window.once("ready-to-show", () => {
    window.show();
  });

  if (!isDev) {
    window.webContents.on("before-input-event", (event, input) => {
      const isReloadShortcut =
        (input.key.toLowerCase() === "r" && (input.meta || input.control)) ||
        input.key === "F5";

      if (isReloadShortcut) {
        event.preventDefault();
      }
    });
  }

  if (process.env.VITE_DEV_SERVER_URL) {
    await window.loadURL(process.env.VITE_DEV_SERVER_URL);
    if (shouldOpenDevTools) {
      window.webContents.openDevTools({ mode: "detach", activate: true });
    }
    const bridgeStatus = await window.webContents.executeJavaScript(
      "({ hasBenchLocal: typeof window.benchlocal !== 'undefined', keys: window.benchlocal ? Object.keys(window.benchlocal) : [] })"
    );
    console.log("[benchlocal] preload bridge status", bridgeStatus);
    return;
  }

  await window.loadFile(path.join(__dirname, "../renderer/index.html"));
  if (shouldOpenDevTools) {
    window.webContents.openDevTools({ mode: "detach", activate: true });
  }
}

app.whenReady().then(async () => {
  const appMetadata = await loadAppMetadata();
  app.setAboutPanelOptions({
    applicationName: appMetadata.productName,
    applicationVersion: appMetadata.version,
    ...(appMetadata.copyright ? { copyright: appMetadata.copyright } : {})
  });
  registerIpcHandlers();
  buildApplicationMenu(appMetadata.productName);
  await createMainWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (!isMac) {
    app.quit();
  }
});

if (isDev) {
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = "true";
}
