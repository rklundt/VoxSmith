# VoxSmith - CLAUDE.md

## License

VoxSmith is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**.

- Full license text: `LICENSE` file in project root
- License URL: https://www.gnu.org/licenses/agpl-3.0.txt
- Author: **Ray Klundt w/ Claude Code Assist**

### License Header Requirement

**Every new code file** (`.ts`, `.tsx`, `.js`, `.css`, `.html`) must include the license header at the top of the file. Do not add headers to JSON files or third-party/vendor files (e.g., files in `src/assets/rubberband-wasm/` or `node_modules/`).

**For `.ts`, `.tsx`, `.js`, `.css` files**, use this block comment as the very first thing in the file:

```
/**
 * VoxSmith — Voice Processing for Indie Game Developers
 * Copyright (C) 2025 Ray Klundt w/ Claude Code Assist
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/agpl-3.0.txt>.
 */
```

**For `.html` files**, use this HTML comment as the very first thing in the file (before `<!DOCTYPE html>`):

```html
<!--
  VoxSmith — Voice Processing for Indie Game Developers
  Copyright (C) 2025 Ray Klundt w/ Claude Code Assist

  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU Affero General Public License as
  published by the Free Software Foundation, either version 3 of the
  License, or (at your option) any later version.

  This program is distributed in the hope that it will be useful,
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
  GNU Affero General Public License for more details.

  You should have received a copy of the GNU Affero General Public License
  along with this program. If not, see <https://www.gnu.org/licenses/agpl-3.0.txt>.
-->
```

---

## Project Overview

**VoxSmith** is a desktop voice processing application for indie game developers. The developer records their own voice and processes it to sound like dozens of distinct characters. Built with Electron + React + TypeScript.

Always read the following docs before starting any sprint or significant feature work:
- `docs/phasesAndSprints.md` - current phase, sprint, and user stories
- `docs/architecture.md` - layer rules, IPC boundaries, audio engine design
- `docs/techStack.md` - every library, why it was chosen, install notes
- `docs/testStrategy.md` - testing approach, Vitest scope, manual QA checklists
- `docs/cicd.md` - CI/CD maturity stages and release checklist
- `docs/userGuide.md` - user-facing feature documentation and feature interaction guide
- `src/shared/tooltips.ts` - single source of truth for all UI tooltip copy

---

## Tech Stack Summary

| Layer | Technology |
|---|---|
| Desktop shell | Electron |
| UI framework | React + TypeScript |
| Bundler | electron-vite |
| Audio effects | Web Audio API + Tone.js (renderer process only) |
| Formant shifting | Rubber Band Library (native CLI binary via main process) |
| Waveform display | WaveSurfer.js |
| File processing/export | FFmpeg (bundled binary, called from main process) |
| State management | Zustand |
| Logging | Winston |
| Packaging | electron-builder |

**Real-time audio effects (EQ, reverb, compression, etc.) run in the renderer process via Web Audio API.** Never move real-time effects to the main process.

**Offline audio processing (pitch/formant/tempo via Rubber Band CLI), FFmpeg, and file I/O run exclusively in the main process.** Never call Rubber Band CLI, FFmpeg, or write files directly from the renderer — always use IPC.

**Three-stage pipeline:** Stage 1 (offline: Rubber Band CLI in main) → Stage 2 (real-time: Web Audio in renderer) → Stage 3 (export: FFmpeg in main). See `docs/architecture.md` for full details.

---

## Project Structure

```
src/
  main/                      # Electron main process ONLY
    index.ts                 # App entry, window creation
    ipc/                     # All IPC handler registrations
    ffmpeg/                  # FFmpeg wrapper and export pipeline
    fileSystem/              # Preset JSON, settings.json, log management

  preload/
    index.ts                 # contextBridge API — only bridge between main and renderer
    voxsmith.d.ts            # TypeScript declarations for window.voxsmith API

  renderer/
    components/              # React UI components - NO business logic here
      controls/              # Knobs, sliders, toggles
      panels/                # PresetPanel, WaveformPanel, ControlPanel
      layout/                # App shell, sidebar, header
    hooks/                   # Custom React hooks - bridge between UI and engine
    engine/                  # AudioEngine, Web Audio API, Tone.js, Rubber Band WASM
      AudioEngine.ts         # Central audio engine class
      EffectsChain.ts        # All effects nodes wired together
      RubberBandProcessor.ts # Sprint 1 spike wrapper (to be replaced by IPC pipeline in Sprint 2)
      MicInput.ts            # getUserMedia and live mic routing
    stores/                  # Zustand stores - global app state
      presetStore.ts
      engineStore.ts
      sessionStore.ts

  data/                      # Data access layer
    presets.ts               # Read/write presets.json via IPC
    settings.ts              # Read/write config/settings.json via IPC
    logger.ts                # Winston logger setup and session management

  shared/                    # TypeScript types shared across main + renderer
    types.ts
    constants.ts

  assets/                    # Bundled binaries (do not modify)
    ffmpeg/
    rubberband-wasm/

scripts/
  copy-binaries.ts           # Postinstall script — copies FFmpeg and WASM binaries to src/assets/

config/
  settings.json              # Shipped defaults (committed to git)
  userSettingsOverride.json   # User-specific overrides (gitignored, created on first user change)

logs/                        # Session log files - gitignored
testResults/                 # QA run results - rolling last 7 + regression master
docs/                        # Project documentation
.claude/commands/            # Claude Code custom slash commands
```

