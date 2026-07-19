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
