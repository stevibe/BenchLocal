import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import readline from "node:readline/promises";
import { promisify } from "node:util";
import { loadReleaseEnv, normalizeSigningIdentity, releaseEnvPath } from "./release-env.mjs";

const execFileAsync = promisify(execFile);

async function listSigningIdentities() {
  try {
    const { stdout } = await execFileAsync("security", ["find-identity", "-v", "-p", "codesigning"]);
    return stdout
      .split(/\r?\n/)
      .map((line) => line.match(/"(.+?)"/)?.[1] ?? null)
      .filter(Boolean)
      .filter((name) => name.includes("Developer ID Application") || name.includes("Apple Development"));
  } catch {
    return [];
  }
}

function quote(value) {
  return `"${String(value).replaceAll("\"", "\\\"")}"`;
}

async function promptRequired(rl, label, defaultValue = "") {
  while (true) {
    const suffix = defaultValue ? ` [${defaultValue}]` : "";
    const value = (await rl.question(`${label}${suffix}: `)).trim();
    if (value) {
      return value;
    }
    if (defaultValue) {
      return defaultValue;
    }
    console.log("This field is required.");
  }
}

async function chooseSigningIdentity(rl, identities, existingValue = "") {
  if (identities.length === 0) {
    return normalizeSigningIdentity(await promptRequired(rl, "Signing identity (Developer ID Application)"));
  }

  const preferredIndex = existingValue ? identities.findIndex((identity) => identity === existingValue) : 0;
  const defaultIndex = preferredIndex >= 0 ? preferredIndex : 0;

  console.log("Available signing identities:");
  identities.forEach((identity, index) => {
    const marker = index === defaultIndex ? " (default)" : "";
    console.log(`  ${index + 1}. ${identity}${marker}`);
  });
  console.log("  m. Enter a different identity manually");

  while (true) {
    const raw = (await rl.question(`Choose signing identity [${defaultIndex + 1}]: `)).trim().toLowerCase();
    if (!raw) {
      return identities[defaultIndex];
    }
    if (raw === "m") {
      return await promptRequired(rl, "Signing identity");
    }
    const index = Number(raw);
    if (Number.isInteger(index) && index >= 1 && index <= identities.length) {
      return identities[index - 1];
    }
    console.log("Enter a listed number or 'm'.");
  }
}

async function chooseNotarizationFlow(rl, existingValues) {
  const hasExistingApiKeyFlow = Boolean(
    existingValues.APPLE_API_KEY && existingValues.APPLE_API_KEY_ID && existingValues.APPLE_API_ISSUER
  );
  const hasExistingAppleIdFlow = Boolean(
    existingValues.APPLE_ID && existingValues.APPLE_APP_SPECIFIC_PASSWORD && existingValues.APPLE_TEAM_ID
  );

  const defaultMode = hasExistingApiKeyFlow ? "1" : hasExistingAppleIdFlow ? "2" : "1";

  console.log("Notarization method:");
  console.log("  1. App Store Connect API key (recommended)");
  console.log("  2. Apple ID + app-specific password");

  while (true) {
    const choice = (await rl.question(`Choose notarization method [${defaultMode}]: `)).trim() || defaultMode;
    if (choice === "1") {
      const apiKeyPath = path.resolve(
        await promptRequired(rl, "App Store Connect API key (.p8) absolute path", existingValues.APPLE_API_KEY ?? "")
      );
      await fs.access(apiKeyPath);
      const apiKeyId = await promptRequired(rl, "APPLE_API_KEY_ID", existingValues.APPLE_API_KEY_ID ?? "");
      const apiIssuer = await promptRequired(rl, "APPLE_API_ISSUER", existingValues.APPLE_API_ISSUER ?? "");
      return {
        APPLE_API_KEY: apiKeyPath,
        APPLE_API_KEY_ID: apiKeyId,
        APPLE_API_ISSUER: apiIssuer
      };
    }
    if (choice === "2") {
      const appleId = await promptRequired(rl, "APPLE_ID", existingValues.APPLE_ID ?? "");
      const appSpecificPassword = await promptRequired(
        rl,
        "APPLE_APP_SPECIFIC_PASSWORD",
        existingValues.APPLE_APP_SPECIFIC_PASSWORD ?? ""
      );
      const teamId = await promptRequired(rl, "APPLE_TEAM_ID", existingValues.APPLE_TEAM_ID ?? "");
      return {
        APPLE_ID: appleId,
        APPLE_APP_SPECIFIC_PASSWORD: appSpecificPassword,
        APPLE_TEAM_ID: teamId
      };
    }
    console.log("Enter 1 or 2.");
  }
}

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    const existingValues = (await loadReleaseEnv()) ?? {};
    const identities = await listSigningIdentities();
    const cscName = normalizeSigningIdentity(
      await chooseSigningIdentity(rl, identities, existingValues.CSC_NAME ?? "")
    );
    const notarizationValues = await chooseNotarizationFlow(rl, existingValues);

    const body = [
      "# Local release secrets for BenchLocal macOS distribution",
      `CSC_NAME=${quote(cscName)}`,
      ...Object.entries(notarizationValues).map(([key, value]) => `${key}=${quote(value)}`),
      ""
    ].join("\n");

    await fs.writeFile(releaseEnvPath, body, "utf8");
    console.log(`Wrote ${releaseEnvPath}`);
    console.log("Run `npm run release:doctor:mac` next.");
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
