import { spawn } from "node:child_process";
import { loadReleaseEnv, releaseEnvProblems, repoRoot } from "./release-env.mjs";

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
      ...envFileValues
    }
  });

  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
