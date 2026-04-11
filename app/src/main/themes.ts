import { app } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { BenchLocalThemeDefinition, BenchLocalThemeDescriptor } from "@core";
import { getThemeStorageDir, loadThemeDefinitionFromFile } from "@core";

function getBenchLocalWorkspaceRoot(): string {
  return path.resolve(__dirname, "../../..");
}

function getBuiltInThemesDir(): string {
  const packagedThemesDir = path.join(process.resourcesPath, "themes");
  if (app.isPackaged) {
    return packagedThemesDir;
  }

  return path.join(getBenchLocalWorkspaceRoot(), "themes");
}

async function listThemeFiles(targetDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(targetDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => path.join(targetDir, entry.name));
  } catch {
    return [];
  }
}

export async function listAvailableThemes(): Promise<BenchLocalThemeDescriptor[]> {
  const builtInFiles = await listThemeFiles(getBuiltInThemesDir());
  const userDir = getThemeStorageDir();
  await fs.mkdir(userDir, { recursive: true });
  const userFiles = await listThemeFiles(userDir);

  const themes: BenchLocalThemeDescriptor[] = [];

  for (const filePath of builtInFiles) {
    try {
      const theme = await loadThemeDefinitionFromFile(filePath);
      themes.push({
        id: theme.id,
        name: theme.name,
        colorScheme: theme.colorScheme,
        source: "builtin",
        path: filePath
      });
    } catch {
      // Skip invalid theme files.
    }
  }

  for (const filePath of userFiles) {
    try {
      const theme = await loadThemeDefinitionFromFile(filePath);
      themes.push({
        id: theme.id,
        name: theme.name,
        colorScheme: theme.colorScheme,
        source: "user",
        path: filePath
      });
    } catch {
      // Skip invalid theme files.
    }
  }

  return themes.sort((left, right) => {
    if (left.source !== right.source) {
      return left.source === "builtin" ? -1 : 1;
    }

    return left.name.localeCompare(right.name);
  });
}

export async function loadAvailableTheme(themeId: string): Promise<BenchLocalThemeDefinition | null> {
  const themes = await listAvailableThemes();
  const match = themes.find((theme) => theme.id === themeId);

  if (!match?.path) {
    return null;
  }

  return loadThemeDefinitionFromFile(match.path);
}
