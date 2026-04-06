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
 * RNNoise AudioWorklet Processor (Sprint 7.2)
 *
 * Runs RNNoise (neural-network noise suppression) in the audio rendering thread.
 * Removes background noise (fan, AC, keyboard, room tone) from the microphone
 * signal in real time before it reaches the effects chain.
 *
 * FRAME SIZE MISMATCH:
 * Web Audio delivers 128-sample render quanta in process(), but RNNoise requires
 * exactly 480-sample frames (10ms at 48kHz). We use a ring buffer to accumulate
 * 128-sample blocks, process a full 480-sample frame when ready, and drain the
 * processed output back in 128-sample chunks.
 *
 * SAMPLE RATE:
 * RNNoise is trained on 48kHz audio. If the AudioContext runs at a different rate
 * (e.g., 44100Hz on Windows), we resample input up to 48kHz before processing
 * and resample the output back down. Linear interpolation is sufficient for voice.
 *
 * WASM LOADING:
 * The WASM binary is sent from the main thread via MessagePort as an ArrayBuffer.
 * We embed the full Jitsi/Emscripten glue code (adapted for AudioWorklet scope)
 * to properly initialize the WASM runtime — including wasmTable, heap views,
 * runtime callbacks, and memory management. This replaces the earlier manual
 * WebAssembly.instantiate() approach which missed critical init steps.
 *
 * INT16 SCALING:
 * The original RNNoise C API expects float samples scaled to int16 range
 * (±32768), NOT standard Web Audio [-1, 1] floats. We scale up before
 * processing and scale back down after. The @jitsi/rnnoise-wasm build
 * does not change this convention.
 *
 * MESSAGE PORT PROTOCOL:
 *   Main → Processor:
 *     { type: 'load-wasm', wasm: ArrayBuffer }  — WASM binary to compile
 *     { type: 'enable' }                         — turn on noise suppression
 *     { type: 'disable' }                        — turn off (passthrough)
 *
 *   Processor → Main:
 *     { type: 'ready' }                          — WASM loaded successfully
 *     { type: 'error', message: string }         — WASM load failed
 *     { type: 'vad', probability: number }       — Voice Activity Detection (0-1)
 */

// ─── Constants ──────────────────────────────────────────────────────────────

/** RNNoise processes exactly 480 samples per frame (10ms at 48kHz) */
const RNNOISE_FRAME_SIZE = 480

/** Web Audio delivers 128 samples per render quantum */
const RENDER_QUANTUM = 128

/** RNNoise expects 48kHz audio — this is what the neural network was trained on */
const RNNOISE_SAMPLE_RATE = 48000

/** How often to send VAD probability to the main thread (every ~500ms = ~50 frames at 48kHz) */
const VAD_REPORT_INTERVAL = 50

/**
 * RNNoise C API expects floats in int16 range (±32768), not Web Audio [-1, 1].
 * We scale input up by this factor before processing and scale output back down.
 */
const INT16_SCALE = 32768.0

// ─── Embedded Emscripten Glue ───────────────────────────────────────────────

/**
 * Creates a fully initialized RNNoise WASM Module using the Jitsi Emscripten
 * runtime glue code, adapted for AudioWorklet scope (no document, no window,
 * no fetch — WASM binary provided directly via wasmBinaryData parameter).
 *
 * This handles ALL the critical initialization that manual WebAssembly.instantiate()
 * misses:
 *   - wasmTable setup (export "k") — required for internal function pointer calls
 *   - updateGlobalBufferAndViews — creates HEAP8/HEAPU8/HEAP32/HEAPF32/etc.
 *   - callRuntimeCallbacks(__ATINIT__) — runs __wasm_call_ctors with proper args
 *   - _emscripten_resize_heap with overgrowth retry logic
 *
 * Returns a Promise that resolves to the initialized Module object with:
 *   Module.HEAPF32 — Float32 view of WASM memory
 *   Module._rnnoise_create() — create DenoiseState
 *   Module._rnnoise_process_frame(state, outPtr, inPtr) — denoise a 480-sample frame
 *   Module._rnnoise_destroy(state) — free DenoiseState
 *   Module._malloc(bytes) — allocate WASM memory
 *   Module._free(ptr) — free WASM memory
 *
 * @param {ArrayBuffer} wasmBinaryData — The rnnoise.wasm binary
 * @returns {Promise<Object>} Initialized Emscripten Module
 */
