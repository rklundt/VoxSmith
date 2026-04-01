# VoxSmith - Phases and Sprints

## Overview

VoxSmith is built across three phases. Phases 1 and 2 are combined into a single launch target (Core Studio) to avoid audio engine refactor debt. Phase 3 adds the full production pipeline.

---

## Phase 1+2 - Core Studio

Full file-based and live recording studio in one release. The AudioEngine serves both WAV file input and live microphone input through the same effects chain.

---

### Sprint 0 - Project Scaffold

**Goal:** Runnable Electron + React + TypeScript + electron-vite shell with all dependencies installed, logging active, and directory structure established.

**User Stories:**
- As a developer, I can run `pnpm dev` and see an Electron window so that I know the scaffold is working
- As a developer, I can run `pnpm dist` and get a `.exe` file so that packaging is confirmed from day one
- As a developer, a new log file is created in `logs/` on every launch so that I can diagnose issues from the first session
- As a developer, log files beyond the configured maximum are purged on startup so that disk space is managed automatically
- As a developer, `config/settings.json` controls the max log file count so that I can change it without a code change

**Acceptance Criteria:**
- Electron window opens without errors
- Dev server starts via `electron-vite dev` (not `vite dev`)
- Winston logger creates `logs/session-YYYY-MM-DD_HH-MM-SS.log` on launch
- Old logs purged when count exceeds `settings.json` value
- TypeScript compiles clean with no errors
- All folders from architecture doc exist
- CSP configured in main process: `script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:` — required before Sprint 1 spike
- `vitest.config.ts` exists at project root and `pnpm test` executes without errors
- `scripts/copy-binaries.ts` runs on `pnpm install` and copies FFmpeg and WASM binaries to `src/assets/`

**QA Checklist:**
- [ ] `pnpm dev` opens Electron window with no console errors
- [ ] `pnpm dist` produces a `.exe` in the release directory
- [ ] Log file appears in `logs/` with correct naming pattern
- [ ] Set `maxSessionFiles` to 2, launch 3 times, verify oldest log is purged
- [ ] `pnpm typecheck` passes with no errors
- [ ] `pnpm test` passes with no errors
- [ ] CSP header present in renderer: verify no `wasm-unsafe-eval` or `blob:` errors in DevTools console
- [ ] Negative: delete `config/settings.json`, launch app — graceful fallback to hardcoded defaults, no crash
- [ ] Negative: set `maxSessionFiles` to 0 or -1 in settings — app does not crash, uses safe minimum

**Definition of Done:**
- All acceptance criteria met
- QA checklist passed and results recorded in `testResults/`
- `package.json` version set to `0.0.0`
- No unexpected `error` or `warn` entries in session log during QA run (entries from intentional negative tests are expected)

**Libraries to install:**
`electron`, `react`, `react-dom`, `typescript`, `electron-vite`, `zustand`, `tone`, `wavesurfer.js`, `winston`, `rubberband-web`, `electron-builder`, `vitest`, `tsx`

**Note:** `electron-vite` replaces standalone Vite entirely. Do not install or configure `vite` separately. Do not create a separate `vite.config.ts` — `electron-vite` handles main, renderer, and preload build targets in a single `electron.vite.config.ts`.

---

### Sprint 1 - Rubber Band WASM Spike

**Goal:** Prove that Rubber Band WASM loads and processes audio inside an Electron AudioWorklet. This is the highest-risk dependency in the project. Resolve it before building anything else.

**Primary target:** `rubberband-web` (confirmed on npm, GPL-2.0, acceptable for our use case).

**User Stories:**
- As a developer, I can load the Rubber Band WASM binary inside an AudioWorklet in the renderer so that formant shifting is confirmed viable
- As a developer, I can process a test WAV file through Rubber Band and hear the pitch-shifted result so that audio round-trip is confirmed
- As a developer, formant shift and pitch shift are independently controllable so that the core value of the library is confirmed
- As a developer, I can register a custom bare-minimum passthrough AudioWorklet processor so that the custom worklet pattern is validated for Sprint 3
- As a developer, if Rubber Band fails to load, an error is logged with the full failure reason so that I can diagnose and switch to SoundTouch fallback if needed

