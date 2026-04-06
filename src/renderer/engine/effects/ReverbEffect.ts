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
 * ReverbEffect — Convolution reverb simulating physical spaces.
 *
 * WHAT IT DOES:
 * Simulates the sound of a physical space (room, hall, cave, cathedral)
 * around the voice. Uses convolution-based reverb for natural-sounding
 * reflections. The roomSize parameter controls the simulated space size
 * (mapped to decay time).
 *
 * IMPORTANT — MANUAL WET/DRY ROUTING:
 * We use manual wet/dry routing (parallel GainNodes) instead of
 * Tone.Reverb's built-in .wet property. Reason: Tone.Reverb's internal
 * convolver runs even at wet=0, which bleeds reverb coloring into the
 * signal. By routing around the Reverb node entirely when dry, we
 * guarantee zero reverb artifacts at the default setting.
 *
 * ROUTING:
 *   input ──┬── dryGain ──────────────────────────────┬── output
 *           └── reverb (wet=1.0) → wetGain ───────────┘
 */

import * as Tone from 'tone'
import type { EffectModule } from './EffectModule'
import { DEFAULT_ENGINE_SNAPSHOT } from '../../../shared/constants'

export class ReverbEffect implements EffectModule {
  readonly input: GainNode
  readonly output: GainNode

  private reverb: Tone.Reverb
  private dryGain: GainNode
  private wetGain: GainNode

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain()
    this.input.gain.value = 1.0

    // Tone.Reverb generates an impulse response based on decay time.
    // We set internal wet=1.0 so it always outputs fully reverbed signal.
    // Our EXTERNAL dry/wet gain nodes control the actual mix.
    this.reverb = new Tone.Reverb({
      decay: DEFAULT_ENGINE_SNAPSHOT.reverbRoomSize * 10, // 0-1 → 0-10 seconds
      wet: 1.0, // Always fully wet internally
    })

    this.dryGain = ctx.createGain()
    this.dryGain.gain.value = 1.0 - DEFAULT_ENGINE_SNAPSHOT.wetDryMix.reverb
    this.wetGain = ctx.createGain()
    this.wetGain.gain.value = DEFAULT_ENGINE_SNAPSHOT.wetDryMix.reverb

    this.output = ctx.createGain()
    this.output.gain.value = 1.0

    // Wire:
    // Dry: input → dryGain → output
    this.input.connect(this.dryGain)
    this.dryGain.connect(this.output)
    // Wet: input → reverb (Tone.js) → wetGain → output
    Tone.connect(this.input, this.reverb)
    this.reverb.connect(this.wetGain)
    this.wetGain.connect(this.output)
  }

  /**
   * Sets reverb room size.
   * @param roomSize - 0-1, maps to decay time (0 = tiny room, 1 = cathedral)
   */
  setReverb(roomSize: number): void {
    // Map 0-1 to 0.1-10 seconds. Minimum 0.1s so there's always a tiny
    // bit of space even at minimum setting.
    this.reverb.decay = 0.1 + roomSize * 9.9
  }

  /**
   * Sets wet/dry mix via manual parallel gain nodes.
   * At mix=0: dryGain=1, wetGain=0 → convolver output is muted entirely.
   * At mix=1: dryGain=0, wetGain=1 → full reverb, no dry signal.
   */
  setWetDry(mix: number): void {
    const t = this.dryGain.context.currentTime
    this.dryGain.gain.setValueAtTime(1.0 - mix, t)
    this.wetGain.gain.setValueAtTime(mix, t)
  }

  dispose(): void {
    this.input.disconnect()
    this.reverb.dispose()
    this.dryGain.disconnect()
    this.wetGain.disconnect()
    this.output.disconnect()
  }
}
