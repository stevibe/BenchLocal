import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  loadReleaseEnv,
  normalizeSigningIdentity,
  releaseEnvPath,
  releaseEnvProblems
} from "./release-env.mjs";

const execFileAsync = promisify(execFile);

async function checkSigningIdentity(identity) {
  const { stdout } = await execFileAsync("security", ["find-identity", "-v", "-p", "codesigning"]);
  const normalized = normalizeSigningIdentity(identity);
  return (
    stdout.includes(identity) ||
    stdout.includes(`Developer ID Application: ${normalized}`) ||
    stdout.includes(`Apple Development: ${normalized}`)
  );
}

async function main() {
  const env = await loadReleaseEnv();
  const problems = releaseEnvProblems(env);

  if (env?.APPLE_API_KEY) {
    try {
      await fs.access(env.APPLE_API_KEY);
    } catch {
      problems.push(`APPLE_API_KEY file does not exist: ${env.APPLE_API_KEY}`);
    }
  }

  if (env?.CSC_NAME) {
    const found = await checkSigningIdentity(env.CSC_NAME);
    if (!found) {
      problems.push(`CSC_NAME was not found in the login keychain: ${env.CSC_NAME}`);
    }
  }

  if (problems.length > 0) {
    console.error(`Release configuration check failed for ${releaseEnvPath}`);
    for (const problem of problems) {
      console.error(`- ${problem}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("BenchLocal macOS release configuration looks valid.");
  console.log(`Using signing identity: ${normalizeSigningIdentity(env.CSC_NAME)}`);
  if (env.APPLE_API_KEY) {
    console.log(`Using App Store Connect API key: ${env.APPLE_API_KEY}`);
  } else {
    console.log(`Using Apple ID notarization flow for: ${env.APPLE_ID}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
