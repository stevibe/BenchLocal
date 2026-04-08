import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { getBenchLocalHome } from "./config.js";

export type BenchLocalThemeColorScheme = "light" | "dark";

export type BenchLocalThemeDefinition = {
  schemaVersion: 1;
  id: string;
  name: string;
  colorScheme: BenchLocalThemeColorScheme;
  variables: Record<string, string>;
};

export type BenchLocalThemeDescriptor = {
  id: string;
  name: string;
  colorScheme: BenchLocalThemeColorScheme;
  source: "builtin" | "user";
  path?: string;
};

const ThemeSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  colorScheme: z.enum(["light", "dark"]),
  variables: z.record(z.string().trim().min(1), z.string().trim().min(1))
});

export function getThemeStorageDir(): string {
  return path.join(getBenchLocalHome(), "themes");
}

export async function loadThemeDefinitionFromFile(filePath: string): Promise<BenchLocalThemeDefinition> {
  const raw = await fs.readFile(filePath, "utf8");
  return ThemeSchema.parse(JSON.parse(raw)) as BenchLocalThemeDefinition;
}
