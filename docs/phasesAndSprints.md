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
- ~~As a user, I can control formant shift independently of pitch and click Apply so that my voice sounds like a different body size~~ **DEFERRED** — Rubber Band CLI lacks native formant scale control; two-pass CLI workaround produces unacceptable artifacts. Slider disabled in UI. Re-enabled in Sprint 6 via `Koffi` wrapping the Rubber Band shared library (`.dll`).
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
- ~~Formant shift is audibly independent of pitch~~ **DEFERRED** — requires Rubber Band native library integration (delivered in Sprint 6 via `Koffi`)
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
- [ ] ~~Formant: shift independently of pitch, click Apply — audible character change, NOT chipmunk~~ **DEFERRED to Sprint 6** — formant slider disabled with explanation text in UI; re-enabled via `Koffi` Rubber Band library integration
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
- ~~As a user, I can control formant shift independently of pitch via the Rubber Band C++ library API (`setFormantScale()`) so that my voice sounds like a different body size without robotic artifacts~~ **MOVED to Sprint 6** — delivered via `Koffi` wrapping the Rubber Band shared library (`.dll`)
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
- [ ] ~~Formant (re-enabled): shift independently of pitch via native Rubber Band API — audible character change, NOT chipmunk, no robotic artifacts~~ **MOVED to Sprint 6**
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
- As a user, I can toggle between two presets in A/B mode so that I can switch between two versions of a character
- As a user, preset-related controls (save, load, A/B, emotion sub-presets) have tooltips from `tooltips.ts` so that the workflow is self-documenting
- As a developer, all preset save, load, and delete operations are logged at info level with the preset name

**Acceptance Criteria:**
- Presets persist in `presets.json` across app restarts
- Portrait images are stored as relative paths in `presets.json`, files managed in `userData/portraits/`
- On preset delete, associated portrait file is deleted in the same IPC operation
- A/B toggle instantly switches Stage 2 effects between two loaded presets; Stage 1 params update visually but require Apply
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
- [ ] A/B toggle two presets — instant toggle of Stage 2 effects, Stage 1 requires Apply
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
- As a user, I can control formant shift independently of pitch so that my voice sounds like a different body size without robotic artifacts — **RE-ENABLEMENT from Sprint 2** (uses `Koffi` to call Rubber Band shared library `.dll` with `setFormantScale()` for single-pass processing; no native addon build toolchain required, `.dll` bundled like FFmpeg)
- As a developer, the Rubber Band `.dll` is bundled via the existing `scripts/copy-binaries.ts` and `extraResources` pattern so that no C++ build tools are needed to develop locally

**Acceptance Criteria:**
- Export produces a valid WAV file at the specified bit depth and sample rate
- Normalized exports are within -1dBFS
- Noise gate audibly removes background noise from test recordings
- Silence padding is accurate to within 5ms
- Export failure is caught, logged at error level, and shown to user
- Formant slider re-enabled in UI with full range control (semitones)
- Formant shifting uses single-pass Rubber Band library API via `Koffi` — no two-pass CLI workaround, no robotic artifacts
- Rubber Band `.dll` bundled in `src/assets/rubberband/` and copied via `scripts/copy-binaries.ts`
- `pnpm install` on a fresh clone resolves all dependencies including the `.dll` — no C++ build tools required

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
- [ ] Formant: shift independently of pitch, click Apply — audible character change, NOT chipmunk, no robotic artifacts
- [ ] Formant: set to +4 semitones — voice sounds smaller/thinner (child/fairy)
- [ ] Formant: set to -4 semitones — voice sounds larger/deeper (ogre/giant)
- [ ] Formant + Pitch combined: shift pitch up +6, formant down -3 — pitch changes but body size stays large
- [ ] Formant slider tooltip present and sourced from `tooltips.ts`
- [ ] Rubber Band `.dll` present in `src/assets/rubberband/` after `pnpm install`
- [ ] Fresh clone: `pnpm install && pnpm dev` — formant works without C++ build tools
- [ ] Negative: delete `.dll`, launch app — graceful error logged, formant disabled with message, other features still work

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
- [x] Select mic input device from dropdown — correct device used
- [x] Monitor mic through effects chain — hear processed voice in real time
- [x] Verify monitoring latency is acceptable (< 30ms perceived)
- [x] Record a take — captured audio plays back with effects applied
- [x] Record multiple takes — all preserved in take list
- [x] Audition each take — correct audio plays for each
- [x] Delete a take — removed from list
- [x] Use count-in (1-4 beats) — recording starts after count
- [x] Punch-in on a specific section — only punched region re-recorded, clean splice
- [x] Keyboard shortcut for record/stop/punch-in — functional and displayed in UI
- [x] Adjust effects during recording — changes apply in real time
- [x] Playback at reduced speed — tempo changes without pitch change
- [x] Audio sanity: bypass toggle during mic monitoring — clean A/B
- [x] Audio sanity: switch from file input to mic input — no engine crash
- [ ] Negative: deny microphone permission — clear message, app remains functional for file input *(error handling in place, needs manual QA)*
- [ ] Negative: disconnect mic during recording — recording stops gracefully, partial take preserved *(no track-ended handler yet — known limitation, non-blocking)*
- [ ] Negative: select non-existent device ID — error message, falls back to default mic *(error handling in place, needs manual QA)*
- ~~Noise suppression toggle~~ — **deferred to Sprint 7.2** (Electron ignores getUserMedia noiseSuppression constraint; RNNoise WASM planned)

**Definition of Done:**
- All acceptance criteria met
- QA checklist passed and results recorded in `testResults/`
- `package.json` version set to `0.7.0`
- Audio sanity checklist from `testStrategy.md` passed
- All Sprint 0-6 regression items re-verified

---

### Sprint 7.1 - Phase 1+2 Refactor

**Goal:** Harden the codebase before v1.0. Fix security vulnerabilities, eliminate dead code, resolve correctness bugs, improve accessibility, and clean up architectural debt accumulated across Sprints 0-7. Changes are scoped to avoid conflicts with Sprint 7.2 (RNNoise AudioWorklet) and Sprint 8 (error messaging UI, settings panel, packaging).

**Background:**
A senior-level code review of the full codebase identified 27 actionable items across security, correctness, dead code, architecture, and accessibility. One item (waveform load error display) is deferred to Sprint 8 where user-facing error messaging is delivered holistically.

---

#### Security (S1-S8)

These are must-fix items before v1.0 ships.

**S1 — CRITICAL — Path traversal in portrait protocol handler**
- **File:** `src/main/index.ts` lines 175-184
- **Problem:** The custom `portrait://` protocol handler builds a file path from `url.hostname + url.pathname` without sanitization. A malicious `portraitPath` stored in `presets.json` (e.g. `../../etc/hosts` or `../../Windows/System32/config/SAM`) could serve any file on the system.
- **Current code:**
  ```typescript
  const filename = url.hostname + url.pathname
  const filePath = path.join(portraitsDir, filename)
  return net.fetch(`file://${filePath}`)
  ```
- **Fix:** Strip path components using `path.basename()`, then verify the resolved path stays within `portraitsDir`:
  ```typescript
  const safeFilename = path.basename(url.hostname + url.pathname)
  const filePath = path.resolve(portraitsDir, safeFilename)
  // Verify the resolved path is actually inside portraitsDir
  if (!filePath.startsWith(path.resolve(portraitsDir))) {
    logger.error(`Portrait protocol: path escape attempt blocked: ${request.url}`)
    return new Response('Forbidden', { status: 403 })
  }
  return net.fetch(`file://${filePath}`)
  ```
- **Test:** Request `portrait://../../etc/hosts` → should return 403, not file contents.

**S2 — CRITICAL — Path traversal in deletePreset portrait deletion**
- **File:** `src/main/fileSystem/presets.ts` lines 194-205
- **Problem:** `deletePreset` joins `getProjectRoot()` with `preset.portraitPath` and calls `fs.unlinkSync()`. If presets.json is hand-edited or corrupted to contain `portraitPath: "../../important-file.txt"`, it deletes that file.
- **Current code:**
  ```typescript
  const fullPortraitPath = path.join(getProjectRoot(), preset.portraitPath)
  fs.unlinkSync(fullPortraitPath)
  ```
- **Fix:** Resolve both paths and verify containment:
  ```typescript
  const fullPortraitPath = path.resolve(getProjectRoot(), preset.portraitPath)
  const portraitsDir = path.resolve(getPortraitsDir())
  if (!fullPortraitPath.startsWith(portraitsDir)) {
    logger.error(`Portrait path escape attempt blocked: ${preset.portraitPath}`)
    return  // Do NOT delete — path is outside portraits dir
  }
  fs.unlinkSync(fullPortraitPath)
  ```
- **Test:** Edit `presets.json` to set `portraitPath: "../../outside.txt"`, create that file, delete the preset → file must NOT be deleted, error logged.

**S3 — CRITICAL — No input validation on preset IPC handlers**
- **File:** `src/main/ipc/index.ts` lines 98-135
- **Problem:** PRESET_SAVE, PRESET_DELETE, and PRESET_SAVE_PORTRAIT handlers do not validate their arguments. Null, undefined, or malformed objects pass through unchecked.
- **Fix:** Add validation at the top of each handler:
  ```typescript
  // PRESET_SAVE
  if (!preset || typeof preset !== 'object' || !preset.id || !preset.name) {
    throw new Error('Invalid preset: must have id and name')
  }
  // PRESET_DELETE
  if (!presetId || typeof presetId !== 'string') {
    throw new Error('Invalid presetId: must be a non-empty string')
  }
  // PRESET_SAVE_PORTRAIT
  if (!args || !args.sourcePath || !args.presetId) {
    throw new Error('Invalid portrait args: must have sourcePath and presetId')
  }
  ```
- **Test:** Call each IPC channel with null/undefined/empty → should throw, not crash.

**S4 — CRITICAL — No validation of export output path**
- **File:** `src/main/ffmpeg/exportWav.ts` lines 178-246
- **Problem:** `exportWav` writes to `request.outputPath` without checking if it's within an allowed directory. Could write to system directories.
- **Fix:** Validate output path resolves to user home, documents, or desktop:
  ```typescript
  import { app } from 'electron'
  const outputPath = path.resolve(request.outputPath)
  const allowedRoots = [
    path.resolve(app.getPath('home')),
    path.resolve(app.getPath('documents')),
    path.resolve(app.getPath('desktop')),
    path.resolve(app.getPath('downloads')),
  ]
  if (!allowedRoots.some(root => outputPath.startsWith(root))) {
    return { success: false, error: 'Output path must be within your home directory', outputPath: '' }
  }
  ```
