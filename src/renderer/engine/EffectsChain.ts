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
 * EffectsChain — Stage 2 Real-Time Audio Effects Orchestrator
 *
 * Wires individual effect modules into the full signal chain and provides
 * a unified API for AudioEngine to set parameters and apply snapshots.
 *
 * Each effect is implemented in its own module file under `effects/`.
 * This file only handles:
 *   1. Creating each effect module
 *   2. Wiring them in the correct signal chain order
 *   3. Bypass routing (input → output, skipping the chain)
 *   4. Forwarding parameter setter calls to the correct module
 *   5. Applying full snapshots to all modules at once
 *
 * SIGNAL CHAIN ORDER (matches architecture.md):
 *   input → highPass → spectralTilt → eq → compressor
 *     → vibrato → tremolo → vocalFry → breathiness → breathiness2
 *     → reverb → outputGain → output
 *
 * BYPASS: When bypassed, signal routes directly from input → output,
 * skipping the entire chain. The chain output is muted via gain = 0.
 */

import * as Tone from 'tone'
import type { EngineSnapshot, EQBand, EffectName } from '../../shared/types'
import { DEFAULT_ENGINE_SNAPSHOT } from '../../shared/constants'
import {
  HighPassEffect,
  SpectralTiltEffect,
  EQEffect,
  CompressorEffect,
  VibratoEffect,
  TremoloEffect,
  VocalFryEffect,
  BreathinessEffect,
  Breathiness2Effect,
  ReverbEffect,
} from './effects'

export class EffectsChain {
  private ctx: AudioContext

  // ─── Effect Modules (in signal chain order) ────────────────────────────
  private highPass: HighPassEffect
  private spectralTilt: SpectralTiltEffect
  private eq: EQEffect
  private compressor: CompressorEffect
  private vibrato: VibratoEffect
  private tremolo: TremoloEffect
  private vocalFry: VocalFryEffect
  private breathiness: BreathinessEffect
  private breathiness2: Breathiness2Effect
  private reverb: ReverbEffect

  // ─── Output and Bypass ─────────────────────────────────────────────────
  private outputGain: GainNode
  private bypassGain: GainNode   // Direct input → output path (gain=1 when bypassed)
  private chainGain: GainNode    // Chain output level (gain=0 when bypassed)

  // Chain entry/exit points for external connections
  private _input: GainNode
  private _output: GainNode

  constructor(audioContext: AudioContext) {
    this.ctx = audioContext

    // Tell Tone.js to use our existing AudioContext. This is critical —
    // all Tone.js nodes must share the same context as our Web Audio nodes.
    // Without this, Tone creates its own context and nodes can't connect.
    Tone.setContext(this.ctx)

    // ─── Create all effect modules ───────────────────────────────────
    this.highPass = new HighPassEffect(this.ctx)
    this.spectralTilt = new SpectralTiltEffect(this.ctx)
    this.eq = new EQEffect(this.ctx)
    this.compressor = new CompressorEffect(this.ctx)
    this.vibrato = new VibratoEffect(this.ctx)
    this.tremolo = new TremoloEffect(this.ctx)
    this.vocalFry = new VocalFryEffect(this.ctx)
    this.breathiness = new BreathinessEffect(this.ctx)
    this.breathiness2 = new Breathiness2Effect(this.ctx)
    this.reverb = new ReverbEffect(this.ctx)

    // ─── Input / Output / Bypass ─────────────────────────────────────
    this._input = this.ctx.createGain()
    this._input.gain.value = 1.0

    this.outputGain = this.ctx.createGain()
    this.outputGain.gain.value = 1.0

    this.bypassGain = this.ctx.createGain()
    this.bypassGain.gain.value = DEFAULT_ENGINE_SNAPSHOT.bypassed ? 1.0 : 0.0

    this.chainGain = this.ctx.createGain()
    this.chainGain.gain.value = DEFAULT_ENGINE_SNAPSHOT.bypassed ? 0.0 : 1.0

    this._output = this.ctx.createGain()
    this._output.gain.value = 1.0

    // ─── Wire the complete chain ─────────────────────────────────────
    this._wireChain()
  }

