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
 * BreathinessEffect — Spectral reshaping to simulate open-glottis airy speech.
 *
 * WHAT MAKES A VOICE SOUND BREATHY:
 * In breathy speech, the vocal folds don't fully close during each vibration
 * cycle. This means:
 *   - Less low-frequency harmonic energy (weaker chest resonance)
 *   - More high-frequency energy (turbulent airflow through the gap)
 * The voice sounds thinner, airier, and less "solid."
 *
 * HOW WE DO IT:
 * Two shelf filters reshape the voice's spectral balance:
 *   - Low-shelf CUT at 300 Hz: reduces chest body/warmth
 *   - High-shelf BOOST at 3000 Hz: adds air/brightness/sibilance
 * The reshaped voice is blended with the original via wet/dry crossfade.
 * No noise injection — we modify the voice signal itself.
 *
 * ROUTING:
 *   input ──┬── dryGain ──────────────────────────────┬── output
 *           └── lowShelf → highShelf → wetGain ───────┘
 */

import type { EffectModule } from './EffectModule'
import { DEFAULT_ENGINE_SNAPSHOT } from '../../../shared/constants'

export class BreathinessEffect implements EffectModule {
  readonly input: GainNode
  readonly output: GainNode

  // Low-shelf filter — reduces low-frequency harmonics (chest weight).
  // At max breathiness, cuts up to -12 dB below 300 Hz.
  // This makes the voice sound thinner, like the speaker has less body.
  private lowShelf: BiquadFilterNode
  // High-shelf filter — boosts high-frequency energy (air/sibilance).
  // At max breathiness, boosts up to +9 dB above 3 kHz.
  // This simulates turbulent airflow through open vocal folds.
  private highShelf: BiquadFilterNode

  // Wet/dry crossfade gains
  private dryGain: GainNode
  private wetGain: GainNode

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain()
    this.input.gain.value = 1.0

    // Low-shelf: cuts lows to thin out the chest resonance
    this.lowShelf = ctx.createBiquadFilter()
    this.lowShelf.type = 'lowshelf'
    this.lowShelf.frequency.value = 300
    this.lowShelf.gain.value = 0 // 0 dB = no change at default

    // High-shelf: boosts highs to add air/sibilance
    this.highShelf = ctx.createBiquadFilter()
    this.highShelf.type = 'highshelf'
    this.highShelf.frequency.value = 3000
    this.highShelf.gain.value = 0 // 0 dB = no change at default

    // Wet/dry crossfade
    this.dryGain = ctx.createGain()
    this.wetGain = ctx.createGain()
    this.output = ctx.createGain()
    this.output.gain.value = 1.0

    const amount = DEFAULT_ENGINE_SNAPSHOT.breathiness
    this.dryGain.gain.value = 1.0 - amount
    this.wetGain.gain.value = amount

    // Wire parallel paths:
    // Dry: input → dryGain → output
    // Wet: input → lowShelf → highShelf → wetGain → output
    this.input.connect(this.dryGain)
    this.dryGain.connect(this.output)
    this.input.connect(this.lowShelf)
    this.lowShelf.connect(this.highShelf)
    this.highShelf.connect(this.wetGain)
    this.wetGain.connect(this.output)
  }

  /**
   * Sets breathiness amount (0-1).
   * Controls spectral reshaping intensity AND wet/dry crossfade.
   *
   * At 0: no reshaping, full dry voice.
   * At 1: maximum reshaping (-12 dB low cut, +9 dB high boost), full wet.
   * In between: proportional reshaping with crossfade.
   */
  setBreathiness(amount: number): void {
    const t = this.lowShelf.context.currentTime

    // Scale shelf filter gains with breathiness amount.
    this.lowShelf.gain.setValueAtTime(-12 * amount, t)
    this.highShelf.gain.setValueAtTime(9 * amount, t)

    // Crossfade: dry voice fades out as breathy version fades in.
    this.dryGain.gain.setValueAtTime(1.0 - amount, t)
    this.wetGain.gain.setValueAtTime(amount, t)
  }

  /**
   * Sets wet/dry mix for breathiness.
   * This is a true crossfade — volume stays consistent.
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
