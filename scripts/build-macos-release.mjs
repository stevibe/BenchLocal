import fs from "node:fs/promises";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { loadReleaseEnv, normalizeSigningIdentity, releaseEnvProblems, repoRoot } from "./release-env.mjs";

const execFileAsync = promisify(execFile);

async function findReleaseArtifacts() {
  const appDir = path.join(repoRoot, "app", "dist");
  const entries = await fs.readdir(appDir, { withFileTypes: true });

  const macDir = entries.find((entry) => entry.isDirectory() && entry.name.startsWith("mac-"));
  let appPath = null;
  if (macDir) {
    const macEntries = await fs.readdir(path.join(appDir, macDir.name), { withFileTypes: true });
    const appEntry = macEntries.find((entry) => entry.isDirectory() && entry.name.endsWith(".app"));
    if (appEntry) {
      appPath = path.join(appDir, macDir.name, appEntry.name);
    }
  }

  return { appPath };
}

async function stapleArtifact(filePath) {
  if (!filePath) {
    return;
  }
  await execFileAsync("xcrun", ["stapler", "staple", filePath], {
    cwd: repoRoot
  });
}

async function main() {
  const envFileValues = await loadReleaseEnv();
  const problems = releaseEnvProblems(envFileValues);

  if (problems.length > 0) {
    for (const problem of problems) {
      console.error(`- ${problem}`);
    }
    console.error("Run `npm run release:setup:mac` or create .env.release.local first.");
    process.exitCode = 1;
    return;
  }

  const child = spawn("npm", ["run", "build:mac"], {
    cwd: repoRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      ...envFileValues,
      CSC_NAME: normalizeSigningIdentity(envFileValues.CSC_NAME)
    }
  });

  child.on("exit", async (code) => {
    if (code !== 0) {
      process.exitCode = code ?? 1;
      return;
    }

    try {
      const { appPath } = await findReleaseArtifacts();
      await stapleArtifact(appPath);
      process.exitCode = 0;
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