**Spike Checklist:**
1. Verify CSP from Sprint 0 allows WASM loading (prerequisite)
2. Load `rubberband-web` WASM binary inside an AudioWorklet
3. Process test audio with audible pitch change
4. Process test audio with audible formant change **independent of pitch** — this is the critical validation
5. Register a bare-minimum passthrough custom AudioWorklet processor (validates pattern for VocalFry/Breathiness in Sprint 3)
6. Confirm message port communication works between main thread and custom worklet

**Acceptance Criteria:**
- WASM binary loads without CSP or path errors in Electron renderer
- Test audio processes through Rubber Band with audible pitch change
- Test audio processes through Rubber Band with audible formant change independent of pitch
- Custom passthrough AudioWorklet registers and passes audio through without modification
- Load success or failure is logged at appropriate level

**Note:** If `rubberband-web` does not expose independent formant shifting, document the limitation and evaluate compiling from source or switching to `soundtouch-audio-worklet`. If the entire spike fails after reasonable effort, switch to the fallback and document the decision in CLAUDE.md key decisions log.

**Sprint 1 Spike Findings (Completed):**

| Feature | rubberband-web (WASM AudioWorklet) | Finding |
|---|---|---|
| Pitch shift | Works | `setPitch()` produces audible pitch change |
| Formant control | **Not exposed** | No `setFormant()` in API. Searched source — zero matches for "formant". |
| Tempo / time-stretch | **Broken** | Does not function in real-time 128-sample AudioWorklet blocks. Causes BUFFER OVERRUN errors. |
| Buffer management | **Overruns** | `RealtimeRubberBand::push()` overflows internal ring buffer at AudioWorklet's fixed block size. Console floods with "BUFFER OVERRUN" from WASM stdout. |
| CSP | Required `unsafe-eval` | Emscripten uses `new Function()` internally — `wasm-unsafe-eval` alone is insufficient. |

**Decision:** Switch to Rubber Band native CLI binary via `child_process` in main process. This solves all three limitations: full formant control (`--formant` flag), proper tempo/time-stretch, and no buffer issues (offline whole-file processing). Architecture updated to three-stage processing pipeline. See `docs/architecture.md`.

**User Story (added post-spike):**
- As a developer, the architecture documents and code reflect the three-stage processing pipeline (offline Rubber Band CLI → real-time Web Audio effects → FFmpeg export) so that Sprint 2+ implementation has a clear foundation

**QA Checklist:**
- [x] WASM loads with no console errors or CSP violations (after adding `unsafe-eval`)
- [x] Play test audio through Rubber Band with pitch shifted — audible change confirmed
- [x] Formant independence — **ABSENT**: confirmed no `setFormant()` in API or WASM internals
- [x] Tempo — **BROKEN**: does not change playback speed; causes BUFFER OVERRUN
- [ ] Custom passthrough worklet passes audio through unmodified (deferred — not needed with native binary approach)
- [x] Spike findings documented in architecture.md, techStack.md, CLAUDE.md, and this file
- [x] Three-stage pipeline architecture documented and IPC channels defined
- [ ] Negative: Force WASM load failure (rename binary) — error logged at `error` level with reason (deferred — WASM spike path being replaced)

**Definition of Done:**
- Spike findings documented across all docs
- Three-stage pipeline architecture documented
- IPC channels for `AUDIO_PROCESS` and `AUDIO_PROCESS_CANCEL` defined in constants
- `AudioProcessRequest` and `AudioProcessResult` types added to shared types
- QA checklist passed and results recorded in `testResults/`
- `package.json` version set to `0.1.0`
- Decision logged in CLAUDE.md key decisions: native Rubber Band CLI replaces WASM AudioWorklet
- No `error` entries in session log during successful QA run

---

### Sprint 2 - Core Audio Engine + Stage 1 Pipeline