function _createRNNoiseModule(wasmBinaryData) {
  return new Promise((moduleResolve, moduleReject) => {
    // ── Module object — Emscripten's central state container ──
    // We pre-set wasmBinary so the glue code skips all fetch/XHR paths.
    var Module = {}
    Module['wasmBinary'] = wasmBinaryData

    // ── Ready promise — resolves when WASM is fully initialized ──
    var readyPromiseResolve, readyPromiseReject
    Module['ready'] = new Promise(function (resolve, reject) {
      readyPromiseResolve = resolve
      readyPromiseReject = reject
    })

    // Wire our outer promise to the inner ready promise
    Module['ready'].then(moduleResolve, moduleReject)

    // ── Runtime state ──
    var wasmMemory   // WebAssembly.Memory instance
    var wasmTable    // WebAssembly.Table for indirect function calls
    var ABORT = false

    // ── Heap views — typed array views of the WASM linear memory ──
    // These get invalidated whenever memory grows, so updateGlobalBufferAndViews
    // must be called after any memory.grow() operation.
    var buffer, HEAP8, HEAPU8, HEAP16, HEAPU16, HEAP32, HEAPU32, HEAPF32, HEAPF64

    function updateGlobalBufferAndViews(buf) {
      buffer = buf
      Module['HEAP8'] = HEAP8 = new Int8Array(buf)
      Module['HEAP16'] = HEAP16 = new Int16Array(buf)
      Module['HEAP32'] = HEAP32 = new Int32Array(buf)
      Module['HEAPU8'] = HEAPU8 = new Uint8Array(buf)
      Module['HEAPU16'] = HEAPU16 = new Uint16Array(buf)
      Module['HEAPU32'] = HEAPU32 = new Uint32Array(buf)
      Module['HEAPF32'] = HEAPF32 = new Float32Array(buf)
      Module['HEAPF64'] = HEAPF64 = new Float64Array(buf)
    }

    // ── Runtime callback queues — Emscripten lifecycle hooks ──
    var __ATINIT__ = []
    var runtimeInitialized = false

    /**
     * Executes queued runtime callbacks. Emscripten uses these for deferred
     * initialization — __wasm_call_ctors is added to __ATINIT__ and called
     * here during initRuntime(). The callback receives Module as an argument.
     */
    function callRuntimeCallbacks(callbacks) {
      while (callbacks.length > 0) {
        var callback = callbacks.shift()
        if (typeof callback == 'function') {
          // Direct JS function — call with Module as argument (Emscripten convention)
          callback(Module)
          continue
        }
        // Function-pointer style callback (uses wasmTable for indirect calls)
        var func = callback.func
        if (typeof func == 'number') {
          if (callback.arg === undefined) {
            wasmTable.get(func)()
          } else {
            wasmTable.get(func)(callback.arg)
          }
        } else {
          func(callback.arg === undefined ? null : callback.arg)
        }
      }
    }

    // ── Emscripten import functions ──
    // These two functions are the WASM binary's only imports from the host.
    // They handle bulk memory operations and memory growth.

    /**
     * emscripten_memcpy_big — bulk memory copy within the WASM heap.
     * Called by Emscripten's libc for large memcpy operations that exceed
     * the WASM-native memory.copy threshold.
     */
    function _emscripten_memcpy_big(dest, src, num) {
      HEAPU8.copyWithin(dest, src, src + num)
    }

    /**
     * Helper to grow WASM memory and refresh all heap views.
     * Returns 1 on success, undefined on failure.
     */
    function emscripten_realloc_buffer(size) {
      try {
        wasmMemory.grow((size - buffer.byteLength + 65535) >>> 16)
        updateGlobalBufferAndViews(wasmMemory.buffer)
        return 1
      } catch (e) {
        // Memory growth failed — WASM memory cannot exceed 2GB
      }
    }

    /**
     * emscripten_resize_heap — grows WASM memory when malloc needs more space.
     * Uses Emscripten's overgrowth strategy: tries progressively smaller growth
     * amounts (1.2x, 1.1x, 1.05x, 1.025x of current size) to avoid fragmentation.
     * Returns true on success, false on failure.
     */
    function _emscripten_resize_heap(requestedSize) {
      var oldSize = HEAPU8.length
      requestedSize = requestedSize >>> 0
      var maxHeapSize = 2147483648  // 2GB max for WASM
      if (requestedSize > maxHeapSize) return false

      let alignUp = (x, multiple) => x + (multiple - x % multiple) % multiple
      // Try progressively smaller overgrowth amounts
      for (var cutDown = 1; cutDown <= 4; cutDown *= 2) {
        var overGrownHeapSize = oldSize * (1 + 0.2 / cutDown)
        overGrownHeapSize = Math.min(overGrownHeapSize, requestedSize + 100663296)
        var newSize = Math.min(
          maxHeapSize,
          alignUp(Math.max(requestedSize, overGrownHeapSize), 65536)
        )
        var replacement = emscripten_realloc_buffer(newSize)
        if (replacement) return true
      }
      return false
    }

    // ── WASM import object ──
    // The Jitsi WASM binary uses minified import names:
    //   Module "a" → { "b": emscripten_memcpy_big, "a": emscripten_resize_heap }
    var asmLibraryArg = {
      'b': _emscripten_memcpy_big,
      'a': _emscripten_resize_heap,
    }

    // ── WASM Instantiation ──
    // Compile and instantiate the WASM binary, then run the full Emscripten
    // initialization sequence. This is where our manual approach was failing —
    // it skipped wasmTable setup and the callRuntimeCallbacks chain.
    var info = { 'a': asmLibraryArg }

    WebAssembly.instantiate(wasmBinaryData, info)
      .then(function (result) {
        var exports = result.instance.exports

        // Store exports on Module (Emscripten convention)
        Module['asm'] = exports

        // "c" = WebAssembly.Memory — the WASM linear memory
        wasmMemory = exports['c']
        updateGlobalBufferAndViews(wasmMemory.buffer)

        // "k" = WebAssembly.Table — function pointer table for indirect calls.
        // THIS WAS THE MISSING PIECE in our manual approach. Without wasmTable,
        // any internal C function pointer calls (callbacks, vtable dispatch)
        // would fail silently or crash.
        wasmTable = exports['k']

        // "d" = __wasm_call_ctors — queued for init, not called directly.
        // Emscripten adds it to __ATINIT__ and calls it via callRuntimeCallbacks
        // during initRuntime(), which passes Module as an argument.
        __ATINIT__.push(exports['d'])

        // Run the Emscripten runtime initialization sequence
        runtimeInitialized = true
        callRuntimeCallbacks(__ATINIT__)

        // ── Named export wrappers ──
        // Map the minified single-letter WASM exports to human-readable names.
        // These become the public API on the Module object.
        Module['_rnnoise_init'] = exports['e']
        Module['_rnnoise_create'] = exports['f']
        Module['_malloc'] = exports['g']
        Module['_rnnoise_destroy'] = exports['h']
        Module['_free'] = exports['i']
        Module['_rnnoise_process_frame'] = exports['j']

        // Signal that the Module is fully initialized and ready to use
        readyPromiseResolve(Module)
      })
      .catch(function (reason) {
        readyPromiseReject(reason)
      })
  })
}

