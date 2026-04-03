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

/**
 * Rubber Band Library FFI Binding via Koffi
 *
 * This module wraps the Rubber Band C library API (rubberband-3.dll) using Koffi,
 * a modern FFI library that works with Electron's V8 Memory Cage (unlike node-ffi-napi).
 *
 * WHY KOFFI INSTEAD OF node-ffi-napi?
 * - node-ffi-napi is abandoned and crashes on Electron >= 21 due to the V8 Memory Cage
 * - Koffi is actively maintained, faster, and fully compatible with modern Electron
 * - No native addon build toolchain required — Koffi ships prebuilt binaries for all platforms
 *
 * WHY THIS MODULE EXISTS:
 * The Rubber Band CLI only offers --formant as a boolean preserve/don't-preserve flag.
 * It CANNOT shift formants independently — the two-pass CLI workaround produces robotic
 * artifacts because audio is processed twice through the pitch-shifting algorithm.
 *
 * The Rubber Band C library API provides setFormantScale() which does true single-pass
 * formant shifting. This gives VoxSmith the ability to make voices sound like genuinely
 * different body sizes (small fairy, large ogre) without quality loss.
 *
 * REQUIRES:
 * - rubberband-3.dll in src/assets/rubberband/ (built from Rubber Band Library v4.0.0 source)
 * - The R3 engine (OptionEngineFiner flag) — setFormantScale() only works with R3
 *
 * AUDIO DATA FORMAT:
 * The Rubber Band C API expects de-interleaved float arrays: one float* per channel.
 * For mono audio, that's an array of 1 pointer. For stereo, array of 2 pointers.
 * This is different from the interleaved format used in WAV files.
 */

import path from 'path'
import fs from 'fs'
import { app } from 'electron'
import type { Logger } from 'winston'

// ─── Rubber Band Option Flags ────────────────────────────────────────────────
// These are bitmask values OR'd together and passed to rubberband_new().
// See: https://breakfastquay.com/rubberband/code-doc/rubberband-c_8h.html

/** Offline mode (default): requires a study pass before processing. Better quality. */
const RubberBandOptionProcessOffline = 0x00000000

/** R3 engine: REQUIRED for setFormantScale() to work as an independent control. */
const RubberBandOptionEngineFiner = 0x20000000

/** Preserve formant envelope when pitch-shifting (prevents chipmunk effect). */
const RubberBandOptionFormantPreserved = 0x01000000

/** Higher quality pitch shifting — slightly slower but cleaner output. */
const RubberBandOptionPitchHighQuality = 0x02000000

/** Single-threaded processing — avoids thread management overhead in FFI context. */
const RubberBandOptionThreadingNever = 0x00010000

/**
 * Combined options bitmask for VoxSmith's use case:
 * - Offline processing (study + process pattern)
 * - R3 engine (required for formant scale)
 * - Formant preservation (baseline — we override with setFormantScale for independent control)
 * - High quality pitch shifting
 * - Single-threaded (safe for FFI)
 */
const VOXSMITH_OPTIONS =
  RubberBandOptionProcessOffline |
  RubberBandOptionEngineFiner |
  RubberBandOptionFormantPreserved |
  RubberBandOptionPitchHighQuality |
  RubberBandOptionThreadingNever

// ─── Koffi Library Binding ───────────────────────────────────────────────────

// Lazy-loaded Koffi bindings — initialized on first use
let lib: ReturnType<typeof loadLibrary> | null = null
let loadError: string | null = null

/**
 * Resolves the path to rubberband-3.dll.
 * Same pattern as binaryPath.ts for rubberband.exe.
 */
function getDllPath(): string {
  const dllName = 'rubberband-3.dll'

  // Production: electron-builder copies extraResources to process.resourcesPath
  const productionPath = path.join(process.resourcesPath, 'rubberband', dllName)

  // Dev: relative to the compiled output directory
  const devPath = path.join(__dirname, '../../src/assets/rubberband', dllName)

  // Dev alternate: from app root
  const devAltPath = path.join(app.getAppPath(), 'src/assets/rubberband', dllName)

  if (app.isPackaged && fs.existsSync(productionPath)) return productionPath
  if (fs.existsSync(devPath)) return devPath
  if (fs.existsSync(devAltPath)) return devAltPath

  throw new Error(
    `Rubber Band shared library (${dllName}) not found. Searched:\n` +
    `  Production: ${productionPath}\n` +
    `  Dev: ${devPath}\n` +
    `  Dev alt: ${devAltPath}\n` +
    `Build the DLL from Rubber Band Library v4.0.0 source using Meson + MSVC.`
  )
}