  /**
   * Wires all modules in signal chain order.
   * Called once in constructor. The chain topology is fixed — only
   * parameter values change at runtime via the setter methods.
   *
   * Chain: input → highPass → spectralTilt → eq → compressor
   *   → vibrato → tremolo → vocalFry → breathiness → breathiness2
   *   → reverb → outputGain → chainGain → output
   */
  private _wireChain(): void {
    // Connect input to first module
    this._input.connect(this.highPass.input)

    // Chain modules in order — each module's output feeds the next module's input.
    // Each module handles its own internal routing (wet/dry, parallel paths, etc).
    this.highPass.output.connect(this.spectralTilt.input)
    this.spectralTilt.output.connect(this.eq.input)
    this.eq.output.connect(this.compressor.input)
    this.compressor.output.connect(this.vibrato.input)
    this.vibrato.output.connect(this.tremolo.input)
    this.tremolo.output.connect(this.vocalFry.input)
    this.vocalFry.output.connect(this.breathiness.input)
    this.breathiness.output.connect(this.breathiness2.input)
    this.breathiness2.output.connect(this.reverb.input)

    // Last module → output gain → chain gain → output
    this.reverb.output.connect(this.outputGain)
    this.outputGain.connect(this.chainGain)
    this.chainGain.connect(this._output)

    // Bypass path: input → bypassGain → output (skips entire chain)
    this._input.connect(this.bypassGain)
    this.bypassGain.connect(this._output)
  }

  // ─── Public Accessors ──────────────────────────────────────────────────

  /** Connect source nodes TO this input */
  get input(): GainNode {
    return this._input
  }

  /** Connect this output TO AudioContext.destination */
  get output(): GainNode {
    return this._output
  }

  // ─── Parameter Setters ─────────────────────────────────────────────────
  // Each setter forwards to the corresponding effect module.

  // ── Inline Effects ─────────────────────────────────────────────────────

  setHighPassFrequency(hz: number): void {
    this.highPass.setFrequency(hz)
  }

  /**
   * Sets the spectral tilt amount.
   * Range: -10 (very dark/warm) to +10 (very bright/thin). 0 = neutral.
   * Negative = larger/older character. Positive = smaller/younger character.
   */
  setSpectralTilt(tilt: number): void {
    this.spectralTilt.setTilt(tilt)
  }

  setEQBand(index: number, band: EQBand): void {
    this.eq.setBand(index, band)
  }

  setAllEQBands(bands: EQBand[]): void {
    this.eq.setAllBands(bands)
  }

  setCompressorThreshold(db: number): void {
    this.compressor.setThreshold(db)
  }

  setCompressorRatio(ratio: number): void {
    this.compressor.setRatio(ratio)
  }

  setOutputGain(gain: number): void {
    this.outputGain.gain.setValueAtTime(gain, this.ctx.currentTime)
  }

  // ── Tone.js Effects ────────────────────────────────────────────────────

  setVibrato(rate: number, depth: number): void {
    this.vibrato.setVibrato(rate, depth)
  }

  setTremolo(rate: number, depth: number): void {
    this.tremolo.setTremolo(rate, depth)
  }

  setReverb(roomSize: number, _amount: number): void {
    this.reverb.setReverb(roomSize)
  }

  // ── Custom Effects ─────────────────────────────────────────────────────

  setVocalFry(intensity: number): void {
    this.vocalFry.setIntensity(intensity)
  }

  setBreathiness(amount: number): void {
    this.breathiness.setBreathiness(amount)
  }

  setBreathiness2(amount: number): void {
    this.breathiness2.setAmount(amount)
  }

  // ── Wet/Dry Mix ────────────────────────────────────────────────────────

  /**
   * Sets the wet/dry mix for a specific effect.
   * @param effect - Which effect to adjust
   * @param mix - 0.0 (full dry / effect bypassed) to 1.0 (full wet / fully applied)
   */
  setWetDry(effect: EffectName, mix: number): void {
    switch (effect) {
      case 'vibrato':
        this.vibrato.setWetDry(mix)
        break
      case 'tremolo':
        this.tremolo.setWetDry(mix)
        break
      case 'reverb':
        this.reverb.setWetDry(mix)
        break
      case 'vocalFry':
        this.vocalFry.setWetDry(mix)
        break
      case 'breathiness':
        this.breathiness.setWetDry(mix)
        break
      case 'breathiness2':
        this.breathiness2.setWetDry(mix)
        break
      case 'spectralTilt':
        this.spectralTilt.setWetDry(mix)
        break
    }
  }

