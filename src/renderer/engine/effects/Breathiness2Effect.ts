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
 * Breathiness2Effect — Vocal processing method for close-mic breathy tone.
 *
 * HOW IT WORKS (Billie Eilish / close-mic technique):
 * 1. Duplicate the voice signal into an "upper" (airy) track
 * 2. High-pass filter at 500 Hz — strips out the bass/body
 * 3. High-shelf boost at 8 kHz — emphasizes the airy sibilant frequencies
 * 4. Compress the upper track — makes the breath noise consistent in level
 * 5. Blend the upper track at reduced volume with the original voice
 *
 * This is different from Breathiness 1 (spectral reshaping of the whole
 * voice). Breathiness 2 keeps the original voice intact and layers a
 * processed "air" track on top — more like a mix engineer's approach.
 *
 * ROUTING (ADDITIVE, not crossfade):
 *   input ──┬── dryGain (always 1.0) ─────────────────┬── output
 *           └── highPass → highShelf → compressor      │
 *               → wetGain ────────────────────────────┘
 */

import type { EffectModule } from './EffectModule'
import { DEFAULT_ENGINE_SNAPSHOT } from '../../../shared/constants'

export class Breathiness2Effect implements EffectModule {
  readonly input: GainNode
  readonly output: GainNode

  // High-pass at 500 Hz — removes the "body" of the voice, leaving
  // only the upper harmonics and sibilant/breath frequencies.
  private highPass: BiquadFilterNode
  // High-shelf boost at 8 kHz — emphasizes the airy frequencies above 8k.
  // Always boosted on the wet path. This is the "air" band that gives
  // the close-mic, intimate vocal character.
  private highShelf: BiquadFilterNode
  // Compressor on the airy track — makes breath noise consistent.
  // Low threshold catches quiet breath sounds; moderate ratio evens them out.
  private compressor: DynamicsCompressorNode

  // Dry path: original voice (always at 1.0, this is additive not crossfade)
  private dryGain: GainNode
  // Wet path: processed air track blended in on top
  private wetGain: GainNode

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain()
    this.input.gain.value = 1.0

    this.highPass = ctx.createBiquadFilter()
    this.highPass.type = 'highpass'
    this.highPass.frequency.value = 500
    this.highPass.Q.value = 0.7

    this.highShelf = ctx.createBiquadFilter()
    this.highShelf.type = 'highshelf'
    this.highShelf.frequency.value = 8000
    this.highShelf.gain.value = 12 // Always boosted on the wet path

    this.compressor = ctx.createDynamicsCompressor()
    this.compressor.threshold.value = -30
    this.compressor.ratio.value = 4
    this.compressor.knee.value = 10
    this.compressor.attack.value = 0.003
    this.compressor.release.value = 0.1

    // Dry path: always 1.0 (original voice always present)
    this.dryGain = ctx.createGain()
    this.dryGain.gain.value = 1.0

    // Wet path: processed air track volume
    this.wetGain = ctx.createGain()
    this.wetGain.gain.value = DEFAULT_ENGINE_SNAPSHOT.breathiness2

    this.output = ctx.createGain()
    this.output.gain.value = 1.0

    // Wire:
    // Dry: input → dryGain → output
    this.input.connect(this.dryGain)
    this.dryGain.connect(this.output)
    // Wet: input → HPF → shelf → compressor → wetGain → output
    this.input.connect(this.highPass)
    this.highPass.connect(this.highShelf)
    this.highShelf.connect(this.compressor)
    this.compressor.connect(this.wetGain)
    this.wetGain.connect(this.output)
  }

  /**
   * Sets breathiness 2 amount (0-1).
   * Controls the volume of the processed "air" track that layers on top.
   * 0 = no air track. 1 = full air track blended in.
   */
  setAmount(amount: number): void {
    this.wetGain.gain.setValueAtTime(amount, this.wetGain.context.currentTime)
  }

  /**
   * Sets wet/dry mix. Since this is additive (dry always 1.0),
   * this controls the wet path volume only.
   */
  setWetDry(mix: number): void {
    this.wetGain.gain.setValueAtTime(mix, this.wetGain.context.currentTime)
  }

  dispose(): void {
    this.input.disconnect()
    this.highPass.disconnect()
    this.highShelf.disconnect()
    this.compressor.disconnect()
    this.dryGain.disconnect()
    this.wetGain.disconnect()
    this.output.disconnect()
  }
}
