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
 * VocalFryEffect — Amplitude modulation at sub-audio frequencies.
 *
 * WHAT IT DOES:
 * An oscillator running at 20-80 Hz modulates the voice's volume,
 * creating a crackling/creaky sound. This is the same physical mechanism
 * as real vocal fry — irregular glottal pulses that produce a low,
 * rattling quality.
 *
 * WHAT IT SOUNDS LIKE:
 *   Low intensity: Subtle creakiness — tired, bored, disinterested character
 *   Medium intensity: Pronounced fry — monster growl, zombie moan
 *   High intensity: Heavy rattling — demonic, otherworldly
 *
 * HOW IT WORKS (AM SYNTHESIS):
 * The sub-audio LFO's output feeds into the gain parameter of a
 * modulator GainNode. The voice signal passes through this modulator,
 * so its volume oscillates at the LFO rate. The LFOGain controls
 * how deep the modulation goes:
 *   - depth=0: gain stays at 1.0 (no modulation, clean signal)
 *   - depth=1: gain swings between 0 and 2 (heavy fry)
 *
 * ROUTING:
 *   input ──┬── vocalFryModulator (wet, AM'd) → wetGain ──┬── output
 *           └── dryGain ──────────────────────────────────┘
 */

import type { EffectModule } from './EffectModule'
import { DEFAULT_ENGINE_SNAPSHOT } from '../../../shared/constants'

export class VocalFryEffect implements EffectModule {
  readonly input: GainNode
  readonly output: GainNode

  // Sub-audio oscillator (20-80 Hz) — the "pulse" that creates the fry
  private lfo: OscillatorNode
  // Controls LFO depth (how much the volume swings). 0 = no fry, 1 = full fry.
  private lfoGain: GainNode
  // The gain node whose gain parameter is modulated by the LFO.
  // Voice signal passes through this, getting amplitude-modulated.
  private modulator: GainNode
  // Parallel routing for wet/dry mix
  private dryGain: GainNode
  private wetGain: GainNode

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain()
    this.input.gain.value = 1.0

    // LFO: sub-audio sine wave at 50 Hz (middle of the fry range)
    this.lfo = ctx.createOscillator()
    this.lfo.type = 'sine'
    this.lfo.frequency.value = 50
    this.lfo.start()

    // LFO gain controls modulation depth
    this.lfoGain = ctx.createGain()
    this.lfoGain.gain.value = DEFAULT_ENGINE_SNAPSHOT.vocalFryIntensity

    // Modulator: voice passes through this. Its gain is modulated by the LFO.
    this.modulator = ctx.createGain()
    this.modulator.gain.value = 1.0 // Base gain; LFO oscillates around this

    // Wire LFO → modulator gain parameter (AM synthesis)
    this.lfo.connect(this.lfoGain)
    this.lfoGain.connect(this.modulator.gain)

    // Wet/dry parallel routing
    this.dryGain = ctx.createGain()
    this.wetGain = ctx.createGain()
    this.output = ctx.createGain()
    this.output.gain.value = 1.0

    const mix = DEFAULT_ENGINE_SNAPSHOT.wetDryMix.vocalFry
    this.wetGain.gain.value = mix
    this.dryGain.gain.value = 1.0 - mix

    // Wire parallel paths:
    // Dry: input → dryGain → output
    // Wet: input → modulator → wetGain → output
    this.input.connect(this.dryGain)
    this.dryGain.connect(this.output)
    this.input.connect(this.modulator)
    this.modulator.connect(this.wetGain)
    this.wetGain.connect(this.output)
  }

  /**
   * Sets vocal fry intensity (0-1).
   * Controls the depth of the sub-audio AM oscillator.
   * 0 = no modulation (clean). 1 = heavy modulation (crackling fry).
   */
  setIntensity(intensity: number): void {
    this.lfoGain.gain.setValueAtTime(intensity, this.lfo.context.currentTime)
  }

  /**
   * Sets wet/dry mix for the fry effect.
   * 0 = full dry (no fry). 1 = full wet (max fry).
   */
  setWetDry(mix: number): void {
    const t = this.lfo.context.currentTime
    this.wetGain.gain.setValueAtTime(mix, t)
    this.dryGain.gain.setValueAtTime(1.0 - mix, t)
  }

  dispose(): void {
    try { this.lfo.stop() } catch { /* already stopped */ }
    this.input.disconnect()
    this.lfo.disconnect()
    this.lfoGain.disconnect()
    this.modulator.disconnect()
    this.dryGain.disconnect()
    this.wetGain.disconnect()
    this.output.disconnect()
  }
}
