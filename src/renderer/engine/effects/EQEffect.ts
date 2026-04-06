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
 * EQEffect — 4-band parametric equalizer for tonal shaping.
 *
 * WHAT IT DOES:
 * Four peaking filters at different center frequencies let the user boost
 * or cut specific frequency ranges. This shapes the overall "tone" of the
 * voice — more bass, less harshness, brighter presence, etc.
 *
 * THE FOUR BANDS:
 *   Band 0 (Low ~200Hz):     Chest weight, body, bass resonance
 *   Band 1 (Low-Mid ~800Hz): Warmth, fullness, "boxiness"
 *   Band 2 (High-Mid ~2.5kHz): Presence, nasality, intelligibility
 *   Band 3 (High ~8kHz):     Brightness, air, sibilance
 *
 * INLINE (no wet/dry): EQ is a fundamental tonal tool that shapes the
 * voice's character. It's always fully applied — there's no "blend with
 * un-EQ'd" use case in voice processing.
 */

import type { EffectModule } from './EffectModule'
import type { EQBand } from '../../../shared/types'
import { DEFAULT_ENGINE_SNAPSHOT } from '../../../shared/constants'

export class EQEffect implements EffectModule {
  readonly input: GainNode
  readonly output: GainNode

  // The four peaking filter nodes in series. Each boosts/cuts a bell-shaped
  // region around its center frequency. Q=1.0 gives a moderate bandwidth.
  private bands: BiquadFilterNode[]

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain()
    this.input.gain.value = 1.0

    // Create 4 peaking filters from the default EQ band config
    this.bands = DEFAULT_ENGINE_SNAPSHOT.eq.map((band: EQBand) => {
      const filter = ctx.createBiquadFilter()
      filter.type = 'peaking'
      filter.frequency.value = band.frequency
      filter.gain.value = band.gain
      filter.Q.value = 1.0 // Moderate width — musical, not surgical
      return filter
    })

    this.output = ctx.createGain()
    this.output.gain.value = 1.0

    // Wire: input → band[0] → band[1] → band[2] → band[3] → output
    let prev: AudioNode = this.input
    for (const band of this.bands) {
      prev.connect(band)
      prev = band
    }
    prev.connect(this.output)
  }

  /**
   * Sets a single EQ band's gain and center frequency.
   * @param index - Band index (0-3)
   * @param band - The new gain (dB) and frequency (Hz) values
   */
  setBand(index: number, band: EQBand): void {
    if (index < 0 || index >= this.bands.length) return
    const t = this.bands[index].context.currentTime
    this.bands[index].gain.setValueAtTime(band.gain, t)
    this.bands[index].frequency.setValueAtTime(band.frequency, t)
  }

  /**
   * Sets all 4 EQ bands at once (used when applying a preset snapshot).
   */
  setAllBands(bands: EQBand[]): void {
    bands.forEach((band, i) => this.setBand(i, band))
  }

  dispose(): void {
    this.input.disconnect()
    for (const band of this.bands) {
      band.disconnect()
    }
    this.output.disconnect()
  }
}
