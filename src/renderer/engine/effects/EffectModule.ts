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
 * EffectModule — Base interface for modular audio effects.
 *
 * Each effect in the Stage 2 signal chain implements this interface.
 * The EffectsChain orchestrator wires modules together by connecting
 * one module's output to the next module's input.
 *
 * WHY MODULAR:
 * EffectsChain.ts was growing with every sprint (breathiness, breathiness2,
 * vocal fry, reverb, etc.) and would continue to balloon with spectral tilt
 * (7.4), distortion (7.5), and formant bank (7.6). Extracting each effect
 * into its own file keeps the code navigable and lets each effect be
 * understood in isolation.
 *
 * SIGNAL FLOW:
 * Each module has an `input` GainNode and an `output` GainNode.
 * The orchestrator connects: prevModule.output → nextModule.input.
 * Modules that support wet/dry mix handle the parallel routing internally.
 */

/**
 * Base interface that all effect modules must implement.
 * Provides a consistent API for the EffectsChain orchestrator.
 */
export interface EffectModule {
  /** The entry point for audio flowing into this effect. */
  readonly input: GainNode

  /** The exit point for audio flowing out of this effect. */
  readonly output: GainNode

  /**
   * Disconnects all internal nodes and releases resources.
   * Called when the AudioContext is being torn down.
   */
  dispose(): void
}
