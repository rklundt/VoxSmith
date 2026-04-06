/**
 * VoxSmith - Voice Processing for Indie Game Developers
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
 * AudioEngine - Central Audio Engine (Stage 2)
 *
 * Owns the AudioContext, manages the real-time effects chain, and handles
 * playback of both original and Stage 1-processed audio buffers.
 *
 * THREE-STAGE PIPELINE CONTEXT:
 *   Stage 1 (offline): Rubber Band CLI processes pitch/formant/tempo → produces processedBuffer
 *   Stage 2 (real-time): THIS - plays audio through Web Audio effects chain (EQ, compressor, etc.)
 *   Stage 3 (export): FFmpeg renders final output with noise gate, normalization, etc.
 *
 * WHAT THIS CLASS OWNS:
 * - AudioContext lifecycle (create, resume, close)
 * - EffectsChain instance (all Web Audio nodes for real-time effects)
 * - AudioBufferSourceNode for playback
 * - Volume control (pre-effects gain)
 * - Two audio buffers: original (raw file) and processed (Stage 1 output)
 *
 * WHAT THIS CLASS DOES NOT OWN:
 * - Stage 1 processing (that's in main process via IPC)
 * - UI state (that's in engineStore via Zustand)
 *
 * MIC INPUT (Sprint 7 + 7.2):
 * Mic audio routes through the same effects chain as file playback.
 * A MediaStreamSource replaces the AudioBufferSourceNode as the signal source.
 * Signal chain: mic → micGain → inputAnalyser → volumeGain → [RNNoise] → effects → speakers
 * Recording captures audio after micGain (includes gain boost) but before effects,
 * so takes can be re-processed with different settings later.
 *
 * SINGLETON PATTERN:
 * There should only be one AudioEngine per app session. The useAudioEngine hook
 * creates it once and holds a ref. Multiple components can read its state via
 * the engineStore, but only the hook mutates it.
 */

import { EffectsChain } from './EffectsChain'
import { acquireMicStream, releaseMicStream, RecordingBuffer } from './MicInput'
import type { MicStreamOptions } from './MicInput'
import type { EngineSnapshot, EffectName } from '../../shared/types'

export type PlaybackStatus = 'idle' | 'playing' | 'paused'

export class AudioEngine {
  private ctx: AudioContext
  private effectsChain: EffectsChain

  // Pre-effects volume control - this is the user's "volume" slider.
  // Sits between the source and the effects chain input.
  // GainNode is a native AudioParam, so it updates smoothly without zipper noise.
  private volumeGain: GainNode

  // The currently playing source node. AudioBufferSourceNode is single-use:
  // once stop() is called, it cannot be restarted. A new one must be created
  // for each play() call. This is a Web Audio API design constraint.
  private sourceNode: AudioBufferSourceNode | null = null

  // ─── Audio Buffers ──────────────────────────────────────────────────

  // The original audio loaded from a WAV/MP3 file, before any processing.
  // Kept so we can re-run Stage 1 with different parameters without reloading.
  private _originalBuffer: AudioBuffer | null = null

  // The Stage 1-processed audio (pitch/formant/tempo applied by Rubber Band CLI).
  // This is what actually gets played through the effects chain.
  // If null, the original buffer is played instead (no Stage 1 processing applied).
  private _processedBuffer: AudioBuffer | null = null

  // Track playback state - used by the hook to update the store
  private _status: PlaybackStatus = 'idle'

  // Callback fired when playback ends naturally (source reached end of buffer).
  // The hook uses this to update the store's isPlaying state.
  private onPlaybackEnd: (() => void) | null = null

  // Track the current playback start time for pause/resume offset calculation
  private playbackStartTime = 0
  private playbackOffset = 0

  // Loop mode - when true, audio restarts from the beginning when it reaches the end.
  // Setting sourceNode.loop = true tells Web Audio to loop natively (no gap, seamless).
  private _loop = false

  // ─── Mic Input (Sprint 7) ─────────────────────────────────────────────

  // The active MediaStream from getUserMedia. Null when not in mic mode.
  private micStream: MediaStream | null = null

  // MediaStreamSourceNode connects the mic stream to the audio graph.
  // Created fresh each time mic input starts (like AudioBufferSourceNode, it's tied
  // to a specific stream and cannot be reattached).
  private micSourceNode: MediaStreamAudioSourceNode | null = null

  // Whether the engine is currently in mic input mode vs file playback mode.
  // When true, Stage 1 controls (pitch/formant/tempo) should be disabled in the UI.
  private _micActive = false

  // Monitor mute: when true, mic audio does NOT go to speakers/headphones.
  // Recording still captures raw audio. This prevents feedback loops when
  // the user doesn't have headphones — the mic picks up speaker output,
  // which gets re-processed (especially noticeable with reverb/delay effects).
  // Default is true (muted) to prevent feedback by default.
  private _monitorMuted = true

  // GainNode used to mute/unmute monitoring output. Sits between the effects
  // chain output and the analyser→destination. When muted, gain=0 silences
  // speakers but the recording tap (before effects) still captures audio.
  private monitorGain: GainNode

  // ─── Mic Gain & Input Metering (Sprint 7.2) ──────────────────────────

  // Software pre-amp for the mic signal. Sits between micSourceNode and volumeGain.
  // Boosts (or cuts) the raw mic signal before it enters the effects chain.
  // This compensates for OS-level mic gain settings that can't be controlled from
  // Web Audio — if Windows mic is set to 50%, this slider lets the user boost in-app.
  // Also affects the recorder tap (recorder taps AFTER this gain) so takes get the boost.
  private micGainNode: GainNode | null = null

  // AnalyserNode on the raw mic signal (after micGain, before volumeGain).
  // Used to display input level metering in the RecordingPanel — shows the user
  // how hot their signal is coming in, independent of the monitoring volume slider.
  private inputAnalyser: AnalyserNode | null = null

