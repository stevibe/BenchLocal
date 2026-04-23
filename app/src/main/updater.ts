import { app, BrowserWindow, dialog } from "electron";
import electronUpdater, { type AppUpdater, type ProgressInfo, type UpdateDownloadedEvent, type UpdateInfo } from "electron-updater";
import type { BenchLocalUpdateState } from "@/shared/desktop-api";

export const APP_UPDATE_STATE_CHANNEL = "benchlocal:updates:state";

const AUTO_CHECK_DELAY_MS = 12_000;
const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

const { autoUpdater } = electronUpdater;

type UpdateFeedSource = "github" | "generic";

type SupportedUpdateSupport = {
  supported: true;
  feedSource: UpdateFeedSource;
  feedLabel: string;
  feedUrl?: string;
  channel?: string;
};

type UnsupportedUpdateSupport = {
  supported: false;
  message: string;
  feedSource?: UpdateFeedSource;
  feedLabel?: string;
  feedUrl?: string;
};

let updaterInitialized = false;
let autoCheckTimeout: NodeJS.Timeout | null = null;
let autoCheckInterval: NodeJS.Timeout | null = null;
let updaterFeedConfigured = false;

let appUpdateState: BenchLocalUpdateState = createInitialUpdateState();

function createInitialUpdateState(): BenchLocalUpdateState {
  const support = resolveUpdateSupport();

  return {
    status: support.supported ? "idle" : "unsupported",
    currentVersion: app.getVersion(),
    feedSource: support.feedSource,
    feedLabel: support.feedLabel,
    feedUrl: support.feedUrl,
    message: support.supported
      ? support.feedSource === "generic"
        ? "BenchLocal can check for updates using a local test feed."
        : "BenchLocal can check for updates."
      : support.message
  };
}

function resolveConfiguredUpdateFeed(): SupportedUpdateSupport | UnsupportedUpdateSupport {
  const overrideUrl = process.env.BENCHLOCAL_UPDATE_URL?.trim();

  if (!overrideUrl) {
    return {
      supported: true,
      feedSource: "github",
      feedLabel: "GitHub Releases"
    };
  }

  try {
    const parsed = new URL(overrideUrl);

    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("Local update feed must use http:// or https://.");
    }

    if (!parsed.pathname.endsWith("/")) {
      parsed.pathname = `${parsed.pathname}/`;
    }

    const channel = process.env.BENCHLOCAL_UPDATE_CHANNEL?.trim() || undefined;

    return {
      supported: true,
      feedSource: "generic",
      feedLabel: "Local Test Feed",
      feedUrl: parsed.toString(),
      channel
    };
  } catch (error) {
    return {
      supported: false,
      message:
        error instanceof Error && error.message.trim()
          ? error.message.trim()
          : "BENCHLOCAL_UPDATE_URL must be a valid http:// or https:// URL.",
      feedSource: "generic",
      feedLabel: "Local Test Feed",
      feedUrl: overrideUrl
    };
  }
}

function resolveUpdateSupport(): SupportedUpdateSupport | UnsupportedUpdateSupport {
  if (!app.isPackaged) {
    return {
      supported: false,
      message: "Self-update is only available in packaged BenchLocal builds.",
      feedSource: "github",
      feedLabel: "GitHub Releases"
    };
  }

  if (process.platform === "linux" && !process.env.APPIMAGE) {
    return {
      supported: false,
      message: "Self-update on Linux requires running the AppImage build.",
      feedSource: "github",
      feedLabel: "GitHub Releases"
    };
  }

  return resolveConfiguredUpdateFeed();
}

function configureAutoUpdaterFeed(support: SupportedUpdateSupport): void {
  if (updaterFeedConfigured) {
    return;
  }

  const updater = getAutoUpdater();

  if (support.feedSource === "generic" && support.feedUrl) {
    updater.setFeedURL({
      provider: "generic",
      url: support.feedUrl,
      ...(support.channel ? { channel: support.channel } : {})
    });
  }

  updaterFeedConfigured = true;
}

function formatUpdateError(error: unknown): string {
  if (error instanceof Error) {
    return error.message.trim() || "BenchLocal could not complete the update request.";
  }

  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }

  return "BenchLocal could not complete the update request.";
}