/**
 * Loads the Rubber Band shared library and defines all C function bindings.
 *
 * Uses Koffi to declare the C function signatures. The RubberBandState is an
 * opaque pointer — we treat it as a generic pointer type in Koffi.
 */
function loadLibrary() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const koffi = require('koffi')

  const dllPath = getDllPath()
  console.log(`[RB-LIB] Loading DLL from: ${dllPath}`)
  const rb = koffi.load(dllPath)
  console.log('[RB-LIB] DLL loaded successfully')

  // RubberBandState is an opaque pointer — represented as void* in prototypes.
  // All function signatures match rubberband/rubberband-c.h exactly.
  //
  // CRITICAL: study(), process(), and retrieve() take `float *const *` (pointer
  // to array of float pointers). We MUST declare this as koffi.pointer(FloatPtr)
  // and pass JS arrays of koffi.as(Float32Array, FloatPtr). Using `void *` with
  // manual pointer array encoding (koffi.alloc + koffi.encode) produces incorrect
  // pointer layouts and causes ACCESS_VIOLATION crashes on multi-channel audio.
  const FloatPtr = koffi.pointer('float')

  const bindings = {
    koffi,
    FloatPtr,  // Export for use in processWithLibrary

    // ─── Constructor / Destructor ──────────────────────────────────────
    rubberband_new: rb.func(
      'void *rubberband_new(unsigned int sampleRate, unsigned int channels, int options, double initialTimeRatio, double initialPitchScale)'
    ),
    rubberband_delete: rb.func('void rubberband_delete(void *state)'),

    // ─── Parameter Control ─────────────────────────────────────────────
    rubberband_set_time_ratio: rb.func('void rubberband_set_time_ratio(void *state, double ratio)'),
    rubberband_set_pitch_scale: rb.func('void rubberband_set_pitch_scale(void *state, double scale)'),

    // rubberband_set_formant_scale — the key function!
    // Only works with R3 engine (OptionEngineFiner).
    // 1.0 = no change, > 1.0 = shift formants up, < 1.0 = shift formants down.
    // 0.0 = automatic (defaults to 1/pitchScale when FormantPreserved is set).
    rubberband_set_formant_scale: rb.func('void rubberband_set_formant_scale(void *state, double scale)'),

    // ─── Processing Setup ──────────────────────────────────────────────
    // Hint for memory allocation — total frames (not total samples across all channels)
    rubberband_set_expected_input_duration: rb.func(
      'void rubberband_set_expected_input_duration(void *state, unsigned int samples)'
    ),
    rubberband_get_samples_required: rb.func(
      'unsigned int rubberband_get_samples_required(void *state)'
    ),
    // Tell the stretcher the maximum number of frames that will be passed to
    // a single process() call. Must be called before study() and process().
    rubberband_set_max_process_size: rb.func(
      'void rubberband_set_max_process_size(void *state, unsigned int samples)'
    ),

    // ─── Study + Process + Retrieve ────────────────────────────────────
    // input/output: float *const * — array of per-channel float pointers.
    // Declared with koffi.pointer(FloatPtr) = float** — Koffi marshals a JS
    // array of koffi.as(Float32Array, FloatPtr) into the correct pointer layout.
    // samples: number of frames per channel (NOT total samples)
    // final: 1 if this is the last block, 0 otherwise
    rubberband_study: rb.func('rubberband_study', 'void', [
      'void *', koffi.pointer(FloatPtr), 'uint', 'int'
    ]),
    rubberband_process: rb.func('rubberband_process', 'void', [
      'void *', koffi.pointer(FloatPtr), 'uint', 'int'
    ]),

    // Returns frames available for retrieval, -1 when all output has been consumed
    rubberband_available: rb.func('int rubberband_available(void *state)'),

    // Returns actual number of frames retrieved
    rubberband_retrieve: rb.func('rubberband_retrieve', 'uint', [
      'void *', koffi.pointer(FloatPtr), 'uint'
    ]),

    // Returns 2 for R2 engine, 3 for R3 engine
    rubberband_get_engine_version: rb.func('int rubberband_get_engine_version(void *state)'),
  }

  // ─── Smoke test: verify the DLL actually works ────────────────────
  // Create a minimal stretcher, check engine version, then delete it.
  // If this crashes, we know the DLL is incompatible before any real processing.
  console.log('[RB-LIB] Running smoke test...')
  const testState = bindings.rubberband_new(44100, 1, VOXSMITH_OPTIONS, 1.0, 1.0)
  if (!testState) {
    throw new Error('Smoke test failed: rubberband_new returned null')
  }
  const version = bindings.rubberband_get_engine_version(testState)
  console.log(`[RB-LIB] Smoke test: engine R${version}`)
  bindings.rubberband_set_formant_scale(testState, 1.0)
  console.log('[RB-LIB] Smoke test: setFormantScale OK')
  bindings.rubberband_delete(testState)
  console.log('[RB-LIB] Smoke test PASSED')

  return bindings
}

