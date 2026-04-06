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
 * HighPassEffect — Removes low-frequency rumble from the voice signal.
 *
 * WHAT IT DOES:
 * A high-pass filter allows frequencies above the cutoff to pass through
 * and attenuates (reduces) frequencies below the cutoff. This removes
 * room noise, mic handling noise, and sub-bass rumble that muddy the voice.
 *
 * WHY IT'S FIRST IN THE CHAIN:
 * Removing low-frequency garbage before any other processing prevents
 * downstream effects (EQ, compressor, reverb) from amplifying or
 * reacting to noise that isn't part of the voice.
 *
 * INLINE (no wet/dry): This effect is always fully applied. There's no
 * creative reason to blend rumble back in — it's purely cleanup.
 */

import type { EffectModule } from './EffectModule'
import { DEFAULT_ENGINE_SNAPSHOT } from '../../../shared/constants'

export class HighPassEffect implements EffectModule {
  readonly input: GainNode
  readonly output: GainNode

  // The high-pass filter node. Butterworth response (Q=0.7) gives a gentle,
  // natural-sounding roll-off without a resonant peak at the cutoff.
  private filter: BiquadFilterNode

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain()
    this.input.gain.value = 1.0

    this.filter = ctx.createBiquadFilter()
    this.filter.type = 'highpass'
    this.filter.frequency.value = DEFAULT_ENGINE_SNAPSHOT.highPassFrequency
    this.filter.Q.value = 0.7 // Butterworth — gentle roll-off, no resonant peak

    // Output is just the filter's output — no parallel routing needed.
    this.output = ctx.createGain()
    this.output.gain.value = 1.0

    // Wire: input → filter → output
    this.input.connect(this.filter)
    this.filter.connect(this.output)
  }

  /**
   * Sets the high-pass cutoff frequency in Hz.
   * Lower values let more bass through; higher values cut more aggressively.
   * Typical voice range: 60-200 Hz. Default 80 Hz removes sub-bass only.
   */
  setFrequency(hz: number): void {
    this.filter.frequency.setValueAtTime(hz, this.filter.context.currentTime)
  }

  dispose(): void {
    this.input.disconnect()
    this.filter.disconnect()
    this.output.disconnect()
  }
}
