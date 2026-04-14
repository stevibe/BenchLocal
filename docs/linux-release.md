# Linux Release

BenchLocal can be packaged for Linux as:

- `AppImage` for direct download and execution
- `tar.gz` as a secondary portable archive

Current release target:

- `x64`

Build from the repo root:

```bash
cd BenchLocal
npm run build:linux
```

Artifacts are written to:

- `app/dist/`

Expected outputs:

- `BenchLocal-<version>-linux-x64.AppImage`
- `BenchLocal-<version>-linux-x64.tar.gz`

Notes:

- no Linux developer account is required for direct distribution
- code signing is optional for the first Linux release path
- verifier-backed Bench Packs still require Docker installed and running on the target machine
- Linux validation should be done on a real Linux machine before release
