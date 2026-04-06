# VoxSmith - Tech Stack

## Core Framework

### Electron
- **Why:** Desktop shell enabling Web Audio API + WASM in renderer, Node.js file I/O in main, single codebase, `.exe` packaging
- **Version:** Latest stable
- **Key config:** `contextIsolation: true`, `nodeIntegration: false`, `preload` script for IPC bridge
- **Packaging:** electron-builder with NSIS installer target

### React + TypeScript
- **Why:** Familiar stack (same as A Lotl Legends), component-based UI, strong typing for audio parameter contracts
- **Version:** React 18+, TypeScript 5+

### electron-vite
- **Why:** Fast HMR, handles main/renderer/preload build targets in a single `electron.vite.config.ts`
- **Note:** `electron-vite` replaces standalone Vite entirely. Do not install `vite` separately or create a `vite.config.ts`.

---

## Audio Processing

### Web Audio API (built-in)
- **Why:** Native browser audio graph, runs on dedicated audio thread, low latency
- **Used for:** AudioContext, GainNode, BiquadFilterNode, DynamicsCompressorNode, ConvolverNode, MediaStreamSource, AudioWorkletNode
- **Location:** Renderer process only

### Tone.js
- **Why:** High-level wrappers for reverb, tremolo, vibrato - saves significant implementation time
- **Used for:** `Tone.Reverb`, `Tone.Tremolo`, `Tone.Vibrato`
- **Note:** Tone.js wraps Web Audio API - it works within the same AudioContext. Connect Tone nodes inline in the effects chain.
- **Install:** `pnpm add tone`

### Rubber Band Library (CLI Binary + Shared Library DLL)
- **Why:** Professional-grade independent pitch and formant shifting. Used in commercial audio software.
- **Distribution:** Bundled CLI binary + shared library DLL inside the app. Zero user dependencies.
- **Sprint 1 finding:** The `rubberband-web` npm package (WASM AudioWorklet) was evaluated and rejected. It lacks independent formant control (`setFormant()` not exposed), its real-time tempo/time-stretch is broken in 128-sample AudioWorklet blocks, and it causes BUFFER OVERRUN errors.
- **Sprint 6 integration:** The Rubber Band C library API is called via Koffi FFI from the main process. `setFormantScale()` provides true single-pass formant shifting — no two-pass CLI workaround, no robotic artifacts. The CLI is still used for pitch/tempo-only processing.
- **Key API:** `rubberband_new()`, `rubberband_set_formant_scale()`, `rubberband_set_pitch_scale()`, `rubberband_study()`, `rubberband_process()`, `rubberband_retrieve()`
- **Key CLI flags:** `--pitch` (semitones), `--formant` (preserve formants), `--tempo` (time-stretch ratio), `--fine` (high quality)
- **Binary source:** CLI (`rubberband.exe`) fetched by postinstall script. DLL (`rubberband-3.dll`) built from v4.0.0 source with Meson + MSVC and committed to git.
- **License:** GPL-2.0 — acceptable for our use case (VoxSmith is AGPL-3.0)
- **Note:** `rubberband-web` remains as a dev dependency temporarily for the Sprint 1 spike test UI. It will be removed in a future sprint.
- **Install:** CLI binary fetched by postinstall script; DLL committed to git (no build tools needed for developers)

### Koffi (FFI Library)
- **Why:** Modern FFI for calling the Rubber Band C library API from Node.js. Compatible with Electron's V8 Memory Cage (unlike `node-ffi-napi` which is abandoned and crashes on Electron >= 21).
- **Used for:** Calling `rubberband-3.dll` functions from the main process for single-pass formant shifting via `setFormantScale()`
- **Ships prebuilt:** Koffi includes prebuilt binaries for all platforms — no C++ build tools needed
- **Install:** `pnpm add koffi`

### RNNoise WASM (Noise Suppression)
- **Why:** Electron/Chromium ignores the `getUserMedia` `noiseSuppression` constraint. RNNoise provides AI-based noise suppression via a neural network trained on voice audio at 48kHz.
- **Source:** `@jitsi/rnnoise-wasm` npm package (dev dependency) provides the precompiled WASM binary (~110KB). The AudioWorklet processor (`rnnoise-processor.js`) is custom-written for VoxSmith.
- **Used for:** Real-time background noise removal (fan, AC, keyboard, room tone) in the mic monitoring path
- **Architecture:** Runs as an AudioWorklet processor in the renderer process. WASM binary loaded via MessagePort. Processes 480-sample frames (10ms at 48kHz) with ring buffer adaptation from 128-sample Web Audio render quanta.
- **Signal chain:** `mic → volumeGain → [rnnoiseNode] → effectsChain → speakers`. Recorder tap captures raw audio before RNNoise for dry takes.
- **License:** Apache-2.0 (compatible with AGPL-3.0)
- **Install:** `pnpm add -D @jitsi/rnnoise-wasm` — postinstall script copies WASM to `src/assets/rnnoise/` and `src/renderer/public/rnnoise/`

