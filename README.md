# VoxSmith

Voice processing desktop app for indie game developers. Record your own voice and process it to sound like dozens of distinct characters using pitch shifting, formant control, effects chains, and preset management.

Built with Electron + React + TypeScript.

Licensed under [AGPL-3.0](LICENSE).

## Prerequisites

- **Node.js** 20+
- **pnpm** (install via `npm install -g pnpm` if needed)
- **Windows 11** Only if you want to proceed with compiling to .exe file (Win 11 is the primary target; Windows 10 minimum)

## Setup

```bash
git clone https://github.com/rklundt/VoxSmith.git
cd VoxSmith
pnpm install
```

`pnpm install` automatically fetches and copies bundled binaries (FFmpeg, Rubber Band) via the postinstall script. No manual binary setup is needed.

## Development

```bash
pnpm dev          # Start Electron in dev mode with HMR
pnpm typecheck    # TypeScript compiler check
pnpm vitest run   # Run unit tests
pnpm build        # Production build
pnpm dist         # Package to .exe installer
```

## Documentation

Detailed project docs live in `docs/`:

- [Phases and Sprints](docs/phasesAndSprints.md) - roadmap and sprint definitions
- [Architecture](docs/architecture.md) - process model, signal chain, IPC contracts
- [Tech Stack](docs/techStack.md) - libraries and integration notes
- [Test Strategy](docs/testStrategy.md) - testing approach and QA checklists
- [User Guide](docs/userGuide.md) - feature documentation
