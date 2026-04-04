import { BrowserWindow } from "electron";
import path from "node:path";
import type { DetachedLogsState } from "@/shared/desktop-api";

export const DETACHED_LOGS_STATE_CHANNEL = "benchlocal:logs:state";
export const DETACHED_LOGS_CLOSED_CHANNEL = "benchlocal:logs:closed";

let detachedLogsWindow: BrowserWindow | null = null;
let latestDetachedLogsState: DetachedLogsState | null = null;

function broadcastWindowClosed(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window === detachedLogsWindow || window.isDestroyed()) {
      continue;
    }

    window.webContents.send(DETACHED_LOGS_CLOSED_CHANNEL);
  }
}

function getDetachedLogsUrl(): { url?: string; filePath?: string } {
  if (process.env.VITE_DEV_SERVER_URL) {
    return {
      url: `${process.env.VITE_DEV_SERVER_URL}?view=logs`
    };
  }

  return {
    filePath: path.join(__dirname, "../renderer/index.html")
  };
}

export async function openDetachedLogsWindow(preloadPath: string): Promise<void> {
  if (detachedLogsWindow && !detachedLogsWindow.isDestroyed()) {
    detachedLogsWindow.focus();
    return;
  }

  detachedLogsWindow = new BrowserWindow({
    width: 980,
    height: 420,
    minWidth: 760,
    minHeight: 260,
    title: "BenchLocal Logs",
    backgroundColor: "#f1f2f4",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  detachedLogsWindow.on("closed", () => {
    detachedLogsWindow = null;
    broadcastWindowClosed();
  });

  detachedLogsWindow.webContents.on("did-finish-load", () => {
    if (latestDetachedLogsState) {
      detachedLogsWindow?.webContents.send(DETACHED_LOGS_STATE_CHANNEL, latestDetachedLogsState);
    }
  });

  const target = getDetachedLogsUrl();

  if (target.url) {
    await detachedLogsWindow.loadURL(target.url);
    return;
  }

  if (target.filePath) {
    await detachedLogsWindow.loadFile(target.filePath, {
      search: "view=logs"
    });
  }
}

export function closeDetachedLogsWindow(): boolean {
  if (!detachedLogsWindow || detachedLogsWindow.isDestroyed()) {
    return false;
  }

  detachedLogsWindow.close();
  return true;
}

export function publishDetachedLogsState(state: DetachedLogsState): void {
  latestDetachedLogsState = state;

  if (!detachedLogsWindow || detachedLogsWindow.isDestroyed()) {
    return;
  }

  detachedLogsWindow.webContents.send(DETACHED_LOGS_STATE_CHANNEL, state);
}