  // Reusable Float32Array for reading input level samples (avoids GC per frame).
  // Explicit ArrayBuffer generic needed — Web Audio API's getFloatTimeDomainData()
  // expects Float32Array<ArrayBuffer>, not Float32Array<ArrayBufferLike>.
  private inputAnalyserData: Float32Array<ArrayBuffer> | null = null

  // ─── Noise Suppression (Sprint 7.2) ──────────────────────────────────

  // RNNoise AudioWorklet node — processes audio through a neural-network noise
  // suppressor. Sits between volumeGain and effects chain input in the mic path:
  //   mic → volumeGain → [rnnoiseNode] → effects chain → speakers
  // The recorder tap branches off BEFORE this node (from micSourceNode) to
  // capture raw/dry audio for later re-processing.
  private rnnoiseNode: AudioWorkletNode | null = null

  // Whether the RNNoise worklet module has been loaded (addModule is async)
  private rnnoiseWorkletReady = false

  // Whether WASM loaded successfully inside the worklet processor
  private _rnnoiseAvailable = false

  // ─── Recording (Sprint 7) ───────────────────────────────────────────

  // AudioWorkletNode taps the pre-effects signal to capture raw mic audio.
  // We capture pre-effects so recorded takes can be re-processed with different
  // Stage 2 settings later. The user hears post-effects audio through speakers.
  //
  // PARALLEL TAP ARCHITECTURE: The recorder is connected as a side-branch off
  // the mic source, NOT inline in the monitoring path. This avoids any audio
  // interruption when recording starts/stops:
  //   mic ──┬── volumeGain → effects → speakers  (monitoring, never touched)
  //         └── recorderNode → (nowhere)           (capture only)
  //
  // The worklet processor (recorder-processor.js) runs on the audio rendering
  // thread and sends sample copies to the main thread via MessagePort.
  private recorderNode: AudioWorkletNode | null = null

  // Whether the recorder worklet module has been loaded (addModule is async,
  // must be called once before creating any AudioWorkletNode).
  private recorderWorkletReady = false

  // Silent gain node connected to destination — keeps the recorder worklet alive.
  // Some browsers won't call process() on an AudioWorkletNode whose output
  // goes nowhere (optimization). Connecting through a zero-gain node to
  // destination forces the browser to keep processing the node.
  private recorderKeepAlive: GainNode | null = null

  // Collects raw PCM samples during recording
  private recordingBuffer: RecordingBuffer | null = null

  // Whether we're currently recording audio from the mic
  private _isRecording = false

  // ─── Level Metering (Sprint 4) ───────────────────────────────────────

  // AnalyserNode sits at the end of the signal chain (after effects, before destination).
  // It performs a real-time FFT on the audio stream without modifying it.
  // We use it to read peak amplitude for the level meter and clip detection.
  private analyser: AnalyserNode

  // Reusable typed array for reading time-domain amplitude samples.
  // Allocated once in the constructor to avoid per-frame GC pressure.
  // A4: Use standard Float32Array type instead of non-standard Float32Array<ArrayBuffer> generic.
  // A4: Explicit ArrayBuffer generic needed — Web Audio API's getFloatTimeDomainData()
  // expects Float32Array<ArrayBuffer>, not Float32Array<ArrayBufferLike>
  private analyserData: Float32Array<ArrayBuffer>

  constructor() {
    // Create the AudioContext - this is the "audio universe" everything lives in.
    // All nodes, buffers, and timing are relative to this context.
    this.ctx = new AudioContext()

    // Create the effects chain (EQ, compressor, high-pass, etc.)
    this.effectsChain = new EffectsChain(this.ctx)

    // Pre-effects volume control
    this.volumeGain = this.ctx.createGain()
    this.volumeGain.gain.value = 1.0

    // AnalyserNode for level metering - inserted between effects output and destination.
    // fftSize=2048 gives us 2048 time-domain samples per read - enough for accurate
    // peak detection without excessive CPU cost. smoothingTimeConstant=0.8 gives a
    // visually smooth meter that still responds quickly to transients.
    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = 2048
    this.analyser.smoothingTimeConstant = 0.8
    this.analyserData = new Float32Array(this.analyser.fftSize)

    // Monitor gain control — sits between analyser and destination.
    // When muted (gain=0), no audio goes to speakers/headphones.
    // The analyser still reads levels (it's before the monitor gate).
    this.monitorGain = this.ctx.createGain()
    this.monitorGain.gain.value = 1.0 // unmuted by default for file playback

    // Wire: volumeGain -> effectsChain.input -> [chain] -> effectsChain.output -> analyser -> monitorGain -> destination
    this.volumeGain.connect(this.effectsChain.input)
    this.effectsChain.output.connect(this.analyser)
    this.analyser.connect(this.monitorGain)
    this.monitorGain.connect(this.ctx.destination)
  }

  // ─── Buffer Management ────────────────────────────────────────────────

  /**
   * Loads raw audio data (WAV/MP3 bytes) and decodes it into an AudioBuffer.
   * This is called when the user opens a file - the raw bytes come from the
   * renderer's file input or from a file:// URL fetch.
   *
   * @param arrayBuffer - Raw audio file bytes (WAV, MP3, etc.)
   */
  async loadFile(arrayBuffer: ArrayBuffer): Promise<void> {
    // Ensure context is running (may be suspended if no user gesture yet)
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume()
    }

