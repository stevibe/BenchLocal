export type WebPackMediaPermissionRequest = {
  webContentsId: number;
  permission: string;
  requestingUrl?: string;
  securityOrigin?: string;
  mediaTypes: readonly string[];
};

function toAllowedOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    const isHttps = url.protocol === "https:";
    const isLoopbackHttp = url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1");
    return isHttps || isLoopbackHttp ? url.origin : null;
  } catch {
    return null;
  }
}

export class WebPackMediaPermissionPolicy {
  readonly #microphoneOriginsByWebContents = new Map<number, ReadonlySet<string>>();

  update(webContentsId: number, microphoneOrigins: readonly string[]): void {
    const normalizedOrigins = microphoneOrigins
      .map(toAllowedOrigin)
      .filter((origin): origin is string => origin !== null);
    this.#microphoneOriginsByWebContents.set(webContentsId, new Set(normalizedOrigins));
  }

  clear(webContentsId: number): void {
    this.#microphoneOriginsByWebContents.delete(webContentsId);
  }

  allows(request: WebPackMediaPermissionRequest): boolean {
    if (request.permission !== "media" || request.mediaTypes.length === 0 || request.mediaTypes.some((type) => type !== "audio")) {
      return false;
    }

    const origin = toAllowedOrigin(request.securityOrigin ?? request.requestingUrl ?? "");
    return origin !== null && this.#microphoneOriginsByWebContents.get(request.webContentsId)?.has(origin) === true;
  }
}

export const webPackMediaPermissionPolicy = new WebPackMediaPermissionPolicy();

type PermissionSession = {
  setPermissionCheckHandler(handler: (
    webContents: { id: number } | null,
    permission: string,
    requestingOrigin: string,
    details: { mediaType?: string; requestingUrl?: string; securityOrigin?: string }
  ) => boolean): void;
  setPermissionRequestHandler(handler: (
    webContents: { id: number },
    permission: string,
    callback: (granted: boolean) => void,
    details: { requestingUrl?: string; securityOrigin?: string; mediaTypes?: readonly string[] }
  ) => void): void;
};

export function registerWebPackMediaPermissionHandlers(permissionSession: PermissionSession): void {
  permissionSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    return webPackMediaPermissionPolicy.allows({
      webContentsId: webContents?.id ?? -1,
      permission,
      requestingUrl: details.requestingUrl ?? requestingOrigin,
      securityOrigin: details.securityOrigin,
      mediaTypes: details.mediaType ? [details.mediaType] : []
    });
  });

  permissionSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(webPackMediaPermissionPolicy.allows({
      webContentsId: webContents.id,
      permission,
      requestingUrl: details.requestingUrl,
      securityOrigin: details.securityOrigin,
      mediaTypes: details.mediaTypes ?? []
    }));
  });
}