**Goal:** Build the three-stage processing pipeline. Stage 1 (offline: Rubber Band CLI for pitch/formant/tempo via IPC) and Stage 2 (real-time: Web Audio effects chain in renderer). File input only at this stage.

**User Stories:**
- As a user, I can import a WAV file by drag-and-drop or file browser so that I have audio to work with
- As a user, I can play back my imported audio through the real-time effects chain so that I can hear the processed result
- As a user, I can control pitch (semitones) and click Apply so that my voice sounds higher or lower after offline processing
- ~~As a user, I can control formant shift independently of pitch and click Apply so that my voice sounds like a different body size~~ **DEFERRED** — Rubber Band CLI lacks native formant scale control; two-pass CLI workaround produces unacceptable artifacts. Slider disabled in UI. Re-enabled when Rubber Band C++ library API is integrated via Node.js native addon (see Sprint 3).
- As a user, I can control playback speed/tempo and click Apply so that my character speaks at a different rate
- As a user, I see a progress indicator while Stage 1 processing is running so that I know the app is working
- As a user, I see a "preview outdated" indicator when pitch/formant/tempo sliders have changed but not yet been applied
- As a user, I can click a "reset" link on Stage 1 controls to return pitch/formant/speed to defaults (still requires Apply to re-process)
- As a user, I can click a "reset" link on Stage 2 controls to return real-time effects to defaults (applies immediately, no Apply needed)
- As a user, I can control reverb and room size in real-time (instant slider response) so that I can fine-tune without waiting
- As a user, I can toggle a bypass switch to compare processed vs original audio so that I can judge the effect
- As a user, I see a tooltip on every slider and audio control explaining what it does in plain language so that I do not need audio engineering knowledge to use the app
- As a developer, the Rubber Band CLI binary is bundled and resolved correctly in dev and production
- As a developer, all AudioEngine parameter changes and IPC calls are logged at debug level so that issues can be traced

**Acceptance Criteria:**
- WAV file loads and plays back
- Pitch and formant controls work via Stage 1 IPC — Apply button triggers offline processing
- ~~Formant shift is audibly independent of pitch~~ **DEFERRED** — requires Rubber Band native library integration (Sprint 3)
- Tempo/speed changes via Stage 1 without affecting pitch
- Progress indicator visible during Stage 1 processing
- Stale preview indicator visible when offline params changed but not applied
- Stage 1 reset link returns pitch/formant/speed to defaults and marks preview stale
- Stage 2 reset link returns real-time effects to defaults and updates engine immediately
- Every slider and audio control has a tooltip with short hover text and detailed help via "?" icon
- Tooltip content is sourced from `src/shared/tooltips.ts` — not hardcoded in components
- Reverb and other real-time controls respond instantly
- Bypass toggle switches between processed and dry signal
- No audio glitches or dropouts during real-time parameter changes during playback

**QA Checklist:**
- [ ] Import WAV via drag-and-drop — file loads and plays
- [ ] Import WAV via file browser dialog — file loads and plays
- [ ] Pitch: set to +12 semitones, click Apply — audible pitch change after processing completes
- [ ] ~~Formant: shift independently of pitch, click Apply — audible character change, NOT chipmunk~~ **DEFERRED to Sprint 3** — formant slider disabled with explanation text in UI
- [ ] Speed/Tempo: set to 0.7, click Apply — slower playback without pitch change
- [ ] Progress indicator: visible during Stage 1 processing, disappears on completion
- [ ] Stale indicator: change pitch slider without clicking Apply — "preview outdated" visible
- [ ] Stage 1 reset: click "reset" — pitch/formant/speed return to 0/0/1.0, stale indicator appears
- [ ] Stage 1 reset + Apply: click "reset" then Apply — audio reverts to unprocessed original
- [ ] Stage 2 reset: click "reset" — high-pass/compressor return to defaults, audible change immediate
- [ ] Tooltips: hover over each slider label — short description appears as native title text
- [ ] Tooltips: hover over "?" icon on each control — full detail text appears including "Works well with" pairings
- [ ] Tooltips: verify Pitch, Formant, Speed, Volume, High-Pass, Comp Threshold, Comp Ratio all have tooltips
- [ ] Tooltips: verify tooltip content matches `src/shared/tooltips.ts` (not hardcoded)
- [ ] Reverb: sweep amount and room size — instant audible change (no Apply needed)
- [ ] Bypass toggle: A/B between processed and dry — instant switch, no dropout
- [ ] Check debug logs for IPC AUDIO_PROCESS calls and Rubber Band CLI command strings
- [ ] Negative: load a non-WAV file (e.g. .txt) — clear error message, no crash
- [ ] Negative: load a corrupted WAV file — clear error message, no crash
- [ ] Negative: set pitch to extreme values (-24, +24) — processes without crash
- [ ] Negative: cancel Stage 1 processing mid-flight — app returns to ready state, temp files cleaned up
- [ ] Negative: Rubber Band CLI binary missing — clear error message, Stage 2 effects still functional

