# VoxSmith - Architecture

## Process Model

VoxSmith is an Electron application with two processes that have strictly defined responsibilities.

```
┌─────────────────────────────────────────────┐
│  MAIN PROCESS (Node.js)                     │
│  - App lifecycle, window management         │
│  - File system: presets.json, settings.json │
│  - FFmpeg subprocess calls                  │
│  - IPC handler registration                 │
│  - Log file management (Winston)            │
└────────────────┬────────────────────────────┘
                 │ IPC (contextBridge)
┌────────────────▼────────────────────────────┐
│  RENDERER PROCESS (Chromium)                │
│  - React UI                                 │
│  - Web Audio API + AudioWorklets            │
│  - Tone.js effects                          │
│  - Tone.js + Web Audio real-time effects     │
│  - WaveSurfer.js (waveform display)         │
│  - Zustand state stores                     │
└─────────────────────────────────────────────┘
```

**Rule:** Real-time audio effects never move to main. File I/O never moves to renderer. Offline audio processing (Rubber Band for pitch/formant/tempo) runs in main — formant shifting uses the Rubber Band library API via Koffi FFI (`setFormantScale()`), pitch/tempo-only uses the CLI binary. Both return processed buffers to the renderer via IPC.

---

## Three-Stage Processing Pipeline

VoxSmith's audio processing is split into three stages based on what can run in real-time and what requires offline processing. This was determined by the Sprint 1 Rubber Band WASM spike.

```
 STAGE 1 — Offline Processing         STAGE 2 — Real-time Effects          STAGE 3 — Export
 (Main process, Rubber Band CLI)      (Renderer, Web Audio API)            (Main process, FFmpeg)
 ┌──────────────────────────────┐     ┌──────────────────────────────┐     ┌───────────────────────┐
 │ Pitch (semitones)            │     │ HighPassFilter               │     │ Noise gate            │
 │ Formant (independent ratio)  │────▶│ SpectralTilt  ← wet/dry     │────▶│ Normalization         │
 │ Tempo / Speed                │ IPC │ 4-Band EQ                    │ IPC │ Bit depth conversion  │
 │                              │     │ Compressor                   │     │ Silence padding       │
 │ [Apply] button in UI         │     │ Vibrato       ← wet/dry     │     │ Format (.wav)         │
 │ ████░░░ progress indicator   │     │ Tremolo       ← wet/dry     │     └───────────────────────┘
 └──────────────────────────────┘     │ Vocal Fry     ← wet/dry     │
                                      │ Breathiness   ← wet/dry     │
                                      │ Reverb        ← wet/dry     │
                                      │ Gain (output)               │
                                      │                              │
                                      │ ◀ Instant slider preview ▶   │
                                      └──────────────────────────────┘
```

### Why Three Stages?

**Stage 1 (Offline):** Pitch shifting and formant control use the Rubber Band library, not the WASM AudioWorklet. Sprint 1 proved that `rubberband-web` has no formant API and its real-time mode has buffer management issues. Sprint 6 integrated the Rubber Band C library API via Koffi FFI, providing true single-pass formant shifting via `setFormantScale()`. Pitch/tempo-only processing uses the CLI binary. Both approaches process entire files offline without buffer overruns.

**Stage 2 (Real-time):** All other effects use the Web Audio API and Tone.js. These process audio in real-time with no perceptible latency. Slider changes are instant. This is where the user spends most of their time fine-tuning character voices.

**Stage 3 (Export):** FFmpeg handles final processing that is not part of creative sound design — noise gate, normalization, bit depth, silence padding, and format conversion. These are applied once at export time.

### User Experience Flow

1. **Record or load** a voice line (2–30 seconds)
2. **Dial pitch, formant, tempo** — these have an **"Apply"** button. Rubber Band CLI processes the full buffer in main process (~1–3 seconds), returns a new buffer to renderer via IPC
3. **Tweak EQ, reverb, gain, compression, etc.** — these are **instant**. Sliders move, sound changes live. No waiting.
4. **Export** — sends to FFmpeg for final processing

