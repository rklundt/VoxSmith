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
 * CompressorEffect — Dynamics compression to even out volume.
 *
 * WHAT IT DOES:
 * Reduces the volume of loud parts so quiet and loud sections are closer
 * together in level. This is essential for voice processing because:
 *   - Pitch shifting can create volume spikes
 *   - Different effects can amplify certain frequencies unpredictably
 *   - Game dialogue needs consistent volume for the player
 *
 * KEY PARAMETERS:
 *   threshold — The level (in dB) above which compression kicks in.
 *               Lower threshold = more compression. Default -24 dB.
 *   ratio     — How much to reduce the signal above threshold.
 *               4:1 means for every 4 dB over threshold, only 1 dB passes.
 *   knee      — How gradually compression engages around the threshold.
 *               10 dB soft knee for natural-sounding compression.
 *   attack    — How fast the compressor reacts to loud signals (3ms).
 *   release   — How fast the compressor lets go after the signal drops (250ms).
 *
 * INLINE (no wet/dry): Compression is a utility — it tames dynamics.
 * "Parallel compression" (blending compressed + dry) is a mixing technique
 * that's overkill for character voice processing.
 */

import type { EffectModule } from './EffectModule'
import { DEFAULT_ENGINE_SNAPSHOT } from '../../../shared/constants'

export class CompressorEffect implements EffectModule {
  readonly input: GainNode
  readonly output: GainNode

  private compressor: DynamicsCompressorNode

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain()
    this.input.gain.value = 1.0

    this.compressor = ctx.createDynamicsCompressor()
    this.compressor.threshold.value = DEFAULT_ENGINE_SNAPSHOT.compressorThreshold
    this.compressor.ratio.value = DEFAULT_ENGINE_SNAPSHOT.compressorRatio
    this.compressor.knee.value = 10      // 10dB soft knee — natural-sounding engagement
    this.compressor.attack.value = 0.003 // 3ms — catches consonant transients
    this.compressor.release.value = 0.25 // 250ms — doesn't muffle trailing words

    this.output = ctx.createGain()
    this.output.gain.value = 1.0

    // Wire: input → compressor → output
    this.input.connect(this.compressor)
    this.compressor.connect(this.output)
  }

  setThreshold(db: number): void {
    this.compressor.threshold.setValueAtTime(db, this.compressor.context.currentTime)
  }

  setRatio(ratio: number): void {
    this.compressor.ratio.setValueAtTime(ratio, this.compressor.context.currentTime)
  }

  dispose(): void {
    this.input.disconnect()
    this.compressor.disconnect()
    this.output.disconnect()
  }
}