**Definition of Done:**
- All acceptance criteria met
- QA checklist passed and results recorded in `testResults/`
- `package.json` version set to `0.2.0`
- Audio sanity checklist from `testStrategy.md` passed
- All Sprint 0-1 regression items re-verified

---

### Sprint 3 - Advanced Effects Chain

**Goal:** Complete the full effects chain including all advanced controls.

**User Stories:**
- As a user, I can control vibrato rate and depth so that my character voice has personality oscillation
- As a user, I can control tremolo rate and depth so that my character voice has volume oscillation
- As a user, I can control vocal fry intensity so that my character sounds raspy or gritty
- As a user, I can control breathiness/air so that my character sounds airy or whispery
- As a user, I can adjust a 4-band EQ so that I can shape the tonal character precisely
- As a user, I can adjust compression threshold and ratio so that my voice has consistent dynamic control
- As a user, I can set a high-pass filter cutoff so that low-end rumble is removed
- As a user, I can set a wet/dry mix per effect so that I can blend processed and dry signal per effect
- As a user, I can control formant shift independently of pitch via the Rubber Band C++ library API (`setFormantScale()`) so that my voice sounds like a different body size without robotic artifacts — **RE-ENABLEMENT from Sprint 2** (requires Node.js native addon or `node-ffi-napi` wrapping the Rubber Band shared library; single-pass processing, no two-pass CLI workaround)
- As a user, I can toggle between Basic and Advanced mode so that the interface is not overwhelming by default
- As a user, Basic mode shows pitch, formant, reverb, and speed so that I can get results quickly
- As a user, Advanced mode reveals all remaining controls so that I have full control when needed
- As a user, I can enable an "Auto Apply" checkbox under Stage 1 controls so that when I click Play, any pending Stage 1 changes are automatically applied before playback starts
- As a user, every new control added in this sprint has a tooltip sourced from `tooltips.ts` so that the help experience is consistent

**Acceptance Criteria:**
- All advanced controls audibly affect output
- Basic/Advanced toggle shows and hides correct controls
- Toggle state persists across sessions
- No performance degradation with full effects chain active
- Every new control has a tooltip from `tooltips.ts` with short text, detail, and pairings
- Auto Apply checkbox: when enabled and Play is clicked with stale Stage 1 params, processing runs automatically before playback

**QA Checklist:**
- [ ] Vibrato: sweep rate and depth — audible oscillation
- [ ] Tremolo: sweep rate and depth — audible volume oscillation
- [ ] Vocal Fry: sweep intensity — audible rasp/grit
- [ ] Breathiness: sweep amount — audible air/whisper
- [ ] EQ: adjust each of 4 bands — audible tonal change per band
- [ ] Compressor: adjust threshold and ratio — audible dynamic control
- [ ] High-pass filter: sweep cutoff — audible low-end removal
- [ ] Wet/dry mix: adjust per effect — blend between processed and dry
- [ ] Formant (re-enabled): shift independently of pitch via native Rubber Band API — audible character change, NOT chipmunk, no robotic artifacts
- [ ] Basic mode: only pitch, formant, reverb, speed visible
- [ ] Advanced mode: all controls visible
- [ ] Toggle mode, restart app — mode persists
- [ ] Enable all effects simultaneously — no audible glitches or frame drops
- [ ] Tooltips: all new controls (vibrato, tremolo, vocal fry, breathiness, EQ, wet/dry) have tooltips from `tooltips.ts`
- [ ] Audio sanity: bypass toggle with full chain active — clean A/B comparison
- [ ] Negative: set all parameters to max simultaneously — no crash, no NaN audio
- [ ] Negative: rapidly toggle Basic/Advanced mode during playback — no UI freeze or audio dropout