    // decodeAudioData parses the WAV/MP3 header and PCM data into an AudioBuffer.
    // The AudioBuffer holds deinterleaved Float32 channel data ready for playback.
    this._originalBuffer = await this.ctx.decodeAudioData(arrayBuffer)
    // Clear any previous Stage 1 processing - user loaded a new file
    this._processedBuffer = null
  }

  /**
   * Loads Stage 1-processed audio data (WAV bytes from Rubber Band CLI output).
   * Called after the IPC processAudio() call returns successfully.
   *
   * @param arrayBuffer - WAV file bytes from the Rubber Band CLI output
   */
  async loadProcessedBuffer(arrayBuffer: ArrayBuffer): Promise<void> {
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume()
    }
    this._processedBuffer = await this.ctx.decodeAudioData(arrayBuffer)
  }

  /**
   * Returns the buffer that should be played - processed if available, otherwise original.
   * This is the "active" buffer that goes through Stage 2 effects.
   */
  get activeBuffer(): AudioBuffer | null {
    return this._processedBuffer ?? this._originalBuffer
  }

  /** Whether an original file has been loaded */
  get hasOriginal(): boolean {
    return this._originalBuffer !== null
  }

  /** Whether Stage 1 processing has been applied */
  get hasProcessed(): boolean {
    return this._processedBuffer !== null
  }

  /**
   * Clears the Stage 1 processed buffer so the original plays directly.
   * Called when the user resets Stage 1 params to defaults and clicks Apply -
   * they want to "un-process" back to the raw recording.
   */
  clearProcessedBuffer(): void {
    this._processedBuffer = null
  }

  /** The original unprocessed buffer (needed for re-running Stage 1) */
  get originalBuffer(): AudioBuffer | null {
    return this._originalBuffer
  }

  /** Duration of the active buffer in seconds */
  get duration(): number {
    return this.activeBuffer?.duration ?? 0
  }

  /** Current playback status */
  get status(): PlaybackStatus {
    return this._status
  }

  /** The AudioContext - exposed for components that need it (e.g., waveform rendering) */
  get audioContext(): AudioContext {
    return this.ctx
  }

  // ─── Playback Controls ────────────────────────────────────────────────

  /**
   * Starts playback of the active buffer through the effects chain.
   *
   * Creates a new AudioBufferSourceNode each time (Web Audio requirement:
   * source nodes are single-use - once stopped, they cannot be restarted).
   *
   * @param onEnd - Optional callback when playback finishes naturally
   */
  async play(onEnd?: () => void): Promise<void> {
    const buffer = this.activeBuffer
    if (!buffer) return

    // Stop any existing playback first
    this.stopSource()

    // B1: Ensure context is running — must await to prevent unhandled promise rejection.
    // All other resume() calls in this file are correctly awaited; this one was missed.
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume()
    }

    // Create a fresh source node for this playback
    this.sourceNode = this.ctx.createBufferSource()
    this.sourceNode.buffer = buffer

    // Set loop mode on the source node. When loop=true, Web Audio natively
    // loops the buffer with no gap - seamless and sample-accurate.
    this.sourceNode.loop = this._loop

    // Connect: source -> volumeGain -> effectsChain -> destination
    this.sourceNode.connect(this.volumeGain)

    // Handle natural end of playback (buffer finished playing).
    // Note: when loop=true, onended only fires after stop() is called,
    // NOT at the loop boundary - Web Audio handles looping internally.
    this.onPlaybackEnd = onEnd ?? null
    this.sourceNode.onended = () => {
      this._status = 'idle'
      this.sourceNode = null
      this.playbackOffset = 0
      this.onPlaybackEnd?.()
    }

    // Start playback from the current offset (0 for fresh play, >0 for resume)
    this.sourceNode.start(0, this.playbackOffset)
    this.playbackStartTime = this.ctx.currentTime
    this._status = 'playing'
  }

  /**
   * Pauses playback by stopping the source and recording the current position.
   * Resume by calling play() again - it will start from the paused offset.
   */
  pause(): void {
    if (this._status !== 'playing' || !this.sourceNode) return

    // Calculate how far into the buffer we've played
    this.playbackOffset += this.ctx.currentTime - this.playbackStartTime

    // Kill the onended handler before stopping to prevent the race condition
    // where onended fires asynchronously and resets state after we've already
    // set it to 'paused'. (This was a Sprint 1 bug fix.)
    this.sourceNode.onended = null
    this.sourceNode.stop()
    this.sourceNode.disconnect()
    this.sourceNode = null

    this._status = 'paused'
  }

  /**
   * Stops playback completely and resets to the beginning.
   */
  stop(): void {
    this.stopSource()
    this.playbackOffset = 0
    this._status = 'idle'
  }

  /**
   * Internal: stops the current source node without changing status.
   */
  private stopSource(): void {
    if (this.sourceNode) {
      // Null out onended before stop() to prevent the async race condition
      // where onended fires after we've already updated state.
      this.sourceNode.onended = null
      try {
        this.sourceNode.stop()
      } catch {
        // stop() throws if the source hasn't started yet - safe to ignore
      }
      this.sourceNode.disconnect()
      this.sourceNode = null
    }
  }

  // ─── Seek (Sprint 4) ─────────────────────────────────────────────────

  /**
   * Seeks to a specific position in the audio buffer.
   *
   * Because AudioBufferSourceNode is single-use in Web Audio, seeking during
   * playback requires stopping the current source, setting the offset, and
   * creating a new source that starts from the new position. If paused or
   * idle, we just update the offset so the next play() starts from there.
   *
   * @param seconds - Position to seek to (clamped to buffer duration)
   */
  seek(seconds: number, onEnd?: () => void): void {
    const buffer = this.activeBuffer
    if (!buffer) return

    // Clamp to valid range
    const clampedSeconds = Math.max(0, Math.min(seconds, buffer.duration))

    if (this._status === 'playing') {
      // Seeking during playback: stop current source, set new offset, restart
      this.stopSource()
      this.playbackOffset = clampedSeconds
      // Re-create source and start from new offset
      this.sourceNode = this.ctx.createBufferSource()
      this.sourceNode.buffer = buffer
      this.sourceNode.loop = this._loop
      this.sourceNode.connect(this.volumeGain)

      this.onPlaybackEnd = onEnd ?? this.onPlaybackEnd
      this.sourceNode.onended = () => {
        this._status = 'idle'
        this.sourceNode = null
        this.playbackOffset = 0
        this.onPlaybackEnd?.()
      }

      this.sourceNode.start(0, clampedSeconds)
      this.playbackStartTime = this.ctx.currentTime
      this._status = 'playing'
    } else {
      // Not playing: just update the offset for next play()
      this.playbackOffset = clampedSeconds
    }
  }

  /**
   * Returns the current playback position in seconds.
   * Used by the waveform playhead to track progress.
   *
   * During playback, this is calculated from the AudioContext clock.
   * When paused, it returns the stored offset.
   * When idle, it returns 0.
   */
  get currentTime(): number {
    if (this._status === 'playing' && this.sourceNode) {
      const elapsed = this.ctx.currentTime - this.playbackStartTime
      const position = this.playbackOffset + elapsed
      const duration = this.activeBuffer?.duration ?? 0
      // When looping, wrap position around the buffer duration
      if (this._loop && duration > 0) {
        return position % duration
      }
      return Math.min(position, duration)
    }
    // When paused or idle, return the stored offset. This covers:
    //  - Paused: offset is where playback was paused
    //  - Idle after seek: user clicked waveform to position cursor, seek() stored it
    //  - Idle after stop: stop() resets offset to 0, so this still returns 0
    return this.playbackOffset
  }

  // ─── Level Metering (Sprint 4) ────────────────────────────────────────

  /**
   * Returns the current output peak level as a value from 0.0 to 1.0+.
   * Values above 1.0 indicate clipping (the signal exceeds 0 dBFS).
   *
   * Reads time-domain samples from the AnalyserNode and finds the peak
   * absolute value. This is called on every animation frame by the level
   * meter component for smooth, responsive visual feedback.
   *
   * PERFORMANCE NOTE: getFloatTimeDomainData() copies samples into a
   * pre-allocated Float32Array (no allocation per call), so this is safe
   * to call at 60fps without GC pressure.
   */
  getOutputLevel(): number {
    this.analyser.getFloatTimeDomainData(this.analyserData)
    let peak = 0
    for (let i = 0; i < this.analyserData.length; i++) {
      const abs = Math.abs(this.analyserData[i])
      if (abs > peak) peak = abs
    }
    return peak
  }

  // ─── Real-Time Parameter Updates (Stage 2) ────────────────────────────

  /**
   * Sets the pre-effects volume level.
   * Uses setValueAtTime for smooth, click-free updates.
   *
   * @param value - 0.0 (silence) to 4.0 (400% boost). 1.0 = unity.
   */
  setVolume(value: number): void {
    this.volumeGain.gain.setValueAtTime(value, this.ctx.currentTime)
  }

  /**
   * Sets the mic input gain (software pre-amp).
   * Boosts (or cuts) the raw mic signal before it enters the volume slider and effects chain.
   * Also affects recorded takes — the gain is applied before the recorder tap.
   *
   * Use this when the OS mic gain is set too low and the signal comes in quiet.
   * Unlike the volume slider (which only affects monitoring), this affects recordings too.
   *
   * @param value - 0.0 (silence) to 4.0 (400% boost). 1.0 = unity (no change).
   */
  setMicGain(value: number): void {
    if (this.micGainNode) {
      this.micGainNode.gain.setValueAtTime(value, this.ctx.currentTime)
    }
  }

  /**
   * Returns the current mic input peak level as a value from 0.0 to 1.0+.
   * Values above 1.0 indicate the input signal is clipping.
   *
   * Reads from an AnalyserNode positioned after mic gain but before volume/effects.
   * Shows the true input signal strength — use this to judge whether the mic
   * gain needs boosting. Returns 0 if mic is not active.
   *
   * Called on every animation frame by the RecordingPanel input level meter.
   */
  getInputLevel(): number {
    if (!this.inputAnalyser || !this.inputAnalyserData) return 0
    this.inputAnalyser.getFloatTimeDomainData(this.inputAnalyserData)
    let peak = 0
    for (let i = 0; i < this.inputAnalyserData.length; i++) {
      const abs = Math.abs(this.inputAnalyserData[i])
      if (abs > peak) peak = abs
    }
    return peak
  }

  /**
   * Applies all Stage 2 effects from an EngineSnapshot.
   * Called when loading a preset or resetting to defaults.
   * Stage 1 params (pitch/formant/tempo) in the snapshot are ignored here.
   */
  applySnapshot(snapshot: EngineSnapshot): void {
    this.effectsChain.applySnapshot(snapshot)
  }

  /**
   * Updates a single EQ band in real time.
   */
  setEQBand(index: number, gain: number, frequency: number): void {
    this.effectsChain.setEQBand(index, { gain, frequency })
  }

  /**
   * Updates the high-pass filter cutoff.
   */
  setHighPassFrequency(hz: number): void {
    this.effectsChain.setHighPassFrequency(hz)
  }

  /**
   * Updates the spectral tilt (voice brightness/darkness).
   * Range: -10 (very dark/warm — giant, dragon) to +10 (very bright/thin — fairy, child).
   * 0 = neutral (no spectral modification).
   * Uses a low shelf + high shelf pair with opposing gains to tilt the entire
   * frequency spectrum. Placed after high-pass, before EQ in the signal chain.
   */
  setSpectralTilt(tilt: number): void {
    this.effectsChain.setSpectralTilt(tilt)
  }

  /**
   * Updates the compressor threshold.
   */
  setCompressorThreshold(db: number): void {
    this.effectsChain.setCompressorThreshold(db)
  }

  /**
   * Updates the compressor ratio.
   */
  setCompressorRatio(ratio: number): void {
    this.effectsChain.setCompressorRatio(ratio)
  }

  /**
   * Updates the output gain (master volume after effects).
   * @param gain - 0.0 (silence) to 2.0 (boost). 1.0 = unity.
   */
  setOutputGain(gain: number): void {
    this.effectsChain.setOutputGain(gain)
  }

  // ── Tone.js Effects ────────────────────────────────────────────────────

  /**
   * Updates vibrato rate and depth in real time.
   * Rate = LFO speed in Hz (how fast pitch wavers).
   * Depth = 0-1 (how wide the pitch swing is). depth=0 disables vibrato.
   */
  setVibrato(rate: number, depth: number): void {
    this.effectsChain.setVibrato(rate, depth)
  }

  /**
   * Updates tremolo rate and depth in real time.
   * Rate = LFO speed in Hz (how fast volume pulses).
   * Depth = 0-1 (how strong the pulsing is). depth=0 disables tremolo.
   */
  setTremolo(rate: number, depth: number): void {
    this.effectsChain.setTremolo(rate, depth)
  }

  /**
   * Updates reverb room size and amount.
   * roomSize = 0-1 (maps to decay time: small room → cathedral).
   * amount = 0-1 (how much reverb is mixed in).
   */
  setReverb(roomSize: number, amount: number): void {
    this.effectsChain.setReverb(roomSize, amount)
  }

  // ── Custom Effects ─────────────────────────────────────────────────────

  /**
   * Updates vocal fry intensity (0-1).
   * Controls the depth of sub-audio AM modulation.
   * 0 = clean voice, 1 = heavy crackling fry.
   */
  setVocalFry(intensity: number): void {
    this.effectsChain.setVocalFry(intensity)
  }

  /**
   * Updates breathiness amount (0-1).
   * Controls spectral reshaping intensity - low-shelf cut + high-shelf boost
   * simulate the open-glottis airy quality of breathy speech.
   * 0 = normal voice, 1 = fully reshaped (thin body, lots of air).
   */
  setBreathiness(amount: number): void {
    this.effectsChain.setBreathiness(amount)
  }

  /**
   * Updates breathiness 2 amount (0-1).
   * Vocal processing method - layers a processed "air" track on top of the
   * original voice (HPF 500Hz + high-shelf boost 8kHz + gentle compression).
   * 0 = original voice only, 1 = full breathy air track layered in.
   */
  setBreathiness2(amount: number): void {
    this.effectsChain.setBreathiness2(amount)
  }

  // ── Wet/Dry Mix ────────────────────────────────────────────────────────

  /**
   * Sets the wet/dry mix for a specific effect.
   * @param effect - Which effect to adjust
   * @param mix - 0.0 (full dry) to 1.0 (full wet)
   */
  setWetDry(effect: EffectName, mix: number): void {
    this.effectsChain.setWetDry(effect, mix)
  }

  // ── Bypass ─────────────────────────────────────────────────────────────

  /**
   * Enables or disables bypass mode.
   * When bypassed, the signal skips the entire effects chain -
   * useful for instant A/B comparison of processed vs. original.
   */
  setBypass(bypassed: boolean): void {
    this.effectsChain.setBypass(bypassed)
  }

  // ── Loop ──────────────────────────────────────────────────────────────

  /** Whether loop mode is currently enabled */
  get loop(): boolean {
    return this._loop
  }

  /**
   * Enables or disables loop mode.
   * When enabled, playback restarts seamlessly from the beginning when
   * the audio reaches the end. Uses Web Audio's native sourceNode.loop
   * for gapless, sample-accurate looping.
   *
   * If audio is currently playing, the loop flag is applied to the
   * active source node immediately (takes effect at the next boundary).
   */
  setLoop(loop: boolean): void {
    this._loop = loop
    // Apply to currently playing source node if one exists.
    // Changing .loop on a playing source takes effect immediately -
    // if switching from loop=true to loop=false, the current iteration
    // finishes and then playback stops normally (onended fires).
    if (this.sourceNode) {
      this.sourceNode.loop = loop
    }
  }

  // ─── Mic Input (Sprint 7) ──────────────────────────────────────────────

  /** Whether the engine is in mic input mode */
  get micActive(): boolean {
    return this._micActive
  }

  /** Whether audio is currently being recorded */
  get isRecording(): boolean {
    return this._isRecording
  }

  /** Whether monitoring output is muted (no audio to speakers) */
  get monitorMuted(): boolean {
    return this._monitorMuted
  }

  /**
   * Mutes or unmutes monitoring output.
   *
   * When muted, mic audio still flows through the effects chain (for recording
   * and level metering) but nothing goes to speakers/headphones. This prevents
   * feedback loops when the user isn't wearing headphones.
   *
   * File playback is NOT affected by this — only mic monitoring respects the mute.
   * When mic stops, monitor is automatically unmuted for normal playback.
   */
  setMonitorMute(muted: boolean): void {
    this._monitorMuted = muted
    // Only apply the mute when mic is active — don't silence file playback
    if (this._micActive) {
      this.monitorGain.gain.setValueAtTime(muted ? 0 : 1, this.ctx.currentTime)
    }
  }

  /**
   * Starts live mic input through the effects chain.
   *
   * Acquires a MediaStream for the specified device, creates a
   * MediaStreamSourceNode, and routes it through the same effects chain
   * used for file playback. The user hears their processed voice in
   * real time — this is the monitoring path.
   *
   * File playback is stopped when mic input starts. The two input modes
   * are mutually exclusive to prevent signal conflicts in the chain.
   *
   * @param options - Mic stream options (device ID, etc.)
   */
  async startMicInput(options: MicStreamOptions = {}): Promise<void> {
    // Stop any file playback first — can't have two sources in the chain
    this.stop()

    // Ensure context is running (autoplay policy may have suspended it)
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume()
    }

    // Acquire the mic stream with the specified options
    this.micStream = await acquireMicStream(options)

    // Create a source node from the mic stream and route it into the effects chain.
    // MediaStreamSourceNode is the bridge between getUserMedia and Web Audio API.
    this.micSourceNode = this.ctx.createMediaStreamSource(this.micStream)

    // ── Mic Gain & Input Metering (Sprint 7.2) ──
    // Create a software pre-amp GainNode at the very front of the mic chain.
    // This sits between the raw mic source and everything else, so both
    // the monitoring path AND the recorder tap benefit from the gain boost.
    // Signal chain:
    //   mic → micGainNode → inputAnalyser ─┬─ volumeGain → [rnnoise] → effects → speakers
    //                                       └─ recorderNode (parallel tap, gains included)
    this.micGainNode = this.ctx.createGain()
    this.micGainNode.gain.value = 1.0  // Unity by default — user adjusts via slider

    // AnalyserNode for input level metering — reads signal strength after mic gain
    // but before volume/effects. Lets the user see if their mic signal is too quiet.
    this.inputAnalyser = this.ctx.createAnalyser()
    this.inputAnalyser.fftSize = 2048
    this.inputAnalyser.smoothingTimeConstant = 0.8
    this.inputAnalyserData = new Float32Array(this.inputAnalyser.fftSize)

    // Wire: micSourceNode → micGainNode → inputAnalyser → volumeGain
    this.micSourceNode.connect(this.micGainNode)
    this.micGainNode.connect(this.inputAnalyser)
    this.inputAnalyser.connect(this.volumeGain)

    // ── RNNoise Noise Suppression (Sprint 7.2) ──
    // Insert the RNNoise AudioWorklet between volumeGain and the effects chain.
    // Signal chain becomes:
    //   mic → micGain → inputAnalyser → volumeGain → [rnnoiseNode] → effectsChain → speakers
    // The RNNoise node denoises the monitoring path (what the user hears).
    // Recording captures audio after micGain (so gain boost is included in takes).
    try {
      await this.ensureRnnoiseWorklet()

      // Disconnect the normal volumeGain → effects connection
      console.log('[AudioEngine] Disconnecting volumeGain → effectsChain for RNNoise insertion')
      this.volumeGain.disconnect(this.effectsChain.input)

      // Create the RNNoise worklet node
      this.rnnoiseNode = new AudioWorkletNode(this.ctx, 'rnnoise-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 1,
      })

      // Listen for messages from the RNNoise processor
      this.rnnoiseNode.port.onmessage = (event: MessageEvent) => {
        const msg = event.data
        if (msg.type === 'ready') {
          console.log('[AudioEngine] RNNoise WASM loaded successfully')
          this._rnnoiseAvailable = true
        } else if (msg.type === 'error') {
          console.error('[AudioEngine] RNNoise WASM load failed:', msg.message)
          this._rnnoiseAvailable = false
          // Fallback: reconnect volumeGain directly to effects (bypass RNNoise)
          this._bypassRnnoise()
        } else if (msg.type === 'vad') {
          // VAD probability logged for verification; future use: auto-silence-trim
          console.debug(`[AudioEngine] VAD: ${msg.probability.toFixed(2)}`)
        }
      }

      // Wire: volumeGain → rnnoiseNode → effectsChain.input
      this.volumeGain.connect(this.rnnoiseNode)
      this.rnnoiseNode.connect(this.effectsChain.input)
      console.log('[AudioEngine] Signal chain wired: volumeGain → rnnoiseNode → effectsChain')

      // Load the WASM binary into the worklet processor
      await this.loadRnnoiseWasm()

    } catch (err) {
      // RNNoise setup failed — fall back to direct connection (no denoising)
      console.warn('[AudioEngine] RNNoise setup failed, falling back to passthrough:', err)
      this._rnnoiseAvailable = false
      // Ensure volumeGain is connected to effects chain (may have been disconnected)
      try { this.volumeGain.disconnect(this.effectsChain.input) } catch { /* already disconnected */ }
      this.volumeGain.connect(this.effectsChain.input)
    }

    // Set up the recorder worklet as a persistent parallel tap on the mic source.
    // The recorder node stays connected for the entire mic session — starting and
    // stopping recording just sends messages to toggle sample forwarding.
    // This eliminates per-recording node creation/connection overhead that was
    // causing ~1s of audio to be lost at the start of each recording.
    await this.ensureRecorderWorklet()
    this.recorderNode = new AudioWorkletNode(this.ctx, 'recorder-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
    })

    // Listen for sample chunks — only collected when _isRecording is true
    this.recorderNode.port.onmessage = (event: MessageEvent) => {
      if (event.data.type === 'samples' && this.recordingBuffer && this._isRecording) {
        // B5: Validate the worklet message data is actually a Float32Array
        // before adding to the recording buffer. Defensive against malformed messages.
        const chunk = event.data.data
        if (chunk instanceof Float32Array) {
          this.recordingBuffer.addChunk(chunk)
        }
      }
    }

    // Connect recorder as a parallel tap with a keep-alive to destination.
    // The keep-alive (zero-gain) ensures the browser keeps calling process()
    // on the worklet even though the output produces no audible sound.
    // NOTE: Recorder taps from micGainNode (after mic gain, before volume/effects),
    // so recorded takes include the mic gain boost but are pre-effects/pre-RNNoise
    // for re-processing flexibility.
    this.recorderKeepAlive = this.ctx.createGain()
    this.recorderKeepAlive.gain.value = 0
    this.micGainNode.connect(this.recorderNode)
    this.recorderNode.connect(this.recorderKeepAlive)
    this.recorderKeepAlive.connect(this.ctx.destination)

    this._micActive = true

    // Apply monitor mute state — prevents feedback when not using headphones.
    // Default is muted to be safe. User can unmute if wearing headphones.
    this.monitorGain.gain.setValueAtTime(this._monitorMuted ? 0 : 1, this.ctx.currentTime)
  }

  /**
   * Stops mic input and releases the microphone.
   *
   * Disconnects the mic source node and stops all MediaStream tracks.
   * If recording is in progress, it is stopped first and the partial take
   * is preserved (the recording buffer still has the captured samples).
   */
  stopMicInput(): void {
    // Stop recording if it's in progress
    if (this._isRecording) {
      this.stopRecording()
    }

    // Clean up the persistent recorder tap and keep-alive
    if (this.recorderNode) {
      this.recorderNode.port.onmessage = null
      this.recorderNode.disconnect()
      this.recorderNode = null
    }
    if (this.recorderKeepAlive) {
      this.recorderKeepAlive.disconnect()
      this.recorderKeepAlive = null
    }

    // ── Clean up RNNoise node (Sprint 7.2) ──
    // Disconnect the RNNoise worklet and restore the direct volumeGain → effects
    // connection for file playback. The worklet module stays registered in the
    // AudioContext — only the node is destroyed. Next mic start will create a new one.
    if (this.rnnoiseNode) {
      // Send destroy message so the processor frees WASM state and memory
      console.log('[AudioEngine] Destroying RNNoise node — sending destroy, disconnecting')
      this.rnnoiseNode.port.postMessage({ type: 'destroy' })
      this.rnnoiseNode.port.onmessage = null
      try { this.rnnoiseNode.disconnect() } catch { /* already disconnected */ }
      this.rnnoiseNode = null
      this._rnnoiseAvailable = false
    } else {
      console.debug('[AudioEngine] stopMicInput — no RNNoise node to clean up')
    }

    // Restore the standard signal path: volumeGain → effectsChain.input
    // (RNNoise may have been in between, or the direct connection may already exist)
    try { this.volumeGain.disconnect(this.effectsChain.input) } catch { /* wasn't connected */ }
    this.volumeGain.connect(this.effectsChain.input)
    console.log('[AudioEngine] Signal chain restored: volumeGain → effectsChain (direct)')

    // ── Clean up mic gain and input analyser (Sprint 7.2) ──
    if (this.inputAnalyser) {
      this.inputAnalyser.disconnect()
      this.inputAnalyser = null
      this.inputAnalyserData = null
    }
    if (this.micGainNode) {
      this.micGainNode.disconnect()
      this.micGainNode = null
    }

    // Disconnect the mic source from the audio graph
    if (this.micSourceNode) {
      this.micSourceNode.disconnect()
      this.micSourceNode = null
    }

    // Release the MediaStream (frees the microphone hardware)
    if (this.micStream) {
      releaseMicStream(this.micStream)
      this.micStream = null
    }

    this._micActive = false

    // Restore monitor output for file playback — unmute regardless of mic mute setting
    this.monitorGain.gain.setValueAtTime(1, this.ctx.currentTime)
  }

  // ─── Noise Suppression Controls (Sprint 7.2) ────────────────────────

  /** Whether RNNoise WASM loaded successfully and noise suppression is available */
  get rnnoiseAvailable(): boolean {
    return this._rnnoiseAvailable
  }

  /**
   * Enables or disables noise suppression on the mic monitoring path.
   *
   * Sends a message to the RNNoise AudioWorklet processor to toggle
   * denoising on/off. When disabled, the processor passes audio through
   * unchanged (zero CPU cost). When enabled, audio goes through the
   * RNNoise neural network to strip background noise.
   *
   * Has no effect if RNNoise is not available (WASM failed to load).
   *
   * @param enabled - true to activate noise suppression, false for passthrough
   */
  setNoiseSuppression(enabled: boolean): void {
    if (!this.rnnoiseNode) {
      console.warn(`[AudioEngine] setNoiseSuppression(${enabled}) called but rnnoiseNode is null — message not sent`)
      return
    }

    // Send enable/disable message to the worklet processor.
    // The processor handles this immediately on the audio thread —
    // no latency or gap in audio output during the toggle.
    const msgType = enabled ? 'enable' : 'disable'
    this.rnnoiseNode.port.postMessage({ type: msgType })
    console.log(`[AudioEngine] Noise suppression → sent '${msgType}' to processor (rnnoiseAvailable: ${this._rnnoiseAvailable})`)
  }

  /**
   * Sets the aggressiveness of noise suppression (VAD gate threshold).
   *
   * RNNoise does the neural-network denoising, but some residual noise leaks
   * through. The VAD gate adds a second layer: frames with low voice-activity
   * probability get additional attenuation proportional to how "noise-like"
   * they are. Higher threshold = more aggressive gating.
   *
   * @param value - Threshold from 0.1 (gentle) to 0.95 (very aggressive).
   *   0.3 = gentle — only gate obvious pure-noise frames
   *   0.5 = moderate (default) — good balance of suppression vs naturalness
   *   0.7 = aggressive — gate anything that isn't clearly speech
   */
  setNoiseSuppressionAggressiveness(value: number): void {
    if (!this.rnnoiseNode) {
      console.warn(`[AudioEngine] setNoiseSuppressionAggressiveness(${value}) called but rnnoiseNode is null`)
      return
    }
    this.rnnoiseNode.port.postMessage({ type: 'set-aggressiveness', value })
    console.log(`[AudioEngine] Noise suppression aggressiveness → ${value.toFixed(2)}`)
  }

  /**
   * Ensures the RNNoise AudioWorklet module is loaded.
   *
   * Like ensureRecorderWorklet(), this must complete before creating any
   * AudioWorkletNode with the 'rnnoise-processor' name. Called lazily on
   * first mic start — the processor JS file is loaded once and stays
   * registered for the lifetime of the AudioContext.
   */
  private async ensureRnnoiseWorklet(): Promise<void> {
    if (this.rnnoiseWorkletReady) {
      console.debug('[AudioEngine] RNNoise worklet module already loaded (cached)')
      return
    }

    // Load the RNNoise processor module from the public directory.
    // In dev: Vite serves /rnnoise-processor.js from src/renderer/public/
    // In production: it's bundled into the renderer output directory.
    console.log('[AudioEngine] Loading RNNoise worklet module...')
    await this.ctx.audioWorklet.addModule('/rnnoise-processor.js')
    this.rnnoiseWorkletReady = true
    console.log('[AudioEngine] RNNoise worklet module loaded')
  }

  /**
   * Fetches the RNNoise WASM binary and sends it to the worklet processor.
   *
   * The WASM binary contains the RNNoise neural network model (~110KB).
   * It's fetched as an ArrayBuffer and sent to the processor via MessagePort,
   * where it's compiled with WebAssembly.instantiate(). The processor stays
   * in passthrough mode until this completes successfully.
   *
   * The processor will respond with { type: 'ready' } on success or
   * { type: 'error', message } on failure — handled by the port.onmessage
   * listener set up in startMicInput().
   */
  private async loadRnnoiseWasm(): Promise<void> {
    if (!this.rnnoiseNode) {
      console.warn('[AudioEngine] loadRnnoiseWasm called but rnnoiseNode is null — skipping')
      return
    }

    // Fetch the WASM binary from the public directory.
    // In dev: Vite serves /rnnoise/rnnoise.wasm from src/renderer/public/rnnoise/
    // In production: it's bundled into the renderer output directory.
    console.log('[AudioEngine] Fetching RNNoise WASM binary...')
    const fetchStart = performance.now()
    const response = await fetch('/rnnoise/rnnoise.wasm')
    if (!response.ok) {
      throw new Error(`Failed to fetch RNNoise WASM: ${response.status} ${response.statusText}`)
    }

    const wasmBinary = await response.arrayBuffer()
    const fetchMs = (performance.now() - fetchStart).toFixed(1)
    console.log(`[AudioEngine] RNNoise WASM fetched: ${wasmBinary.byteLength} bytes in ${fetchMs}ms`)

    // Send the WASM binary to the worklet processor for compilation.
    // We transfer (not copy) the ArrayBuffer to avoid duplicating ~110KB in memory.
    // After transfer, the original ArrayBuffer becomes detached (zero-length).
    this.rnnoiseNode.port.postMessage(
      { type: 'load-wasm', wasm: wasmBinary },
      [wasmBinary]  // Transferable: moves ownership to the worklet thread
    )
    console.log('[AudioEngine] RNNoise WASM binary transferred to worklet processor')
  }

  /**
   * Fallback: bypasses RNNoise by reconnecting volumeGain directly to the
   * effects chain input. Called when WASM loading fails or the processor
   * reports an error. Audio continues flowing without noise suppression.
   */
  private _bypassRnnoise(): void {
    console.warn('[AudioEngine] Bypassing RNNoise — falling back to direct signal path')
    // Disconnect the broken RNNoise node from the signal path
    if (this.rnnoiseNode) {
      try { this.rnnoiseNode.disconnect() } catch { /* already disconnected */ }
      try { this.volumeGain.disconnect(this.rnnoiseNode) } catch { /* already disconnected */ }
      this.rnnoiseNode = null
      console.warn('[AudioEngine] RNNoise node disconnected and nulled')
    }

    // Reconnect volumeGain directly to the effects chain (standard non-RNNoise path)
    try { this.volumeGain.disconnect(this.effectsChain.input) } catch { /* wasn't connected */ }
    this.volumeGain.connect(this.effectsChain.input)
    console.warn('[AudioEngine] RNNoise bypassed — volumeGain → effectsChain restored')
  }

  // ─── Recording (Sprint 7) ────────────────────────────────────────────

  /**
   * Ensures the recorder AudioWorklet module is loaded.
   *
   * AudioContext.audioWorklet.addModule() is async and must complete before
   * any AudioWorkletNode using that processor can be created. We call this
   * lazily on first recording attempt rather than at construction time,
   * because the AudioContext might be suspended (no user gesture yet).
   */
  private async ensureRecorderWorklet(): Promise<void> {
    if (this.recorderWorkletReady) return

    // Load the recorder processor module from the public directory.
    // In dev: Vite serves /recorder-processor.js from src/renderer/public/
    // In production: it's bundled into the renderer output directory.
    await this.ctx.audioWorklet.addModule('/recorder-processor.js')
    this.recorderWorkletReady = true
  }

  /**
   * Starts recording audio from the active mic input.
   *
   * Creates an AudioWorkletNode (recorder-processor) that taps the
   * pre-effects signal path. The worklet runs on the audio rendering thread
   * and sends raw mono samples to the main thread via MessagePort.
   *
   * The worklet passes audio through to its output for monitoring —
   * it's transparent in the signal chain.
   *
   * MUST be called after startMicInput() — throws if mic is not active.
   */
  async startRecording(): Promise<void> {
    if (!this._micActive || !this.micSourceNode) {
      throw new Error('Cannot start recording: mic input is not active')
    }
    if (!this.recorderNode) {
      throw new Error('Cannot start recording: recorder worklet not initialized')
    }

    // Create a fresh recording buffer at the context's sample rate
    this.recordingBuffer = new RecordingBuffer(this.ctx.sampleRate)

    // Tell the persistent recorder worklet to start forwarding samples.
    // The node is already connected and processing audio (created during
    // startMicInput). This message just flips a boolean on the audio thread —
    // no node creation, no connection changes, virtually zero latency.
    this.recorderNode.port.postMessage({ type: 'start' })

    this._isRecording = true
  }

  /**
   * Stops recording and returns the captured audio as an AudioBuffer.
   *
   * The recorder worklet tap is disconnected from the mic source.
   * The monitoring path (mic → volumeGain → effects) is never touched,
   * so there's no audio interruption.
   *
   * @returns The recorded AudioBuffer (mono, at context sample rate), or null
   *   if no samples were captured (e.g., recording was stopped immediately).
   */
  stopRecording(): AudioBuffer | null {
    this._isRecording = false

    // Tell the worklet processor to stop forwarding samples.
    // The recorder node stays connected — it just stops posting sample
    // chunks to the main thread. Ready for the next recording instantly.
    if (this.recorderNode) {
      this.recorderNode.port.postMessage({ type: 'stop' })
    }

    // Convert the recording buffer to an AudioBuffer
    if (this.recordingBuffer && this.recordingBuffer.sampleCount > 0) {
      const audioBuffer = this.recordingBuffer.toAudioBuffer(this.ctx)
      this.recordingBuffer = null
      return audioBuffer
    }

    this.recordingBuffer = null
    return null
  }

  /**
   * Returns the current recording duration in milliseconds.
   * Used by the UI to show a live recording timer.
   */
  get recordingDurationMs(): number {
    return this.recordingBuffer?.durationMs ?? 0
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────

  /**
   * Tears down the engine: stops playback, stops mic, disposes effects chain,
   * and closes the AudioContext. Call on app unmount.
   */
  async dispose(): Promise<void> {
    // stopMicInput() handles RNNoise cleanup, recorder cleanup, and mic release
    this.stopMicInput()
    this.stop()
    this.effectsChain.dispose()
    this.analyser.disconnect()
    this.monitorGain.disconnect()
    this.volumeGain.disconnect()
    if (this.ctx.state !== 'closed') {
      await this.ctx.close()
    }
  }
}