// ─── Processor ──────────────────────────────────────────────────────────────

class RNNoiseProcessor extends AudioWorkletProcessor {
  constructor() {
    super()

    // ── State flags ──
    this._enabled = false       // User toggle — suppression on/off
    this._wasmReady = false     // WASM compiled and RNNoise state created
    this._destroyed = false     // Cleanup flag

    // ── Emscripten Module (replaces manual exports/memory refs) ──
    // The Module object holds HEAPF32, _rnnoise_process_frame, _malloc, etc.
    // Using the full Emscripten Module ensures proper runtime initialization.
    this._module = null         // Initialized Emscripten Module object
    this._rnnoiseState = 0      // Pointer to RNNoise DenoiseState in WASM memory
    this._inputPtr = 0          // WASM memory pointer for input frame buffer
    this._outputPtr = 0         // WASM memory pointer for output frame buffer

    // ── Ring buffer for frame size adaptation (128 → 480) ──
    // Input accumulator: collects 128-sample blocks until we have 480
    this._inputRing = new Float32Array(RNNOISE_FRAME_SIZE)
    this._inputOffset = 0       // How many samples accumulated so far

    // Output queue: processed 480-sample frames waiting to be drained
    // We use a simple array of frames + read offset within the current frame
    this._outputQueue = []
    this._outputReadOffset = 0

    // ── Sample rate resampling ──
    // If the AudioContext sample rate isn't 48kHz, we need to resample
    this._contextSampleRate = sampleRate  // AudioWorkletGlobalScope.sampleRate
    this._needsResampling = Math.abs(this._contextSampleRate - RNNOISE_SAMPLE_RATE) > 1
    this._resampleRatio = RNNOISE_SAMPLE_RATE / this._contextSampleRate

    // Resampling buffers (only allocated if needed)
    if (this._needsResampling) {
      // Input: we need to upsample 128 context-rate samples to ~139 48kHz samples
      // (for 44100→48000: 128 * 48000/44100 ≈ 139.3)
      // We accumulate resampled samples into a buffer, then feed to the ring buffer
      this._resampleInputBuffer = new Float32Array(Math.ceil(RENDER_QUANTUM * this._resampleRatio) + 2)
      // Output: we need to downsample 480 48kHz samples to ~441 context-rate samples
      // (for 48000→44100: 480 * 44100/48000 ≈ 441)
      this._resampleOutputBuffer = new Float32Array(Math.ceil(RNNOISE_FRAME_SIZE / this._resampleRatio) + 2)
      // Fractional sample position for resampling continuity across blocks
      this._resampleInputPhase = 0
      this._resampleOutputPhase = 0
    }

    // ── VAD-gated attenuation (post-RNNoise extra suppression) ──
    // RNNoise does the heavy lifting, but some residual noise leaks through.
    // This soft gate uses the VAD probability to apply additional attenuation
    // on frames that RNNoise considers mostly noise. Speech frames pass through.
    //
    // How it works:
    //   - VAD > threshold → gain = 1.0 (speech, no extra attenuation)
    //   - VAD < threshold → gain ramps linearly from 0 to 1 as VAD approaches threshold
    //   - Smoothing prevents clicks at speech/noise boundaries
    //
    // Threshold controls aggressiveness:
    //   0.3 = gentle (only gate obvious noise)
    //   0.5 = moderate (default)
    //   0.7 = aggressive (gate anything that isn't clearly speech)
    this._vadGateThreshold = 0.5    // VAD probability below this gets extra attenuation
    this._smoothedGain = 1.0        // Exponential moving average of gate gain (click-free)
    this._gainSmoothingFactor = 0.15 // How fast gain changes (0=frozen, 1=instant, 0.15≈smooth)

    // ── VAD reporting ──
    this._vadCounter = 0
    this._lastVadProb = 0
    this._loggedFirstFrame = false  // One-time log when first active frame is processed

    // ── Message handling ──
    this.port.onmessage = (e) => this._handleMessage(e.data)
  }