**Definition of Done:**
- All acceptance criteria met
- QA checklist passed and results recorded in `testResults/`
- `package.json` version set to `0.3.0`
- Audio sanity checklist from `testStrategy.md` passed
- All Sprint 0-2 regression items re-verified

---

### Sprint 4 - Waveform Display and Monitoring

**Goal:** Visual feedback during playback and recording.

**User Stories:**
- As a user, I can see a waveform of my imported audio file so that I understand the shape of what I recorded
- As a user, I can see a real-time level meter so that I know when I am clipping
- As a user, the waveform playhead moves during playback so that I know where I am in the file
- As a user, I can click on the waveform to seek to a position so that I can audition specific sections
- As a user, the waveform updates after I process and export so that I see the result accurately

**Acceptance Criteria:**
- WaveSurfer.js renders waveform for any loaded WAV
- Level meter updates in real time during playback
- Seeking via waveform click works accurately
- No UI freeze during waveform rendering

**QA Checklist:**
- [ ] Load WAV — waveform renders without UI freeze
- [ ] Play audio — playhead moves in sync with audio
- [ ] Click on waveform at various positions — playback seeks accurately
- [ ] Level meter responds during playback — peaks visible on loud sections
- [ ] Clip detection: play loud audio — meter indicates clipping
- [ ] Export processed audio, re-import — waveform reflects processed result
- [ ] Load a very short WAV (< 1 second) — waveform still renders correctly
- [ ] Load a long WAV (> 2 minutes) — no UI freeze during render
- [ ] Negative: seek past end of waveform — handled gracefully, no crash
- [ ] Negative: load file while another is playing — previous playback stops cleanly

**Definition of Done:**
- All acceptance criteria met
- QA checklist passed and results recorded in `testResults/`
- `package.json` version set to `0.4.0`
- All Sprint 0-3 regression items re-verified

---

### Sprint 5 - Preset System

**Goal:** Full character preset library with all metadata.

**User Stories:**
- As a user, I can save my current settings as a named character preset so that I can recall it later
- As a user, I can load a saved preset so that all controls update to the saved values
- As a user, I can rename a preset so that I can correct mistakes or refine character names
- As a user, I can delete a preset so that I can remove characters I no longer need
- As a user, I can organize presets into folders or categories (e.g. Heroes, Villains, Creatures) so that I can navigate a large library easily
- As a user, I can add a portrait image to a preset so that I remember who the character is visually
- As a user, I can add a text notes field to a preset so that I remember details like tone direction and performance notes
- As a user, I can create emotion sub-presets for a character (angry, whisper, sad) so that the same character sounds consistent across emotional states
- As a user, I can compare two presets in A/B mode so that I can choose between two versions of a character
- As a user, preset-related controls (save, load, A/B, emotion sub-presets) have tooltips from `tooltips.ts` so that the workflow is self-documenting
- As a developer, all preset save, load, and delete operations are logged at info level with the preset name

**Acceptance Criteria:**
- Presets persist in `presets.json` across app restarts
- Portrait images are stored as relative paths in `presets.json`, files managed in `userData/portraits/`
- On preset delete, associated portrait file is deleted in the same IPC operation
- A/B toggle instantly switches between two loaded presets
- Emotion sub-presets are nested under the parent character preset
- Folders/categories are collapsible in the preset panel