When pitch/formant/tempo values change but haven't been applied yet, the UI shows a "preview outdated" indicator. The user can hear the last-applied version through the real-time chain while adjusting offline parameters. Clicking Apply (or auto-apply after debounce) processes the audio and updates the preview.

### Stale Preview Indicator

```
┌──────────────────────────────────────────────────┐
│  PITCH    ◄━━━━━━━━●━━━━━━━━━━► 0.85x           │
│  FORMANT  ◄━━━━━━━━━━━●━━━━━━━► 1.15x           │
│  TEMPO    ◄━━━━━━━━●━━━━━━━━━━► 1.00x           │
│                                                  │
│  ● Preview outdated      [ ▶ Apply Changes ]     │
│  ████████░░░░ Processing...                      │
└──────────────────────────────────────────────────┘
```

**Presets save ALL parameters** — both offline (pitch, formant, tempo) and real-time (EQ, reverb, etc.). Loading a preset triggers one offline Apply followed by instant real-time parameter restoration.

---

## Audio Engine Architecture

The AudioEngine is a singleton class in `src/renderer/engine/AudioEngine.ts`. It manages Stage 2 (real-time effects) only. Stage 1 processing is handled via IPC to the main process.

### Required Initialization Order

Before any Tone.js nodes are created or the effects chain is wired, the AudioEngine must bind Tone.js to the app's single AudioContext:

```typescript
const context = new AudioContext();
Tone.setContext(context);
// Now safe to create Tone.Reverb, Tone.Tremolo, Tone.Vibrato, etc.
```

**Rule:** Never let Tone.js create its own AudioContext. All audio nodes — both raw Web Audio and Tone.js wrappers — must share one context.

### Stage 2 Signal Chain (Real-time Effects)

The AudioEngine receives an already-processed AudioBuffer from Stage 1 (or the raw buffer if no offline processing has been applied yet).

```
Input Source (switchable)
  ├── FileSource: AudioBuffer from Stage 1 (pitch/formant/tempo applied)
  └── MicSource: MediaStream from getUserMedia (no Stage 1 — real-time only)

        ↓
  GainNode (input gain)
        ↓
  HighPassFilterNode (BiquadFilterNode)
        ↓
  SpectralTiltNode (low shelf + high shelf)  ← wet/dry pair (Sprint 7.4)
        ↓
  EQNode (4x BiquadFilterNode)
        ↓
  FormantBankNode (3-4x BiquadFilterNode peaking: F1/F2/F3/F4) ← wet/dry pair (Sprint 7.6)
        ↓
  CompressorNode (DynamicsCompressorNode)
        ↓
  ┌─── Per-effect wet/dry routing (repeated for each effect below) ───┐
  │                                                                    │
  │  input ──┬── EffectNode (wet path) ── wetGain ──┬── blendOutput   │
  │          └── dryGain (dry path) ────────────────┘                  │
  │                                                                    │
  │  setWetDry(effect, mix) controls wetGain and dryGain levels.      │
  │  mix=1.0: full wet. mix=0.0: full dry (effect bypassed).          │
  └────────────────────────────────────────────────────────────────────┘
        ↓
  DistortionNode (WaveShaperNode)            ← wet/dry pair (Sprint 7.5)
        ↓
  VibratoNode (Tone.js Vibrato)           ← wet/dry pair
        ↓
  TremoloNode (Tone.js Tremolo)           ← wet/dry pair
        ↓
  VocalFryNode (custom AudioWorklet)      ← wet/dry pair
        ↓
  BreathinessNode (custom AudioWorklet)   ← wet/dry pair
        ↓
  ReverbNode (Tone.js Reverb)             ← wet/dry pair
        ↓
  GainNode (output gain)
        ↓
  AudioContext.destination (speakers)
  └── also branches to → RecorderNode (MediaRecorder) when recording
```

