# /spike-rubberband

Use this command for Sprint 1. This is the highest-risk dependency in the project.
The goal is to prove or disprove that Rubber Band WASM works inside an Electron AudioWorklet
before any other audio work is built on top of it.

## Success Criteria

- [ ] `rubberband.wasm` loads without error inside an AudioWorklet in Electron renderer
- [ ] A test WAV file processes through Rubber Band and plays back with audible pitch change
- [ ] Formant shift works independently of pitch change
- [ ] No CSP (Content Security Policy) errors blocking WASM execution
- [ ] Load success is logged at info level with binary path
- [ ] Load failure is logged at error level with full error message

## Spike Steps

### Step 1 - Install and locate the binary
```bash
pnpm add rubberband-web
```
Locate the `.wasm` file in `node_modules/rubberband-web/dist/` and copy it to `src/assets/rubberband-wasm/`.

### Step 2 - Configure Electron CSP
In the main process window creation, ensure CSP allows WASM:
```
Content-Security-Policy: script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:
```
Log if CSP header is missing or incorrect.

### Step 3 - Create the AudioWorklet processor
Create `src/renderer/engine/rubberband-worklet.js`:
- Load WASM from a path passed via processorOptions
- Expose pitch and formant as AudioParam values
- Process audio in chunks using Rubber Band's API

### Step 4 - Create RubberBandProcessor.ts
Create `src/renderer/engine/RubberBandProcessor.ts`:
- Extends AudioWorkletNode
- Registers the worklet module
- Exposes `setPitch(semitones)` and `setFormant(ratio)` methods
- Logs load success or failure

### Step 5 - Create a minimal spike test UI
Create a temporary test component (can be deleted after spike):
- Load a hardcoded test WAV
- Connect: Source → RubberBandProcessor → AudioContext.destination
- Add two sliders: pitch (-12 to +12) and formant (-1.0 to +1.0)
- Add a Play button

### Step 6 - Test and log outcome
Run the app and test:
- Confirm pitch slider changes pitch audibly
- Confirm formant slider changes formant audibly and independently
- Check logs for load confirmation

## If Spike Fails

If Rubber Band WASM cannot be loaded after reasonable troubleshooting:

1. Document the specific error in `docs/architecture.md` under a new "Spike Failure Notes" section
2. Switch to `soundtouch-audio-worklet`:
   ```bash
   pnpm add soundtouch-audio-worklet
   ```
3. Note: SoundTouch does not offer fully independent formant shifting. Pitch and formant will be coupled to some degree.
4. Update CLAUDE.md key decisions table with the change and reason
5. Continue with Sprint 2 using SoundTouch

## Cleanup After Spike

- Remove the temporary test UI component
- Move RubberBandProcessor.ts into the permanent engine folder
- Confirm binary path resolution works for both dev and packaged builds (see techStack.md)
