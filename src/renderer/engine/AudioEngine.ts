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
 * - Mic input (Sprint 7)
 *
 * SINGLETON PATTERN:
 * There should only be one AudioEngine per app session. The useAudioEngine hook
 * creates it once and holds a ref. Multiple components can read its state via
 * the engineStore, but only the hook mutates it.
 */

import { EffectsChain } from './EffectsChain'
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

  // ─── Level Metering (Sprint 4) ───────────────────────────────────────

  // AnalyserNode sits at the end of the signal chain (after effects, before destination).
  // It performs a real-time FFT on the audio stream without modifying it.
  // We use it to read peak amplitude for the level meter and clip detection.
  private analyser: AnalyserNode

  // Reusable typed array for reading time-domain amplitude samples.
  // Allocated once in the constructor to avoid per-frame GC pressure.
  // Explicit ArrayBuffer generic avoids TS strict ArrayBufferLike mismatch.
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

    // Wire: volumeGain -> effectsChain.input -> [chain] -> effectsChain.output -> analyser -> destination
    this.volumeGain.connect(this.effectsChain.input)
    this.effectsChain.output.connect(this.analyser)
    this.analyser.connect(this.ctx.destination)
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
  play(onEnd?: () => void): void {
    const buffer = this.activeBuffer
    if (!buffer) return

    // Stop any existing playback first
    this.stopSource()

    // Ensure context is running
    if (this.ctx.state === 'suspended') {
      this.ctx.resume()
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
    if (this._status === 'paused') {
      return this.playbackOffset
    }
    return 0
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
   * @param value - 0.0 (silence) to 2.0 (200% boost). 1.0 = unity.
   */
  setVolume(value: number): void {
    this.volumeGain.gain.setValueAtTime(value, this.ctx.currentTime)
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

  // ─── Lifecycle ────────────────────────────────────────────────────────

  /**
   * Tears down the engine: stops playback, disposes effects chain,
   * and closes the AudioContext. Call on app unmount.
   */
  async dispose(): Promise<void> {
    this.stop()
    this.effectsChain.dispose()
    this.analyser.disconnect()
    this.volumeGain.disconnect()
    if (this.ctx.state !== 'closed') {
      await this.ctx.close()
    }
  }
}