  // ── Bypass ─────────────────────────────────────────────────────────────

  /**
   * Enables or disables bypass mode.
   * When bypassed, the signal routes directly from input to output,
   * skipping the entire effects chain.
   */
  setBypass(bypassed: boolean): void {
    const t = this.ctx.currentTime
    if (bypassed) {
      this.chainGain.gain.setValueAtTime(0.0, t)
      this.bypassGain.gain.setValueAtTime(1.0, t)
    } else {
      this.chainGain.gain.setValueAtTime(1.0, t)
      this.bypassGain.gain.setValueAtTime(0.0, t)
    }
  }

  // ── Snapshot ────────────────────────────────────────────────────────────

  /**
   * Applies a full EngineSnapshot to all Stage 2 effect parameters.
   * Stage 1 params (pitch/formant/tempo) are ignored here.
   *
   * PRESET MIGRATION: Presets saved before new effects were added will have
   * missing fields (e.g., spectralTilt didn't exist before Sprint 7.4).
   * We merge with DEFAULT_ENGINE_SNAPSHOT so any missing field falls back
   * to its default value instead of passing `undefined` (which causes
   * Web Audio's setValueAtTime to throw "non-finite float value").
   */
  applySnapshot(snapshot: EngineSnapshot): void {
    // Merge with defaults to fill in any fields missing from old presets.
    // Spread order: defaults first, then snapshot overwrites with saved values.
    // wetDryMix needs a nested merge since it's an object.
    const s: EngineSnapshot = {
      ...DEFAULT_ENGINE_SNAPSHOT,
      ...snapshot,
      wetDryMix: {
        ...DEFAULT_ENGINE_SNAPSHOT.wetDryMix,
        ...snapshot.wetDryMix,
      },
    }

    // Inline effects
    this.setHighPassFrequency(s.highPassFrequency)
    this.setSpectralTilt(s.spectralTilt)
    this.setAllEQBands(s.eq)
    this.setCompressorThreshold(s.compressorThreshold)
    this.setCompressorRatio(s.compressorRatio)

    // Tone.js effects
    this.setVibrato(s.vibratoRate, s.vibratoDepth)
    this.setTremolo(s.tremoloRate, s.tremoloDepth)
    this.setReverb(s.reverbRoomSize, s.reverbAmount)

    // Custom effects
    this.setVocalFry(s.vocalFryIntensity)
    this.setBreathiness(s.breathiness)
    this.setBreathiness2(s.breathiness2)

    // Wet/dry mix for all effects
    this.setWetDry('vibrato', s.wetDryMix.vibrato)
    this.setWetDry('tremolo', s.wetDryMix.tremolo)
    this.setWetDry('reverb', s.wetDryMix.reverb)
    this.setWetDry('vocalFry', s.wetDryMix.vocalFry)
    this.setWetDry('breathiness', s.wetDryMix.breathiness)
    this.setWetDry('breathiness2', s.wetDryMix.breathiness2)
    this.setWetDry('spectralTilt', s.wetDryMix.spectralTilt)

    // Bypass
    this.setBypass(s.bypassed)
  }

  // ── Cleanup ─────────────────────────────────────────────────────────────

  /**
   * Disconnects all nodes and releases resources.
   * Call this when the AudioContext is being closed.
   */
  dispose(): void {
    // Dispose all effect modules (each handles its own internal cleanup)
    this.highPass.dispose()
    this.spectralTilt.dispose()
    this.eq.dispose()
    this.compressor.dispose()
    this.vibrato.dispose()
    this.tremolo.dispose()
    this.vocalFry.dispose()
    this.breathiness.dispose()
    this.breathiness2.dispose()
    this.reverb.dispose()

    // Disconnect orchestrator-level nodes
    this._input.disconnect()
    this.outputGain.disconnect()
    this.bypassGain.disconnect()
    this.chainGain.disconnect()
    this._output.disconnect()
  }
}
