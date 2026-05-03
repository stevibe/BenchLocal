import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type PackageJsonShape = {
  name?: string;
  productName?: string;
};

const APP_PACKAGE_NAME = 'benchlocal-app';
const APP_PRODUCT_NAME = 'BenchLocal';

function getModuleDir(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

function getResourcesPath(): string | undefined {
  return (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
}

function uniqueCandidates(candidates: Array<string | undefined>): string[] {
  return [
    ...new Set(
      candidates.filter((candidate): candidate is string => Boolean(candidate)),
    ),
  ];
}

function isExistingFile(targetPath: string): boolean {
  try {
    return statSync(targetPath).isFile();
  } catch {
    return false;
  }
}

function isExistingDir(targetPath: string): boolean {
  try {
    return statSync(targetPath).isDirectory();
  } catch {
    return false;
  }
}

function readPackageJson(targetPath: string): PackageJsonShape | null {
  if (!isExistingFile(targetPath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(targetPath, 'utf8')) as PackageJsonShape;
  } catch {
    return null;
  }
}

function isBenchLocalAppPackageJson(targetPath: string): boolean {
  const packageJson = readPackageJson(targetPath);

  if (!packageJson) {
    return false;
  }

  return (
    packageJson.name === APP_PACKAGE_NAME ||
    packageJson.productName === APP_PRODUCT_NAME
  );
}

function firstExisting(
  candidates: string[],
  predicate: (candidate: string) => boolean,
): string | undefined {
  return candidates.find((candidate) => predicate(candidate));
}

export function resolveAppPackageJsonPath(): string {
  const cwd = process.cwd();
  const moduleDir = getModuleDir();
  const candidates = uniqueCandidates([
    process.env.BENCHLOCAL_APP_PACKAGE_JSON,
    path.resolve(cwd, 'app', 'package.json'),
    path.resolve(cwd, '..', 'app', 'package.json'),
    path.resolve(cwd, 'package.json'),
    path.resolve(moduleDir, '..', '..', 'package.json'),
    path.resolve(moduleDir, '..', '..', 'app', 'package.json'),
    path.resolve(moduleDir, '..', '..', '..', 'app', 'package.json'),
  ]);

  const appMatch = firstExisting(candidates, isBenchLocalAppPackageJson);
  if (appMatch) {
    return appMatch;
  }

  return firstExisting(candidates, isExistingFile) ?? candidates[0];
}

export function resolveAppRoot(): string {
  return path.dirname(resolveAppPackageJsonPath());
}

export function resolveWorkspaceRoot(): string {
  const envWorkspaceRoot = process.env.BENCHLOCAL_WORKSPACE_ROOT;
  if (envWorkspaceRoot && isExistingDir(envWorkspaceRoot)) {
    return envWorkspaceRoot;
  }

  const appRoot = resolveAppRoot();
  const cwd = process.cwd();
  const moduleDir = getModuleDir();
  const candidates = uniqueCandidates([
    path.dirname(appRoot),
    path.resolve(cwd),
    path.resolve(cwd, '..'),
    path.resolve(moduleDir, '..', '..'),
    path.resolve(moduleDir, '..', '..', '..'),
  ]);

  const workspaceMatch = firstExisting(
    candidates,
    (candidate) =>
      isExistingDir(path.join(candidate, 'themes')) ||
      isBenchLocalAppPackageJson(path.join(candidate, 'app', 'package.json')),
  );

  return (
    workspaceMatch ??
    firstExisting(candidates, isExistingDir) ??
    path.dirname(appRoot)
  );
}

export function resolveRendererOutDir(): string {
  const workspaceRoot = resolveWorkspaceRoot();
  const cwd = process.cwd();
  const resourcesPath = getResourcesPath();
  const candidates = uniqueCandidates([
    process.env.BENCHLOCAL_RENDERER_OUT_DIR,
    resourcesPath ? path.join(resourcesPath, 'renderer-out') : undefined,
    path.join(workspaceRoot, 'dist', 'renderer-out'),
    path.resolve(cwd, 'dist', 'renderer-out'),
    path.resolve(cwd, '..', 'dist', 'renderer-out'),
  ]);

  return firstExisting(candidates, isExistingDir) ?? candidates[0];
}

export function resolveBuiltInThemesDir(): string {
  const workspaceRoot = resolveWorkspaceRoot();
  const appRoot = resolveAppRoot();
  const cwd = process.cwd();
  const resourcesPath = getResourcesPath();
  const candidates = uniqueCandidates([
    process.env.BENCHLOCAL_THEMES_DIR,
    resourcesPath ? path.join(resourcesPath, 'themes') : undefined,
    path.join(workspaceRoot, 'themes'),
    path.join(appRoot, 'themes'),
    path.resolve(cwd, 'themes'),
  ]);

  return firstExisting(candidates, isExistingDir) ?? candidates[0];
}

export function resolveLicensePath(): string {
  const workspaceRoot = resolveWorkspaceRoot();
  const appRoot = resolveAppRoot();
  const resourcesPath = getResourcesPath();
  const candidates = uniqueCandidates([
    process.env.BENCHLOCAL_LICENSE_PATH,
    resourcesPath ? path.join(resourcesPath, 'LICENSE') : undefined,
    path.join(workspaceRoot, 'LICENSE'),
    path.resolve(appRoot, '..', 'LICENSE'),
  ]);

  return firstExisting(candidates, isExistingFile) ?? candidates[0];
}

export function pathExists(targetPath: string): boolean {
  return existsSync(targetPath);
}
