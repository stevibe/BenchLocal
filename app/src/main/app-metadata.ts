import { promises as fs } from "node:fs";
import path from "node:path";
import { app } from "electron";

export type BenchLocalAppMetadata = {
  productName: string;
  description: string;
  version: string;
  author: string;
  license?: string;
  copyright?: string;
};

type AppPackageJson = {
  productName?: string;
  description?: string;
  version?: string;
  author?: string;
  license?: string;
};

function getPackageJsonPath(): string {
  return path.join(app.getAppPath(), "package.json");
}

function getLicensePath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "LICENSE")
    : path.resolve(app.getAppPath(), "..", "LICENSE");
}

function parseCopyrightLine(licenseText: string): string | undefined {
  const line = licenseText
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => /^copyright\s*\(c\)\s+/i.test(entry));

  if (!line) {
    return undefined;
  }

  return line.replace(/^copyright\s*\(c\)\s+/i, "Copyright © ");
}

function parseLicenseName(licenseText: string): string | undefined {
  const firstLine = licenseText
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);

  return firstLine || undefined;
}

export async function loadAppMetadata(): Promise<BenchLocalAppMetadata> {
  const packageJsonRaw = await fs.readFile(getPackageJsonPath(), "utf8");
  const packageJson = JSON.parse(packageJsonRaw) as AppPackageJson;

  let license = packageJson.license;
  let copyright: string | undefined;

  try {
    const licenseRaw = await fs.readFile(getLicensePath(), "utf8");
    license = license ?? parseLicenseName(licenseRaw);
    copyright = parseCopyrightLine(licenseRaw);
  } catch {
    license = packageJson.license;
    copyright = undefined;
  }

  return {
    productName: packageJson.productName ?? app.getName(),
    description: packageJson.description ?? "",
    version: packageJson.version ?? app.getVersion(),
    author: packageJson.author ?? "",
    license,
    copyright
  };
}
