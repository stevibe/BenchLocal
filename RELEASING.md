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
npm version 0.2.2 --workspace app --include-workspace-root --no-git-tag-version
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
- `npm run release:all` runs the same three builds in order

4. Confirm release artifacts in `app/dist`:

- `BenchLocal-<version>-apple-silicon.dmg`
- `BenchLocal-<version>-apple-silicon.dmg.blockmap`
- `BenchLocal-<version>-apple-silicon.zip`
- `BenchLocal-<version>-apple-silicon.zip.blockmap`
- `BenchLocal-<version>-windows-x64.exe`
- `BenchLocal-<version>-windows-x64.exe.blockmap`
- `BenchLocal-<version>-windows-x64.zip`
- `BenchLocal-<version>-linux-x64.AppImage`
- `BenchLocal-<version>-linux-x64.tar.gz`
- `latest.yml`
- `latest-mac.yml`
- `latest-linux.yml`

Notes:
- these `latest*.yml` files power the in-app self-update flow
- every desktop release must publish the matching metadata files alongside the platform artifacts
- the blockmap files are used by `electron-updater` for differential downloads and should be uploaded with the artifacts that generated them
- the GitHub tag must be `v<version>` because the updater is configured with `tagNamePrefix: v`

5. Push the release commit and create the release tag:

```bash
git push origin main
git tag v<version>
git push origin v<version>
```

6. Create the GitHub release for `v<version>` and upload the artifacts from `app/dist`.

Notes:
- publish the GitHub release after all assets are uploaded; draft releases are not visible to the updater feed
- upload the `latest*.yml` metadata files and `.blockmap` files along with the installers and archives
- if a release is published without `latest-mac.yml`, `latest.yml`, or `latest-linux.yml`, installed apps can show 404 errors when users click "Check for Updates"

## Self-Update Requirements

BenchLocal uses `electron-updater` with the GitHub Releases provider. Production update checks look for the latest published GitHub release and download the matching updater metadata:

- macOS: `latest-mac.yml`
- Windows: `latest.yml`
- Linux: `latest-linux.yml`

Before announcing a release, verify these URLs return HTTP 200:

```bash
curl -fsSL https://github.com/stevibe/BenchLocal/releases/download/v<version>/latest-mac.yml
curl -fsSL https://github.com/stevibe/BenchLocal/releases/download/v<version>/latest.yml
curl -fsSL https://github.com/stevibe/BenchLocal/releases/download/v<version>/latest-linux.yml
```

Then inspect each metadata file and confirm:

- `version:` matches `<version>`
- every referenced `url:` file exists in the same GitHub release assets
- macOS metadata references the `.zip` artifact because that is what Squirrel.Mac applies during update installation

`v0.2.2` is the first release that includes the self-update client. Users on `v0.2.1` still need to install `v0.2.2` manually. After users are on `v0.2.2` or later, future releases can be installed through the in-app updater.

## macOS Release Checks

Before using `release:mac`, make sure the local macOS release environment is ready:

```bash
npm run release:doctor:mac
```

If setup is needed:

```bash
npm run release:setup:mac
```

## Local Self-Update Testing

You can test the updater end to end without creating a GitHub release by pointing an installed BenchLocal build at a local HTTP feed.

1. Install an older packaged build, for example `0.2.2`.
2. Build a newer release, for example `0.2.3`, so `app/dist` contains:
   - the platform artifacts
   - `latest.yml`
   - `latest-mac.yml`
   - `latest-linux.yml`
3. Serve `app/dist` over HTTP, for example:

```bash
cd app/dist
python3 -m http.server 9000
```

4. Launch the installed older app with `BENCHLOCAL_UPDATE_URL` pointed at that server:

```bash
BENCHLOCAL_UPDATE_URL=http://127.0.0.1:9000/ /Applications/BenchLocal.app/Contents/MacOS/BenchLocal
```

Notes:
- the updater override is intended for packaged app testing; dev mode still disables self-update
- `BENCHLOCAL_UPDATE_CHANNEL` is optional if you need to override the update channel name
- the About dialog shows the active update feed so you can confirm the app is using the local test server
- after "Restart to Update", relaunch with `BENCHLOCAL_UPDATE_URL` again if you want another local-feed check; the environment override may not be preserved by the updater relaunch

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
- verify the `latest*.yml` GitHub URLs return HTTP 200
- verify an installed update-capable build can detect the new release from GitHub Releases
- verify the app launches and reports the new version correctly
- if the release bundles updated runtime packages, verify Bench Pack installation and execution still work on the built app
