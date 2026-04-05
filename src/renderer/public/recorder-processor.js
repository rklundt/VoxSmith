/**
 * VoxSmith — Voice Processing for Indie Game Developers
 * Copyright (C) 2025 Ray Klundt w/ Claude Code Assist
 *
 * RecorderProcessor — AudioWorklet processor for capturing raw mic audio.
 *
 * Runs on the audio rendering thread (separate from the main JS thread).
 * Receives audio samples in process() and forwards them to the main thread
 * via the MessagePort. The main thread (RecordingBuffer) collects the chunks.
 *
 * This replaces the deprecated ScriptProcessorNode for recording.
 * AudioWorkletNode runs on a dedicated thread with guaranteed timing,
 * whereas ScriptProcessorNode ran on the main thread and could glitch
 * under heavy UI load.
 *
 * SIGNAL FLOW:
 *   mic → RecorderWorkletNode → volumeGain → effects → speakers
 *   RecorderWorkletNode also posts input samples to main thread via port
 *
 * The processor passes audio through unchanged (input → output) so the
 * effects chain still receives the mic signal for live monitoring.
 */

class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    // Whether we're actively recording (controlled from main thread)
    this._recording = false

    // Listen for start/stop messages from the main thread
    this.port.onmessage = (event) => {
      if (event.data.type === 'start') {
        this._recording = true
      } else if (event.data.type === 'stop') {
        this._recording = false
      }
    }
  }

  /**
   * Called by the audio rendering thread for every 128-sample block.
   *
   * @param inputs  - Array of inputs. inputs[0] is our mono mic channel.
   *                  inputs[0][0] is the Float32Array of 128 samples.
   * @param outputs - Array of outputs. We copy input to output for passthrough.
   * @returns true to keep the processor alive
   */
  process(inputs, outputs) {
    const input = inputs[0]
    const output = outputs[0]

    // Passthrough: copy input to output so monitoring still works.
    // If there's no input data (mic disconnected), output stays silent.
    if (input && input.length > 0) {
      for (let channel = 0; channel < input.length; channel++) {
        if (output[channel]) {
          output[channel].set(input[channel])
        }
      }

      // If recording, send a copy of the first channel (mono) to the main thread.
      // We must copy because the input buffer is reused by the audio thread.
      if (this._recording && input[0]) {
        const copy = new Float32Array(input[0].length)
        copy.set(input[0])
        this.port.postMessage({ type: 'samples', data: copy }, [copy.buffer])
      }
    }

    // Return true to keep the processor node alive
    return true
  }
}

registerProcessor('recorder-processor', RecorderProcessor)