  // ─── Message Handler ──────────────────────────────────────────────────

  _handleMessage(msg) {
    if (msg.type === 'load-wasm') {
      console.log(`[RNNoise] Received load-wasm message (${msg.wasm?.byteLength ?? 0} bytes)`)
      this._loadWasm(msg.wasm)
    } else if (msg.type === 'enable') {
      this._enabled = true
      console.log('[RNNoise] Enabled — wasmReady:', this._wasmReady)
    } else if (msg.type === 'disable') {
      this._enabled = false
      console.log('[RNNoise] Disabled')
    } else if (msg.type === 'set-aggressiveness') {
      // Aggressiveness controls the VAD gate threshold.
      // Higher threshold = more aggressive noise gating.
      // Value is clamped to [0.1, 0.95] to prevent extremes.
      const value = Math.max(0.1, Math.min(0.95, msg.value))
      this._vadGateThreshold = value
      console.log(`[RNNoise] Aggressiveness set — VAD gate threshold: ${value.toFixed(2)}`)
    } else if (msg.type === 'destroy') {
      console.log('[RNNoise] Received destroy message — cleaning up WASM state')
      this._destroy()
    } else {
      console.warn('[RNNoise] Unknown message type:', msg.type)
    }
  }

  // ─── WASM Loading ─────────────────────────────────────────────────────