**Wet/dry routing detail:** Each effect with a wet/dry control uses a parallel split topology. The input signal is split to both the effect node (wet path) and a direct GainNode (dry path). Both are summed into a blend GainNode. The `setWetDry(effect, mix)` method on AudioEngine adjusts the gain levels of each path. Effects without wet/dry control (HighPass, EQ, Compressor) are inline — they process the signal directly with no parallel dry path.

### Mic Input (Sprint 7)

Live microphone monitoring routes through Stage 2 only — no Stage 1 processing. Pitch/formant/tempo controls are disabled during live mic mode because they require offline processing. The user records first, then applies character voice settings. This is by design: the VoxSmith workflow is record → process → preview → export, not live voice-changing.

**Implementation details:**
- `MicInput.ts` handles device enumeration (`enumerateDevices`), stream acquisition (`getUserMedia`), and recording buffer management
- `AudioEngine.startMicInput()` creates a `MediaStreamSourceNode` and routes it through the same effects chain as file playback
- Recording uses a persistent AudioWorkletNode (`recorder-processor.js`) tap connected in parallel to capture raw (pre-effects) audio so takes can be re-processed with different settings. The recorder node is created once at mic start and stays connected for the entire mic session — recording start/stop is a message, not a node creation.
- Punch-in splices new audio into an existing take's buffer at sample-accurate boundaries. The splice fits the punch buffer to the exact region length (truncate/pad) to prevent time shifting.
- Takes are stored as `AudioBuffer` in memory during the session, with optional IPC-based persistence to `userData/takes/`

**Noise Suppression (Sprint 7.2 — planned):**
- Electron/Chromium ignores the `getUserMedia` `noiseSuppression` constraint (tested: `track.getSettings()` always reports `false`)
- Sprint 7.2 adds RNNoise WASM as an AudioWorklet in the signal chain: `mic → volumeGain → [RNNoise worklet] → effects chain`
- The RNNoise worklet processes audio in real time, removing background noise before it reaches effects or speakers
- The recorder tap captures audio BEFORE the RNNoise node (raw mic signal) for dry recording
- Toggle on/off via message port — no mic restart required
- Store state (`noiseSuppression`) and tooltip already in place from Sprint 7

### Custom AudioWorklet Processors

VocalFry and Breathiness are implemented as custom AudioWorkletProcessors, following the same pattern as RubberBandProcessor: a worklet processor file and a typed AudioWorkletNode wrapper class.

| Processor | DSP Approach | Sprint |
|---|---|---|
| **VocalFryProcessor** | Ring modulation or waveshaping at low frequencies to simulate glottal creak | Sprint 3 (DSP), Sprint 1 (registration pattern validated) |
| **BreathinessProcessor** | Filtered white noise mixed into the signal to simulate air and breath | Sprint 3 (DSP), Sprint 1 (registration pattern validated) |

**Sprint 1 validates the worklet pattern only** — bare-minimum passthrough processors that confirm custom AudioWorklet registration, WASM loading, and message port communication all work inside Electron's renderer. No DSP logic is implemented in Sprint 1. Sprint 3 implements the actual DSP into the already-proven worklet pattern.

### AudioEngine Public API

The AudioEngine manages Stage 2 (real-time) effects only. Pitch, formant, and tempo are handled by Stage 1 via IPC — they are NOT methods on AudioEngine.

