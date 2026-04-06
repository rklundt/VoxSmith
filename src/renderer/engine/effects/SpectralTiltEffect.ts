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
 * SpectralTiltEffect — Tilts the entire frequency spectrum bright or dark.
 * Sprint 7.4
 *
 * WHAT IT DOES:
 * Applies a continuous gain slope across the full frequency spectrum.
 * Positive tilt boosts highs relative to lows (brighter, thinner,
 * younger-sounding). Negative tilt boosts lows relative to highs
 * (darker, warmer, older or larger-sounding).
 *
 * HOW IT DIFFERS FROM EQ:
 * EQ adjusts specific frequency bands independently — it's surgical.
 * Spectral tilt reshapes the overall balance between brightness and
 * warmth across the WHOLE spectrum — it's holistic. Think of it as a
 * "see-saw" centered around ~1000 Hz: tilt one way and lows go up
 * while highs go down, tilt the other way and the opposite happens.
 *
 * WHY IT MATTERS FOR CHARACTER VOICES:
 * Real human voices differ dramatically in spectral tilt:
 *   - Children/small characters: bright, harmonically rich (positive tilt)
 *   - Large/old/authoritative characters: dark, warm (negative tilt)
 * Combined with pitch and formant shifting, spectral tilt is the
 * "missing dimension" that transforms "you with effects" into "a
 * different person." Many professional voice changers use this as
 * their primary character age/size knob.
 *
 * CHARACTER ARCHETYPES:
 *   -10 to -8: Giant, ancient dragon, booming deity
 *   -7 to -3: Warrior, king, mature authority figure
 *       0:    Natural speaking voice (no modification)
 *   +3 to +7: Young woman, teenager, small creature
 *   +8 to +10: Child, tiny fairy, insectoid creature
 *
 * IMPLEMENTATION:
 * A pair of shelf filters with opposing gains:
 *   - Low shelf at 1000 Hz: gain = -tiltAmount
 *   - High shelf at 1000 Hz: gain = +tiltAmount
 * When tilt is negative (darker): lows are boosted, highs are cut.
 * When tilt is positive (brighter): lows are cut, highs are boosted.
 * When tilt is 0: both gains are 0, no effect on the signal.
 *
 * The crossover point (1000 Hz) is the pivot frequency — roughly the
 * center of the human voice's spectral range. This is the standard
 * crossover used in professional spectral tilt implementations.
 *
 * WET/DRY ROUTING:
 * Supports wet/dry mix so users can blend between their natural
 * spectral balance and the tilted version.
 *
 * ROUTING:
 *   input ──┬── dryGain ──────────────────────────────┬── output
 *           └── lowShelf → highShelf → wetGain ───────┘
 *
 * SIGNAL CHAIN POSITION:
 * After the high-pass filter, before the EQ bands. The high-pass has
 * already removed sub-bass rumble, so the tilt operates on clean voice
 * signal. Placing it before EQ means the user's broad tonal tilt is
 * applied first, then per-band EQ refinements adjust specific ranges.
 */

import type { EffectModule } from './EffectModule'
import { DEFAULT_ENGINE_SNAPSHOT } from '../../../shared/constants'

/** Crossover frequency in Hz — the pivot point for the spectral see-saw.
 *  ~1000 Hz is the center of the human voice's spectral range and is
 *  the standard crossover for professional spectral tilt implementations. */
const CROSSOVER_FREQUENCY = 1000

export class SpectralTiltEffect implements EffectModule {
  readonly input: GainNode
  readonly output: GainNode

  // Low shelf filter — boosts or cuts frequencies BELOW the crossover.
  // When tilt is negative (darker): gain goes positive (boost lows).
  // When tilt is positive (brighter): gain goes negative (cut lows).
  private lowShelf: BiquadFilterNode

  // High shelf filter — boosts or cuts frequencies ABOVE the crossover.
  // When tilt is negative (darker): gain goes negative (cut highs).
  // When tilt is positive (brighter): gain goes positive (boost highs).
  private highShelf: BiquadFilterNode

  // Wet/dry parallel routing
  private dryGain: GainNode
  private wetGain: GainNode

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain()
    this.input.gain.value = 1.0

    // Low shelf: affects everything below the crossover frequency.
    // BiquadFilterNode "lowshelf" boosts/cuts below its frequency parameter.
    this.lowShelf = ctx.createBiquadFilter()
    this.lowShelf.type = 'lowshelf'
    this.lowShelf.frequency.value = CROSSOVER_FREQUENCY
    this.lowShelf.gain.value = 0 // No tilt at default

    // High shelf: affects everything above the crossover frequency.
    // BiquadFilterNode "highshelf" boosts/cuts above its frequency parameter.
    this.highShelf = ctx.createBiquadFilter()
    this.highShelf.type = 'highshelf'
    this.highShelf.frequency.value = CROSSOVER_FREQUENCY
    this.highShelf.gain.value = 0 // No tilt at default

    // Wet/dry parallel routing
    this.dryGain = ctx.createGain()
    this.wetGain = ctx.createGain()
    this.output = ctx.createGain()
    this.output.gain.value = 1.0

    // Initialize wet/dry from defaults
    const mix = DEFAULT_ENGINE_SNAPSHOT.wetDryMix.spectralTilt
    this.dryGain.gain.value = 1.0 - mix
    this.wetGain.gain.value = mix

    // Wire parallel paths:
    // Dry: input → dryGain → output (original spectrum preserved)
    this.input.connect(this.dryGain)
    this.dryGain.connect(this.output)
    // Wet: input → lowShelf → highShelf → wetGain → output (tilted spectrum)
    this.input.connect(this.lowShelf)
    this.lowShelf.connect(this.highShelf)
    this.highShelf.connect(this.wetGain)
    this.wetGain.connect(this.output)
  }

  /**
   * Sets the spectral tilt amount.
   * @param tilt — Range: -10 (very dark) to +10 (very bright). 0 = neutral.
   *
   * The tilt value maps directly to dB gain on the shelf filters:
   *   lowShelf.gain  = -tilt  (negative tilt → boost lows, positive → cut lows)
   *   highShelf.gain = +tilt  (negative tilt → cut highs, positive → boost highs)
   *
   * At tilt=0, both gains are 0 dB — the filters pass audio unchanged.
   * At tilt=-10, lows get +10 dB and highs get -10 dB — very dark/warm.
   * At tilt=+10, lows get -10 dB and highs get +10 dB — very bright/thin.
   */
  setTilt(tilt: number): void {
    const t = this.lowShelf.context.currentTime
    // Opposing gains create the "see-saw" tilt effect.
    // Negative tilt → positive low shelf gain (boost lows), negative high shelf gain (cut highs).
    // Positive tilt → negative low shelf gain (cut lows), positive high shelf gain (boost highs).
    this.lowShelf.gain.setValueAtTime(-tilt, t)
    this.highShelf.gain.setValueAtTime(tilt, t)
  }

  /**
   * Sets the wet/dry mix for spectral tilt.
   * 0 = full dry (natural spectrum). 1 = full wet (tilted spectrum).
   * Intermediate values blend the tilted and original signals.
   */
  setWetDry(mix: number): void {
    const t = this.lowShelf.context.currentTime
    this.dryGain.gain.setValueAtTime(1.0 - mix, t)
    this.wetGain.gain.setValueAtTime(mix, t)
  }

  dispose(): void {
    this.input.disconnect()
    this.lowShelf.disconnect()
    this.highShelf.disconnect()
    this.dryGain.disconnect()
    this.wetGain.disconnect()
    this.output.disconnect()
  }
}