**QA Checklist:**
- [ ] Save a preset with name and settings — appears in preset panel
- [ ] Close and reopen app — preset persists
- [ ] Load a preset — all controls update to saved values
- [ ] Rename a preset — name updates in panel and in `presets.json`
- [ ] Delete a preset — removed from panel and `presets.json`
- [ ] Add portrait image to preset — image displays in panel
- [ ] Delete preset with portrait — portrait file deleted from `userData/portraits/`
- [ ] Add text notes to a preset — notes persist across restart
- [ ] Create emotion sub-presets (angry, whisper, sad) under a character — nested correctly
- [ ] Create folders/categories — collapsible in panel
- [ ] A/B compare two presets — instant toggle, no audio gap
- [ ] Save preset with all effects at extreme values — loads back correctly
- [ ] Negative: save preset with empty name — rejected with error message, not saved
- [ ] Negative: save preset with duplicate name — handled gracefully (rename prompt or suffix)
- [ ] Negative: manually delete `presets.json`, reopen app — app starts with empty preset library, no crash
- [ ] Negative: delete portrait file outside the app, load preset — app handles missing portrait gracefully (placeholder image)
- [ ] Negative: save preset with special characters in name (e.g. `/\:*?"<>|`) — handled gracefully

**Definition of Done:**
- All acceptance criteria met
- QA checklist passed and results recorded in `testResults/`
- `package.json` version set to `0.5.0`
- All Sprint 0-4 regression items re-verified

---

### Sprint 6 - Export Pipeline

**Goal:** File export with full processing via FFmpeg.

**User Stories:**
- As a user, I can export my processed audio as a WAV file so that I have a usable game asset
- As a user, I can choose the export bit depth (16, 24, or 32-bit) so that I control quality and file size
- As a user, I can choose the sample rate on export so that files match my game engine's requirements
- As a user, my exported file is normalized so that all character exports have consistent volume
- As a user, I can configure noise gate settings so that silence and background noise are stripped before export
- As a user, I can add silence padding in milliseconds to the start and end of exported files so that game engine audio triggers do not clip
- As a user, export controls (bit depth, sample rate, normalize, noise gate, silence padding) have tooltips from `tooltips.ts` so that I understand what each setting does
- As a developer, the full FFmpeg command executed for each export is logged at debug level so that export issues can be diagnosed

**Acceptance Criteria:**
- Export produces a valid WAV file at the specified bit depth and sample rate
- Normalized exports are within -1dBFS
- Noise gate audibly removes background noise from test recordings
- Silence padding is accurate to within 5ms
- Export failure is caught, logged at error level, and shown to user

**QA Checklist:**
- [ ] Export at 16-bit / 44100Hz — valid WAV, correct properties
- [ ] Export at 24-bit / 48000Hz — valid WAV, correct properties
- [ ] Export at 32-bit / 44100Hz — valid WAV, correct properties
- [ ] Enable normalization — exported file peak within -1dBFS
- [ ] Enable noise gate on noisy recording — background noise audibly reduced
- [ ] Set pad start 500ms, pad end 300ms — silence padding accurate (±5ms)
- [ ] Check debug log for FFmpeg command string after export
- [ ] Simulate export failure (invalid output path) — error shown to user, logged at error level
- [ ] Export a 30-second file — completes without IPC timeout
- [ ] Negative: export to a read-only directory — error shown to user, logged, no crash
- [ ] Negative: export with no audio loaded — prevented with clear message
- [ ] Negative: cancel/close save dialog during export — handled gracefully, no orphaned temp files

**Definition of Done:**
- All acceptance criteria met
- QA checklist passed and results recorded in `testResults/`
- `package.json` version set to `0.6.0`
- All Sprint 0-5 regression items re-verified

---

### Sprint 7 - Live Microphone Input and Recording

**Goal:** Add live mic input through the same AudioEngine used for file playback. Mic monitoring uses Stage 2 (real-time effects) only. Stage 1 (pitch/formant/tempo) is applied after recording via the standard Apply workflow.

