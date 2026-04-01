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
 * AudioEngine — Central Audio Engine (Stage 2)
 *
 * Owns the AudioContext, manages the real-time effects chain, and handles
 * playback of both original and Stage 1-processed audio buffers.
 *
 * THREE-STAGE PIPELINE CONTEXT:
 *   Stage 1 (offline): Rubber Band CLI processes pitch/formant/tempo → produces processedBuffer
 *   Stage 2 (real-time): THIS — plays audio through Web Audio effects chain (EQ, compressor, etc.)
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
import type { EngineSnapshot } from '../../shared/types'

export type PlaybackStatus = 'idle' | 'playing' | 'paused'

export class AudioEngine {
  private ctx: AudioContext
  private effectsChain: EffectsChain

  // Pre-effects volume control — this is the user's "volume" slider.
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

  // Track playback state — used by the hook to update the store
  private _status: PlaybackStatus = 'idle'

  // Callback fired when playback ends naturally (source reached end of buffer).
  // The hook uses this to update the store's isPlaying state.
  private onPlaybackEnd: (() => void) | null = null

  // Track the current playback start time for pause/resume offset calculation
  private playbackStartTime = 0
  private playbackOffset = 0

  constructor() {
    // Create the AudioContext — this is the "audio universe" everything lives in.
    // All nodes, buffers, and timing are relative to this context.
    this.ctx = new AudioContext()

    // Create the effects chain (EQ, compressor, high-pass, etc.)
    this.effectsChain = new EffectsChain(this.ctx)

    // Pre-effects volume control
    this.volumeGain = this.ctx.createGain()
    this.volumeGain.gain.value = 1.0

    // Wire: volumeGain → effectsChain.input → [chain internals] → effectsChain.output → destination
    this.volumeGain.connect(this.effectsChain.input)
    this.effectsChain.output.connect(this.ctx.destination)
  }

  // ─── Buffer Management ────────────────────────────────────────────────

  /**
   * Loads raw audio data (WAV/MP3 bytes) and decodes it into an AudioBuffer.
   * This is called when the user opens a file — the raw bytes come from the
   * renderer's file input or from a file:// URL fetch.
   *
   * @param arrayBuffer — Raw audio file bytes (WAV, MP3, etc.)
   */
  async loadFile(arrayBuffer: ArrayBuffer): Promise<void> {
    // Ensure context is running (may be suspended if no user gesture yet)
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume()
    }

    // decodeAudioData parses the WAV/MP3 header and PCM data into an AudioBuffer.
    // The AudioBuffer holds deinterleaved Float32 channel data ready for playback.
    this._originalBuffer = await this.ctx.decodeAudioData(arrayBuffer)
    // Clear any previous Stage 1 processing — user loaded a new file
    this._processedBuffer = null
  }

  /**
   * Loads Stage 1-processed audio data (WAV bytes from Rubber Band CLI output).
   * Called after the IPC processAudio() call returns successfully.
   *
   * @param arrayBuffer — WAV file bytes from the Rubber Band CLI output
   */
  async loadProcessedBuffer(arrayBuffer: ArrayBuffer): Promise<void> {
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume()
    }
    this._processedBuffer = await this.ctx.decodeAudioData(arrayBuffer)
  }

  /**
   * Returns the buffer that should be played — processed if available, otherwise original.
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
   * Called when the user resets Stage 1 params to defaults and clicks Apply —
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

  /** The AudioContext — exposed for components that need it (e.g., waveform rendering) */
  get audioContext(): AudioContext {
    return this.ctx
  }

  // ─── Playback Controls ────────────────────────────────────────────────

  /**
   * Starts playback of the active buffer through the effects chain.
   *
   * Creates a new AudioBufferSourceNode each time (Web Audio requirement:
   * source nodes are single-use — once stopped, they cannot be restarted).
   *
   * @param onEnd — Optional callback when playback finishes naturally
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

    // Connect: source → volumeGain → effectsChain → destination
    this.sourceNode.connect(this.volumeGain)

    // Handle natural end of playback (buffer finished playing)
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
   * Resume by calling play() again — it will start from the paused offset.
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
        // stop() throws if the source hasn't started yet — safe to ignore
      }
      this.sourceNode.disconnect()
      this.sourceNode = null
    }
  }

  // ─── Real-Time Parameter Updates (Stage 2) ────────────────────────────

  /**
   * Sets the pre-effects volume level.
   * Uses setValueAtTime for smooth, click-free updates.
   *
   * @param value — 0.0 (silence) to 2.0 (200% boost). 1.0 = unity.
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

  // ─── Lifecycle ────────────────────────────────────────────────────────

  /**
   * Tears down the engine: stops playback, disposes effects chain,
   * and closes the AudioContext. Call on app unmount.
   */
  async dispose(): Promise<void> {
    this.stop()
    this.effectsChain.dispose()
    this.volumeGain.disconnect()
    if (this.ctx.state !== 'closed') {
      await this.ctx.close()
    }
  }
}