```typescript
class AudioEngine {
  // Input — loads the buffer from Stage 1 (already processed for pitch/formant/tempo)
  loadFile(buffer: AudioBuffer): void
  loadProcessedFile(buffer: AudioBuffer): void  // explicit: from Stage 1 result
  startMicInput(deviceId: string): Promise<void>
  stopMicInput(): void

  // Playback
  play(): void
  pause(): void
  stop(): void
  seek(seconds: number): void

  // Stage 2 Parameters — all real-time, instant slider response
  setReverb(amount: number, roomSize: number): void
  setVibrato(rate: number, depth: number): void
  setTremolo(rate: number, depth: number): void
  setVocalFry(intensity: number): void
  setBreathiness(amount: number): void
  setEQ(band: 0|1|2|3, gain: number, freq: number): void
  setCompressor(threshold: number, ratio: number): void
  setHighPass(frequency: number): void
  setSpectralTilt(tilt: number): void       // -10 (dark) to +10 (bright), Sprint 7.4
  setWetDry(effect: EffectName, mix: number): void
  setBypass(bypassed: boolean): void

  // Level metering
  getInputLevel(): number
  getOutputLevel(): number

  // Recording
  startRecording(): void
  stopRecording(): AudioBuffer
  punchIn(startTime: number, endTime: number): void

  // Preset — snapshot includes BOTH Stage 1 params (pitch/formant/tempo)
  // and Stage 2 params (EQ, reverb, etc.). Stage 1 params are stored in the
  // snapshot for preset save/load but are applied via IPC, not AudioEngine.
  getSnapshot(): EngineSnapshot
  loadSnapshot(snapshot: EngineSnapshot): void
}
```

---

## Shared Types

The canonical type definitions live in `src/shared/types.ts`. Architecture.md documents the shapes; `types.ts` enforces them.

### EngineSnapshot

The serializable representation of all AudioEngine parameter values. Used for preset storage, A/B comparison, and state recovery on crash.

```typescript
interface EngineSnapshot {
  pitch: number                        // -24 to +24 semitones
  formant: number                      // -2.0 to +2.0 octaves
  reverbAmount: number                 // 0.0 to 1.0
  reverbRoomSize: number               // 0.0 to 1.0
  speed: number                        // 0.5 to 2.0
  vibratoRate: number                  // Hz
  vibratoDepth: number                 // 0.0 to 1.0
  tremoloRate: number                  // Hz
  tremoloDepth: number                 // 0.0 to 1.0
  vocalFryIntensity: number            // 0.0 to 1.0
  breathiness: number                  // 0.0 to 1.0
  eq: EQBand[]                         // 4 bands, each with gain and freq
  compressorThreshold: number          // dB
  compressorRatio: number              // ratio (e.g. 4 = 4:1)
  highPassFrequency: number            // Hz
  spectralTilt: number                 // -10 (dark) to +10 (bright), 0 = neutral
  wetDryMix: Record<EffectName, number> // 0.0 (dry) to 1.0 (wet) per effect
  bypassed: boolean
}

interface EQBand {
  gain: number     // dB boost/cut
  frequency: number // center frequency Hz
}

type EffectName = 'vibrato' | 'tremolo' | 'vocalFry' | 'breathiness' | 'reverb' | 'spectralTilt'
```

### Preset

```typescript
interface Preset {
  id: string                           // uuid
  name: string                         // character name
  category: string                     // folder/category label
  portraitPath?: string                // relative path in userData/portraits/
  notes?: string                       // free text performance notes
  emotionVariants: EmotionVariant[]    // sub-presets per emotion
  engineSnapshot: EngineSnapshot       // all parameter values
  createdAt: string                    // ISO timestamp
  updatedAt: string                    // ISO timestamp
}

interface EmotionVariant {
  id: string
  emotion: string                      // e.g. "angry", "whisper", "sad", "default"
  engineSnapshot: EngineSnapshot
}
```

---

## Preload Script

The preload script (`src/preload/index.ts`) is the **only** bridge between the main process and the renderer process. It uses `contextBridge.exposeInMainWorld` to expose a typed `window.voxsmith` API object.

**Rule:** No raw `ipcRenderer` calls are permitted in the renderer. All IPC goes through `window.voxsmith`.

