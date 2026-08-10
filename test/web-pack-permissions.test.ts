import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { isWebBenchPackPermission } from "../packages/benchlocal-core/src/web-pack-permissions.js";
import { getWebPackIframeAllow } from "../app/src/renderer/src/web-pack-permissions.js";
import { WebPackMediaPermissionPolicy } from "../app/src/main/web-pack-media-permission-policy.js";

test("a web Bench Pack can declare microphone access", () => {
  assert.equal(isWebBenchPackPermission("media:microphone"), true);
});

test("microphone delegation is projected only for packs that request it", () => {
  assert.equal(getWebPackIframeAllow([]), undefined);
  assert.equal(getWebPackIframeAllow(["runs:write", "media:microphone"]), "microphone");
});

test("microphone permission is limited to the active trusted pack origin", () => {
  const policy = new WebPackMediaPermissionPolicy();
  policy.update(42, ["http://127.0.0.1:5177"]);

  assert.equal(policy.allows({
    webContentsId: 42,
    permission: "media",
    requestingUrl: "http://127.0.0.1:5177/voice",
    mediaTypes: ["audio"]
  }), true);
  assert.equal(policy.allows({
    webContentsId: 42,
    permission: "media",
    requestingUrl: "https://untrusted.example/",
    mediaTypes: ["audio"]
  }), false);
  assert.equal(policy.allows({
    webContentsId: 7,
    permission: "media",
    requestingUrl: "http://127.0.0.1:5177/voice",
    mediaTypes: ["audio"]
  }), false);
  assert.equal(policy.allows({
    webContentsId: 42,
    permission: "media",
    requestingUrl: "http://127.0.0.1:5177/voice",
    mediaTypes: ["audio", "video"]
  }), false);
});

test("microphone permission accepts IPv6 loopback origins", () => {
  const policy = new WebPackMediaPermissionPolicy();
  policy.update(42, ["http://[::1]:5177"]);

  assert.equal(policy.allows({
    webContentsId: 42,
    permission: "media",
    requestingUrl: "http://[::1]:5177/voice",
    mediaTypes: ["audio"]
  }), true);
});

test("the macOS package signs the app and helpers for audio input", async () => {
  const packageConfig = JSON.parse(await readFile(new URL("../app/package.json", import.meta.url), "utf8"));
  assert.equal(packageConfig.build.mac.entitlements, "build/entitlements.mac.plist");
  assert.equal(packageConfig.build.mac.entitlementsInherit, "build/entitlements.mac.plist");
  assert.match(packageConfig.build.mac.extendInfo.NSMicrophoneUsageDescription, /approved Web Bench Packs/);

  const entitlements = await readFile(new URL("../app/build/entitlements.mac.plist", import.meta.url), "utf8");
  assert.match(entitlements, /<key>com\.apple\.security\.device\.audio-input<\/key>\s*<true\/>/);
});