---

## Architectural Rules

These rules must be followed without exception. If a task seems to require breaking them, ask before proceeding.

### 1. Strict Layer Separation

**UI Layer** (`renderer/components/`)
- React components handle display and user interaction only
- No direct calls to AudioEngine, no file system access, no IPC calls
- All data flows in via props or Zustand store selectors
- All actions flow out via hook calls

**Application Layer** (`renderer/hooks/` + `renderer/engine/` + `renderer/stores/`)
- Hooks orchestrate between UI events, engine state, and store updates
- AudioEngine owns all Web Audio API nodes and the effects chain
- Stores hold serializable app state only - no audio nodes in stores

**Data/File Layer** (`src/data/` + `src/main/`)
- All file reads and writes go through the main process via IPC
- Renderer never accesses the file system directly
- IPC channels must be defined in `src/shared/constants.ts`

### 2. IPC Contracts
- All IPC channel names are defined as constants in `src/shared/constants.ts`
- Never use magic strings for IPC channel names
- Every IPC handler in main must have a corresponding typed invoke in renderer/data

### 3. Tooltip Copy
- All tooltip text lives in `src/shared/tooltips.ts` - never hardcode tooltip strings in components
- When adding a new UI control, add its entry to `tooltips.ts` first
- Tooltip content must stay in sync with `docs/userGuide.md` - if one is updated, update the other
- The `poweredBy` field in each tooltip identifies which library handles that feature for support and enhancement requests

### 4. Code Comments
- Use verbose inline comments throughout all code, especially in audio engine, effects chain, and WASM integration code
- Assume the reader has no audio engineering background — explain what DSP operations do in plain language, not just what the code does
- Comment the "why" and the "what it sounds like," not just the "what"
- Every AudioWorklet processor, effects node connection, and parameter mapping should have a comment explaining its purpose in the signal chain

### 5. Bundled Binaries
- FFmpeg and Rubber Band WASM are bundled inside the app for portability
- Never require the user to install external dependencies
- Binary paths must be resolved relative to `process.resourcesPath` in production and `__dirname` in dev

---

## Logging

VoxSmith uses **Winston** for structured session logging.

### Configuration
Log behavior is controlled by `config/settings.json` - never hardcode these values:
```json
{
  "logging": {
    "maxSessionFiles": 5,
    "logLevel": "info"
  }
}
```

### Session Log Strategy
- A new log file is created on each app launch: `logs/session-YYYY-MM-DD_HH-MM-SS.log`
- On startup, after creating the new log file, purge oldest files if count exceeds `maxSessionFiles`
- Log files are gitignored
- `maxSessionFiles` is user-configurable in `config/settings.json` without a code change

### Log Levels
| Level | When to use |
|---|---|
| `error` | Unhandled exceptions, FFmpeg failures, IPC failures, WASM load failures |
| `warn` | Recoverable issues, fallback behavior triggered, missing optional config |
| `info` | App lifecycle events, preset save/load, export complete, session start/end |
| `debug` | Audio engine state changes, parameter updates, IPC calls |

### What to Always Log
- App launch with version, platform, and resolved binary paths
- Every IPC call (channel name + success/failure, no audio buffer content)
- Preset save, load, delete operations (preset name, not full JSON)
- Every export operation (filename, settings, duration, success/failure)
- FFmpeg command executed (full command string for diagnostics)
- Rubber Band WASM load success or failure
- Any caught exception with full stack trace

### Diagnosing Issues
When the developer reports a bug, the first step is always:
1. Ask them to share the most recent log file from `logs/`
2. Check for `error` and `warn` level entries around the time of the issue
3. Trace IPC call sequence from the debug logs
4. Check FFmpeg command string if export-related

---

## Development Commands

```bash
pnpm dev             # Start Electron in dev mode via electron-vite with HMR
pnpm build           # Production build
pnpm dist            # Package to .exe via electron-builder
pnpm typecheck       # Run TypeScript compiler check only
pnpm lint            # ESLint
```

---

## Git Workflow & Branching Strategy

**Repository:** https://github.com/rklundt/VoxSmith

### Branch Structure

| Branch | Purpose |
|---|---|
| `main` | Stable, sprint-accepted code only. Never commit directly to main. |
| `sprint/{N}-{short-description}` | Active sprint work. Created at sprint start, PR'd into main at sprint end. |

### Sprint Delivery Process

When a sprint is **accepted** (all QA checklist items pass, user confirms), follow these steps exactly:

1. **Ensure all work is committed** on the current sprint branch.
2. **Run validation** before the PR:
   ```bash
   pnpm typecheck && pnpm vitest run
   ```
3. **Push the sprint branch** to the remote:
   ```bash
   git push -u origin sprint/{N}-{short-description}
   ```
4. **Create a Pull Request** into `main` using `gh pr create`:
   - Title: `Sprint {N}: {Sprint Title from phasesAndSprints.md}`
   - Body: Summary of user stories completed, key changes, QA results
   - Tag with the sprint version (e.g., `v0.2.0`)
5. **Merge the PR** once the user approves. Use merge commit (not squash) to preserve sprint commit history.
6. **Tag the merge** on main:
   ```bash
   git tag v0.{N}.0
   git push origin v0.{N}.0
   ```

### Branch Naming Convention

- Sprint branches: `sprint/{N}-{kebab-case-description}` (e.g., `sprint/2-core-audio-pipeline`)
- Hotfix branches: `hotfix/{N}-{kebab-case-description}` (e.g., `hotfix/2-fix-wav-header`)

### Rules

- **Never commit directly to `main`** — all changes go through sprint branches + PRs.
- **Never force-push to `main`** — main history is append-only.
- When starting a new sprint, create the branch from the latest `main`:
  ```bash
  git checkout main && git pull && git checkout -b sprint/{N}-{description}
  ```
- The PR into main serves as the sprint acceptance record — include QA results in the PR body.

---

## Packaging Notes

- Target: Windows 11 primary, Windows 10 minimum
- Mac and Linux are stretch goals - do not break cross-platform compatibility but do not prioritize
- FFmpeg binary must be included in `extraResources` in `electron-builder.config.js`
- Rubber Band WASM must be copied to the renderer's public directory at build time
- Output: single `.exe` installer via NSIS

---

## Custom Claude Commands

These slash commands are available in `.claude/commands/`:

| Command | Purpose |
|---|---|
| `/start-sprint` | Run before beginning any sprint - confirms scope and checks docs |
| `/spike-rubberband` | Guided flow for the Rubber Band WASM spike sprint |
| `/debug-audio` | Structured diagnostic checklist when audio issues are reported |
| `/new-character-preset` | Scaffolds any work touching the preset data shape |

---

## Versioning Strategy

VoxSmith uses sprint-based semantic versioning:

| Phase | Sprint | Version |
|---|---|---|
| Development | Sprint 0 | `0.0.0` |
| Development | Sprint 1 | `0.1.0` |
| Development | Sprint N | `0.{N}.0` |
| Phase 1+2 launch | Sprint 8 complete | `1.0.0` |
| Phase 3 | Sprint 9 | `1.1.0` |
| Phase 3 | Sprint N | `1.{N-8}.0` |

- Patch bumps (`x.x.1`) are reserved for hotfixes within a sprint
- Version is set in `package.json` and displayed in the app's settings/about panel
- Bump version at the start of each sprint, not at the end

---

## Key Decisions Log

| Decision | Choice | Reason |
|---|---|---|
| Desktop framework | Electron | Single codebase, WASM/Web Audio API ecosystem, familiar TS stack |
| Audio processing location | Renderer process | Web Audio API, Tone.js, WaveSurfer.js, Rubber Band WASM all require browser context |
| Formant shifting | Rubber Band CLI (native binary) | rubberband-web WASM lacks formant API, broken real-time tempo, buffer overruns — native CLI solves all three |
| Formant fallback | SoundTouch WASM | No longer planned — native Rubber Band CLI provides full formant control |
| Processing pipeline | Three-stage (offline → real-time → export) | Pitch/formant/tempo offline via Rubber Band CLI; EQ/reverb/etc real-time via Web Audio; export via FFmpeg |
| File export pipeline | FFmpeg (bundled) | Handles noise gate, normalization, bit depth, silence padding reliably |
| Preset storage | Single presets.json | Simple, sufficient for expected data volume, easy to back up |
| FFmpeg distribution | Bundled in app | Zero user dependencies, fully portable install |
| Logging | Winston, per-session files | Structured, configurable, diagnosable without code changes |
| Log file count | Configurable in settings.json | User can change without a code change |
| Phase 1 + 2 combined | Single launch target | Shared AudioEngine serves both file and mic input - eliminates refactor debt |
| UI complexity | Basic/Advanced toggle | Keeps interface clean, reveals depth on demand |
| Exe signing | Unsigned for v1 | Signed build deferred to production readiness; SmartScreen warning acceptable during development |
| Auto-update | Deferred post-Phase 3 | Manual download/reinstall for v1; electron-updater added when user base warrants it |
| Binary distribution | Not committed to git | FFmpeg and Rubber Band WASM fetched on `pnpm install` and copied via postinstall script |
| Settings override | `config/settings.json` + `config/userSettingsOverride.json` | Committed defaults + gitignored user overrides, shallow merge on startup |
| Preset file safety | Atomic write (temp + rename) | Prevents data loss from crash during save |