/**
 * Returns the Koffi bindings, loading them on first call.
 * Throws if the DLL cannot be found or loaded.
 */
function getLib() {
  if (loadError) throw new Error(loadError)
  if (!lib) {
    try {
      lib = loadLibrary()
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err)
      throw err
    }
  }
  return lib
}

/**
 * Checks whether the Rubber Band shared library is available.
 * Returns true if the DLL can be loaded, false otherwise.
 * Does not throw — safe to call during startup to determine feature availability.
 */
export function isLibraryAvailable(): boolean {
  try {
    getLib()
    return true
  } catch {
    return false
  }
}

// ─── High-Level Processing API ───────────────────────────────────────────────

/**
 * Parameters for a single-pass Rubber Band library processing operation.
 */
export interface LibraryProcessParams {
  /** Raw audio data as Float32 interleaved samples */
  audioData: ArrayBuffer
  /** Sample rate in Hz */
  sampleRate: number
  /** Number of audio channels (1 = mono, 2 = stereo) */
  channels: number
  /** Pitch shift in semitones (e.g., +2 = up 2 semitones, -3 = down 3) */
  pitchSemitones: number
  /** Formant shift in semitones (e.g., +4 = smaller/thinner voice, -4 = larger/deeper) */
  formantSemitones: number
  /** Tempo ratio (1.0 = no change, 0.5 = half speed, 2.0 = double speed) */
  tempo: number
}

/**
 * Result from library processing.
 */
export interface LibraryProcessResult {
  success: boolean
  /** Processed audio as interleaved Float32 ArrayBuffer */
  processedData?: ArrayBuffer
  /** Duration of processed audio in seconds */
  durationSeconds?: number
  /** Diagnostic info string */
  info?: string
  error?: string
}

/**
 * Converts semitones to a frequency ratio for Rubber Band's pitch_scale parameter.
 *
 * Rubber Band uses frequency ratios, not semitones:
 * - 1.0 = no change
 * - 2.0 = up one octave (+12 semitones)
 * - 0.5 = down one octave (-12 semitones)
 *
 * Formula: ratio = 2^(semitones / 12)
 */
function semitonesToScale(semitones: number): number {
  return Math.pow(2.0, semitones / 12.0)
}

/**
 * Processes audio through the Rubber Band library API with full formant control.
 *
 * This is a SINGLE-PASS operation — pitch, formant, and tempo are all applied
 * in one processing pass. No two-pass CLI workaround, no robotic artifacts.
 *
 * WORKFLOW:
 * 1. De-interleave input audio (WAV format → per-channel arrays)
 * 2. Create a RubberBandStretcher with R3 engine options
 * 3. Set pitch scale, formant scale, and time ratio
 * 4. Study pass: feed all audio to analyze transients and stretching profile
 * 5. Process pass: feed all audio again to produce output
 * 6. Retrieve all output frames
 * 7. Re-interleave output audio (per-channel → interleaved for WAV)
 * 8. Clean up the stretcher
 *
 * @param params - Audio data and processing parameters
 * @param logger - Winston logger for diagnostics
 * @returns Processed audio or error
 */
