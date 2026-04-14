# Windows Release

BenchLocal does not yet have a production-ready Windows release pipeline.

Current target:

- `nsis` installer
- `zip` portable artifact
- `x64` only

Build command:

```bash
cd BenchLocal
npm run build:win
```

Or build all release artifacts from the repo root:

```bash
npm run release:all
```

Expected outputs:

- `app/dist/BenchLocal-<version>-windows-x64.exe`
- `app/dist/BenchLocal-<version>-windows-x64.zip`

Current gaps:

- no Windows `.ico` asset is configured yet
- no Windows code-signing flow is configured yet
- Bench Pack archive extraction still relies on `tar` being available on the target machine

Signing guidance:

- a Microsoft Store developer account is not required for direct downloads
- a Windows code-signing certificate is recommended for public distribution
- EV signing provides better SmartScreen trust than a standard code-signing certificate

Practical rollout:

1. produce an unsigned Windows build
2. validate install, launch, Bench Pack install/uninstall, and Docker-backed verifier flows on a real Windows machine
3. add signing after the runtime behavior is proven stable
