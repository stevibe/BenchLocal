import type { WebBenchPackBridgePermission } from "./protocol.js";

const WEB_BENCH_PACK_BRIDGE_PERMISSIONS = new Set<WebBenchPackBridgePermission>([
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

export function isWebBenchPackBridgePermission(value: unknown): value is WebBenchPackBridgePermission {
  return typeof value === "string" && WEB_BENCH_PACK_BRIDGE_PERMISSIONS.has(value as WebBenchPackBridgePermission);
}

