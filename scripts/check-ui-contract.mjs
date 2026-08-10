import fs from "node:fs/promises";
import path from "node:path";

const rootDir = process.cwd();
const rendererCssPath = path.join(rootDir, "app/src/renderer/src/index.css");
const themesDir = path.join(rootDir, "themes");
const requiredThemeTokens = [
  "--accent",
  "--border",
  "--dialog-backdrop",
  "--fail",
  "--ink",
  "--muted",
  "--partial",
  "--pass",
  "--surface",
  "--table-header-bg",
  "--workspace-canvas-bg"
];

function collectMatches(source, expression) {
  return new Set(Array.from(source.matchAll(expression), (match) => match[1]));
}

async function checkCssTokens(problems) {
  const css = await fs.readFile(rendererCssPath, "utf8");
  const usedTokens = collectMatches(css, /var\(\s*(--[a-zA-Z0-9-]+)/g);
  const declaredTokens = collectMatches(css, /(--[a-zA-Z0-9-]+)\s*:/g);

  for (const token of [...usedTokens].sort()) {
    if (!declaredTokens.has(token)) {
      problems.push(`Renderer CSS uses ${token}, but index.css does not provide a fallback declaration.`);
    }
  }
}

async function checkBuiltInThemes(problems) {
  const themeFiles = (await fs.readdir(themesDir)).filter((fileName) => fileName.endsWith(".json")).sort();
  const themeIds = new Set();

  for (const fileName of themeFiles) {
    const filePath = path.join(themesDir, fileName);
    const theme = JSON.parse(await fs.readFile(filePath, "utf8"));

    if (theme.schemaVersion !== 1) {
      problems.push(`${fileName} must use theme schemaVersion 1.`);
    }

    if (theme.colorScheme !== "light" && theme.colorScheme !== "dark") {
      problems.push(`${fileName} has an invalid colorScheme.`);
    }

    if (typeof theme.id !== "string" || !theme.id.trim()) {
      problems.push(`${fileName} must define a non-empty id.`);
    } else if (themeIds.has(theme.id)) {
      problems.push(`${fileName} duplicates theme id ${theme.id}.`);
    } else {
      themeIds.add(theme.id);
    }

    if (!theme.variables || typeof theme.variables !== "object" || Array.isArray(theme.variables)) {
      problems.push(`${fileName} must define a variables object.`);
      continue;
    }

    for (const token of requiredThemeTokens) {
      if (typeof theme.variables[token] !== "string" || !theme.variables[token].trim()) {
        problems.push(`${fileName} is missing required token ${token}.`);
      }
    }

    for (const token of Object.keys(theme.variables)) {
      if (!token.startsWith("--")) {
        problems.push(`${fileName} contains invalid theme token ${token}.`);
      }
    }
  }
}

async function main() {
  const problems = [];

  await checkCssTokens(problems);
  await checkBuiltInThemes(problems);

  if (problems.length > 0) {
    console.error("BenchLocal UI contract check failed:");
    for (const problem of problems) {
      console.error(`- ${problem}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("BenchLocal UI tokens and built-in themes are consistent.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
