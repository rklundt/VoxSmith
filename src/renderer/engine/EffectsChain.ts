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
 * EffectsChain — Stage 2 Real-Time Audio Effects
 *
 * Wires together all Web Audio API nodes into a signal chain.
 * This handles ALL real-time effects: EQ, reverb, compression, vibrato,
 * tremolo, vocal fry, breathiness, high-pass filter, and wet/dry mixing.
 *
 * WHAT THIS DOES NOT DO:
 * - Pitch shifting, formant control, tempo — those are Stage 1 (offline, Rubber Band CLI)
 * - Export processing (noise gate, normalization) — that's Stage 3 (FFmpeg)
 *
 * SIGNAL CHAIN:
 *   input → highPass → eq[0..3] → compressor → gainOutput → destination
 *
 * Sprint 2 starts with a minimal chain (EQ + compressor + high-pass + gain).
 * Advanced effects (reverb, vibrato, tremolo, vocal fry, breathiness) will be
 * added in Sprint 3 when the Advanced Mode UI is built.
 *
 * WHY A CLASS?
 * Web Audio nodes are stateful objects tied to a specific AudioContext.
 * A class cleanly owns the lifecycle: create nodes on init, update params
 * via setters, tear down on dispose. Zustand stores hold the serializable
 * parameter values; this class holds the actual audio nodes.
 */

import type { EngineSnapshot, EQBand } from '../../shared/types'
import { DEFAULT_ENGINE_SNAPSHOT } from '../../shared/constants'

export class EffectsChain {
  private ctx: AudioContext

  // ─── Audio Nodes ──────────────────────────────────────────────────────

  // High-pass filter — removes low-frequency rumble (room noise, mic handling noise).
  // A higher cutoff makes the voice thinner (useful for radio or small creature effects).
  private highPassFilter: BiquadFilterNode

  // 4-band parametric EQ — shapes the tonal character of the voice.
  // Band 1 (Low ~200Hz): chest weight. Band 2 (Low-Mid ~800Hz): warmth.
  // Band 3 (High-Mid ~2500Hz): presence/nasality. Band 4 (High ~8000Hz): brightness/air.
  private eqBands: BiquadFilterNode[]

  // Dynamics compressor — evens out volume differences so quiet and loud parts
  // are closer in level. Prevents clipping on loud passages and brings up quiet detail.
  private compressor: DynamicsCompressorNode

  // Master output gain — controls the overall volume level after all effects.
  // This is NOT the same as the user's "volume" control (which is pre-effects).
  // This is used for bypass routing and master level adjustment.
  private outputGain: GainNode

  // ─── Chain Entry/Exit Points ──────────────────────────────────────────

  // External code connects source nodes to this input node.
  // The chain routes internally from input through all effects to output.
  private _input: GainNode

  // External code connects this output node to AudioContext.destination.
  private _output: GainNode

  constructor(audioContext: AudioContext) {
    this.ctx = audioContext

    // Create a pass-through input gain node (unity gain) as the chain entry point.
    // Source nodes connect here instead of directly to the first effect,
    // so we can rewire the chain internally without touching external connections.
    this._input = this.ctx.createGain()
    this._input.gain.value = 1.0

    // ─── High-Pass Filter ─────────────────────────────────────────────
    // Type 'highpass': passes frequencies above the cutoff, attenuates below.
    // At 80Hz (default), this just removes sub-bass rumble without affecting the voice.
    this.highPassFilter = this.ctx.createBiquadFilter()
    this.highPassFilter.type = 'highpass'
    this.highPassFilter.frequency.value = DEFAULT_ENGINE_SNAPSHOT.highPassFrequency
    // Q factor of 0.7 gives a gentle roll-off (Butterworth response).
    // Higher Q creates a resonant peak at the cutoff, which sounds unnatural for voice.
    this.highPassFilter.Q.value = 0.7

    // ─── 4-Band Parametric EQ ─────────────────────────────────────────
    // Each band is a 'peaking' filter: boosts or cuts a frequency range
    // centered on the band's frequency. Q controls width of the affected range.
    this.eqBands = DEFAULT_ENGINE_SNAPSHOT.eq.map((band: EQBand) => {
      const filter = this.ctx.createBiquadFilter()
      filter.type = 'peaking'
      filter.frequency.value = band.frequency
      filter.gain.value = band.gain
      // Q of 1.0 gives a moderately wide band — good for broad tonal shaping.
      // Higher Q = narrower surgical cut/boost. Lower Q = wider gentle shape.
      filter.Q.value = 1.0
      return filter
    })

    // ─── Compressor ───────────────────────────────────────────────────
    // DynamicsCompressorNode reduces the volume of sounds that exceed the threshold.
    // This makes the voice more consistent in level — important for game dialogue
    // where the player shouldn't have to adjust volume between characters.
    this.compressor = this.ctx.createDynamicsCompressor()
    this.compressor.threshold.value = DEFAULT_ENGINE_SNAPSHOT.compressorThreshold
    this.compressor.ratio.value = DEFAULT_ENGINE_SNAPSHOT.compressorRatio
    // knee: how gradually compression kicks in around the threshold.
    // 10dB soft knee sounds more natural than a hard 0dB knee.
    this.compressor.knee.value = 10
    // attack: how quickly compressor reacts to loud transients (seconds).
    // 0.003s (3ms) is fast enough to catch consonants without pumping.
    this.compressor.attack.value = 0.003
    // release: how quickly compressor stops compressing after signal drops (seconds).
    // 0.25s feels natural for voice — fast enough to not muffle trailing words.
    this.compressor.release.value = 0.25

    // ─── Output Gain ──────────────────────────────────────────────────
    this.outputGain = this.ctx.createGain()
    this.outputGain.gain.value = 1.0

    // Output node — external connections go here → destination
    this._output = this.ctx.createGain()
    this._output.gain.value = 1.0

    // ─── Wire the Chain ───────────────────────────────────────────────
    // input → highPass → eq[0] → eq[1] → eq[2] → eq[3] → compressor → outputGain → output
    this._input.connect(this.highPassFilter)

    let prevNode: AudioNode = this.highPassFilter
    for (const band of this.eqBands) {
      prevNode.connect(band)
      prevNode = band
    }

    prevNode.connect(this.compressor)
    this.compressor.connect(this.outputGain)
    this.outputGain.connect(this._output)
  }

