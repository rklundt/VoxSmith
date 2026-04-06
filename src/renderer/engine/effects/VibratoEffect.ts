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
 * VibratoEffect — Pitch oscillation that adds character and emotion.
 *
 * WHAT IT DOES:
 * A low-frequency oscillator (LFO) modulates the pitch of the voice up
 * and down at a set rate. This creates a wobbling pitch effect.
 *
 * WHAT IT SOUNDS LIKE:
 *   Slow rates (2-4 Hz): Theatrical, operatic, mystical — elderly wizard, bard
 *   Medium rates (4-6 Hz): Natural singing vibrato — confident, expressive
 *   Fast rates (8+ Hz): Anxious, trembling, elderly — nervous character
 *
 * IMPLEMENTATION: Uses Tone.js Vibrato which wraps a DelayNode with an
 * LFO-modulated delay time. The built-in `.wet` property handles wet/dry.
 *
 * NOTE: Tone.js must be bound to our AudioContext before creating this
 * node. EffectsChain handles this via `Tone.setContext(ctx)`.
 */

import * as Tone from 'tone'
import type { EffectModule } from './EffectModule'
import { DEFAULT_ENGINE_SNAPSHOT } from '../../../shared/constants'

export class VibratoEffect implements EffectModule {
  readonly input: GainNode
  readonly output: GainNode

  private vibrato: Tone.Vibrato

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain()
    this.input.gain.value = 1.0

    this.vibrato = new Tone.Vibrato({
      frequency: DEFAULT_ENGINE_SNAPSHOT.vibratoRate,
      depth: DEFAULT_ENGINE_SNAPSHOT.vibratoDepth,
      wet: DEFAULT_ENGINE_SNAPSHOT.wetDryMix.vibrato,
    })

    this.output = ctx.createGain()
    this.output.gain.value = 1.0

    // Wire: input → vibrato → output
    // Use Tone.connect() to bridge native Web Audio into Tone.js graph
    Tone.connect(this.input, this.vibrato)
    this.vibrato.connect(this.output)
  }

  /**
   * Sets vibrato rate (LFO frequency in Hz) and depth (0-1).
   * Rate controls how fast the pitch wavers; depth controls how wide.
   * depth=0 means no vibrato regardless of rate or wet level.
   */
  setVibrato(rate: number, depth: number): void {
    this.vibrato.frequency.value = rate
    this.vibrato.depth.value = depth
  }

  /**
   * Sets the wet/dry mix via Tone.js built-in wet property.
   * 0 = full dry (no vibrato). 1 = full wet (max vibrato).
   */
  setWetDry(mix: number): void {
    this.vibrato.wet.value = mix
  }

  dispose(): void {
    this.input.disconnect()
    this.vibrato.dispose()
    this.output.disconnect()
  }
}