**User Stories:**
- As a user, I can select my microphone input device so that I use the right hardware
- As a user, I can monitor my microphone in real time through the Stage 2 effects chain (EQ, reverb, compression, etc.) so that I hear a preview while recording
- As a user, I can record my voice with the character effects applied so that I capture a processed take directly
- As a user, I can adjust any effects parameter during recording so that I can refine the character in the moment
- As a user, I can use a count-in (1-4 beats) before recording starts so that I have time to prepare
- As a user, I can record multiple takes so that I can pick the best performance
- As a user, I can audition each take before committing so that I do not have to re-record unnecessarily
- As a user, I can use punch-in recording to re-record a specific section so that I do not redo a full take for one mistake
- As a user, I can use keyboard shortcuts for record, stop, and punch-in so that I can operate hands-free
- As a user, I can review playback at reduced speed without pitch change so that I can evaluate timing and delivery
- As a user, recording controls (count-in, take management, punch-in) have tooltips from `tooltips.ts` so that I understand the workflow

**Acceptance Criteria:**
- Mic input routes through the same AudioEngine effects chain as file input
- Monitoring latency is below 30ms on standard hardware
- Punch-in records only the punched region and splices cleanly
- Keyboard shortcuts are documented and displayed in the UI
- All takes are preserved until explicitly deleted

**QA Checklist:**
- [ ] Select mic input device from dropdown — correct device used
- [ ] Monitor mic through effects chain — hear processed voice in real time
- [ ] Verify monitoring latency is acceptable (< 30ms perceived)
- [ ] Record a take — captured audio plays back with effects applied
- [ ] Record multiple takes — all preserved in take list
- [ ] Audition each take — correct audio plays for each
- [ ] Delete a take — removed from list
- [ ] Use count-in (1-4 beats) — recording starts after count
- [ ] Punch-in on a specific section — only punched region re-recorded, clean splice
- [ ] Keyboard shortcut for record/stop/punch-in — functional and displayed in UI
- [ ] Adjust effects during recording — changes apply in real time
- [ ] Playback at reduced speed — tempo changes without pitch change
- [ ] Audio sanity: bypass toggle during mic monitoring — clean A/B
- [ ] Audio sanity: switch from file input to mic input — no engine crash
- [ ] Negative: deny microphone permission — clear message, app remains functional for file input
- [ ] Negative: disconnect mic during recording — recording stops gracefully, partial take preserved
- [ ] Negative: select non-existent device ID — error message, falls back to default mic

**Definition of Done:**
- All acceptance criteria met
- QA checklist passed and results recorded in `testResults/`
- `package.json` version set to `0.7.0`
- Audio sanity checklist from `testStrategy.md` passed
- All Sprint 0-6 regression items re-verified

---

### Sprint 8 - Polish, Settings, and Packaging

**Goal:** Ship-ready build. Settings UI, error handling, onboarding, and `.exe` packaging.

**User Stories:**
- As a user, I can open a settings panel and change the max log file count without editing JSON directly so that configuration is approachable
- As a user, I see a clear error message if a WAV file fails to load so that I am not left confused
- As a user, I see a clear error message if export fails so that I know what went wrong
- As a user, I can see the app version in the settings or about panel so that I can report it when asking for help
- As a developer, I can run `pnpm dist` and get a `.exe` NSIS installer so that the app can be installed on a clean Windows machine
- As a developer, the bundled FFmpeg and Rubber Band WASM binaries resolve correctly in the packaged build so that the app works after installation

**Acceptance Criteria:**
- Settings panel reads merged settings and writes user changes to `config/userSettingsOverride.json`
- All expected error states show user-facing messages
- Packaged `.exe` installs and runs on a clean Windows 11 machine
- No console errors in packaged build
- Version number displayed in app matches `package.json`

**QA Checklist:**
- [ ] Open settings panel — current values reflect merged defaults + overrides
- [ ] Change max log file count in settings — value written to `config/userSettingsOverride.json`
- [ ] Load invalid WAV file — clear error message shown to user
- [ ] Trigger export failure — clear error message shown to user
- [ ] Version displayed in settings/about matches `package.json` version
- [ ] `pnpm dist` produces `.exe` NSIS installer
- [ ] Install `.exe` on clean Windows 11 — app launches without errors
- [ ] In packaged build: load WAV, process, export — full pipeline works
- [ ] In packaged build: FFmpeg binary resolves correctly
- [ ] In packaged build: Rubber Band WASM loads correctly
- [ ] In packaged build: no console errors in DevTools
- [ ] Negative: manually corrupt `config/settings.json`, launch app — falls back to defaults, no crash
- [ ] Negative: delete FFmpeg binary from resources, attempt export — clear error message, no crash

