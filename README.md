# BenchLocal

BenchLocal is the desktop host for the six benchmark pillars:

- ToolCall-15
- BugFind-15
- DataExtract-15
- InstructFollow-15
- ReasonMath-15
- StructOutput-15

The goal is to move shared concerns into one desktop application while preserving standalone operation for each benchmark repo.

BenchLocal owns:

- provider configuration
- model registry
- generation parameters
- run scheduling and concurrency
- Bench Pack install and update flow
- verifier lifecycle management
- desktop UI and persisted user settings

Each Bench Pack owns:

- scenario definitions
- benchmark-specific prompts
- tool logic where applicable
- verifier hooks where applicable
- deterministic scoring logic
- benchmark-specific trace formatting

The first design document is in [ARCHITECTURE.md](./ARCHITECTURE.md).

Packaging and public macOS release steps are documented in [docs/macos-release.md](./docs/macos-release.md).