  /**
   * Loads the RNNoise WASM binary using the full Emscripten glue code.
   * This replaces the earlier manual WebAssembly.instantiate() approach
   * that was missing critical runtime initialization (wasmTable, heap views,
   * callRuntimeCallbacks). The Emscripten glue handles all of that properly.
   *
   * After initialization, we call rnnoise_create() to allocate the denoise
   * state and malloc() to allocate input/output frame buffers in WASM memory.
   *
   * @param {ArrayBuffer} wasmBinary — The rnnoise.wasm binary from MessagePort
   */
  async _loadWasm(wasmBinary) {
    try {
      // Use the embedded Emscripten glue to properly initialize the WASM runtime.
      // This creates wasmTable, runs __wasm_call_ctors, sets up all heap views,
      // and provides the named export wrappers (_rnnoise_create, _malloc, etc.).
      // Note: AudioWorkletGlobalScope has no `performance` object — use Date.now()
      const loadStart = Date.now()
      const Module = await _createRNNoiseModule(wasmBinary)
      const loadMs = Date.now() - loadStart
      this._module = Module
      console.log(`[RNNoise] Emscripten Module created in ${loadMs}ms`)

      // Create denoise state — allocates the RNNoise neural network state
      // (GRU layers, filter banks, etc.) in WASM memory
      this._rnnoiseState = Module._rnnoise_create()
      if (!this._rnnoiseState) {
        throw new Error('rnnoise_create returned null — WASM memory allocation failed')
      }
      console.log(`[RNNoise] DenoiseState created at ptr: ${this._rnnoiseState}`)

      // Allocate input/output frame buffers in WASM memory.
      // RNNoise processes 480 float32 samples per frame (4 bytes each = 1920 bytes).
      this._inputPtr = Module._malloc(RNNOISE_FRAME_SIZE * 4)
      this._outputPtr = Module._malloc(RNNOISE_FRAME_SIZE * 4)

      if (!this._inputPtr || !this._outputPtr) {
        throw new Error(`malloc failed — inputPtr: ${this._inputPtr}, outputPtr: ${this._outputPtr}`)
      }
      console.log(`[RNNoise] Frame buffers allocated — inputPtr: ${this._inputPtr}, outputPtr: ${this._outputPtr}`)

      this._wasmReady = true
      console.log('[RNNoise] WASM loaded via Emscripten glue — Module initialized')
      this.port.postMessage({ type: 'ready' })

    } catch (err) {
      console.error('[RNNoise] WASM load failed:', err)
      this.port.postMessage({
        type: 'error',
        message: err.message || 'Failed to load RNNoise WASM',
      })
    }
  }

  // ─── Audio Processing ─────────────────────────────────────────────────

  process(inputs, outputs) {
    if (this._destroyed) return false

    const input = inputs[0]?.[0]   // Mono channel 0
    const output = outputs[0]?.[0]
    if (!input || !output) return true

    // Passthrough if disabled or WASM not ready
    if (!this._enabled || !this._wasmReady) {
      output.set(input)
      return true
    }

    // Log once when the active processing path is first entered.
    // Confirms audio is flowing through RNNoise (not passthrough).
    if (!this._loggedFirstFrame) {
      this._loggedFirstFrame = true
      console.log(`[RNNoise] First active frame — needsResampling: ${this._needsResampling}, sampleRate: ${this._contextSampleRate}`)
    }

    if (this._needsResampling) {
      this._processWithResampling(input, output)
    } else {
      this._processDirect(input, output)
    }

    return true
  }

  /**
   * Direct processing path — AudioContext is already at 48kHz.
   * Accumulate 128-sample blocks into 480-sample frames, process, drain output.
   *
   * 480 / 128 = 3.75 — so a 128-sample block will sometimes straddle a frame
   * boundary. When this happens, we fill the remaining space in the ring buffer,
   * process the full 480-sample frame, then carry the leftover samples into the
   * next frame's ring buffer.
   */
  _processDirect(input, output) {
    let inputIdx = 0

    while (inputIdx < RENDER_QUANTUM) {
      // How many samples we can still fit into the current 480-sample frame
      const spaceLeft = RNNOISE_FRAME_SIZE - this._inputOffset
      // How many input samples we still need to consume from this render quantum
      const samplesLeft = RENDER_QUANTUM - inputIdx
      // Copy whichever is smaller: remaining space or remaining input
      const toCopy = Math.min(spaceLeft, samplesLeft)

      // Copy a chunk of the input into the ring buffer
      this._inputRing.set(input.subarray(inputIdx, inputIdx + toCopy), this._inputOffset)
      this._inputOffset += toCopy
      inputIdx += toCopy

      // When we've accumulated a full 480-sample frame, process it
      if (this._inputOffset >= RNNOISE_FRAME_SIZE) {
        const processedFrame = this._processFrame(this._inputRing)
        this._outputQueue.push(processedFrame)
        this._inputOffset = 0
      }
    }

    // Drain processed output into the 128-sample output block
    this._drainOutput(output)
  }