**Definition of Done:**
- All acceptance criteria met
- QA checklist passed and results recorded in `testResults/`
- `package.json` version set to `1.0.0`
- Full regression suite (all Sprint 0-7 items) passed on packaged build
- Packaged `.exe` tested on clean Windows 11 machine

---

## Phase 1+2 Exit Criteria

Phase 1+2 is complete when all of the following are true:
- All Sprint 0-8 QA checklists pass
- Full regression suite passes on the packaged `.exe` build
- At least one real character preset has been created end-to-end (save, load, export)
- No unresolved `error` level log entries during full QA pass
- Version `1.0.0` set in `package.json` and displayed in app

---

## Phase 3 - Production Pipeline

Transforms VoxSmith from a voice tool into a full game dialogue production pipeline.

**Note:** QA checklists and acceptance criteria will be added when each sprint is actively planned. Phase 3 scope may shift based on Phase 1+2 learnings.

---

### Sprint 9 - Script Import and Session Management

**User Stories:**
- As a user, I can import a script file (plain text or CSV) of dialogue lines so that I can record all lines in one session
- As a user, lines are queued in order so that I can move through the script without manual management
- As a user, each line is tagged with character name, scene number, and emotion so that exports are organized correctly
- As a user, I can save a session file so that I can return and continue recording without losing progress
- As a user, I can re-record a specific line without affecting others so that corrections are fast
- As a user, I can mark a line as complete, needs-redo, or skipped so that I can track progress through a large script

---

### Sprint 10 - Batch Export and Manifest

**User Stories:**
- As a user, I can batch export all completed lines in one action so that I do not export one at a time
- As a user, exported files are named automatically using a configurable convention (e.g. `finn_scene2_line4_angry.wav`) so that files are game-engine ready without renaming
- As a user, a JSON manifest is exported alongside the audio files listing every file with its metadata so that my game engine can reference them programmatically
- As a user, a CSV version of the manifest is also available so that I can review it in a spreadsheet
- As a user, I can configure the file naming convention in settings without a code change so that it matches my game project's asset structure

---

### Sprint 11 - Variation Engine and Loop Markers

**User Stories:**
- As a user, I can enable a variation parameter per character so that repeated exports of the same line have subtle differences and do not sound robotic
- As a user, I can control the intensity of variation so that it is subtle and not distracting
- As a user, I can mark loop start and end points on a recording so that ambient and crowd voice files loop cleanly in my game engine
- As a user, loop points are embedded in the exported WAV file metadata so that game engines that support loop markers can use them automatically

---

### Sprint 12 - Phase 3 Polish and Pipeline QA

**User Stories:**
- As a user, I can do a full end-to-end pass from script import to batch export with no manual file management so that the pipeline is truly automated
- As a user, the manifest accurately reflects every exported file with correct metadata so that I can trust it in production
- As a developer, the full Phase 3 pipeline is tested against VoxSmith's own game project (A Lotl Legends) as the acceptance test so that real-world use is validated

---

## Future Enhancements

Tracked here so they are not forgotten. Not scheduled for any sprint.

| Enhancement | Notes |
|---|---|
| Auto-update via `electron-updater` | Deferred post-Phase 3. Manual download/reinstall acceptable for v1 personal tool. |
| Code signing (EV certificate) | Required for production distribution to avoid SmartScreen warnings. Budget and lead time needed. |
| CI/CD Stage 2 (GitHub Actions) | Implement when project reaches stable feature completion. See `docs/cicd.md`. |
| Mac/Linux packaging | Stretch goal. Do not break compatibility but do not prioritize. |
