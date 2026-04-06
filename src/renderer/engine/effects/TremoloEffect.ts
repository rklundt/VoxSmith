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
 * TremoloEffect — Volume oscillation that adds rhythmic pulsing.
 *
 * WHAT IT DOES:
 * A low-frequency oscillator (LFO) modulates the VOLUME of the voice
 * up and down. Unlike vibrato (which modulates pitch), tremolo pulses
 * the loudness.
 *
 * WHAT IT SOUNDS LIKE:
 *   Slow rates (2-4 Hz): Emotional, shaky, vulnerable — sad character
 *   Medium rates (4-6 Hz): Theatrical, dramatic — narrator effect
 *   Fast rates (8+ Hz): Mechanical, supernatural — robot, ghost
 *
 * IMPLEMENTATION: Uses Tone.js Tremolo which internally uses an
 * OscillatorNode connected to a GainNode. The built-in `.wet` property
 * handles wet/dry mixing. Must call `.start()` to begin the LFO.
 */

import * as Tone from 'tone'
import type { EffectModule } from './EffectModule'
import { DEFAULT_ENGINE_SNAPSHOT } from '../../../shared/constants'

export class TremoloEffect implements EffectModule {
  readonly input: GainNode
  readonly output: GainNode

  private tremolo: Tone.Tremolo

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain()
    this.input.gain.value = 1.0

    this.tremolo = new Tone.Tremolo({
      frequency: DEFAULT_ENGINE_SNAPSHOT.tremoloRate,
      depth: DEFAULT_ENGINE_SNAPSHOT.tremoloDepth,
      wet: DEFAULT_ENGINE_SNAPSHOT.wetDryMix.tremolo,
    }).start() // Start the tremolo LFO immediately — it produces no sound until depth > 0

    this.output = ctx.createGain()
    this.output.gain.value = 1.0

    // Wire: input → tremolo → output
    Tone.connect(this.input, this.tremolo)
    this.tremolo.connect(this.output)
  }

  /**
   * Sets tremolo rate (LFO frequency in Hz) and depth (0-1).
   * Rate controls how fast the volume pulses; depth controls intensity.
   * depth=0 means no tremolo regardless of rate or wet level.
   */
  setTremolo(rate: number, depth: number): void {
    this.tremolo.frequency.value = rate
    this.tremolo.depth.value = depth
  }

  /**
   * Sets the wet/dry mix via Tone.js built-in wet property.
   * 0 = full dry (no tremolo). 1 = full wet (max tremolo).
   */
  setWetDry(mix: number): void {
    this.tremolo.wet.value = mix
  }

  dispose(): void {
    this.input.disconnect()
    this.tremolo.dispose()
    this.output.disconnect()
  }
}
