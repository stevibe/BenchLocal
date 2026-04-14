# macOS Release Workflow

BenchLocal ships a standard macOS desktop release as:

- `BenchLocal-<version>-apple-silicon.dmg`
- `BenchLocal-<version>-apple-silicon.zip`

This repo uses a local signing workflow. Apple credentials stay on the release machine and are not committed to the repo.

## Requirements

- macOS
- Xcode command line tools
- Apple Developer membership
- a `Developer ID Application` certificate installed in the login keychain

For public internet distribution, you also want notarization configured.

## Command reference

From the repo root:

```bash
npm run build
```

Compile only. This is the normal development build.

```bash
npm run pack
```

Compile and package the production app, including DMG and ZIP artifacts.

```bash
npm run build:dir
```

Compile and produce an unpacked local `.app` bundle.

```bash
npm run build:mac
```

Compile and package the macOS DMG and ZIP explicitly through the app workspace.

```bash
npm run release:all
```

Build the signed macOS release, then package Windows and Linux artifacts from the repo root.

For a real signed release, use:

```bash
npm run release:setup:mac
npm run release:doctor:mac
npm run release:mac
```

## Local secrets

Do not commit Apple signing or notarization values into the repo.

BenchLocal uses a local ignored file:

```text
.env.release.local
```

An example template is committed as:

```text
.env.release.example
```

Use the interactive setup helper:

```bash
npm run release:setup:mac
```

Validate the local release environment:

```bash
npm run release:doctor:mac
```

Build a signed release with local secrets loaded:

```bash
npm run release:mac
```

This command builds, signs, and notarizes the release, and staples the produced `.app`.

## Signing vs notarization

These are separate steps.

### Signing

Signing happens locally with the certificate in your keychain.

BenchLocal expects:

- `CSC_NAME`
  - the signing identity name from Keychain Access, without the `Developer ID Application:` prefix

### Notarization

Notarization talks to Apple after the app has already been signed.

BenchLocal supports both notarization flows:

- App Store Connect API key
- Apple ID + app-specific password

Preferred:

- `APPLE_API_KEY`
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER`

Fallback:

- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`

## Verification commands

Useful local checks after a release build:

```bash
codesign --verify --deep --strict --verbose=2 app/dist/mac-arm64/BenchLocal.app
codesign -dv --verbose=4 app/dist/mac-arm64/BenchLocal.app 2>&1 | rg "Authority|TeamIdentifier|Identifier"
spctl --assess --type execute --verbose=4 app/dist/mac-arm64/BenchLocal.app
xcrun stapler validate app/dist/mac-arm64/BenchLocal.app
```

BenchLocal treats the notarized `.app` as the authoritative artifact for trust validation. The generated `.dmg` is the delivery container.

## Typical local release flow

1. Ensure the correct `Developer ID Application` certificate is installed locally.
2. Create or update `.env.release.local`.
3. Run:

```bash
npm run release:doctor:mac
npm run release:mac
```

4. Validate the produced artifacts.
5. Upload the finished `.dmg` and `.zip` to GitHub Releases.

This repo intentionally supports local-only release management without putting Apple credentials into GitHub.

## Output

Artifacts are written to:

```text
app/dist/
```

Typical output:

- `BenchLocal-<version>-apple-silicon.dmg`
- `BenchLocal-<version>-apple-silicon.zip`
- `mac-arm64/BenchLocal.app`