- **Note:** The save dialog already constrains path selection, but this is defense-in-depth against a compromised renderer.
- **Test:** Manually invoke EXPORT_WAV IPC with `outputPath: 'C:\\Windows\\System32\\test.wav'` → rejected with error.

**S5 — HIGH — No validation of AudioProcessRequest**
- **File:** `src/main/ipc/index.ts` lines 187-202 (AUDIO_PROCESS handler)
- **Problem:** The handler passes the request directly to `processAudio()` without validating sampleRate, channels, or audioData. Invalid values could crash the Rubber Band binary or hang the main process.
- **Fix:** Add range checks before calling `processAudio`:
  ```typescript
  if (!request.audioData || request.audioData.byteLength === 0) {
    return { success: false, error: 'No audio data provided' }
  }
  if (request.sampleRate < 8000 || request.sampleRate > 192000) {
    return { success: false, error: `Invalid sample rate: ${request.sampleRate}` }
  }
  if (request.channels < 1 || request.channels > 2) {
    return { success: false, error: `Invalid channel count: ${request.channels}` }
  }
  ```
- **Test:** Call AUDIO_PROCESS with `sampleRate: 0` → returns error, does not spawn Rubber Band.

**S6 — HIGH — Portrait extension not whitelisted**
- **File:** `src/main/fileSystem/presets.ts` lines 223-246 (`savePortrait`)
- **Problem:** `path.extname(sourcePath)` is accepted without checking if it's an image extension. A user could accidentally select a `.exe` or `.dll` file as a portrait and it would be copied and served.
- **Fix:** Whitelist allowed extensions:
  ```typescript
  const ALLOWED_IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']
  const ext = path.extname(sourcePath).toLowerCase() || '.png'
  if (!ALLOWED_IMAGE_EXTS.includes(ext)) {
    logger.warn(`Rejected portrait with invalid extension: ${ext}`)
    return null
  }
  ```
- **Test:** Attempt to save a portrait from a `.exe` file → returns null, warning logged.

**S7 — MEDIUM — TAKE_SAVE has no file size limit**
- **File:** `src/main/ipc/index.ts` — TAKE_SAVE handler (around lines 283-302)
- **Problem:** Writes `request.audioData` to disk with no size limit. A corrupted or malicious renderer could exhaust disk space.
- **Fix:** Check size before writing:
  ```typescript
  const MAX_TAKE_SIZE_BYTES = 500 * 1024 * 1024  // 500 MB
  if (request.audioData.byteLength > MAX_TAKE_SIZE_BYTES) {
    throw new Error(`Take too large: ${(request.audioData.byteLength / 1024 / 1024).toFixed(1)} MB exceeds 500 MB limit`)
  }
  ```

**S8 — MEDIUM — TAKE_LIST uses synchronous file I/O in IPC handler**
- **File:** `src/main/ipc/index.ts` — TAKE_LIST handler (around lines 343-370)
- **Problem:** `readdirSync` + `statSync` in an IPC handler blocks the main process. If `userData/takes/` has many files or the filesystem hangs, the entire app freezes.
- **Fix:** Switch to async variants (`fs.promises.readdir`, `fs.promises.stat`) and limit results to 1000 files:
  ```typescript
  const files = (await fs.promises.readdir(takesDir)).filter(...).slice(0, 1000)
  for (const filename of files) {
    const stat = await fs.promises.stat(filePath)
    // ...
  }
  ```

---

#### Bugs / Correctness (B1-B5)

**B1 — CRITICAL — Missing `await` on `ctx.resume()`**
- **File:** `src/renderer/engine/AudioEngine.ts` line 305
- **Problem:** The `play()` method calls `this.ctx.resume()` without `await`. Every other `resume()` call in the file (lines 216, 234, 700) correctly uses `await`. This creates an unhandled promise rejection if the context is suspended when `play()` is called.
- **Current code:**
  ```typescript
  if (this.ctx.state === 'suspended') {
    this.ctx.resume()  // ← Missing await
  }
  ```
- **Fix:** Make `play()` async and await the resume:
  ```typescript
  async play(onEnd?: () => void): Promise<void> {
    // ...
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume()
    }
  ```
- **Ripple effect:** Callers of `play()` (in `useAudioEngine` hook) need to handle the returned promise. The `play` callback in `useAudioEngine` should `await engine.play(...)` or use `.catch()`.
- **Test:** Call `play()` after creating AudioContext (suspended by autoplay policy) → no unhandled promise rejection in console.

**B2 — MEDIUM — Stale closure in `startCountIn`**
- **File:** `src/renderer/hooks/useRecording.ts` lines 169-191
- **Problem:** `startCountIn` uses `useCallback(fn, [])` (empty deps), but the inner `tick()` function calls `startRecordingImmediate()` which is defined later (line 199) via `useCallback`. The eslint-disable comment on line 190 suppresses the missing-dependency warning. Because the dep array is empty, `startCountIn` captures the *initial* reference to `startRecordingImmediate`. If `startRecordingImmediate` is ever recreated (its deps change), `startCountIn` calls the stale version.
- **Why it works today:** `startRecordingImmediate` depends on `[getEngine]` which is stable (singleton pattern). So the stale closure doesn't fire... yet.
- **Fix:** Either add `startRecordingImmediate` to the dependency array, or use `useRef` to hold a stable reference:
  ```typescript
  const startRecordingRef = useRef(startRecordingImmediate)
  useEffect(() => { startRecordingRef.current = startRecordingImmediate }, [startRecordingImmediate])
  // In startCountIn:
  void startRecordingRef.current()
  ```
- **Test:** Count-in → recording starts → rapidly stop and re-count-in → second recording works correctly.

**B3 — MEDIUM — Race condition in punchIn**
- **File:** `src/renderer/hooks/useRecording.ts` lines 370-438
- **Problem:** `punchIn` uses a `setTimeout` to auto-stop after the punch region duration (line 392-436). If the user triggers punchIn again before the first timeout fires, both timeouts will fire and both will try to `stopRecording()` and `splicePunchIn()` independently, potentially double-splicing or corrupting the take buffer.
- **Fix:** Track the punch-in timeout in a ref and cancel it on re-entry:
  ```typescript
  const punchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const punchIn = useCallback(async (region: PunchInRegion) => {
    // Cancel any in-flight punch
    if (punchTimeoutRef.current) {
      clearTimeout(punchTimeoutRef.current)
      punchTimeoutRef.current = null
      engine.stopRecording()  // Discard the aborted punch audio
      store.getState().setRecordingState('idle')
    }
    // ... rest of punchIn logic ...
    punchTimeoutRef.current = setTimeout(() => {
      punchTimeoutRef.current = null
      // ... splice and cleanup ...
    }, punchDurationMs)
  }, [getEngine, loadFile])
  ```
- **Also:** Clean up `punchTimeoutRef` in the useEffect cleanup function (line 442+).
- **Test:** Mark a region, press P, immediately press P again → no double-splice, no crash, first punch discarded.

**B4 — MEDIUM — Missing try/catch in auditionTake**
- **File:** `src/renderer/hooks/useRecording.ts` line 343
- **Problem:** `audioBufferToWav(buffer)` can throw if the buffer is invalid (e.g. zero-length or missing channel data). The call is not wrapped in try/catch.
- **Fix:** Wrap the audition path:
  ```typescript
  try {
    const wavBytes = audioBufferToWav(buffer)
    await loadFile(wavBytes)
  } catch (err) {
    console.error('Failed to audition take:', err)
    store.getState().setMicError('Failed to load take for audition')
    return
  }
  ```
- **Test:** Corrupt a take buffer (zero-length), try to audition → error shown, no crash.

**B5 — LOW — Unvalidated cast from worklet message**
- **File:** `src/renderer/engine/AudioEngine.ts` line 726
- **Problem:** `event.data.data as Float32Array` is a trust-based cast. If the worklet processor sends malformed data, this passes silently and could corrupt the recording buffer.
- **Current code:**
  ```typescript
  this.recordingBuffer.addChunk(event.data.data as Float32Array)
  ```
- **Fix:** Add runtime check:
  ```typescript
  const chunk = event.data.data
  if (chunk instanceof Float32Array) {
    this.recordingBuffer.addChunk(chunk)
  }
  ```

---

#### Dead Code / Cleanup (D1-D5)

**D1 — SpikeTestUI.tsx still in codebase**
- **File:** `src/renderer/components/SpikeTestUI.tsx`
- **Problem:** Entire file is the Sprint 1 WASM spike. Comments at the top say "SPIKE COMPLETE - will be removed in Sprint 2." It was never removed. ~200 lines of dead code.
- **Fix:** Delete the file. Remove any imports/references to it from `App.tsx` or routes.
- **Verify:** `pnpm typecheck` passes after deletion — no other file imports SpikeTestUI.

**D2 — Unused `labelStyle` in ExportPanel**
- **File:** `src/renderer/components/panels/ExportPanel.tsx` around lines 273-278
- **Problem:** `labelStyle` variable is defined but never used (superseded by `labelWithHelpStyle`).
- **Fix:** Delete the variable.

**D3 — Stub DIALOG_OPEN_WAV handler**
- **File:** `src/main/ipc/index.ts` around lines 211-214
- **Problem:** Handler for `IPC.DIALOG_OPEN_WAV` is a stub that returns null. It was likely intended for a "File > Open" menu item. Either implement it for Sprint 8 or add a clear comment marking it as Sprint 8 work.
- **Fix:** Add comment: `// TODO Sprint 8: Implement File > Open dialog — currently files are loaded via drag-and-drop only`

**D4 — Outdated ScriptProcessorNode reference in MicInput docs**
- **File:** `src/renderer/engine/MicInput.ts` lines 34-37
- **Problem:** Module-level JSDoc still says "Recording uses a ScriptProcessorNode" but the actual implementation uses `AudioWorkletNode` with `recorder-processor.js`.
- **Fix:** Update the comment to reference `AudioWorkletNode` and the persistent parallel tap architecture (see AudioEngine.ts lines 715-737).

**D5 — Unused sessionStore stub**
- **File:** `src/renderer/stores/sessionStore.ts`
- **Problem:** Entire store is a Sprint 0 placeholder with a single `isRecording: false` field. No component or hook imports it.
- **Fix:** Add a comment header marking it as Sprint 8 placeholder for session recovery state, OR delete it if Sprint 8 won't use it. Check if any file imports from this store first.

---

#### Architecture / Code Quality (A1-A8)

