import { app, BrowserWindow, Menu, nativeTheme, screen, type MenuItemConstructorOptions } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getBenchLocalHome, loadOrCreateConfig } from "@core";
import { loadAppMetadata } from "./app-metadata";
import { APP_OPEN_ABOUT_CHANNEL, APP_OPEN_SETTINGS_CHANNEL, registerIpcHandlers, stopActiveBenchPackRunsForShutdown } from "./ipc";
import { loadAvailableTheme } from "./themes";
import { checkForAppUpdatesInteractively, initializeAppUpdater } from "./updater";

const isDev = !app.isPackaged;
const shouldOpenDevTools = process.env.BENCHLOCAL_OPEN_DEVTOOLS === "1";
const isMac = process.platform === "darwin";
let isQuittingAfterBenchPackShutdown = false;
const DEFAULT_WINDOW_WIDTH = 1500;
const DEFAULT_WINDOW_HEIGHT = 800;
const MIN_WINDOW_WIDTH = 1180;
const MIN_WINDOW_HEIGHT = 768;
const WINDOW_STATE_PATH = path.join(getBenchLocalHome(), "window-state.json");

type PersistedWindowState = {
  width: number;
  height: number;
  isMaximized?: boolean;
};

async function loadPersistedWindowState(): Promise<PersistedWindowState | null> {
  try {
    const raw = await fs.readFile(WINDOW_STATE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<PersistedWindowState>;
    const width = Number(parsed.width);
    const height = Number(parsed.height);

    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      return null;
    }

    return {
      width,
      height,
      isMaximized: Boolean(parsed.isMaximized)
    };
  } catch {
    return null;
  }
}

async function savePersistedWindowState(state: PersistedWindowState): Promise<void> {
  await fs.mkdir(path.dirname(WINDOW_STATE_PATH), { recursive: true });
  const tempPath = `${WINDOW_STATE_PATH}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(state, null, 2), "utf8");
  await fs.rename(tempPath, WINDOW_STATE_PATH);
}

function resolveInitialWindowBounds(savedState: PersistedWindowState | null): { width: number; height: number } {
  const primaryWorkArea = screen.getPrimaryDisplay().workAreaSize;
  const maxWidth = Math.max(MIN_WINDOW_WIDTH, primaryWorkArea.width);
  const maxHeight = Math.max(MIN_WINDOW_HEIGHT, primaryWorkArea.height);
  const width = savedState?.width ?? DEFAULT_WINDOW_WIDTH;
  const height = savedState?.height ?? DEFAULT_WINDOW_HEIGHT;

  return {
    width: Math.max(MIN_WINDOW_WIDTH, Math.min(width, maxWidth)),
    height: Math.max(MIN_WINDOW_HEIGHT, Math.min(height, maxHeight))
  };
}

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

  const checkForUpdates = () => {
    void checkForAppUpdatesInteractively();
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
        {
          label: "Check for Updates…",
          click: checkForUpdates
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
        {
          label: "Check for Updates…",
          click: checkForUpdates
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
  const savedWindowState = await loadPersistedWindowState();
  const initialBounds = resolveInitialWindowBounds(savedWindowState);
  const effectiveThemeId =
    loadState.config.ui.theme === "system"
      ? (nativeTheme.shouldUseDarkColors ? "dark" : "light")
      : loadState.config.ui.theme;
  const theme = await loadAvailableTheme(effectiveThemeId);
  const backgroundColor = theme?.variables["--bg"] ?? "#1f2227";

  const window = new BrowserWindow({
    width: initialBounds.width,
    height: initialBounds.height,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
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
    if (savedWindowState?.isMaximized) {
      window.maximize();
    }

    window.show();
  });

  let persistWindowStateTimeout: NodeJS.Timeout | null = null;
  const schedulePersistWindowState = () => {
    if (persistWindowStateTimeout) {
      clearTimeout(persistWindowStateTimeout);
    }

    persistWindowStateTimeout = setTimeout(() => {
      persistWindowStateTimeout = null;
      const bounds = window.isMaximized() ? window.getNormalBounds() : window.getBounds();
      void savePersistedWindowState({
        width: bounds.width,
        height: bounds.height,
        isMaximized: window.isMaximized()
      });
    }, 150);
  };

  window.on("resize", schedulePersistWindowState);
  window.on("maximize", schedulePersistWindowState);
  window.on("unmaximize", schedulePersistWindowState);
  window.on("close", () => {
    if (persistWindowStateTimeout) {
      clearTimeout(persistWindowStateTimeout);
      persistWindowStateTimeout = null;
    }

    const bounds = window.isMaximized() ? window.getNormalBounds() : window.getBounds();
    void savePersistedWindowState({
      width: bounds.width,
      height: bounds.height,
      isMaximized: window.isMaximized()
    });
  });

  window.on("closed", () => {
    if (isMac && !isQuittingAfterBenchPackShutdown) {
      app.quit();
    }
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
  initializeAppUpdater();
  buildApplicationMenu(appMetadata.productName);
  await createMainWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
});

app.on("before-quit", (event) => {
  if (isQuittingAfterBenchPackShutdown) {
    return;
  }

  event.preventDefault();
  void (async () => {
    try {
      await stopActiveBenchPackRunsForShutdown();
    } catch (error) {
      console.error("[benchlocal] failed to stop active Bench Pack runs during shutdown", error);
    } finally {
      isQuittingAfterBenchPackShutdown = true;
      app.quit();
    }
  })();
});

app.on("window-all-closed", () => {
  if (!isMac) {
    app.quit();
  }
});

if (isDev) {
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = "true";
}