function serializeReleaseNotes(releaseNotes: unknown): string | undefined {
  if (typeof releaseNotes === "string") {
    const value = releaseNotes.trim();
    return value || undefined;
  }

  if (Array.isArray(releaseNotes)) {
    const parts = releaseNotes
      .map((entry) => {
        if (typeof entry === "string") {
          return entry.trim();
        }

        if (entry && typeof entry === "object" && "note" in entry && typeof entry.note === "string") {
          return entry.note.trim();
        }

        return "";
      })
      .filter(Boolean);

    return parts.length > 0 ? parts.join("\n\n") : undefined;
  }

  return undefined;
}

function publishAppUpdateState(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(APP_UPDATE_STATE_CHANNEL, appUpdateState);
    }
  }
}

function setAppUpdateState(next: Partial<BenchLocalUpdateState>): BenchLocalUpdateState {
  appUpdateState = {
    ...appUpdateState,
    ...next,
    currentVersion: app.getVersion()
  };
  publishAppUpdateState();
  return appUpdateState;
}

function setAppUpdateStateFromInfo(
  status: BenchLocalUpdateState["status"],
  info: Partial<UpdateInfo> | Partial<UpdateDownloadedEvent>,
  extra?: Partial<BenchLocalUpdateState>
): BenchLocalUpdateState {
  const version = typeof info.version === "string" && info.version.trim() ? info.version.trim() : undefined;
  return setAppUpdateState({
    status,
    availableVersion: version,
    downloadedVersion: status === "downloaded" ? version : appUpdateState.downloadedVersion,
    releaseName: typeof info.releaseName === "string" && info.releaseName.trim() ? info.releaseName.trim() : undefined,
    releaseNotes: serializeReleaseNotes(info.releaseNotes),
    ...extra
  });
}

function getAutoUpdater(): AppUpdater {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.logger = console;
  return autoUpdater;
}

function registerUpdaterEventHandlers(): void {
  const updater = getAutoUpdater();

  updater.on("checking-for-update", () => {
    setAppUpdateState({
      status: "checking",
      checkedAt: new Date().toISOString(),
      progressPercent: undefined,
      bytesPerSecond: undefined,
      transferred: undefined,
      total: undefined,
      message: "Checking for BenchLocal updates."
    });
  });

  updater.on("update-available", (info) => {
    setAppUpdateStateFromInfo("available", info, {
      checkedAt: new Date().toISOString(),
      downloadedVersion: undefined,
      progressPercent: 0,
      bytesPerSecond: undefined,
      transferred: undefined,
      total: undefined,
      message: info.version ? `BenchLocal ${info.version} is available. Downloading update.` : "A BenchLocal update is available. Downloading update."
    });
  });

  updater.on("download-progress", (progress: ProgressInfo) => {
    const version = appUpdateState.availableVersion;
    setAppUpdateState({
      status: "downloading",
      progressPercent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total,
      message: version
        ? `Downloading BenchLocal ${version} (${Math.round(progress.percent)}%).`
        : `Downloading BenchLocal update (${Math.round(progress.percent)}%).`
    });
  });

  updater.on("update-downloaded", (info) => {
    setAppUpdateStateFromInfo("downloaded", info, {
      checkedAt: new Date().toISOString(),
      progressPercent: 100,
      bytesPerSecond: undefined,
      transferred: undefined,
      total: undefined,
      message: info.version
        ? `BenchLocal ${info.version} is ready to install.`
        : "A BenchLocal update is ready to install."
    });
  });

  updater.on("update-not-available", () => {
    setAppUpdateState({
      status: "not_available",
      checkedAt: new Date().toISOString(),
      availableVersion: undefined,
      downloadedVersion: undefined,
      releaseName: undefined,
      releaseNotes: undefined,
      progressPercent: undefined,
      bytesPerSecond: undefined,
      transferred: undefined,
      total: undefined,
      message: "BenchLocal is up to date."
    });
  });

  updater.on("error", (error) => {
    setAppUpdateState({
      status: "error",
      checkedAt: new Date().toISOString(),
      progressPercent: undefined,
      bytesPerSecond: undefined,
      transferred: undefined,
      total: undefined,
      message: formatUpdateError(error)
    });
  });
}

function scheduleAutomaticUpdateChecks(): void {
  if (autoCheckTimeout) {
    clearTimeout(autoCheckTimeout);
  }

  if (autoCheckInterval) {
    clearInterval(autoCheckInterval);
  }

  autoCheckTimeout = setTimeout(() => {
    void checkForAppUpdates();
    autoCheckInterval = setInterval(() => {
      void checkForAppUpdates();
    }, AUTO_CHECK_INTERVAL_MS);
  }, AUTO_CHECK_DELAY_MS);
}

