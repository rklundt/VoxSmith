/**
 * VoxSmith - Voice Processing for Indie Game Developers
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
 * RubberBandProcessor - Renderer Engine Layer
 *
 * Sprint 1 Spike: Wraps the rubberband-web AudioWorkletNode to provide
 * pitch shifting and tempo control via Rubber Band Library (WASM).
 *
 * WHAT THIS DOES:
 * - Loads the rubberband-processor.js AudioWorklet into the AudioContext
 * - Creates a RubberBandNode that sits in the audio signal chain
 * - Exposes setPitch() and setTempo() for real-time parameter changes
 *
 * AUDIO SIGNAL FLOW:
 *   AudioBufferSourceNode (or mic input)
 *     → RubberBandNode (pitch shift + time stretch via WASM)
 *       → AudioContext.destination (speakers)
 *
 * FORMANT INVESTIGATION RESULT (Sprint 1):
 * The rubberband-web package exposes ONLY these methods on RubberBandNode:
 *   - setPitch(pitch: number)    - multiplier, 1.0 = no change, 2.0 = octave up
 *   - setTempo(tempo: number)    - multiplier, 1.0 = no change, 0.5 = half speed
 *   - setHighQuality(on: boolean) - toggles higher-latency quality mode
 *   - close()                    - tears down the worklet
 *
 * There is NO setFormant() method in the public API or in the WASM processor
 * internals (confirmed by searching rubberband-processor.js source for
 * "formant" - zero matches). The underlying Rubber Band C++ library DOES
 * support independent formant scaling, but rubberband-web does not expose it.
 *
 * This means pitch shifting via rubberband-web will exhibit the "chipmunk effect":
 * raising pitch also raises formants proportionally, because formants track pitch.
 * For character voice acting, this is a significant limitation.
 *
 * After confirming this in the spike test, the team will evaluate three options:
 *   1. Fork rubberband-web and add FormantScale parameter to the worklet processor
 *   2. Call the native Rubber Band binary via child_process from the main process
 *   3. Switch to SoundTouch WASM (different algorithm, also lacks independent formant control)
 */

import { createRubberBandNode } from 'rubberband-web'
import type { RubberBandNode } from 'rubberband-web'

/**
 * Path to the rubberband-processor.js AudioWorklet script.
 * In Vite dev mode, files in src/renderer/public/ are served from the root.
 * In production, electron-builder copies public/ contents to the renderer output.
 */
const WORKLET_PROCESSOR_PATH = '/wasm/rubberband-processor.js'

export class RubberBandProcessor {
  // The underlying AudioWorkletNode created by rubberband-web.
  // null until initialize() completes successfully.
  private node: RubberBandNode | null = null

  // Track initialization state to prevent double-initialization
  private initialized = false

  /**
   * Initializes the Rubber Band AudioWorklet within the given AudioContext.
   *
   * This MUST be called before any other method.
   * It registers the AudioWorklet processor script and creates the node.
   * This is async because AudioWorklet.addModule() fetches and compiles the script.
   *
   * @param audioCtx - The AudioContext for the current session.
   *                   Must be in 'running' state (user gesture required in browsers,
   *                   but Electron allows autoplay via webPreferences.autoplayPolicy).
   */
  async initialize(audioCtx: AudioContext): Promise<void> {
    if (this.initialized) {
      return
    }

    // createRubberBandNode handles addModule() internally - it registers the
    // processor at WORKLET_PROCESSOR_PATH and returns a configured AudioWorkletNode.
    this.node = await createRubberBandNode(audioCtx, WORKLET_PROCESSOR_PATH)
    this.initialized = true
  }

  /**
   * Returns the RubberBandNode for use in the audio graph.
   * Source nodes connect TO this node; this node connects TO the destination.
   *
   * Usage:
   *   sourceNode.connect(processor.getNode())
   *   processor.getNode().connect(audioCtx.destination)
   */
  getNode(): RubberBandNode {
    if (!this.node) {
      throw new Error('RubberBandProcessor not initialized - call initialize() first')
    }
    return this.node
  }

  /**
   * Sets the pitch ratio.
   *
   * What it sounds like:
   *   < 1.0 = lower pitch (e.g., 0.5 = one octave down, deeper voice)
   *   1.0   = no change
   *   > 1.0 = higher pitch (e.g., 2.0 = one octave up, child-like)
   *
   * IMPORTANT: Without independent formant control, pitch changes will also
   * shift formants proportionally. Raising pitch makes voices sound like
   * chipmunks; lowering pitch makes them sound artificially hollow.
   * This is the key limitation being evaluated in Sprint 1.
   *
   * @param pitch - Ratio multiplier (recommended range: 0.5 to 2.0)
   */
  setPitch(pitch: number): void {
    this.node?.setPitch(pitch)
  }

  /**
   * Sets the playback tempo (time-stretch) ratio.
   *
   * What it sounds like:
   *   < 1.0 = slower playback (0.5 = half speed, same pitch - stretched)
   *   1.0   = no change
   *   > 1.0 = faster playback (2.0 = double speed, same pitch - compressed)
   *
   * Unlike simple sample-rate changes, Rubber Band uses a phase vocoder
   * to change speed WITHOUT changing pitch - the two are independent.
   *
   * @param tempo - Ratio multiplier (recommended range: 0.5 to 2.0)
   */
  setTempo(tempo: number): void {
    this.node?.setTempo(tempo)
  }

  /**
   * Toggles high-quality processing mode.
   *
   * High quality mode uses a more expensive phase vocoder algorithm
   * that introduces more latency but reduces artifacts (the "phasiness"
   * or "underwater" sound that can appear with fast parameter changes).
   *
   * For live mic monitoring, keep this false (lower latency).
   * For file processing before export, set this true.
   *
   * @param enabled - true = high quality (higher latency), false = real-time mode
   */
  setHighQuality(enabled: boolean): void {
    this.node?.setHighQuality(enabled)
  }

  /**
   * Whether the processor has been successfully initialized.
   */
  get isInitialized(): boolean {
    return this.initialized
  }

  /**
   * Tears down the AudioWorklet node and releases WASM resources.
   * Call this when the AudioContext is being closed or the component unmounts.
   */
  close(): void {
    this.node?.close()
    this.node = null
    this.initialized = false
  }
}
