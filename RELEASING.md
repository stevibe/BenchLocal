# Releasing BenchLocal

This document captures the current release flow for a new BenchLocal desktop release.

## Versioning

- BenchLocal desktop releases use the workspace/app version, for example `0.2.1`.
- For a desktop client-only release, update:
  - `package.json`
  - `app/package.json`
  - `package-lock.json`
- `@benchlocal/core` and `@benchlocal/sdk` should only be bumped when those npm packages are actually being released.
- Internal workspace packages do not need to be version-bumped for every desktop release.

## Release Flow

1. Bump the desktop client version without creating a tag yet:

```bash
npm version <version> --workspace app --include-workspace-root --no-git-tag-version
```

Example:

```bash
npm version 0.2.1 --workspace app --include-workspace-root --no-git-tag-version
```

2. Review the working tree and commit the release prep:

```bash
git status --short
git add package.json app/package.json package-lock.json
git commit -m "Release BenchLocal v<version>"
```

3. Build release artifacts from that exact release commit:

```bash
npm run release:mac
npm run build:win
npm run build:linux
```

Notes:
- macOS should use `release:mac`, not `build:mac`
- Windows and Linux use `build:win` and `build:linux`

4. Confirm release artifacts in `app/dist`:

- `BenchLocal-<version>-apple-silicon.dmg`
- `BenchLocal-<version>-apple-silicon.zip`
- `BenchLocal-<version>-windows-x64.exe`
- `BenchLocal-<version>-windows-x64.zip`
- `BenchLocal-<version>-linux-x64.AppImage`
- `BenchLocal-<version>-linux-x64.tar.gz`

5. Push the release commit and create the release tag:

```bash
git push origin main
git tag v<version>
git push origin v<version>
```

6. Create the GitHub release for `v<version>` and upload the artifacts from `app/dist`.

## macOS Release Checks

Before using `release:mac`, make sure the local macOS release environment is ready:

```bash
npm run release:doctor:mac
```

If setup is needed:

```bash
npm run release:setup:mac
```

## Release Note Inputs

Before publishing, collect:

- commit log since the previous release tag
- user-facing changes since the previous release
- new official Bench Pack support or platform/runtime changes
- installer/runtime fixes that affect production usage

Useful command:

```bash
git log --oneline <previous-tag>..HEAD
```

## Post-Release Checklist

- verify the tag points to the intended release commit
- verify the GitHub release assets match the current version number
- verify the app launches and reports the new version correctly
- if the release bundles updated runtime packages, verify Bench Pack installation and execution still work on the built app