```typescript
// src/preload/index.ts
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('voxsmith', {
  // File system
  loadAllPresets: () => ipcRenderer.invoke(IPC.PRESET_LOAD_ALL),
  savePreset: (preset: Preset) => ipcRenderer.invoke(IPC.PRESET_SAVE, preset),
  deletePreset: (id: string) => ipcRenderer.invoke(IPC.PRESET_DELETE, id),
  getSettings: () => ipcRenderer.invoke(IPC.SETTINGS_GET),
  saveSettings: (settings: Partial<AppSettings>) => ipcRenderer.invoke(IPC.SETTINGS_SAVE, settings),

  // Export
  exportWav: (request: ExportRequest) => ipcRenderer.invoke(IPC.EXPORT_WAV, request),
  exportBatch: (request: BatchExportRequest) => ipcRenderer.invoke(IPC.EXPORT_BATCH, request),

  // File dialogs
  openWavDialog: () => ipcRenderer.invoke(IPC.DIALOG_OPEN_WAV),
  saveWavDialog: (name: string) => ipcRenderer.invoke(IPC.DIALOG_SAVE_WAV, name),
  openImageDialog: () => ipcRenderer.invoke(IPC.DIALOG_OPEN_IMAGE),
})
```

Every IPC channel in the IPC Channels section below must have a corresponding method on the `window.voxsmith` API. The renderer accesses all main process functionality exclusively through this object.

A corresponding type declaration file (`src/preload/voxsmith.d.ts`) must be maintained so that the renderer has full TypeScript support for `window.voxsmith`.

---

## IPC Channels

All channel names are defined as constants in `src/shared/constants.ts`. Never use string literals.

```typescript
// File system
IPC.PRESET_LOAD_ALL       // renderer → main: void → PresetLibrary
IPC.PRESET_SAVE           // renderer → main: Preset → void
IPC.PRESET_DELETE         // renderer → main: presetId → void (also deletes associated portrait file)
IPC.SETTINGS_GET          // renderer → main: void → AppSettings
IPC.SETTINGS_SAVE         // renderer → main: Partial<AppSettings> → void

// Stage 1 — Offline audio processing (Rubber Band CLI)
IPC.AUDIO_PROCESS         // renderer → main: AudioProcessRequest → AudioProcessResult
IPC.AUDIO_PROCESS_CANCEL  // renderer → main: void → void (kills in-flight child_process)

// Stage 3 — Export (FFmpeg)
IPC.EXPORT_WAV            // renderer → main: ExportRequest → ExportResult
IPC.EXPORT_BATCH          // renderer → main: BatchExportRequest → BatchExportResult

// File dialog
IPC.DIALOG_OPEN_WAV       // renderer → main: void → string (file path)
IPC.DIALOG_SAVE_WAV       // renderer → main: string (suggested name) → string (file path)
IPC.DIALOG_OPEN_IMAGE     // renderer → main: void → string (file path)
```

---

## State Management

Three Zustand stores with clear ownership:

### engineStore
Owns: current parameter values, bypass state, input mode, playback state
Does not own: actual Web Audio nodes (those live in AudioEngine instance)

### presetStore
Owns: loaded preset library, active preset id, A/B comparison state, emotion sub-preset state

### sessionStore
Owns: script lines (Phase 3), take list, recording state, punch-in markers, export queue

---

## Rubber Band Integration (Native Binary via Main Process)

**Sprint 1 Finding:** The `rubberband-web` WASM package cannot be used for VoxSmith's needs. It lacks independent formant control, its real-time AudioWorklet mode has buffer overrun issues, and tempo/time-stretch does not function correctly in the fixed 128-sample AudioWorklet block size. See Sprint 1 spike findings for full details.

**Chosen approach:** Rubber Band CLI (native binary) runs as a child process in main. The renderer sends audio data and parameters via IPC; main processes the entire buffer offline and returns the result.

### Stage 1 IPC Data Flow

```
Renderer                              Main Process
   │                                      │
   │──── AUDIO_PROCESS ─────────────────▶│
   │     { audioData: ArrayBuffer,        │
   │       sampleRate: number,            │
   │       pitch: number,                 │
   │       formant: number,               │
   │       tempo: number }                │
   │                                      │── Write temp WAV
   │                                      │── Run rubberband CLI
   │                                      │── Read output WAV
   │                                      │── Delete temp files
   │                                      │
   │◀─── AUDIO_PROCESS_RESULT ──────────│
   │     { processedData: ArrayBuffer,    │
   │       durationSeconds: number }      │
   │                                      │
   │  Decode into AudioBuffer             │
   │  Feed into Stage 2 real-time chain   │
```