export async function processWithLibrary(
  params: LibraryProcessParams,
  logger: Logger
): Promise<LibraryProcessResult> {
  const { koffi, ...rb } = getLib()

  const {
    audioData,
    sampleRate,
    channels,
    pitchSemitones,
    formantSemitones,
    tempo,
  } = params

  // Convert interleaved Float32 input to typed array
  const interleaved = new Float32Array(audioData)
  const totalSamples = interleaved.length
  const framesPerChannel = Math.floor(totalSamples / channels)

  logger.debug(
    `Library processing: ${framesPerChannel} frames, ${channels}ch, ${sampleRate}Hz, ` +
    `pitch=${pitchSemitones}st, formant=${formantSemitones}st, tempo=${tempo}x`
  )

  // ─── Step 1: De-interleave ───────────────────────────────────────────
  // Rubber Band C API wants de-interleaved audio: one float* per channel.
  // Interleaved format: [L0, R0, L1, R1, ...]
  // De-interleaved format: channel[0] = [L0, L1, ...], channel[1] = [R0, R1, ...]
  const channelBuffers: Float32Array[] = []
  for (let ch = 0; ch < channels; ch++) {
    const channelData = new Float32Array(framesPerChannel)
    for (let i = 0; i < framesPerChannel; i++) {
      channelData[i] = interleaved[i * channels + ch]
    }
    channelBuffers.push(channelData)
  }

  // ─── Step 2: Create stretcher ────────────────────────────────────────
  const pitchScale = semitonesToScale(pitchSemitones)
  const formantScale = semitonesToScale(formantSemitones)
  // Rubber Band's time ratio is duration ratio: 2.0 = double duration (half tempo).
  // VoxSmith's tempo param is speed: 2.0 = double speed (half duration).
  // So time ratio = 1.0 / tempo.
  const timeRatio = tempo !== 0 ? 1.0 / tempo : 1.0

  // The stretcher must be deleted in the finally block
  let state: unknown = null

  try {
    logger.debug('[RB-LIB] Step 2: Creating stretcher...')
    state = rb.rubberband_new(sampleRate, channels, VOXSMITH_OPTIONS, timeRatio, pitchScale)
    logger.debug(`[RB-LIB] Step 2: Stretcher created: ${state ? 'OK' : 'NULL'}`)

    if (!state) {
      return { success: false, error: 'Failed to create Rubber Band stretcher (null state)' }
    }

    // Verify we got the R3 engine (required for formant scale)
    const engineVersion = rb.rubberband_get_engine_version(state)
    logger.debug(`[RB-LIB] Step 2: Engine version: R${engineVersion}`)
    if (engineVersion !== 3) {
      logger.warn(`Expected R3 engine but got R${engineVersion} — formant scale may not work`)
    }

    // Set independent formant scale.
    // This is the key feature that the CLI cannot do!
    // 1.0 = no formant change. > 1.0 = formants shift up (smaller body).
    // < 1.0 = formants shift down (larger body).
    logger.debug(`[RB-LIB] Step 2: Setting formant scale to ${formantScale}`)
    rb.rubberband_set_formant_scale(state, formantScale)

    // Tell the stretcher how much audio to expect (improves memory allocation)
    logger.debug(`[RB-LIB] Step 2: Setting expected duration to ${framesPerChannel} frames`)
    rb.rubberband_set_expected_input_duration(state, framesPerChannel)

    // CRITICAL: Tell the stretcher we'll pass the entire buffer in one process() call.
    // Without this, Rubber Band's internal buffer defaults to ~64K frames and crashes
    // with a segfault when given larger input (188K+ frames for a 4-second file).
    rb.rubberband_set_max_process_size(state, framesPerChannel)

    // ─── Step 3: Allocate stable native input buffers ────────────────────
    // The C API expects float *const * (array of pointers to channel buffers).
    //
    // IMPORTANT: We allocate native memory via koffi.alloc() rather than using
    // koffi.as(Float32Array, 'float *'). The koffi.as() approach creates
    // ephemeral pointers to JS-managed memory that can be invalidated by
    // Electron's V8 garbage collector between study() and process() calls,
    // causing hard crashes. Native allocations are GC-safe.
    //
    // Flow: JS Float32Array → koffi.alloc (native) → copy data in → pass to C API
    // ─── Step 3: Build typed pointer arrays for C API ────────────────────
    // The C API expects float *const * (pointer to array of float pointers).
    // Koffi handles this correctly when we:
    // 1. Declare the parameter as koffi.pointer(FloatPtr) = float**
    // 2. Pass a JS array of koffi.as(Float32Array, FloatPtr) values
    // Koffi automatically marshals the JS array into the correct float** layout.
    //
    // IMPORTANT: Do NOT manually build pointer arrays with koffi.alloc('void *')
    // and koffi.encode() — this produces incorrect pointer layouts for multi-channel
    // audio and causes ACCESS_VIOLATION crashes.
    logger.debug(`[RB-LIB] Step 3: Building typed input array for ${channels} channels...`)

    // rb.FloatPtr is the koffi.pointer('float') type from loadLibrary()
    const inputArr = channelBuffers.map(buf => koffi.as(buf, rb.FloatPtr))
    logger.debug('[RB-LIB] Step 3: Input array ready')

    // ─── Step 4: Study pass ────────────────────────────────────────────
    // In offline mode, Rubber Band needs to analyze the entire input first
    // to plan transient handling and stretching profile.
    // We pass the entire buffer at once (Rubber Band handles internal chunking).
    logger.debug('[RB-LIB] Step 4: Starting study pass...')
    rb.rubberband_study(state, inputArr, framesPerChannel, 1)
    logger.debug('[RB-LIB] Step 4: Study pass complete')

    // ─── Step 5: Process pass ──────────────────────────────────────────
    // Feed the same audio again — this time Rubber Band produces output.
    logger.debug('[RB-LIB] Step 5: Starting process pass...')
    rb.rubberband_process(state, inputArr, framesPerChannel, 1)
    logger.debug('[RB-LIB] Step 5: Process pass complete')

    // ─── Step 6: Retrieve all output ───────────────────────────────────
    // For retrieval, allocate Float32Arrays and pass them as typed pointer arrays.
    // Rubber Band writes directly into the Float32Array backing buffers.
    const outputChunks: Float32Array[][] = []

    let available = rb.rubberband_available(state)
    logger.debug(`[RB-LIB] Step 6: Available frames: ${available}`)
    while (available > 0) {
      // Allocate JS output buffers for this retrieval chunk
      const chunkChannels: Float32Array[] = []
      for (let ch = 0; ch < channels; ch++) {
        chunkChannels.push(new Float32Array(available))
      }

      // Pass as typed pointer array — Koffi marshals automatically
      const outArr = chunkChannels.map(buf => koffi.as(buf, rb.FloatPtr))
      const retrieved = rb.rubberband_retrieve(state, outArr, available)

      if (retrieved > 0) {
        // Float32Arrays were filled in-place by Rubber Band.
        // Trim to actual retrieved size if different from available.
        const trimmed = chunkChannels.map(buf =>
          retrieved < available ? buf.slice(0, retrieved) : buf
        )
        outputChunks.push(trimmed)
      }

      available = rb.rubberband_available(state)
    }

    // ─── Step 7: Re-interleave output ──────────────────────────────────
    // Calculate total output frames
    let totalOutputFrames = 0
    for (const chunk of outputChunks) {
      totalOutputFrames += chunk[0].length
    }

    // Interleave back to [L0, R0, L1, R1, ...] format for WAV encoding
    const outputInterleaved = new Float32Array(totalOutputFrames * channels)
    let writeOffset = 0
    for (const chunk of outputChunks) {
      const chunkFrames = chunk[0].length
      for (let i = 0; i < chunkFrames; i++) {
        for (let ch = 0; ch < channels; ch++) {
          outputInterleaved[writeOffset++] = chunk[ch][i]
        }
      }
    }

    const durationSeconds = totalOutputFrames / sampleRate

    logger.info(
      `Library processing complete: pitch=${pitchSemitones}st, formant=${formantSemitones}st, ` +
      `tempo=${tempo}x, input=${framesPerChannel} frames, output=${totalOutputFrames} frames, ` +
      `duration=${durationSeconds.toFixed(2)}s`
    )

    return {
      success: true,
      processedData: outputInterleaved.buffer,
      durationSeconds,
      info: `R3 engine, single-pass, pitch=${pitchScale.toFixed(4)}, formant=${formantScale.toFixed(4)}, timeRatio=${timeRatio.toFixed(4)}`,
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    logger.error(`Library processing failed: ${errorMsg}`)
    return { success: false, error: errorMsg }
  } finally {
    // ─── Step 8: Cleanup ─────────────────────────────────────────────
    // Delete the Rubber Band stretcher. No native buffer cleanup needed —
    // we pass JS Float32Arrays directly via koffi.as(), so V8's GC handles them.
    if (state) {
      try { rb.rubberband_delete(state) } catch { /* best effort */ }
    }
  }
}
