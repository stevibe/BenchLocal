import type { WebBenchPackPermission } from "./protocol.js";

const WEB_BENCH_PACK_PERMISSIONS = new Set<WebBenchPackPermission>([
  "models:list",
  "models:read",
  "inference:chat",
  "inference:stream",
  "runs:write",
  "history:read",
  "history:write",
  "artifacts:write",
  "media:microphone"
]);

export function isWebBenchPackPermission(value: unknown): value is WebBenchPackPermission {
  return typeof value === "string" && WEB_BENCH_PACK_PERMISSIONS.has(value as WebBenchPackPermission);
}

export function toAllowedWebPackOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    const isHttps = url.protocol === "https:";
    const isLoopbackHttp = url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]");
    return isHttps || isLoopbackHttp ? url.origin : null;
  } catch {
    return null;
  }
}