  // ─── Public Accessors ───────────────────────────────────────────────────

  /** Connect source nodes TO this input */
  get input(): GainNode {
    return this._input
  }

  /** Connect this output TO AudioContext.destination (or another node) */
  get output(): GainNode {
    return this._output
  }

  // ─── Parameter Setters ──────────────────────────────────────────────────
  // Each setter updates the corresponding Web Audio node in real time.
  // These are called by the AudioEngine when the Zustand store changes.
  // Using AudioParam.setValueAtTime() instead of direct assignment
  // for sample-accurate updates and to avoid clicks/pops.

  /**
   * Updates high-pass filter cutoff frequency.
   * Higher values remove more low-frequency content from the voice.
   * 80Hz = just rumble removal. 300Hz+ = noticeable thinning.
   */
  setHighPassFrequency(hz: number): void {
    this.highPassFilter.frequency.setValueAtTime(hz, this.ctx.currentTime)
  }

  /**
   * Updates a single EQ band's gain and frequency.
   * @param index — Band index (0-3)
   * @param band — New gain and frequency values
   */
  setEQBand(index: number, band: EQBand): void {
    if (index < 0 || index >= this.eqBands.length) return
    this.eqBands[index].gain.setValueAtTime(band.gain, this.ctx.currentTime)
    this.eqBands[index].frequency.setValueAtTime(band.frequency, this.ctx.currentTime)
  }

  /**
   * Updates all 4 EQ bands at once (e.g., when loading a preset).
   */
  setAllEQBands(bands: EQBand[]): void {
    bands.forEach((band, i) => this.setEQBand(i, band))
  }

  /**
   * Updates the compressor threshold (dB).
   * Lower threshold = more of the signal gets compressed.
   */
  setCompressorThreshold(db: number): void {
    this.compressor.threshold.setValueAtTime(db, this.ctx.currentTime)
  }

  /**
   * Updates the compressor ratio.
   * Higher ratio = more aggressive compression (4:1 moderate, 20:1 = limiting).
   */
  setCompressorRatio(ratio: number): void {
    this.compressor.ratio.setValueAtTime(ratio, this.ctx.currentTime)
  }

  /**
   * Sets the master output gain.
   * 1.0 = unity (no change). 0.0 = silence. >1.0 = boost.
   */
  setOutputGain(gain: number): void {
    this.outputGain.gain.setValueAtTime(gain, this.ctx.currentTime)
  }

  /**
   * Applies a full EngineSnapshot to all effect parameters at once.
   * Used when loading a preset or resetting to defaults.
   * Only applies Stage 2 parameters — Stage 1 (pitch/formant/tempo) is ignored here.
   */
  applySnapshot(snapshot: EngineSnapshot): void {
    this.setHighPassFrequency(snapshot.highPassFrequency)
    this.setAllEQBands(snapshot.eq)
    this.setCompressorThreshold(snapshot.compressorThreshold)
    this.setCompressorRatio(snapshot.compressorRatio)
    // Note: reverb, vibrato, tremolo, vocal fry, breathiness
    // will be wired into the chain in Sprint 3 (Advanced Mode)
  }

  /**
   * Disconnects all nodes and releases resources.
   * Call this when the AudioContext is being closed.
   */
  dispose(): void {
    this._input.disconnect()
    this.highPassFilter.disconnect()
    for (const band of this.eqBands) {
      band.disconnect()
    }
    this.compressor.disconnect()
    this.outputGain.disconnect()
    this._output.disconnect()
  }
}