export function initializeAppUpdater(): void {
  if (updaterInitialized) {
    return;
  }

  updaterInitialized = true;
  appUpdateState = createInitialUpdateState();
  publishAppUpdateState();

  const support = resolveUpdateSupport();
  if (!support.supported) {
    return;
  }

  configureAutoUpdaterFeed(support);
  registerUpdaterEventHandlers();
  scheduleAutomaticUpdateChecks();
}

export function getAppUpdateState(): BenchLocalUpdateState {
  return appUpdateState;
}

export async function checkForAppUpdates(): Promise<BenchLocalUpdateState> {
  const support = resolveUpdateSupport();

  if (!support.supported) {
    return setAppUpdateState({
      status: "unsupported",
      feedSource: support.feedSource,
      feedLabel: support.feedLabel,
      feedUrl: support.feedUrl,
      message: support.message
    });
  }

  if (appUpdateState.status === "checking" || appUpdateState.status === "downloading") {
    return appUpdateState;
  }

  try {
    configureAutoUpdaterFeed(support);
    const result = await getAutoUpdater().checkForUpdates();
    const nextVersion = result?.updateInfo?.version?.trim();

    if (nextVersion && nextVersion !== app.getVersion() && result) {
      setAppUpdateStateFromInfo("available", result.updateInfo, {
        checkedAt: new Date().toISOString(),
        downloadedVersion: undefined,
        progressPercent: 0,
        bytesPerSecond: undefined,
        transferred: undefined,
        total: undefined,
        message: `BenchLocal ${nextVersion} is available. Downloading update.`
      });
    }

    return appUpdateState;
  } catch (error) {
    throw new Error(formatUpdateError(error));
  }
}

export async function checkForAppUpdatesInteractively(): Promise<void> {
  const focusedWindow = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
  const support = resolveUpdateSupport();

  if (!support.supported) {
    await dialog.showMessageBox(focusedWindow ?? undefined, {
      type: "info",
      buttons: ["OK"],
      message: "Self-update unavailable",
      detail: support.message
    });
    return;
  }

  if (appUpdateState.status === "checking") {
    await dialog.showMessageBox(focusedWindow ?? undefined, {
      type: "info",
      buttons: ["OK"],
      message: "BenchLocal is already checking for updates."
    });
    return;
  }

  if (appUpdateState.status === "downloading" || appUpdateState.status === "available") {
    await dialog.showMessageBox(focusedWindow ?? undefined, {
      type: "info",
      buttons: ["OK"],
      message: appUpdateState.availableVersion
        ? `BenchLocal ${appUpdateState.availableVersion} is already downloading.`
        : "BenchLocal is already downloading an update."
    });
    return;
  }

  if (appUpdateState.status === "downloaded") {
    const response = await dialog.showMessageBox(focusedWindow ?? undefined, {
      type: "info",
      buttons: ["Restart to Update", "Later"],
      defaultId: 0,
      cancelId: 1,
      message: appUpdateState.downloadedVersion
        ? `BenchLocal ${appUpdateState.downloadedVersion} is ready to install.`
        : "A BenchLocal update is ready to install.",
      detail: "Restart BenchLocal to apply the downloaded update."
    });

    if (response.response === 0) {
      installDownloadedAppUpdate();
    }

    return;
  }

  try {
    const state = await checkForAppUpdates();

    if (state.status === "not_available") {
      await dialog.showMessageBox(focusedWindow ?? undefined, {
        type: "info",
        buttons: ["OK"],
        message: "BenchLocal is up to date.",
        detail: `Current version: ${state.currentVersion}`
      });
      return;
    }

    if (state.status === "available" || state.status === "downloading") {
      await dialog.showMessageBox(focusedWindow ?? undefined, {
        type: "info",
        buttons: ["OK"],
        message: state.availableVersion
          ? `BenchLocal ${state.availableVersion} is downloading in the background.`
          : "A BenchLocal update is downloading in the background."
      });
    }
  } catch (error) {
    dialog.showErrorBox("Update Check Failed", formatUpdateError(error));
  }
}

export function installDownloadedAppUpdate(): { started: boolean } {
  if (appUpdateState.status !== "downloaded") {
    throw new Error("No downloaded BenchLocal update is ready to install.");
  }

  getAutoUpdater().quitAndInstall(false, true);
  return { started: true };
}
