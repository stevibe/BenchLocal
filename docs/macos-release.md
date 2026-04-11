# macOS Release Workflow

BenchLocal ships a standard macOS desktop release as:

- `BenchLocal-<version>-arm64.dmg`
- `BenchLocal-<version>-arm64.zip`

`npm run build` performs a production package build. `npm run build:mac` is an explicit alias for the same macOS packaging path.

For a real public release, use the local release workflow below instead of exporting secrets directly in the shell.

## Requirements

- macOS
- Xcode command line tools installed
- Apple Developer membership
- a `Developer ID Application` certificate installed in the login keychain

## Local secret handling

Do not commit Apple signing or notarization values into the repo.

BenchLocal now supports a local ignored file:

```bash
.env.release.local
```

Generate it interactively:

```bash
npm run release:setup:mac
```

Validate it:

```bash
npm run release:doctor:mac
```

Run a signed macOS release build with that local config loaded:

```bash
npm run release:mac
```

An example template is committed at:

```bash
.env.release.example
```

## Build commands

From the repo root:

```bash
npm run build
```

or explicitly:

```bash
npm run build:mac
```

For an unpacked local app bundle without installer artifacts:

```bash
npm run build:dir
```

For public release builds, prefer:

```bash
npm run release:mac
```

## Signing

`electron-builder` will discover the installed `Developer ID Application` identity from the keychain and sign the app bundle automatically.

BenchLocal is configured for macOS distribution signing:

- hardened runtime enabled
- distribution signing mode
- DMG + ZIP output

BenchLocal can still package successfully if only an `Apple Development` certificate is installed, but that is not the correct certificate for public distribution outside local testing. For public releases, install a `Developer ID Application` certificate in the login keychain first.

## Notarization

Notarization is enabled when Apple credentials are present in the environment.

Preferred App Store Connect API key flow:

```bash
export APPLE_API_KEY="/absolute/path/to/AuthKey_XXXXXX.p8"
export APPLE_API_KEY_ID="XXXXXX"
export APPLE_API_ISSUER="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

Alternative Apple ID flow:

```bash
export APPLE_ID="you@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="XXXXXXXXXX"
```

With one of those sets exported, `npm run build` will:

1. compile BenchLocal
2. sign the app
3. build the DMG and ZIP
4. submit for notarization
5. staple the notarization ticket

If no notarization credentials are present, the build still succeeds, but notarization is skipped.

## Best practice

For an open-source Electron app with public binaries:

- keep certificate selection and notarization secrets out of git
- use an ignored local env file for local releases
- use CI secrets for automated releases
- use `Developer ID Application` for public macOS signing
- prefer the App Store Connect API key flow over Apple ID + app-specific password

## Output

Artifacts are written to:

```bash
app/dist/
```

Typical output:

- `BenchLocal-0.1.0-arm64.dmg`
- `BenchLocal-0.1.0-arm64.zip`
- `mac-arm64/BenchLocal.app`