  /**
   * Resampling path — AudioContext is NOT at 48kHz (e.g., 44100Hz).
   * Upsample input to 48kHz, process through RNNoise, downsample output.
   *
   * Uses linear interpolation — simple and sufficient for voice frequencies.
   */
  _processWithResampling(input, output) {
    // Upsample: convert 128 context-rate samples to ~N 48kHz samples
    const ratio = this._resampleRatio
    let phase = this._resampleInputPhase
    let outIdx = 0

    for (let i = 0; i < RENDER_QUANTUM; i++) {
      // Linear interpolation between current and next sample
      while (phase < 1.0 && outIdx < this._resampleInputBuffer.length) {
        const sample = input[i] * (1 - phase) + (input[i + 1] || input[i]) * phase
        this._resampleInputBuffer[outIdx++] = sample
        phase += 1.0 / ratio
      }
      phase -= 1.0
    }
    this._resampleInputPhase = phase

    // Feed resampled samples into the ring buffer
    for (let i = 0; i < outIdx; i++) {
      this._inputRing[this._inputOffset++] = this._resampleInputBuffer[i]

      if (this._inputOffset >= RNNOISE_FRAME_SIZE) {
        const processedFrame = this._processFrame(this._inputRing)
        // Downsample the processed 480-sample frame back to context rate
        const downsampled = this._downsampleFrame(processedFrame)
        this._outputQueue.push(downsampled)
        this._inputOffset = 0
      }
    }

    // Drain processed output
    this._drainOutput(output)
  }

  /**
   * Downsample a 480-sample 48kHz frame to context sample rate.
   * Returns a Float32Array of the appropriate length.
   */
  _downsampleFrame(frame48k) {
    const outLength = Math.round(RNNOISE_FRAME_SIZE / this._resampleRatio)
    const result = new Float32Array(outLength)
    const step = RNNOISE_FRAME_SIZE / outLength

    for (let i = 0; i < outLength; i++) {
      const srcPos = i * step
      const srcIdx = Math.floor(srcPos)
      const frac = srcPos - srcIdx
      const s0 = frame48k[srcIdx]
      const s1 = frame48k[Math.min(srcIdx + 1, RNNOISE_FRAME_SIZE - 1)]
      result[i] = s0 + (s1 - s0) * frac
    }

    return result
  }

  /**
   * Process a single 480-sample frame through RNNoise.
   * Returns a new Float32Array with the denoised audio.
   *
   * INT16 SCALING:
   * The RNNoise C API expects float samples in int16 range (±32768).
   * Web Audio uses normalized [-1.0, 1.0] floats. We must:
   *   1. Scale input UP by 32768 before writing to WASM memory
   *   2. Call rnnoise_process_frame
   *   3. Scale output DOWN by 32768 before returning to Web Audio
   *
   * Without this scaling, all input values appear near-zero to the neural
   * network, VAD always reports 0.000, and no suppression occurs.
   */
  _processFrame(frame) {
    const Module = this._module

    // Get the HEAPF32 view — may have been invalidated by memory growth,
    // but the Module's updateGlobalBufferAndViews handles this automatically
    // when _emscripten_resize_heap is called. We use Module.HEAPF32 directly.
    const heapF32 = Module['HEAPF32']

    // Byte offsets → float32 indices (divide by 4)
    const inputOffset = this._inputPtr >> 2
    const outputOffset = this._outputPtr >> 2

    // Copy input to WASM memory, scaling from Web Audio [-1,1] to int16 range [±32768].
    // RNNoise expects this range — the neural network was trained on int16-scaled data.
    for (let i = 0; i < RNNOISE_FRAME_SIZE; i++) {
      heapF32[inputOffset + i] = frame[i] * INT16_SCALE
    }

    // Process — returns VAD probability (0.0 to 1.0)
    // rnnoise_process_frame(DenoiseState*, float* out, const float* in)
    const vadProb = Module._rnnoise_process_frame(
      this._rnnoiseState,
      this._outputPtr,
      this._inputPtr
    )

    // Copy output from WASM memory, scaling back from int16 range to Web Audio [-1,1]
    const result = new Float32Array(RNNOISE_FRAME_SIZE)
    for (let i = 0; i < RNNOISE_FRAME_SIZE; i++) {
      result[i] = heapF32[outputOffset + i] / INT16_SCALE
    }

    // ── VAD-gated attenuation ──
    // Apply additional suppression to frames RNNoise considers mostly noise.
    // This is the "aggressiveness" knob — RNNoise alone leaves some residual
    // noise; the VAD gate pushes those frames closer to silence.
    //
    // Target gain calculation:
    //   VAD >= threshold → 1.0 (speech passes through untouched)
    //   VAD < threshold  → linear ramp: vadProb / threshold
    //     e.g., threshold=0.5, VAD=0.02 → gain = 0.02/0.5 = 0.04 (96% attenuation)
    //     e.g., threshold=0.5, VAD=0.4  → gain = 0.4/0.5 = 0.8 (20% attenuation)
    const targetGain = vadProb >= this._vadGateThreshold
      ? 1.0
      : vadProb / this._vadGateThreshold

    // Smooth the gain transition to prevent clicks at speech/noise boundaries.
    // Exponential moving average: gain changes gradually over ~3-5 frames (~30-50ms).
    this._smoothedGain += (targetGain - this._smoothedGain) * this._gainSmoothingFactor

    // Apply the smoothed gate gain to all samples in the frame
    if (this._smoothedGain < 0.999) {
      for (let i = 0; i < RNNOISE_FRAME_SIZE; i++) {
        result[i] *= this._smoothedGain
      }
    }

    // Report VAD periodically (~every 500ms) to the main thread.
    // Used for console debug output and future features (auto-silence-trim, auto-stop).
    this._vadCounter++
    this._lastVadProb = vadProb
    if (this._vadCounter >= VAD_REPORT_INTERVAL) {
      this.port.postMessage({ type: 'vad', probability: vadProb })
      this._vadCounter = 0
    }

    return result
  }

