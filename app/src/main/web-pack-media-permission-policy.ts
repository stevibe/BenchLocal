import { toAllowedWebPackOrigin } from "@benchlocal/core";

export type WebPackMediaPermissionRequest = {
  webContentsId: number;
  permission: string;
  requestingUrl?: string;
  securityOrigin?: string;
  mediaTypes: readonly string[];
};

export class WebPackMediaPermissionPolicy {
  readonly #microphoneOriginsByWebContents = new Map<number, ReadonlySet<string>>();

  update(webContentsId: number, microphoneOrigins: readonly string[]): void {
    const normalizedOrigins = microphoneOrigins
      .map(toAllowedWebPackOrigin)
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

    const origin = toAllowedWebPackOrigin(request.securityOrigin ?? request.requestingUrl ?? "");
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
  const allows = (
    webContentsId: number,
    permission: string,
    details: { mediaType?: string; mediaTypes?: readonly string[]; requestingUrl?: string; securityOrigin?: string },
    requestingOrigin?: string
  ): boolean => webPackMediaPermissionPolicy.allows({
    webContentsId,
    permission,
    requestingUrl: details.requestingUrl ?? requestingOrigin,
    securityOrigin: details.securityOrigin,
    mediaTypes: details.mediaTypes ?? (details.mediaType ? [details.mediaType] : [])
  });

  permissionSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    return allows(webContents?.id ?? -1, permission, details, requestingOrigin);
  });

  permissionSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(allows(webContents.id, permission, details));
  });
}