### Rubber Band CLI Command

```bash
rubberband \
  --pitch <semitones> \
  --formant \
  --tempo <ratio> \
  --fine \
  input.wav output.wav
```

- `--pitch N`: Pitch shift in semitones (e.g. -6, +12)
- `--formant`: Preserve formants during pitch shift (this is the critical flag missing from rubberband-web)
- `--tempo N`: Time-stretch ratio (1.0 = no change, 0.5 = half speed, 2.0 = double speed)
- `--fine`: Higher quality processing (acceptable latency for offline use)

### Binary Distribution

The Rubber Band CLI binary is bundled in `src/assets/rubberband/` alongside FFmpeg. It follows the same distribution pattern:
- Not committed to git
- Fetched on `pnpm install` via postinstall script
- Resolved via `process.resourcesPath` in production and `__dirname` in dev
- Added to `extraResources` in `electron-builder.config.js`

### Content Security Policy

The CSP includes `'unsafe-eval'` and `'wasm-unsafe-eval'` for the rubberband-web spike validation. Once the native binary approach is fully implemented and rubberband-web is removed from the project, `'unsafe-eval'` can be removed from the CSP, improving security. `'wasm-unsafe-eval'` is retained for potential future WASM needs (VocalFry, Breathiness AudioWorklets).

---

## FFmpeg Export Pipeline

FFmpeg runs as a child process in main. The renderer sends an `ExportRequest` via IPC.

### Export Data Flow

```
Renderer                          Main
   │                                │
   │  AudioBuffer → WAV Blob        │
   │  → ArrayBuffer                 │
   │                                │
   │──── IPC.EXPORT_WAV ───────────→│
   │     { audioData, outputPath,   │
   │       bitDepth, ... }          │
   │                                │
   │                     Write ArrayBuffer to OS temp file
   │                     Run FFmpeg on temp file
   │                     Delete temp file
   │                                │
   │←── ExportResult ──────────────│
```

The renderer never touches the file system directly. Main owns all temp file creation and cleanup.

**Known limitation:** For typical game dialogue lines (under 30 seconds), structured clone over IPC is acceptable. For longer recordings the transfer may be slow. Future optimization path: use SharedArrayBuffer with contextIsolation workarounds, or have the renderer write to a temp path via a dedicated file-write IPC call rather than transferring the buffer itself. Not a blocker for any current sprint — flag for revisiting if performance complaints arise in Phase 3 batch export.

```typescript
interface ExportRequest {
  audioData: ArrayBuffer   // WAV-encoded audio from renderer
  outputPath: string       // user-chosen destination
  bitDepth: 16 | 24 | 32
  sampleRate: number
  normalize: boolean
  noiseGate: boolean
  padStartMs: number
  padEndMs: number
}
```

FFmpeg command is assembled in `src/main/ffmpeg/buildCommand.ts` and logged in full before execution.

---

## Settings and Configuration

User-configurable behavior is controlled by two files: `config/settings.json` (committed defaults) and `config/userSettingsOverride.json` (user-specific overrides, gitignored). See Settings Override Strategy below.

```json
{
  "logging": {
    "maxSessionFiles": 5,
    "logLevel": "info"
  },
  "export": {
    "defaultBitDepth": 24,
    "defaultSampleRate": 44100,
    "defaultNormalize": true,
    "fileNamingTemplate": "{character}_{scene}_{line}_{emotion}"
  },
  "ui": {
    "advancedModeDefault": false,
    "theme": "dark"
  }
}
```

### Settings Override Strategy

Two files, both in `config/`:

| File | Committed | Purpose |
|---|---|---|
| `config/settings.json` | Yes | Shipped defaults. Overwritten on app update. Never edited by the user at runtime. |
| `config/userSettingsOverride.json` | No (gitignored) | User-specific overrides. Created on first user change. Never overwritten by updates. |

On startup, main performs a shallow merge: `settings.json` is loaded first, then `userSettingsOverride.json` is layered on top. The override file wins on any conflicting key. This keeps the repo self-contained after a fresh clone and never requires code changes to ship new defaults.

```typescript
// Shallow merge — override wins on conflict
const defaults = JSON.parse(fs.readFileSync('config/settings.json'))
const overrides = fs.existsSync('config/userSettingsOverride.json')
  ? JSON.parse(fs.readFileSync('config/userSettingsOverride.json'))
  : {}
const settings = { ...defaults, ...overrides }
```

When the user changes a setting via the UI, only `userSettingsOverride.json` is written. `settings.json` is never modified at runtime.

Settings are exposed to renderer via `IPC.SETTINGS_GET`. Changes are written by main via `IPC.SETTINGS_SAVE`.

---

## Preset Portrait Storage

Character preset portraits are stored as image files in a managed directory:

```
{app.getPath('userData')}/portraits/
```

- Portraits are saved as relative paths in `presets.json` (e.g., `"portrait": "portraits/finn.png"`)
- On preset load, main resolves the portrait path and returns it as a file URI the renderer can use as an `<img src>`
- On preset delete, the associated portrait file is deleted in the same IPC operation
- No base64 encoding — only file-based storage to keep `presets.json` lightweight
- Supported formats: PNG, JPG, WebP

---

## Preset File Safety

`presets.json` holds the entire preset library. A corrupted write means total data loss.

**Atomic write pattern:** All writes to `presets.json` use a write-temp-then-rename strategy:

```typescript
// 1. Write to a temporary file in the same directory
const tempPath = path.join(presetDir, 'presets.tmp.json')
fs.writeFileSync(tempPath, JSON.stringify(data, null, 2))

// 2. Rename atomically (on the same filesystem, rename is atomic on Windows/POSIX)
fs.renameSync(tempPath, path.join(presetDir, 'presets.json'))
```

If a crash occurs during step 1, the original `presets.json` is untouched. If a crash occurs during step 2 (extremely rare), the temp file is available for recovery on next launch.

On startup, if `presets.tmp.json` exists and `presets.json` does not, recover from the temp file and log a `warn`.

---

## Error Boundary and Crash Recovery

VoxSmith prioritizes user experience on failure: show a clear message, offer retry, preserve state, and log everything needed for diagnosis.

### Strategy

| Failure Type | Recovery | User Experience |
|---|---|---|
| AudioWorklet crash | Recreate AudioContext and re-register worklets | "Audio engine restarted. Your settings have been preserved." |
| Rubber Band CLI crash or timeout | Kill process, clean up temp files, log command string | "Voice processing failed. Please try again." with error details in log. |
| FFmpeg hang or crash | Kill process after configurable timeout, clean up temp files | "Export failed. Please try again." with error details in log. |
| IPC failure | Retry once, then surface error to user | "Could not save preset. Please try again." |
| `presets.json` corrupted | Fall back to empty preset library, log `error` with file contents | "Preset library could not be loaded. Starting fresh." |
| `settings.json` missing or corrupted | Fall back to hardcoded defaults, log `warn` | Silent — app starts normally with defaults |

### Logging on Failure

Every error boundary must log:
- The error type and full stack trace (`error` level)
- The operation that was being performed (e.g., "export", "preset save", "WASM load")
- Current `EngineSnapshot` at time of failure (so the exact state can be reproduced)
- Any relevant parameters (file path, preset name, FFmpeg command)

### State Preservation

On any recoverable failure, the app must:
1. Preserve the current `EngineSnapshot` in the `engineStore`
2. Preserve the current preset library in the `presetStore`
3. After recovery, restore from the preserved store state
4. Never silently reset parameters to defaults on crash