### WaveSurfer.js
- **Why:** Battle-tested waveform rendering for web, supports seek, regions, real-time updates
- **Used for:** Waveform display, playhead, punch-in region selection (Phase 2)
- **Install:** `pnpm add wavesurfer.js`

---

## State Management

### Zustand
- **Why:** Lightweight, no boilerplate, works well with React hooks pattern, easy to slice into domain stores
- **Stores:** `engineStore`, `presetStore`, `sessionStore`
- **Install:** `pnpm add zustand`

---

## File Processing

### FFmpeg (bundled binary)
- **Why:** Reliable, battle-tested for normalization, noise gate, bit depth conversion, silence padding
- **Distribution:** Bundled in `src/assets/ffmpeg/`. Resolved via `process.resourcesPath` in production.
- **Node integration:** `child_process.spawn` in main process
- **Package for bundling:** `ffmpeg-static` as dev dependency to get the binary, then copy to assets
- **Not committed to git:** The binary is fetched by `ffmpeg-static` on `pnpm install` and copied to `src/assets/ffmpeg/` by the postinstall script
- **Install:** `pnpm add -D ffmpeg-static`

---

## Logging

### Winston
- **Why:** Structured logging, multiple transports, log levels, already familiar from mining app project
- **Config:** Per-session log files, max file count from `settings.json`
- **Transports:** `winston.transports.File` (session log) + `winston.transports.Console` (dev only)
- **Install:** `pnpm add winston`

---

## Testing

### Vitest
- **Why:** Fast, native ESM support, compatible with TypeScript out of the box, uses the same config format as Vite
- **Scope:** Unit tests for pure functions in `src/shared/` and `src/data/`. No automated testing of AudioWorklets or WASM — those are validated manually.
- **Config:** Standalone `vitest.config.ts` at project root (separate from `electron.vite.config.ts` to avoid build config bleeding into test runs)
- **Install:** `pnpm add -D vitest`

---

## Packaging

### electron-builder
- **Why:** Industry standard for Electron packaging, NSIS installer support, `extraResources` for bundled binaries
- **Target:** Windows NSIS `.exe` installer
- **Key config:** `extraResources` must include FFmpeg binary and Rubber Band WASM
- **Install:** `pnpm add -D electron-builder`

---

## Full Install Command

```bash
pnpm add electron react react-dom typescript zustand tone wavesurfer.js winston rubberband-web
pnpm add -D electron-vite electron-builder ffmpeg-static @jitsi/rnnoise-wasm vitest tsx @types/react @types/react-dom
```

**Note:** `electron-vite` replaces standalone Vite. Do not install `vite` separately.

---

## Build Prerequisites — Binary Fetch

Neither FFmpeg nor Rubber Band WASM binaries are committed to git. They are fetched on `pnpm install` and copied to `src/assets/` by a postinstall script.

### Postinstall Script

`scripts/copy-binaries.ts` runs automatically as a `postinstall` hook:

```json
// package.json
{
  "scripts": {
    "postinstall": "tsx scripts/copy-binaries.ts"
  }
}
```

The script:
1. Locates the FFmpeg binary from `node_modules/ffmpeg-static`
2. Copies it to `src/assets/ffmpeg/ffmpeg.exe`
3. Verifies Rubber Band CLI binary and shared library DLL exist in `src/assets/rubberband/`
4. Locates the Rubber Band WASM binary from `node_modules/rubberband-web`
5. Copies it to `src/assets/rubberband-wasm/`
6. Locates the RNNoise WASM binary from `node_modules/@jitsi/rnnoise-wasm`
7. Copies it to `src/assets/rnnoise/` and `src/renderer/public/rnnoise/`
8. Logs success or failure for each binary

After a fresh clone, `pnpm install` is the only step needed to make the build self-contained.

---

## Binary Resolution in Electron

Bundled binaries must resolve differently in dev vs production:

```typescript
// src/main/util/binaryPath.ts
import path from 'path'

export function getBinaryPath(relativePath: string): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, relativePath)
  }
  return path.join(__dirname, '../../src/assets', relativePath)
}

// Usage:
const ffmpegPath = getBinaryPath('ffmpeg/ffmpeg.exe')
const wasmPath = getBinaryPath('rubberband-wasm/rubberband.wasm')
```

---

## electron-builder.config.js Key Settings

```javascript
module.exports = {
  appId: 'com.voxsmith.app',
  productName: 'VoxSmith',
  directories: { output: 'release' },
  win: {
    target: 'nsis',
    icon: 'src/assets/icon.ico'
  },
  extraResources: [
    { from: 'src/assets/ffmpeg', to: 'ffmpeg', filter: ['**/*'] },
    { from: 'src/assets/rubberband-wasm', to: 'rubberband-wasm', filter: ['**/*'] }
  ]
}
```