  /**
   * Drain processed audio from the output queue into the 128-sample output block.
   * If no processed audio is available yet (pipeline filling), output silence.
   */
  _drainOutput(output) {
    let written = 0

    while (written < RENDER_QUANTUM && this._outputQueue.length > 0) {
      const currentFrame = this._outputQueue[0]
      const available = currentFrame.length - this._outputReadOffset
      const needed = RENDER_QUANTUM - written
      const toCopy = Math.min(available, needed)

      // Copy from the current output frame into the output block
      for (let i = 0; i < toCopy; i++) {
        output[written + i] = currentFrame[this._outputReadOffset + i]
      }

      written += toCopy
      this._outputReadOffset += toCopy

      // If we've consumed the entire frame, remove it from the queue
      if (this._outputReadOffset >= currentFrame.length) {
        this._outputQueue.shift()
        this._outputReadOffset = 0
      }
    }

    // If we didn't fill the output (queue empty — pipeline still filling),
    // the remaining samples stay at 0 (silence). This only happens for the
    // first few render quanta while the ring buffer is accumulating.

    // Output queue health check — warn on backpressure (queue growing) or underrun
    if (this._outputQueue.length > 4) {
      console.warn(`[RNNoise] Output queue backpressure: ${this._outputQueue.length} frames queued`)
    }
  }

  // ─── Cleanup ──────────────────────────────────────────────────────────

  _destroy() {
    console.log('[RNNoise] Destroy started — freeing WASM state and memory')
    this._destroyed = true
    this._enabled = false

    if (this._module && this._rnnoiseState) {
      try {
        // Free the RNNoise denoise state (GRU layers, filter banks, etc.)
        this._module._rnnoise_destroy(this._rnnoiseState)
        console.log(`[RNNoise] DenoiseState freed (ptr: ${this._rnnoiseState})`)
      } catch (e) {
        console.warn('[RNNoise] rnnoise_destroy failed:', e.message || e)
      }
      try {
        // Free the input/output frame buffers from WASM memory
        if (this._inputPtr) this._module._free(this._inputPtr)
        if (this._outputPtr) this._module._free(this._outputPtr)
        console.log(`[RNNoise] Frame buffers freed (input: ${this._inputPtr}, output: ${this._outputPtr})`)
      } catch (e) {
        console.warn('[RNNoise] Buffer free failed:', e.message || e)
      }
    } else {
      console.warn(`[RNNoise] Destroy skipped WASM cleanup — module: ${!!this._module}, state: ${this._rnnoiseState}`)
    }

    this._rnnoiseState = 0
    this._module = null
    this._wasmReady = false
    console.log('[RNNoise] Destroy complete')
  }
}

registerProcessor('rnnoise-processor', RNNoiseProcessor)