**A1 — Extract PresetItem from PresetPanel**
- **File:** `src/renderer/components/panels/PresetPanel.tsx` lines 282-612
- **Problem:** `renderPresetItem` is a 330-line inline function inside the component. It handles edit mode, portrait display, emotion sub-presets, notes, and action buttons all inline. This makes PresetPanel ~1000 lines and difficult to maintain.
- **Fix:** Extract `renderPresetItem` into a new `<PresetItem />` component in `src/renderer/components/panels/PresetItem.tsx`. Wrap it in `React.memo` with a comparison function that checks `preset.id`, `preset.updatedAt`, `isActive`, and `isEditing`. Pass callback props for actions (edit, delete, portrait, etc.).
- **License header required** on the new file per CLAUDE.md.
- **Test:** Open preset panel with presets → renders correctly, all actions (edit, delete, portrait, A/B, expand/collapse) still work.

**A2 — Standardize IPC error handling pattern**
- **File:** `src/main/ipc/index.ts` — all handlers
- **Problem:** Inconsistent patterns:
  - PRESET_SAVE: catches and re-throws ✓
  - PRESET_DELETE: catches and re-throws ✓
  - PRESET_SAVE_PORTRAIT: catches and returns `null` ✗ (error is swallowed — renderer can't distinguish "no portrait" from "save failed")
  - EXPORT_WAV: catches and re-throws ✓
  - Some handlers have `try/catch`, some don't
- **Fix:** Standardize all handlers to: (1) validate inputs, (2) try the operation, (3) on error: log and re-throw. Never return null on error. Renderer callers should catch the thrown error and display it (Sprint 8 adds the display layer).
- **Specific fix for PRESET_SAVE_PORTRAIT (line 133):**
  ```typescript
  // BEFORE: return null  (swallows error)
  // AFTER:  throw new Error(errorMsg)  (propagates to renderer)
  ```
- **Sprint 8 dependency:** Sprint 8 builds a consistent error toast/banner system. That system relies on IPC handlers throwing errors with message strings, not returning null. This standardization must happen first.

**A3 — Replace Set with Array in presetStore**
- **File:** `src/renderer/stores/presetStore.ts` line 128
- **Problem:** `collapsedCategories: new Set<string>()` is not JSON-serializable. If we ever persist UI state (Sprint 8 settings or future enhancement), this would need custom serialization.
- **Fix:** Change to `collapsedCategories: string[]` and update `toggleCategory` to use array add/filter instead of Set add/delete:
  ```typescript
  // State
  collapsedCategories: [] as string[],
  // Action
  toggleCategory: (cat) => {
    const current = get().collapsedCategories
    const next = current.includes(cat)
      ? current.filter(c => c !== cat)
      : [...current, cat]
    set({ collapsedCategories: next })
  }
  ```
- **Update type interface** to match: `collapsedCategories: string[]`
- **Update consumers:** Any component that calls `.has()` on the Set needs to use `.includes()` instead.

**A4 — Fix Float32Array generic**
- **File:** `src/renderer/engine/AudioEngine.ts` line 168
- **Problem:** `Float32Array<ArrayBuffer>` is a non-standard TypeScript generic annotation. It was added to avoid `ArrayBufferLike` mismatch with strict mode. This annotation is confusing and may break in future TS versions.
- **Fix:** Use a standard allocation and cast:
  ```typescript
  private analyserData: Float32Array
  // In constructor:
  this.analyserData = new Float32Array(this.analyser.fftSize)
  ```
  If TS strict mode complains about `getFloatTimeDomainData`, use:
  ```typescript
  this.analyser.getFloatTimeDomainData(this.analyserData as Float32Array)
  ```
- **Also check:** `src/renderer/engine/MicInput.ts` line 210 — same pattern may exist there.

**A5 — Document preload IPC constant duplication**
- **File:** `src/preload/index.ts` lines 42-60
- **Problem:** IPC channel names are hardcoded in the preload script, duplicated from `src/shared/constants.ts`. There's a TODO comment acknowledging this. Electron-vite's preload build may not resolve shared imports.
- **Fix:** Try importing from `../../shared/constants` in the preload. If electron-vite's preload target supports it (it may — newer versions resolve cross-target imports), use the import and delete the duplicate. If it fails, add a clear comment explaining the limitation and referencing the canonical source in `constants.ts`.

**A6 — Extract effect names constant**
- **File:** `src/renderer/components/panels/ControlPanel.tsx` around lines 793-806
- **Problem:** Effect names `['vibrato', 'tremolo', 'vocalFry', 'breathiness', 'breathiness2', 'reverb']` are hardcoded in JSX. If a new effect is added, this list must be updated manually.
- **Fix:** Define the list in `src/shared/constants.ts` as `EFFECT_NAMES` and import it. Or derive it from the `EngineSnapshot` type's effect-related keys.

**A7 — Add platform check for FFmpeg binary path**
- **File:** `src/main/ffmpeg/binaryPath.ts` around lines 39-68
- **Problem:** Binary name is hardcoded as `ffmpeg.exe`. On Linux/macOS (stretch goals per CLAUDE.md), it would be `ffmpeg` with no extension.
- **Fix:**
  ```typescript
  const ext = process.platform === 'win32' ? '.exe' : ''
  const binaryName = `ffmpeg${ext}`
  ```
- **Apply same fix** to Rubber Band CLI binary path if it has the same pattern (check `src/main/rubberband/` for `.exe` hardcoding).

**A8 — Replace inline style mutations with CSS**
- **File:** `src/renderer/App.tsx` around lines 168-205
- **Problem:** Menu items use `onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#2a2a4e')}` to apply hover styles. This bypasses React's render cycle and could leak state on unmount.
- **Fix:** Define CSS classes with `:hover` pseudo-class in the component's styles or a CSS module. Remove the `onMouseEnter`/`onMouseLeave` handlers.

---

#### Accessibility (X1-X3)

**X1 — Add ARIA attributes to interactive components**
- **Files:** All files in `src/renderer/components/`
- **Problem:** No `aria-label`, `aria-describedby`, or `role` attributes anywhere. Screen readers cannot interpret controls.
- **Fix (scope for 7.1):** Focus on the most impactful additions:
  - All `<input type="range">` sliders: add `aria-label` with the control name (from tooltips.ts label field)
  - Toggle buttons (bypass, mic mute, count-in): add `aria-pressed` boolean state
  - Panels: add `role="region"` and `aria-label` (e.g. "Control Panel", "Preset Panel")
  - Record/Stop button: add `aria-label` that changes with state ("Start recording" / "Stop recording")
- **Do NOT:** Add ARIA to the noise suppression toggle (Sprint 7.2 re-adds this UI element).

**X2 — Convert clickable spans to buttons in PresetPanel**
- **File:** `src/renderer/components/panels/PresetPanel.tsx`
- **Problem:** Several interactive elements are `<span onClick={...}>` — these are not keyboard-focusable and invisible to screen readers.
- **Fix:** Replace with `<button>` elements styled to match (reset button styles: `border: none, background: none, cursor: pointer`). If extracted to `<PresetItem />` (A1), do this as part of the extraction.

**X3 — Make HelpTooltip accessible**
- **File:** `src/renderer/components/controls/HelpTooltip.tsx` lines 101-114
- **Problem:** The "?" circle is a `<span>` with mouse handlers. Not keyboard-focusable.
- **Fix:** Change to `<button type="button" aria-label="Help" role="button">` with the same styling. Add `onKeyDown` handler for Enter/Space to toggle the tooltip.

---

**Excluded from 7.1 (conflict with future sprints):**

| Item | Reason | Deferred To |
|------|--------|-------------|
| AudioEngine mic signal chain restructuring | Sprint 7.2 inserts RNNoise node between volumeGain and effects chain | 7.2 |
| RecordingPanel noise suppression toggle UI | Sprint 7.2 re-adds the toggle button at lines 79-80 | 7.2 |
| Waveform load error display to user (B6) | Sprint 8 standardizes all user-facing error messaging with toast/banner component | 8 |
| electron-builder config changes | Sprint 8 finalizes NSIS packaging config | 8 |
| Settings merge logic in main process | Sprint 8 owns the settings UI and merge behavior | 8 |

---

**User Stories:**
- As a developer, all IPC handlers validate inputs so that a compromised renderer cannot perform path traversal, write to arbitrary paths, or crash the main process
- As a developer, portrait file operations are sandboxed to the portraits directory so that malicious preset data cannot delete or serve files outside the expected scope
- As a developer, dead code from completed spikes and unused stubs is removed so that the codebase is clean and navigable
- As a developer, React hook dependency arrays are correct so that stale closures and race conditions do not cause intermittent bugs
- As a developer, IPC error handling follows a consistent pattern (throw on failure) so that Sprint 8 can layer user-facing messages on top without guessing the error shape
- As a user, interactive UI elements are semantically correct (`<button>` not `<span>`) and have ARIA labels so that the app is navigable by keyboard and screen reader

**Acceptance Criteria:**
- All CRITICAL and HIGH security items (S1-S6) resolved
- All CRITICAL correctness bugs (B1) resolved
- No dead code from completed spikes remains in the codebase
- IPC handlers follow consistent error pattern (throw on invalid input)
- `pnpm typecheck` passes
- No new `error` or `warn` entries in session log during QA run
- Existing Sprint 0-7 QA regression items still pass (no behavioral changes)

**QA Checklist:**
- [ ] S1: Portrait protocol handler — request `portrait://../../etc/hosts` — returns error, does not serve file
- [ ] S2: Manually edit `presets.json` with `portraitPath: "../../outside.txt"`, delete preset — file outside portraits dir is NOT deleted
- [ ] S3: IPC PRESET_SAVE with null/undefined — returns error, does not crash
- [ ] S4: Export with path outside user home — rejected with error
- [ ] S5: AUDIO_PROCESS with sampleRate=0 — rejected with error, no crash
- [ ] S6: Save portrait with `.exe` source — rejected or extension normalized
- [ ] B1: Play audio when context is suspended — no unhandled promise rejection in console
- [ ] B2: Count-in followed by rapid re-record — no stale callback behavior
- [ ] B3: Trigger punch-in twice rapidly — first punch cancelled cleanly, no double-splice
- [ ] B4: Audition a corrupted take buffer — error caught, no crash
- [ ] D1: `SpikeTestUI.tsx` no longer in the codebase
- [ ] A1: PresetPanel renders correctly after PresetItem extraction
- [ ] A2: IPC error from invalid preset save — error propagates to renderer (not swallowed as null)
- [ ] X1: Tab through all controls — every interactive element is focusable and labelled
- [ ] Regression: Full Sprint 0-7 QA checklist passes — no behavioral changes

**Definition of Done:**
- All acceptance criteria met
- QA checklist passed and results recorded in `testResults/`
- `package.json` version set to `0.7.1`
- All Sprint 0-7 regression items re-verified
- No new features — refactor and hardening only

---

### Sprint 7.2 - Real-Time Noise Suppression (RNNoise WASM)

**Goal:** Add real-time AI-based noise suppression to the microphone signal chain using RNNoise compiled to WebAssembly, running as an AudioWorklet processor. This replaces the non-functional WebRTC `getUserMedia` noiseSuppression constraint (which Electron/Chromium ignores).

**Background:**
Sprint 7 attempted noise suppression via the `getUserMedia({ audio: { noiseSuppression: true } })` constraint. Testing confirmed Electron silently ignores this — `track.getSettings()` always reports `noiseSuppression: false` regardless of the requested value. The WebRTC noise suppressor is not available in Electron's Chromium build.

RNNoise is a neural-network-based noise suppression library developed by Mozilla/Xiph.org. It is used by Discord, OBS Studio, and other voice applications. It processes audio frame-by-frame, distinguishing speech from noise using a recurrent neural network. The model is small (~85KB) and runs in real time on any modern CPU.

---

#### Step 1: Source and Bundle the RNNoise WASM Binary

**Goal:** Get the RNNoise WASM binary into `src/assets/rnnoise/` so it's bundled with the app.

**Where to look (in priority order):**
1. **npm search:** `rnnoise-wasm`, `@nicktomlin/rnnoise-wasm`, `rnnoise`, `@pkvie/rnnoise` — look for packages that ship a `.wasm` file
2. **GitHub:** Search for "rnnoise wasm" — several community WASM builds exist
3. **Compile from source:** Clone the RNNoise C source from Xiph.org/Mozilla, compile with Emscripten to produce `.wasm` + `.js` glue

**Critical requirement:** The WASM binary must be loadable **inside an AudioWorklet scope** (not just the main thread). AudioWorklet scope has no `document`, no `fetch`, and limited globals. The glue JS must use `WebAssembly.instantiate()` with an ArrayBuffer, not fetch-based loading. Many npm WASM packages assume main-thread loading — test in the worklet scope before committing to a package.

**Testing WASM in worklet scope:** Create a minimal test: register a worklet processor that tries to instantiate the WASM binary. If it throws, the package's loader is incompatible and needs patching or a different source.

**File structure after this step:**
```
src/assets/rnnoise/
  rnnoise.wasm          # The compiled WASM binary (~85-100KB)
  rnnoise-glue.js       # Optional JS glue for instantiation (may not be needed)
```

**Update `scripts/copy-binaries.ts`** to copy `src/assets/rnnoise/` to `src/renderer/public/rnnoise/` during build, same as how FFmpeg binaries are copied. This makes the WASM accessible to the renderer at runtime.

**Update `electron-builder.config.js`** to include `rnnoise/` in `extraResources` if needed for production builds (same pattern as FFmpeg).

---

#### Step 2: Create the RNNoise AudioWorklet Processor

**New file:** `src/renderer/public/rnnoise-processor.js`

This is the worklet processor that runs in the audio rendering thread. It must handle:

**Frame size mismatch (critical):**
- Web Audio AudioWorklet delivers audio in **128-sample render quanta** (the `inputs` array in `process()`)
- RNNoise requires exactly **480-sample frames** (10ms at 48kHz)
- The processor must maintain an internal ring buffer:
  - Accumulate 128-sample blocks until 480 samples are collected
  - Process the 480-sample frame through RNNoise
  - Output the processed 480 samples back in 128-sample chunks
  - This requires a double-buffer: input accumulator + output queue

**Sample rate handling:**
- RNNoise is trained on 48kHz audio. It MUST receive 48kHz input.
- If `AudioContext.sampleRate` is 44100Hz (common on Windows), the processor must:
  1. Resample input from 44100 → 48000 before processing
  2. Resample output from 48000 → 44100 after processing
  3. Use linear interpolation for resampling (simple and sufficient for voice)
- If `AudioContext.sampleRate` is already 48000, skip resampling.
- Read `sampleRate` from `AudioWorkletGlobalScope.sampleRate` in the constructor.

**Message port protocol:**
```javascript
// Main thread → Processor
{ type: 'enable' }         // Turn on noise suppression
{ type: 'disable' }        // Turn off (passthrough)
{ type: 'load-wasm', wasm: ArrayBuffer }  // Send WASM binary for instantiation

// Processor → Main thread
{ type: 'ready' }          // WASM loaded and ready
{ type: 'error', message: string }  // WASM load failed
{ type: 'vad', probability: number }  // Voice Activity Detection (0.0-1.0), sent every ~100ms
```

**Bypass mode:** When disabled, `process()` copies input directly to output with zero processing overhead. No WASM calls. This is the default state until `enable` message is received.

**WASM loading sequence:**
1. Main thread reads the `.wasm` file as ArrayBuffer (via fetch or import)
2. Main thread sends `{ type: 'load-wasm', wasm: arrayBuffer }` to processor via port
3. Processor calls `WebAssembly.instantiate(wasm, imports)` inside the worklet scope
4. Processor sends `{ type: 'ready' }` back, or `{ type: 'error' }` on failure
5. Processor is in bypass mode until both WASM is loaded AND `enable` message is received

**Processor skeleton:**
```javascript
class RNNoiseProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this._enabled = false
    this._wasmReady = false
    this._rnnoiseState = null       // Pointer to RNNoise state in WASM memory
    this._inputBuffer = new Float32Array(480)
    this._outputBuffer = new Float32Array(480)
    this._inputOffset = 0           // How many samples accumulated so far
    this._outputQueue = []          // Processed 480-sample frames waiting to be drained
    this._outputReadOffset = 0      // Read position in current output frame
    this.port.onmessage = (e) => this._handleMessage(e.data)
  }

  _handleMessage(msg) {
    if (msg.type === 'load-wasm') { /* instantiate WASM, create RNNoise state */ }
    if (msg.type === 'enable')  { this._enabled = true }
    if (msg.type === 'disable') { this._enabled = false }
  }

  process(inputs, outputs) {
    const input = inputs[0][0]   // Mono channel 0
    const output = outputs[0][0]
    if (!input) return true

    if (!this._enabled || !this._wasmReady) {
      output.set(input)  // Passthrough
      return true
    }

    // Accumulate input into 480-sample buffer, process when full,
    // drain output queue into 128-sample output blocks
    // ... (frame buffering logic) ...
    return true
  }
}
registerProcessor('rnnoise-processor', RNNoiseProcessor)
```

---

#### Step 3: Integrate into AudioEngine Signal Chain

**File:** `src/renderer/engine/AudioEngine.ts` — modify `startMicInput()`

**Current mic signal chain (from Sprint 7):**
```
mic → MediaStreamSource → volumeGain → effects chain input → ... → speakers
                              └── recorderNode (parallel tap) → keepAlive → destination
```

**New signal chain with RNNoise:**
```
mic → MediaStreamSource → volumeGain ──┬── recorderNode (parallel tap, RAW audio)
                                        │         └── keepAlive → destination
                                        └── [RNNoise AudioWorklet] → effects chain input → ... → speakers
```

**Key design decision:** The recorder tap branches off BEFORE the RNNoise node, from `volumeGain`. This captures raw (un-denoised) audio, so the user can re-process with different settings later. The RNNoise node only affects the monitoring path (what the user hears through speakers) and does NOT affect recorded audio.

**Implementation in `startMicInput()`:**

1. After creating `this.micSourceNode` and connecting to `this.volumeGain` (existing code, ~line 708):
2. Register the RNNoise worklet module: `await this.ctx.audioWorklet.addModule('/rnnoise-processor.js')`
3. Create the RNNoise node: `this.rnnoiseNode = new AudioWorkletNode(this.ctx, 'rnnoise-processor', { ... })`
4. Load WASM: Fetch the `.wasm` file, send ArrayBuffer to processor via port
5. Wait for `{ type: 'ready' }` response
6. Rewire the chain:
   ```typescript
   // Before (Sprint 7):
   // this.micSourceNode.connect(this.volumeGain)
   // this.volumeGain.connect(this.effects.input)  ← this needs to change

   // After (Sprint 7.2):
   this.micSourceNode.connect(this.volumeGain)
   this.volumeGain.connect(this.rnnoiseNode)      // volumeGain → RNNoise
   this.rnnoiseNode.connect(this.effects.input)    // RNNoise → effects chain
   // Recorder tap stays on volumeGain (raw audio):
   this.volumeGain.connect(this.recorderNode)      // (unchanged from Sprint 7)
   ```
7. Send initial enable/disable based on `engineStore.noiseSuppression` state

**New private fields on AudioEngine:**
```typescript
private rnnoiseNode: AudioWorkletNode | null = null
```

**Cleanup in `stopMicInput()`:** Disconnect and null out `this.rnnoiseNode` alongside existing mic cleanup.

**Store binding:** In the hook that calls `startMicInput` (likely `useRecording.ts`), watch `noiseSuppression` store state and send enable/disable messages to the worklet when it changes:
```typescript
useEffect(() => {
  if (engine.rnnoiseNode) {
    engine.rnnoiseNode.port.postMessage({
      type: noiseSuppression ? 'enable' : 'disable'
    })
  }
}, [noiseSuppression])
```

---

#### Step 4: Re-add UI Toggle to RecordingPanel

**File:** `src/renderer/components/panels/RecordingPanel.tsx` — lines 79-80 (comment placeholder)

**Replace the placeholder comment with:**
```tsx
const noiseSuppression = useEngineStore((s) => s.noiseSuppression)
const setNoiseSuppression = useEngineStore((s) => s.setNoiseSuppression)
```

**Add toggle button** in the mic controls section (near the monitor mute toggle):
```tsx
<button
  onClick={() => setNoiseSuppression(!noiseSuppression)}
  aria-pressed={noiseSuppression}
  aria-label={tooltips.noiseSuppression.label}
  title={tooltips.noiseSuppression.short}
>
  {noiseSuppression ? '🔇 Noise Suppression On' : '🔊 Noise Suppression Off'}
</button>
```

**Tooltip** already exists in `src/shared/tooltips.ts` — the `noiseSuppression` entry was updated in Sprint 7 with RNNoise-specific copy and `poweredBy: 'RNNoise WASM (AudioWorklet)'`.

**Store state** already exists in `src/renderer/stores/engineStore.ts`:
- `noiseSuppression: boolean` (default: `true`) — line ~251
- `setNoiseSuppression: (enabled: boolean) => void` — line ~320

---

#### Step 5: Error Handling and Graceful Degradation

**If WASM fails to load (file missing, CSP blocks it, instantiation error):**
1. Processor sends `{ type: 'error', message: '...' }` via port
2. AudioEngine logs error at `error` level
3. RNNoise node stays in bypass mode (passthrough) — monitoring works, just without denoising
4. UI toggle is disabled with a tooltip explaining "Noise suppression unavailable — WASM failed to load"
5. Store state `noiseSuppression` is set to `false`

**If sample rate is unusual (not 44100 or 48000):**
- The processor should still work via the resampling path, but log a warning
- Test with 96000Hz if possible (some pro audio interfaces run at this rate)

---

**What's Already In Place (from Sprint 7):**

| Item | File | Lines | Status |
|------|------|-------|--------|
| Store state: `noiseSuppression: boolean` | `engineStore.ts` | ~119, ~251 | Ready — default `true` |
| Store action: `setNoiseSuppression()` | `engineStore.ts` | ~195, ~320 | Ready |
| Tooltip: `noiseSuppression` entry | `tooltips.ts` | ~384-394 | Ready — updated for RNNoise |
| UI placeholder comment | `RecordingPanel.tsx` | 79-80 | Comment marking where toggle goes |
| MicStreamOptions comment | `MicInput.ts` | 72-78 | Comment explaining Sprint 7.2 plan |
| Architecture doc: noise suppression plan | `architecture.md` | Mic Input section | Documented |
| CLAUDE.md key decision | `CLAUDE.md` | Key Decisions Log | "RNNoise WASM (Sprint 7.2)" entry |
| getUserMedia constraint set to `false` | `MicInput.ts` | ~104 | Hardcoded false (not relying on WebRTC) |

---

**User Stories:**
- As a user, I can toggle noise suppression on/off during mic monitoring so that background noise (fan, AC, keyboard, room tone) is removed from my voice signal in real time
- As a user, noise suppression processes audio with minimal added latency (~10ms) so that monitoring feels responsive
- As a user, my recorded takes capture raw (pre-noise-suppression) audio so that I can re-process with different settings later
- As a developer, the RNNoise WASM binary is bundled locally so that `pnpm install && pnpm dev` works on a fresh clone with no external downloads
- As a developer, the RNNoise AudioWorklet reports VAD probability so that future features (auto-silence-trim, recording auto-stop) can use it
- As a developer, if RNNoise WASM fails to load, the app degrades gracefully to passthrough mode with the toggle disabled, and an error is logged

**Acceptance Criteria:**
- Noise suppression audibly removes background noise (fan, AC, room tone) from mic signal
- Toggle on/off works in real time without restarting the mic
- Added latency from noise suppression is imperceptible (< 15ms)
- Recorded takes contain raw audio (not noise-suppressed) for re-processing
- RNNoise WASM loads without CSP violations in Electron
- Fresh clone: `pnpm install && pnpm dev` — noise suppression works without manual setup
- VAD probability is available via message port (logged to console for verification)
- WASM load failure: passthrough mode, toggle disabled, error logged

**QA Checklist:**
- [ ] Toggle noise suppression ON — background noise (fan/AC) audibly reduced during monitoring
- [ ] Toggle noise suppression OFF — background noise returns to normal level
- [ ] Toggle while monitoring — no audio dropout or click during switch
- [ ] Record a take with noise suppression ON — playback of the take has raw audio (noise present), confirming dry recording
- [ ] Enable noise suppression, record, disable, record again — both takes contain raw audio
- [ ] Speak normally with suppression ON — voice quality is natural, not robotic or degraded
- [ ] Check monitoring latency with suppression ON — no perceptible additional delay
- [ ] Tooltip on toggle reads correctly (sourced from `tooltips.ts`)
- [ ] Console shows VAD probability updates during speech
- [ ] Fresh clone: `pnpm install && pnpm dev` — suppression toggle works
- [ ] Negative: corrupt/delete RNNoise WASM file — graceful fallback (passthrough), error logged, toggle disabled with message
- [ ] Negative: enable suppression with no mic active — no crash, toggle state preserved for next mic start

**Definition of Done:**
- All acceptance criteria met
- QA checklist passed and results recorded in `testResults/`
- `package.json` version set to `0.7.2`
- All Sprint 0-7.1 regression items re-verified

---

### Sprint 7.3

In this mini sprint, we did a few tweaks like adjust ui spacing and moved some items.


---

### Sprint 7.4 - Spectral Tilt (Voice Brightness/Darkness)

**Goal:** Add a single "Spectral Tilt" slider that tilts the entire frequency spectrum, enabling dramatic shifts in perceived speaker age, size, and character type. This is the highest-impact, lowest-effort addition for making voices sound like genuinely different people.

**Impact: High | Effort: Low**

**What it is:** Spectral tilt is a continuous gain slope applied across the entire frequency spectrum. Positive tilt boosts high frequencies relative to low, creating a brighter, thinner, younger-sounding voice. Negative tilt boosts low frequencies relative to high, creating a darker, warmer, older or larger-sounding voice. This is fundamentally different from EQ — EQ adjusts specific frequency bands, while spectral tilt reshapes the overall balance between brightness and warmth across the whole spectrum.

**Why it helps create different characters:** Real human voices differ dramatically in spectral tilt. Children and small characters have bright, harmonically rich voices (positive tilt). Large, older, or authoritative characters have darker voices with more energy in the low end (negative tilt). Combined with pitch and formant shifting, spectral tilt is the "missing dimension" that transforms "you with effects" into "a different person." Many professional voice changers use this as their primary character age/size knob.

---

#### Design Research: Spectral Tilt in Voice Acoustics

**What spectral tilt means acoustically:** Every voice has a natural energy distribution across the frequency spectrum. When you analyze a voice's frequency content, the balance between low-frequency energy and high-frequency energy forms a slope — this slope is the spectral tilt. A voice with more low-frequency energy relative to high has a "steep" or "negative" tilt (darker sound). A voice with relatively more high-frequency energy has a "shallow" or "positive" tilt (brighter sound).

**Why spectral tilt varies between people:** Spectral tilt is primarily determined by:
- **Vocal cord mass and tension** — Heavier, looser cords (adult males, larger bodies) produce more low harmonics, creating negative tilt. Lighter, tighter cords (children, smaller bodies) produce more high harmonics, creating positive tilt.
- **Subglottal pressure** — More forceful speech (shouting, commanding) flattens the tilt (more highs). Quiet, gentle speech steepens the tilt (more lows dominate).
- **Age** — Older voices lose high-frequency energy due to vocal cord stiffening, producing steeper negative tilt.

**How spectral tilt differs from EQ:** EQ adjusts specific frequency bands independently. Spectral tilt applies a continuous slope across the entire spectrum — it's a global rebalancing of the bright-to-dark axis. You can think of it as a "see-saw" centered around a mid frequency: tilt one way and lows go up while highs go down (darker), tilt the other way and highs go up while lows go down (brighter). EQ is surgical; tilt is holistic.

**Character archetypes enabled by spectral tilt:**
- **Strong negative tilt** (-8 to -10): Giant, ancient dragon, booming deity, very large creature
- **Moderate negative tilt** (-3 to -7): Warrior, king, mature authority figure, large male
- **Neutral** (0): Natural speaking voice, no age/size modification
- **Moderate positive tilt** (+3 to +7): Young woman, teenager, small creature, pixie
- **Strong positive tilt** (+8 to +10): Child, tiny fairy, insectoid creature, very small being

---

#### Implementation Approach

**Recommended implementation: Dual shelf filter pair.** Use two `BiquadFilterNode` instances:
1. A **low shelf** filter (boosts or cuts below a crossover frequency)
2. A **high shelf** filter (boosts or cuts above a crossover frequency)

The tilt parameter controls opposing gains on the two shelves:
```
// Tilt value: -10 (dark) to +10 (bright)
// Crossover point: ~1000Hz (roughly where the spectral balance pivots)
lowShelf.type = 'lowshelf'
lowShelf.frequency.value = 1000
lowShelf.gain.value = -tiltAmount  // Negative tilt → boost lows

highShelf.type = 'highshelf'
highShelf.frequency.value = 1000
highShelf.gain.value = tiltAmount   // Negative tilt → cut highs
```

When tilt is negative (darker): low shelf gain goes positive (boost lows), high shelf gain goes negative (cut highs). When tilt is positive (brighter): the opposite. When tilt is 0: both gains are 0, no effect.

**Why dual shelf filters are the right choice:**
- `BiquadFilterNode` is native Web Audio — zero dependencies, zero latency, hardware-accelerated
- The shelf filter pair is the standard technique for spectral tilt in audio engineering
- `AudioParam` automation means smooth, click-free parameter changes in real time
- The crossover frequency (1000Hz) can be hardcoded initially but made configurable later if needed
- This exact pattern (two BiquadFilterNodes with opposing gains) is used by professional voice changers

**Signal chain insertion point:** After the high-pass filter, before the EQ bands. This ensures the tilt shapes the overall spectrum before per-band EQ refinements. The high-pass has already removed sub-bass rumble, so the tilt operates on clean voice signal.

---

**User Stories:**
- As a user, I can adjust a Spectral Tilt slider so that my voice sounds fundamentally brighter or darker, enabling younger/smaller or older/larger character voices
- As a user, I can combine spectral tilt with pitch and formant shifting so that I can create characters that sound like genuinely different people, not just pitched versions of myself
- As a user, spectral tilt updates in real time so that I can hear the effect immediately while adjusting
- As a user, spectral tilt is saved as part of character presets so that each character's brightness/darkness is remembered
- As a user, spectral tilt has a wet/dry mix so that I can blend between my natural spectral balance and the tilted version
- As a user, I can use negative tilt to make my voice sound like a larger, older, or more authoritative character so that warriors, dragons, and kings sound distinct from my natural voice
- As a user, I can use positive tilt to make my voice sound like a smaller, younger, or more delicate character so that fairies, children, and sprites sound distinct from my natural voice
- As a developer, spectral tilt is implemented as a low shelf + high shelf BiquadFilterNode pair so that it uses native Web Audio with no additional dependencies
- As a developer, spectral tilt follows the existing effects chain architecture and uses AudioParam for smooth real-time parameter changes so that no clicks or pops occur during adjustment

**Acceptance Criteria:**
- Spectral Tilt slider visible in Advanced mode effects section
- Range: -10 to +10 (negative = darker, positive = brighter, 0 = neutral)
- Audible difference when moving from negative to positive tilt
- Updates in real time without audio dropout
- Saved/loaded with character presets
- Wet/dry mix available
- Tooltip explains the effect in plain language
- No impact on existing effects when tilt is at 0

**QA Checklist:**
- [ ] Set tilt to -10 — voice sounds noticeably darker/warmer
- [ ] Set tilt to +10 — voice sounds noticeably brighter/thinner
- [ ] Set tilt to 0 — no audible difference from bypass
- [ ] Combine tilt (-5) + formant shift (+0.5) — sounds like a smaller, younger character
- [ ] Combine tilt (+5) + formant shift (-0.5) — sounds like a larger, older character
- [ ] Adjust tilt while playing — no clicks, pops, or dropouts
- [ ] Save preset with tilt value, reload — tilt restored correctly
- [ ] Wet/dry at 50% — blended effect audible
- [ ] Reset Stage 2 — tilt returns to 0
- [ ] Tooltip text sourced from `tooltips.ts`

**Definition of Done:**
- All acceptance criteria met
- QA checklist passed and results recorded in `testResults/`
- `package.json` version set to `0.7.4`
- All Sprint 0-7.3 regression items re-verified

---

### Sprint 7.5 - Distortion / Saturation Types (Character Archetypes)

**Goal:** Add a distortion/saturation effect with multiple curve types, unlocking entire character archetypes that are currently impossible — gruff warriors, robots, goblins, radio transmissions, and demonic creatures.

**Impact: High for character variety | Effort: Low**

**What it is:** Different distortion curves applied to the audio signal via a WaveShaperNode. Unlike simple overdrive, this provides multiple distinct waveshaping curves that each produce a fundamentally different tonal character. The key insight is that one Web Audio node with different curve presets unlocks a wide range of character archetypes.

**Why it helps create different characters:** Many iconic character voices rely on non-linear distortion:
- **Soft saturation** — warm tube-like overdrive for gruff old men, battle-hardened warriors, or gravelly narrators
- **Hard clipping** — aggressive edge for shouting soldiers, angry bosses, or drill sergeants
- **Bitcrusher** — quantization noise for robots, AI characters, radio transmissions, or retro sci-fi
- **Asymmetric waveshaping** — uneven harmonic generation for goblins, gremlins, creature rasp, or insectoid voices
None of these character types are achievable with the current effects chain. Adding distortion with selectable types is the fastest way to expand the character range.

**Implementation approach:** Web Audio API's `WaveShaperNode` accepts a custom Float32Array curve that defines the input→output transfer function. Different mathematical functions produce different distortion characters. A dropdown selects the curve type, and a "drive" slider controls intensity. Wet/dry mix blends the distorted signal with the clean original.

**Signal chain insertion point:** After the compressor, before the vibrato. This ensures the distortion operates on a dynamics-controlled signal (preventing unexpected volume spikes) and that modulation effects (vibrato, tremolo) operate on the already-distorted signal for more natural results.

---

**User Stories:**
- As a user, I can select from multiple distortion types (soft saturation, hard clip, bitcrusher, asymmetric) so that I can create gruff, robotic, creature, or aggressive character voices
- As a user, I can adjust the distortion drive/intensity so that I can control how much character the effect adds, from subtle grit to extreme transformation
- As a user, I can blend distortion with my clean voice via wet/dry mix so that I can add just a hint of grit without overwhelming the signal
- As a user, distortion type and drive are saved as part of character presets so that each character's texture is remembered
- As a user, I can hear the distortion update in real time as I adjust the drive or switch types so that I can dial in the right amount
- As a developer, distortion is implemented using Web Audio's WaveShaperNode so that no additional dependencies or AudioWorklets are required

**Acceptance Criteria:**
- Distortion section visible in Advanced mode effects section
- Dropdown with at least 4 curve types: Soft Saturation, Hard Clip, Bitcrusher, Asymmetric
- Drive slider (0–100%) controls intensity
- Wet/dry mix available
- Each curve type produces audibly distinct character
- Updates in real time without dropout
- Saved/loaded with character presets
- Tooltip explains each distortion type in plain language

**QA Checklist:**
- [ ] Soft saturation at 50% drive — voice sounds warmer/grittier, not harsh
- [ ] Hard clip at 50% drive — voice has aggressive edge, like shouting into a mic
- [ ] Bitcrusher at 50% drive — voice has digital/robotic quality
- [ ] Asymmetric at 50% drive — voice has uneven, creature-like rasp
- [ ] Drive at 0% — no audible distortion regardless of type
- [ ] Drive at 100% — extreme effect, clearly transformed
- [ ] Wet/dry at 25% — subtle texture addition, character voice not overwhelmed
- [ ] Switch between types while playing — no audio dropout or crash
- [ ] Save preset with distortion settings, reload — type + drive + wetdry restored
- [ ] Reset Stage 2 — distortion off (drive 0, type reset)
- [ ] Tooltip text sourced from `tooltips.ts`
- [ ] Combined with formant shift — gruff dwarf (low formant + saturation) sounds distinct from robot (bitcrusher + neutral formant)

**Definition of Done:**
- All acceptance criteria met
- QA checklist passed and results recorded in `testResults/`
- `package.json` version set to `0.7.5`
- All Sprint 0-7.4 regression items re-verified

---

### Sprint 7.6 - Independent Formant Band Control (Parametric Formant Filter Bank)

**Goal:** Add a parametric formant filter bank with independently controllable F1, F2, F3, and F4 bands so that users can reshape the spectral identity of their voice at the formant level — enabling male↔female conversion, age simulation, creature voices with impossible formant combinations, and fine-grained nasality control.

**Impact: High | Effort: Moderate**

---

#### Design Research: Human Formants and Why Individual Control Matters

**What formants are:** When a human speaks, the vocal cords produce a buzz-like signal rich in harmonics. That signal passes through the vocal tract (throat, mouth, nasal cavity), which acts as a series of resonant chambers. Each chamber amplifies certain frequency ranges — these amplified peaks are called **formants**. The shape and size of the vocal tract determines where the formant peaks fall, and this is the primary mechanism that distinguishes one voice from another.

**The four principal formants:**

| Formant | Typical Range | What It Controls | Acoustic Role |
|---|---|---|---|
| **F1** | 300–800 Hz | Vowel height (open vs closed mouth) | Low F1 = closed vowels (ee, oo). High F1 = open vowels (ah, aa). Shifting F1 changes perceived mouth openness. |
| **F2** | 800–2500 Hz | Vowel frontness (tongue position front vs back) | High F2 = front vowels (ee, ay). Low F2 = back vowels (oo, oh). F2 is the strongest cue for vowel identity. |
| **F3** | 2500–3500 Hz | Speaker identity and rhoticity | F3 distinguishes individual speakers more than vowels. Low F3 = rhotic (/r/) coloring. F3 is a primary forensic voice ID marker. |
| **F4** | 3500–4500 Hz | Voice quality and "ring" | F4 contributes to the singer's formant / vocal projection. Less perceptually critical than F1-F3 but adds clarity and "presence." |

**Why Rubber Band's formant scale is not enough alone:** Rubber Band's `setFormantScale()` shifts ALL formants together as a single unit — it scales the entire spectral envelope up or down. This is useful for coarse gender/age shifts (e.g., shift everything up = smaller vocal tract = female/child). But it cannot:
- Move F1 up while moving F2 down (impossible formant combo for alien/creature voices)
- Boost F1 and F2 close together without affecting F3 (nasality simulation)
- Independently widen or narrow individual formant peaks (changing perceived vocal tract shape)
- Create formant relationships that don't exist in any human vocal tract

**How the two systems complement each other:**
- **Stage 1 (Rubber Band, offline):** Coarse formant shift — moves all formants together as a unit. Think of it as resizing the entire vocal tract.
- **Stage 2 (Formant Bank, real-time):** Fine individual reshaping — moves, boosts, cuts, and widens/narrows each formant independently. Think of it as sculpting the vocal tract shape.

The user applies Rubber Band's formant scale first (Stage 1) for the coarse shift, then uses the formant bank (Stage 2) to fine-tune individual formant positions. This two-level approach gives maximum flexibility.

**Character voice examples achievable with independent formant control:**
- **Male → Female:** Raise F1 by ~20%, raise F2 by ~15%, raise F3 by ~10% (simulates smaller vocal tract). Combined with Rubber Band formant scale +0.2 for the coarse shift, the bank fine-tunes the ratios.
- **Adult → Child:** Raise all formants significantly (F1 +30%, F2 +25%, F3 +20%), combined with pitch up. The bank lets you exaggerate certain formants more than others for realism.
- **Nasality (nerdy wizard, whiny villain):** Boost F1 and bring F2 closer to F1 (narrow the F1-F2 gap). This simulates coupling between oral and nasal cavities. Cut F3 slightly for a more closed, pinched quality.
- **Booming hero / giant:** Cut F1, widen F2 bandwidth (lower Q), boost F3 for projection. Simulates a large, open vocal tract.
- **Alien / insectoid:** Set F1 and F2 to frequencies that never occur in human speech (e.g., F1 at 200Hz, F2 at 3000Hz — an impossible gap). No human vocal tract produces this, so it sounds immediately non-human.
- **Elderly voice:** Narrow all formant bandwidths (higher Q values) and add slight frequency instability. Aged vocal tracts have less muscle control, producing tighter, less stable resonances.

---

#### Implementation Approach

**Core architecture:** 3-4 `BiquadFilterNode` instances in series, each set to `"peaking"` mode. Each node represents one formant band (F1, F2, F3, optionally F4). Each band has three independently controllable parameters:

1. **Center Frequency** — where the formant peak sits. This is the primary control for "moving" a formant.
2. **Gain (dB)** — boost or cut at the center frequency. Boost emphasizes the formant; cut suppresses it.
3. **Q (bandwidth)** — how narrow or wide the resonance peak is. High Q = tight, resonant, pronounced peak. Low Q = broad, subtle, natural-sounding.

**Web Audio API implementation detail:**
```
// Each formant band is a BiquadFilterNode in "peaking" mode
const f1Node = audioContext.createBiquadFilter()
f1Node.type = 'peaking'
f1Node.frequency.value = 500    // F1 center frequency (Hz)
f1Node.gain.value = 6           // Boost by 6dB
f1Node.Q.value = 5              // Moderate bandwidth

// Chain: input → F1 → F2 → F3 → F4 → output
// Each node's parameters are independently controllable via AudioParam
```

**Why `BiquadFilterNode` "peaking" mode is correct:** The "peaking" (also called "parametric EQ") mode of `BiquadFilterNode` boosts or cuts a bell-shaped region around the center frequency. This is exactly what formant manipulation requires — surgically targeting a specific frequency region without affecting the rest of the spectrum. The existing 4-band EQ in the effects chain also uses `BiquadFilterNode`, so this is a proven pattern in the codebase.

**Parameter ranges for each band:**

| Parameter | F1 Range | F2 Range | F3 Range | F4 Range |
|---|---|---|---|---|
| Frequency | 200–1000 Hz | 600–3000 Hz | 2000–4000 Hz | 3000–5000 Hz |
| Gain | -12 to +12 dB | -12 to +12 dB | -12 to +12 dB | -12 to +12 dB |
| Q | 1–15 | 1–15 | 1–15 | 1–15 |

Note: Frequency ranges overlap deliberately — this allows formants to be pushed into each other's territory for extreme character voices. The ranges are wide enough to cover all human vocal tract variations and extend beyond for non-human effects.

**Wet/dry mix:** A single wet/dry control for the entire formant bank (not per-band). At 0% the bank is bypassed; at 100% the full formant reshaping is applied. This lets users dial in subtle formant coloring without full commitment.

**UI layout (Advanced mode):** A "Formant Bank" section with 3 or 4 sub-sections (F1, F2, F3, F4). Each sub-section has:
- A frequency knob or slider
- A gain knob or slider
- A Q knob or slider
- A per-band enable/disable toggle (so unused bands don't add processing overhead)

F4 is optional in the UI — it can be hidden behind an "F4 (Advanced)" toggle since it has less perceptual impact than F1-F3. This keeps the default UI from being overwhelming.

**Preset storage:** Each formant band's three parameters (frequency, gain, Q) plus the enable/disable state are stored in the preset JSON. The wet/dry mix for the bank is stored as a single value. This means a preset fully captures the formant reshaping configuration.

**Signal chain insertion point:** After the EQ bands, before the compressor. This is the same position as the old resonance filter it replaces. Rationale:
- Formant shaping is frequency-domain manipulation, so it belongs with the other frequency-shaping nodes (high-pass, spectral tilt, EQ)
- The compressor should come after all frequency shaping to tame any resonance peaks before modulation effects
- Placing it after EQ means the user's broad tonal adjustments are applied first, then formant-specific sculpting refines the result

**Relationship to the existing 4-band EQ:** The EQ and formant bank serve different purposes and do not conflict:
- **EQ** = broad tonal shaping (bass, low-mid, high-mid, treble). Wide Q values, musical frequency centers. Think "tone knobs."
- **Formant Bank** = surgical formant manipulation. Narrow Q values, speech-specific frequency centers. Think "vocal tract reshaping."
The user uses EQ to set the overall tone, then the formant bank to sculpt the voice's identity characteristics.

---

**User Stories:**
- As a user, I can independently adjust the center frequency of F1, F2, and F3 formant bands so that I can move individual formant peaks to reshape my vocal identity without affecting other formants
- As a user, I can boost or cut each formant band's gain independently so that I can emphasize certain formant peaks (making them more prominent) or suppress them (making them less audible)
- As a user, I can adjust the Q (bandwidth) of each formant band independently so that I can make formant peaks narrow and resonant (for pronounced, artificial effects) or wide and subtle (for natural-sounding shifts)
- As a user, I can optionally enable an F4 band for additional voice quality control so that I have access to the full formant range when creating advanced character voices
- As a user, I can enable or disable individual formant bands so that unused bands don't add processing overhead and so that I can isolate the effect of a single band while tuning
- As a user, I can blend the formant bank effect with my clean signal via a wet/dry mix so that I can add subtle formant coloring without full commitment to extreme settings
- As a user, I can combine Stage 1 Rubber Band formant scale (coarse all-together shift) with Stage 2 formant bank (fine individual reshaping) so that I get both broad gender/age shifts and detailed vocal tract sculpting
- As a user, formant bank settings are saved as part of character presets so that each character's unique formant profile is remembered and restored
- As a user, formant bank parameter changes update in real time so that I can hear the effect of moving a single formant while adjusting
- As a user, I can create nasality effects by boosting F1 and bringing F2 closer to F1 so that I can make nerdy, whiny, or insectoid character voices
- As a user, I can create impossible formant combinations (e.g., very low F1 with very high F2) so that I can design alien, creature, or otherworldly voices that no human vocal tract can produce
- As a developer, the formant bank is implemented using standard BiquadFilterNode "peaking" mode so that no additional dependencies are required and the pattern is consistent with the existing EQ implementation

**Acceptance Criteria:**
- Formant Bank section visible in Advanced mode effects section with F1, F2, F3 bands (F4 optional/toggleable)
- Each band has independent frequency, gain (-12 to +12dB), and Q (1-15) controls
- Frequency ranges: F1 (200-1000Hz), F2 (600-3000Hz), F3 (2000-4000Hz), F4 (3000-5000Hz)
- Each band can be individually enabled/disabled
- Audible formant reshaping when adjusting individual bands
- No conflict with existing 4-band EQ (both active simultaneously)
- Complements Rubber Band formant scale (Stage 1 coarse + Stage 2 fine)
- Wet/dry mix for entire formant bank
- Updates in real time without audio dropout
- Saved/loaded with character presets (per-band frequency, gain, Q, enabled state + bank wet/dry)
- Tooltip explains each band's role in plain language (F1 = mouth openness, F2 = tongue position, F3 = speaker identity, F4 = voice quality)

**QA Checklist:**
- [ ] F1 boost +12dB at 500Hz — voice sounds more open-mouthed, vowels shift toward "ah"
- [ ] F1 cut -12dB at 500Hz — voice sounds closed, muffled
- [ ] F2 boost +8dB at 1800Hz — voice sounds brighter, more forward
- [ ] F2 cut -8dB at 1800Hz — voice sounds darker, more back-of-throat
- [ ] F3 boost +6dB at 3000Hz — voice has more clarity and "presence"
- [ ] F3 cut -6dB at 3000Hz — voice loses individual speaker character
- [ ] All bands at 0dB gain — no audible difference from bypass
- [ ] Sweep F1 frequency from 200 to 1000Hz with +6dB gain — resonance peak moves audibly through vowel space
- [ ] High Q (15) on F2 — tight, pronounced, artificial resonance
- [ ] Low Q (1) on F2 — broad, subtle, natural-sounding
- [ ] Nasality test: F1 +6dB at 500Hz, F2 moved to 800Hz with +4dB — nasal quality audible
- [ ] Alien voice: F1 at 200Hz +8dB, F2 at 2800Hz +8dB — impossible gap sounds non-human
- [ ] Male→female: raise F1 to 600Hz, F2 to 2000Hz, F3 to 3200Hz all with +4dB — voice sounds higher/smaller
- [ ] Combined with Rubber Band formant scale +0.3 — coarse shift + fine bank adjustments stack correctly
- [ ] Combined with Stage 2 EQ adjustments — both active, no conflicts or cancellation
- [ ] Disable F2 band — only F1 and F3 affect audio
- [ ] Enable/disable F4 — toggles fourth band processing
- [ ] Adjust while playing — no clicks, pops, or dropouts
- [ ] Save preset with formant bank settings, reload — all per-band params restored (freq, gain, Q, enabled)
- [ ] Wet/dry at 50% — blended effect audible, less extreme than 100%
- [ ] Wet/dry at 0% — formant bank fully bypassed, no processing artifact
- [ ] Reset Stage 2 — all formant bands return to default (0dB gain, default frequencies)
- [ ] Tooltip text sourced from `tooltips.ts`

**Definition of Done:**
- All acceptance criteria met
- QA checklist passed and results recorded in `testResults/`
- `package.json` version set to `0.7.6`
- All Sprint 0-7.5 regression items re-verified

---

### Sprint 7.7 - Vocal Register Simulation (Chest-to-Head Voice Transition)

**Goal:** Add a unified "vocal register" control that simulates the transition from chest voice to head voice by coordinating spectral tilt, breathiness, and harmonic-to-noise ratio — giving each character a distinct vocal placement that goes beyond pitch and formants.

**Impact: Medium-High | Effort: Moderate**

**Depends on Sprint 7.4:** This sprint relies on the Spectral Tilt node from Sprint 7.4 being implemented. The register control adjusts spectral tilt as one of its coordinated parameters. If Sprint 7.4 is not complete, the spectral tilt component of register simulation will not function.

---

#### Design Research: Vocal Registers and Why They Matter for Character Voices

**What vocal registers are:** Human voices operate in different "registers" depending on how the vocal cords vibrate. The two primary registers are:

- **Chest voice:** The vocal cords vibrate along their full length and thickness. Produces a rich, resonant, powerful tone with strong low harmonics. The speaker feels vibration in their chest. Most adult speaking voices are in chest register.
- **Head voice:** The vocal cords thin and stretch, vibrating primarily along their edges. Produces a lighter, breathier, more ethereal tone with stronger high harmonics relative to the fundamental. The speaker feels vibration in their head/sinuses.

Between these extremes is a continuous spectrum. Real humans shift registers fluidly — a deep-voiced villain speaks in full chest voice, while a nervous fairy character might speak almost entirely in head voice.

**Why register matters for character identity:** Two characters can have the same pitch, the same formant positions, and the same effects — but if one is in chest voice and the other in head voice, they sound like completely different people. Register determines:
- **Perceived size and power** — Chest voice sounds larger, more authoritative, more grounded
- **Perceived age and fragility** — Head voice sounds younger, more delicate, more ethereal
- **Perceived emotion** — Chest voice conveys confidence and calm; head voice conveys excitement, fear, or vulnerability
- **Character archetype** — Warriors, kings, dragons = chest. Fairies, sprites, elderly mystics = head.

**The three acoustic components of register:**

1. **Spectral tilt** (Sprint 7.4 — already planned): The balance between low and high frequency energy. Chest voice has a steep spectral tilt (strong lows, weak highs). Head voice has a flatter tilt (lows and highs more balanced). This is the most prominent acoustic marker of register.

2. **Breathiness / aspiration noise**: Head voice produces more turbulent airflow at the glottis because the vocal cords don't close completely. This adds noise energy across the spectrum — a "breathy" or "airy" quality. Chest voice has less breath noise because the cords close firmly. VoxSmith already has a breathiness effect (white noise mixed with the signal via wet/dry).

3. **Harmonic-to-Noise Ratio (HNR)**: Related to breathiness but distinct. In chest voice, the harmonic structure is clear and dominant — you can hear distinct overtones. In head voice, the harmonic structure is less defined and more noise is present between harmonics. This can be simulated by mixing filtered noise at harmonic frequencies or by modulating the existing breathiness amount.

**How the register control works as a combined parameter:**

A single "Register" slider (or knob) from 0.0 (full chest) to 1.0 (full head) that simultaneously adjusts:

| Register Value | Spectral Tilt | Breathiness Mix | Description |
|---|---|---|---|
| 0.0 (Chest) | Strong negative tilt (boost lows, cut highs) | Very low (0-5%) | Full chest voice: rich, booming, powerful |
| 0.25 (Low Chest) | Moderate negative tilt | Low (5-15%) | Relaxed male speaking voice |
| 0.5 (Neutral) | Flat tilt (no adjustment) | Moderate (15-25%) | Natural balanced speaking voice |
| 0.75 (Head) | Moderate positive tilt (cut lows, boost highs) | Higher (25-40%) | Light, airy, slightly ethereal |
| 1.0 (Full Head) | Strong positive tilt (strong high boost) | High (40-60%) | Full head voice: breathy, light, fairy-like |

The register control does NOT replace the individual spectral tilt and breathiness controls — it provides a coordinated macro that adjusts both in tandem. Users can still override individual controls after setting the register position.

---

#### Implementation Approach

**Architecture:** The register control is a "macro" parameter that maps a single 0.0–1.0 value to multiple underlying effect parameters. It does not create new audio nodes — it adjusts existing ones:

1. **Spectral Tilt adjustment** — Maps register value to the spectral tilt node's bright/dark parameter (Sprint 7.4). Chest = dark, head = bright.
2. **Breathiness adjustment** — Maps register value to the existing breathiness wet/dry mix. Chest = low mix, head = high mix.

**Implementation detail:**
```
// Register value 0.0 (chest) to 1.0 (head)
function applyRegister(registerValue: number): void {
  // Map register to spectral tilt: -6dB (chest) to +6dB (head)
  const tiltAmount = (registerValue - 0.5) * 12  // Range: -6 to +6
  spectralTiltNode.setTilt(tiltAmount)

  // Map register to breathiness wet/dry: 0.02 (chest) to 0.55 (head)
  const breathinessMix = 0.02 + (registerValue * 0.53)
  effectsChain.setWetDry('breathiness', breathinessMix)
}
```

**Why this is a "macro" and not a new audio node:** The acoustic components of register simulation are already present in the effects chain (spectral tilt from Sprint 7.4, breathiness from existing effects). What's missing is the coordinated control that adjusts them together. Adding a new node would duplicate processing that already exists. The macro approach is both simpler and more efficient.

**Interaction with manual controls:** When the user adjusts the register slider, it sets spectral tilt and breathiness to their coordinated values. If the user then manually adjusts spectral tilt or breathiness individually, those manual overrides take precedence. The register slider shows where it was last set but the individual controls show the actual current values. This gives power users full manual control while giving casual users a single "register" knob.

**Parameter mapping curves:** The mapping from register value to underlying parameters is not necessarily linear. Perceptually, the chest-to-head transition is more dramatic in the upper range (0.7–1.0) than in the lower range (0.0–0.3). The implementation may use a slight curve (e.g., quadratic easing) on the breathiness mapping so that extreme head voice sounds appropriately breathy without the mid-range being too airy. This can be tuned during QA.

**UI layout (Advanced mode):** A "Vocal Register" knob or horizontal slider in the effects section, positioned near the spectral tilt and breathiness controls since it coordinates both. Labels at the extremes: "Chest" on the left, "Head" on the right. A tooltip explains what register simulation does in character terms, not acoustic terms.

**Preset storage:** The register value (0.0–1.0) is stored in the preset JSON. On preset load, `applyRegister()` is called which sets the underlying parameters. If the user has also manually adjusted spectral tilt or breathiness in the preset, those manual values are loaded AFTER the register macro, so manual overrides are preserved.

**Signal chain:** No new nodes are added. The register control adjusts:
- SpectralTiltNode (already in chain from Sprint 7.4, after HighPassFilter, before EQ)
- Breathiness wet/dry mix (already in chain, existing effect)

---

**User Stories:**
- As a user, I can adjust a single Vocal Register slider from "Chest" to "Head" so that my character's voice sounds like it's coming from deep in the chest (powerful, grounded) or high in the head (light, ethereal, breathy) without manually coordinating multiple individual effects
- As a user, I can set a character to full chest voice so that warriors, villains, dragons, and authoritative characters have a rich, booming vocal quality with strong low harmonics and minimal breathiness
- As a user, I can set a character to full head voice so that fairies, sprites, nervous characters, and ethereal beings have a light, airy, breathy vocal quality with more high-frequency energy
- As a user, I can set the register to intermediate positions so that I can create voices that are "slightly chest" or "slightly head" for nuanced character differentiation — not every character needs to be at an extreme
- As a user, I can combine vocal register with formant shifting (Stage 1) and formant bank (Stage 2) so that a female fairy character has raised formants AND head voice, while a male warrior has lowered formants AND chest voice
- As a user, I can manually override the spectral tilt or breathiness after setting the register so that I have full control when the coordinated defaults don't match my creative vision
- As a user, vocal register settings are saved as part of character presets so that each character's register placement is remembered and restored
- As a user, the register slider updates in real time so that I can sweep through the chest-to-head range and hear the transition while adjusting
- As a developer, the register control is implemented as a macro that maps to existing spectral tilt and breathiness parameters so that no new audio nodes are created and the implementation is efficient
- As a developer, the register macro's parameter mapping curves are tunable so that perceptual transitions sound natural across the full range

**Acceptance Criteria:**
- Vocal Register slider/knob visible in Advanced mode effects section
- Range: 0.0 (full chest) to 1.0 (full head), default at 0.5 (neutral)
- Adjusting register simultaneously changes spectral tilt and breathiness wet/dry
- Chest extreme (0.0): voice sounds noticeably richer, deeper, more resonant, less breathy
- Head extreme (1.0): voice sounds noticeably lighter, airier, more breathy, brighter
- Neutral (0.5): no significant spectral tilt or breathiness change from default
- Manual spectral tilt or breathiness adjustments override the register-set values
- Updates in real time without audio dropout
- Saved/loaded with character presets
- Tooltip explains the effect in character terms ("warrior vs fairy")
- No new audio nodes created — macro adjusts existing parameters only

**QA Checklist:**
- [ ] Register at 0.0 (chest) — voice sounds rich, deep, minimal breath noise
- [ ] Register at 1.0 (head) — voice sounds light, breathy, higher frequency emphasis
- [ ] Register at 0.5 (neutral) — no audible difference from default settings
- [ ] Sweep register 0.0→1.0 slowly — smooth perceptual transition, no sudden jumps
- [ ] Sweep register 1.0→0.0 — reverse transition sounds equally smooth
- [ ] Register at 0.0 + formant shift -0.3 — deep warrior character
- [ ] Register at 1.0 + formant shift +0.3 — ethereal fairy character
- [ ] Register at 0.0 + formant bank (low F1, wide F2) — booming giant character
- [ ] Register at 0.8 + formant bank (high F1, high F2) — nervous sprite character
- [ ] Set register to 0.2, then manually adjust breathiness up — breathiness overrides register-set value
- [ ] Set register to 0.8, then manually adjust spectral tilt down — tilt overrides register-set value
- [ ] Set register, manual override, then move register slider again — register re-applies coordinated values
- [ ] Adjust while playing — no clicks, pops, or dropouts
- [ ] Save preset with register at 0.3, reload — register and underlying params restored
- [ ] Save preset with register at 0.7 + manual breathiness override — both restored correctly
- [ ] Reset Stage 2 — register returns to 0.5 (neutral)
- [ ] Tooltip text sourced from `tooltips.ts`
- [ ] Combined with distortion (Sprint 7.5) — chest + distortion = gruff orc, head + no distortion = fairy

**Definition of Done:**
- All acceptance criteria met
- QA checklist passed and results recorded in `testResults/`
- `package.json` version set to `0.7.7`
- All Sprint 0-7.6 regression items re-verified

---

### Sprint 8 - Polish, Settings, and Packaging

**Goal:** Ship-ready build. Settings UI, error handling, onboarding, and `.exe` packaging.

**Depends on Sprint 7.1:** IPC handlers now follow a consistent throw-on-error pattern (standardized in Sprint 7.1 item A2). Sprint 8 layers user-facing error messages on top of that pattern. If 7.1 was not completed, IPC error handling is inconsistent and error display will need per-handler special cases.

**Deferred from Sprint 7.1 (pick up here):**
- **B6 — Waveform load error display:** `WaveformPanel.tsx:218-221` logs waveform load errors to console but does not show the user. Add user-facing error toast/banner as part of the error messaging work in this sprint.

**User Stories:**
- As a user, I can open a settings panel and change the max log file count without editing JSON directly so that configuration is approachable
- As a user, I see a clear error message if a WAV file fails to load so that I am not left confused
- As a user, I see a clear error message if export fails so that I know what went wrong
- As a user, I see a clear error message if waveform rendering fails so that I know something went wrong *(deferred from Sprint 7.1)*
- As a user, I can see the app version in the settings or about panel so that I can report it when asking for help
- As a developer, I can run `pnpm dist` and get a `.exe` NSIS installer so that the app can be installed on a clean Windows machine
- As a developer, the bundled FFmpeg and Rubber Band WASM binaries resolve correctly in the packaged build so that the app works after installation

**Acceptance Criteria:**
- Settings panel reads merged settings and writes user changes to `config/userSettingsOverride.json`
- All expected error states show user-facing messages (including waveform load failures)
- Packaged `.exe` installs and runs on a clean Windows 11 machine
- No console errors in packaged build
- Version number displayed in app matches `package.json`

**QA Checklist:**
- [ ] Open settings panel — current values reflect merged defaults + overrides
- [ ] Change max log file count in settings — value written to `config/userSettingsOverride.json`
- [ ] Load invalid WAV file — clear error message shown to user
- [ ] Trigger export failure — clear error message shown to user
- [ ] Waveform load failure — clear error message shown to user *(deferred from 7.1 B6)*
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
- Full regression suite (all Sprint 0-7.7 items) passed on packaged build
- Packaged `.exe` tested on clean Windows 11 machine

---

## Phase 1+2 Exit Criteria

Phase 1+2 is complete when all of the following are true:
- All Sprint 0-8 QA checklists pass (including 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7)
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
| Independent formant band control | **Scheduled as Sprint 7.6.** Parametric formant filter bank with independently controllable F1/F2/F3/F4 bands. |
| Subharmonic generator | Synthesize frequencies one octave below the fundamental for demon, giant, dragon voices. Needs AudioWorklet with pitch detection (autocorrelation) + sine synthesis. Medium-high impact, moderate effort. |
| Vocal register simulation | **Scheduled as Sprint 7.7.** Macro control coordinating spectral tilt + breathiness for chest-to-head voice transition. |
| Ring modulation | Multiply voice by a sine wave for alien, robotic, or demonic inharmonic sidebands. Low freq (5-30Hz) = warble, high freq (100-500Hz) = extreme transformation. Easy via OscillatorNode + GainNode. Niche but dramatic. |
| Convolution with vocal impulse responses | Short IRs (~50-100ms) for whisper texture, megaphone, telephone, walkie-talkie, PA system. Easy via ConvolverNode. Ship a handful of vocal IRs as bundled assets. |
| Auto-update via `electron-updater` | Deferred post-Phase 3. Manual download/reinstall acceptable for v1 personal tool. |
| Code signing (EV certificate) | Required for production distribution to avoid SmartScreen warnings. Budget and lead time needed. |
| CI/CD Stage 2 (GitHub Actions) | Implement when project reaches stable feature completion. See `docs/cicd.md`. |
| Mac/Linux packaging | Stretch goal. Do not break compatibility but do not prioritize. |
