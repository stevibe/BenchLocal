import fs from "node:fs/promises";
import path from "node:path";

export const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
export const releaseEnvPath = path.join(repoRoot, ".env.release.local");

export function normalizeSigningIdentity(value) {
  if (!value) {
    return value;
  }
  return value.replace(/^(Developer ID Application|Apple Development):\s*/, "").trim();
}

function stripQuotes(value) {
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

export async function loadReleaseEnv(filePath = releaseEnvPath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const values = {};
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const pivot = trimmed.indexOf("=");
      if (pivot <= 0) continue;
      const key = trimmed.slice(0, pivot).trim();
      const value = stripQuotes(trimmed.slice(pivot + 1).trim());
      values[key] = value;
    }
    return values;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export function releaseEnvProblems(env) {
  const problems = [];
  if (!env) {
    problems.push(`Missing ${releaseEnvPath}`);
    return problems;
  }

  if (!env.CSC_NAME) {
    problems.push("Missing CSC_NAME (Developer ID Application signing identity)");
  }

  const hasApiKeyFlow = Boolean(env.APPLE_API_KEY && env.APPLE_API_KEY_ID && env.APPLE_API_ISSUER);
  const hasAppleIdFlow = Boolean(env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID);

  if (!hasApiKeyFlow && !hasAppleIdFlow) {
    problems.push(
      "Missing notarization credentials. Provide either APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER, or APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID"
    );
  }

  return problems;
}
