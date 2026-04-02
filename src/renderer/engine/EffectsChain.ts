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
 * EffectsChain - Stage 2 Real-Time Audio Effects (Sprint 3)
 *
 * Full signal chain with all advanced controls, wet/dry routing, and bypass.
 *
 * SIGNAL CHAIN (matches architecture.md):
 *   input → highPass → eq[0..3] → compressor
 *     → vibrato (Tone.js, built-in wet/dry)
 *     → tremolo (Tone.js, built-in wet/dry)
 *     → vocalFry (Web Audio AM synthesis, manual wet/dry)
 *     → breathiness (Web Audio noise injection, manual wet/dry)
 *     → reverb (Tone.js, built-in wet/dry)
 *     → outputGain → output
 *
 * BYPASS: When bypassed, signal routes directly from input → output,
 * skipping the entire chain. The chain output is muted via gain = 0.
 *
 * WET/DRY APPROACHES:
 * - Tone.js effects (vibrato, tremolo): use built-in `.wet` property (0-1)
 * - Reverb: manual parallel dry/wet GainNode routing (Tone.Reverb's internal
 *   crossfade bleeds convolver artifacts at wet=0, so we bypass it externally)
 * - Custom effects (vocalFry, breathiness): parallel dry/wet GainNode routing
 *
 * VOCAL FRY IMPLEMENTATION:
 * Uses amplitude modulation (AM) at sub-audio frequencies (20-80 Hz).
 * A low-frequency oscillator modulates the signal's amplitude, creating
 * the crackling/creaky "fry" register sound. This is the same physical
 * mechanism as real vocal fry - irregular glottal pulses.
 *
 * BREATHINESS IMPLEMENTATION:
 * Spectral reshaping - no noise injection. Two shelf filters modify the
 * voice's frequency balance to simulate breathy speech (open vocal folds):
 *   - Low-shelf CUT at 300 Hz: reduces chest resonance (thinner body)
 *   - High-shelf BOOST at 3 kHz: adds air/sibilance (turbulent airflow)
 * The reshaped voice is crossfaded with the original via wet/dry gain.
 */

import * as Tone from 'tone'
import type { EngineSnapshot, EQBand, EffectName } from '../../shared/types'
import { DEFAULT_ENGINE_SNAPSHOT } from '../../shared/constants'

export class EffectsChain {
  private ctx: AudioContext

  // ─── Inline Effects (no wet/dry - always fully applied) ────────────────

  // High-pass filter - removes low-frequency rumble (room noise, mic handling noise).
  private highPassFilter: BiquadFilterNode

  // 4-band parametric EQ - shapes the tonal character of the voice.
  // Band 1 (Low ~200Hz): chest weight. Band 2 (Low-Mid ~800Hz): warmth.
  // Band 3 (High-Mid ~2500Hz): presence/nasality. Band 4 (High ~8000Hz): brightness/air.
  private eqBands: BiquadFilterNode[]

  // Dynamics compressor - evens out volume so quiet and loud parts are closer.
  private compressor: DynamicsCompressorNode

  // ─── Tone.js Effects (built-in wet/dry via .wet property) ──────────────

  // Vibrato - pitch oscillation that adds character/emotion to the voice.
  // Slow rates (2-4 Hz) sound theatrical; fast rates (8+ Hz) sound anxious/elderly.
  // The LFO modulates pitch; depth controls how wide the pitch swings.
  private vibrato: Tone.Vibrato

  // Tremolo - volume oscillation that adds rhythmic pulsing to the voice.
  // Unlike vibrato (pitch), tremolo pulses the VOLUME up and down.
  // Slow rates sound emotional/shaky; fast rates sound mechanical/supernatural.
  private tremolo: Tone.Tremolo

  // Reverb - simulates the sound of a physical space around the voice.
  // Uses convolution-based reverb for natural-sounding reflections.
  // roomSize controls the simulated space size (decay time).
  //
  // IMPORTANT: We use manual wet/dry routing (same pattern as vocalFry)
  // instead of Tone.Reverb's built-in .wet property. Tone.Reverb's internal
  // convolver runs even at wet=0, which bleeds reverb coloring into the
  // signal. By routing around the Reverb node entirely when dry, we
  // guarantee zero reverb artifacts at the default setting.
  //
  // ROUTING:
  //   prev stage --+-- reverbDryGain -------------------------+-- reverbBlend
  //                |                                           |
  //                +-- reverb (Tone.js, wet=1.0) -- reverbWetGain --+
  private reverb: Tone.Reverb
  private reverbDryGain: GainNode     // Dry path (original, no reverb)
  private reverbWetGain: GainNode     // Wet path (fully reverbed signal, level controlled)
  private reverbBlend: GainNode       // Sum of dry + wet

  // ─── Custom Effects (manual wet/dry routing) ───────────────────────────

  // Vocal Fry - amplitude modulation at sub-audio frequencies.
  // An oscillator at 20-80 Hz modulates the signal's volume, creating
  // the irregular crackling sound of the vocal fry register.
  private vocalFryLFO: OscillatorNode        // Sub-audio oscillator (20-80 Hz)
  private vocalFryLFOGain: GainNode          // Controls LFO depth (0 = no fry, 1 = full fry)
  private vocalFryModulator: GainNode        // The gain node whose gain is modulated by the LFO
  private vocalFryDryGain: GainNode          // Dry path (unmodulated signal)
  private vocalFryWetGain: GainNode          // Wet path (modulated signal)
  private vocalFryBlend: GainNode            // Sum of dry + wet paths

  // Breathiness - spectral reshaping to simulate open-glottis airy speech.
  //
  // WHAT MAKES A VOICE SOUND BREATHY:
  // In breathy speech, the vocal folds don't fully close. This means:
  //   - Less low-frequency harmonic energy (weaker chest resonance)
  //   - More high-frequency energy (turbulent airflow, sibilance)
  // The voice sounds thinner, airier, and less "solid."
  //
  // HOW WE DO IT:
  // Two shelf filters reshape the voice's spectral balance:
  //   - Low-shelf CUT at 300 Hz: reduces chest body/warmth
  //   - High-shelf BOOST at 3000 Hz: adds air/brightness/sibilance
  // The reshaped voice is blended with the original via wet/dry crossfade.
  // No noise injection at all - we modify the voice signal itself.
  //
  // ROUTING:
  //   prev stage ──┬── breathinessDryGain ──────────────────────────┬── blend
  //                └── lowShelf → highShelf → breathinessWetGain ───┘
  private breathinessLowShelf: BiquadFilterNode   // Cuts lows - thins out chest
  private breathinessHighShelf: BiquadFilterNode  // Boosts highs - adds air
  private breathinessDryGain: GainNode            // Dry path (original voice)
  private breathinessWetGain: GainNode            // Wet path (spectrally reshaped)
  private breathinessBlend: GainNode              // Sum of dry + wet paths

  // Breathiness 2 - Vocal processing method for close-mic breathy tone.
  //
  // HOW IT WORKS (Billie Eilish / close-mic technique):
  // 1. Duplicate the voice signal into an "upper" (airy) track
  // 2. High-pass filter at 500 Hz - strips out the bass/body
  // 3. High-shelf boost at 8 kHz - emphasizes the airy sibilant frequencies
  // 4. Compress the upper track - makes the breath noise consistent in level
  // 5. Blend the upper track at reduced volume with the original voice
  //
  // This is different from Breathiness 1 (spectral reshaping of the whole
  // voice). Breathiness 2 keeps the original voice intact and layers a
  // processed "air" track on top - more like a mix engineer's approach.
  //
  // ROUTING:
  //   prev stage --+-- b2DryGain --------------------------------+-- b2Blend
  //                |                                              |
  //                +-- b2HighPass --> b2HighShelf --> b2Compressor |
  //                    --> b2WetGain -----------------------------+
  private b2HighPass: BiquadFilterNode         // HPF at 500 Hz - removes bass/body
  private b2HighShelf: BiquadFilterNode        // Shelf boost above 8 kHz - adds air
  private b2Compressor: DynamicsCompressorNode // Compresses the airy track for consistency
  private b2DryGain: GainNode                  // Dry path (original voice, always full)
  private b2WetGain: GainNode                  // Wet path (processed air track, blended in)
  private b2Blend: GainNode                    // Sum of dry + wet

  // ─── Output and Bypass ─────────────────────────────────────────────────

  // Master output gain - overall level after all effects.
  private outputGain: GainNode

  // Bypass routing - when active, signal skips entire chain.
  private bypassGain: GainNode     // Direct input → output path (gain=1 when bypassed)
  private chainGain: GainNode      // Chain output level (gain=0 when bypassed)

  // Chain entry/exit points for external connections.
  private _input: GainNode
  private _output: GainNode

  constructor(audioContext: AudioContext) {
    this.ctx = audioContext

    // Tell Tone.js to use our existing AudioContext. This is critical -
    // all Tone.js nodes must share the same context as our Web Audio nodes.
    // Without this, Tone creates its own context and nodes can't connect.
    Tone.setContext(this.ctx)

    // ─── Input Node ──────────────────────────────────────────────────
    this._input = this.ctx.createGain()
    this._input.gain.value = 1.0

    // ─── High-Pass Filter ────────────────────────────────────────────
    this.highPassFilter = this.ctx.createBiquadFilter()
    this.highPassFilter.type = 'highpass'
    this.highPassFilter.frequency.value = DEFAULT_ENGINE_SNAPSHOT.highPassFrequency
    this.highPassFilter.Q.value = 0.7 // Butterworth - gentle roll-off

    // ─── 4-Band Parametric EQ ────────────────────────────────────────
    this.eqBands = DEFAULT_ENGINE_SNAPSHOT.eq.map((band: EQBand) => {
      const filter = this.ctx.createBiquadFilter()
      filter.type = 'peaking'
      filter.frequency.value = band.frequency
      filter.gain.value = band.gain
      filter.Q.value = 1.0 // Moderate width
      return filter
    })

    // ─── Compressor ──────────────────────────────────────────────────
    this.compressor = this.ctx.createDynamicsCompressor()
    this.compressor.threshold.value = DEFAULT_ENGINE_SNAPSHOT.compressorThreshold
    this.compressor.ratio.value = DEFAULT_ENGINE_SNAPSHOT.compressorRatio
    this.compressor.knee.value = 10     // 10dB soft knee - natural-sounding
    this.compressor.attack.value = 0.003 // 3ms - catches consonants
    this.compressor.release.value = 0.25 // 250ms - doesn't muffle trailing words

    // ─── Vibrato (Tone.js) ───────────────────────────────────────────
    // Pitch oscillation. depth=0 means no effect regardless of wet level.
    this.vibrato = new Tone.Vibrato({
      frequency: DEFAULT_ENGINE_SNAPSHOT.vibratoRate,
      depth: DEFAULT_ENGINE_SNAPSHOT.vibratoDepth,
      wet: DEFAULT_ENGINE_SNAPSHOT.wetDryMix.vibrato,
    })

    // ─── Tremolo (Tone.js) ───────────────────────────────────────────
    // Volume oscillation. Must call .start() to begin the internal LFO.
    this.tremolo = new Tone.Tremolo({
      frequency: DEFAULT_ENGINE_SNAPSHOT.tremoloRate,
      depth: DEFAULT_ENGINE_SNAPSHOT.tremoloDepth,
      wet: DEFAULT_ENGINE_SNAPSHOT.wetDryMix.tremolo,
    }).start() // Start the tremolo LFO immediately

    // ─── Vocal Fry (AM Synthesis) ────────────────────────────────────
    // Sub-audio oscillator modulates signal amplitude for crackling effect.
    //
    // Routing:
    //   compressor out ──┬── vocalFryModulator (wet, AM'd) → wetGain ──┬── blend
    //                    └── dryGain ──────────────────────────────────┘
    //
    // The LFO oscillator's output feeds into vocalFryModulator.gain,
    // so the modulator's gain oscillates between (1-depth) and (1+depth).
    // At depth=0, gain stays at 1.0 (no modulation). At depth=1, gain
    // swings between 0 and 2 (heavy fry).

    this.vocalFryLFO = this.ctx.createOscillator()
    this.vocalFryLFO.type = 'sine'
    this.vocalFryLFO.frequency.value = 50 // 50 Hz - middle of the fry range
    this.vocalFryLFO.start()

    this.vocalFryLFOGain = this.ctx.createGain()
    this.vocalFryLFOGain.gain.value = DEFAULT_ENGINE_SNAPSHOT.vocalFryIntensity

    this.vocalFryModulator = this.ctx.createGain()
    this.vocalFryModulator.gain.value = 1.0 // Base gain; LFO modulates around this

    this.vocalFryDryGain = this.ctx.createGain()
    this.vocalFryWetGain = this.ctx.createGain()
    this.vocalFryBlend = this.ctx.createGain()
    this.vocalFryBlend.gain.value = 1.0

    // Wire LFO → modulator gain parameter
    this.vocalFryLFO.connect(this.vocalFryLFOGain)
    this.vocalFryLFOGain.connect(this.vocalFryModulator.gain)

    // Set initial wet/dry for vocal fry
    const vocalFryMix = DEFAULT_ENGINE_SNAPSHOT.wetDryMix.vocalFry
    this.vocalFryWetGain.gain.value = vocalFryMix
    this.vocalFryDryGain.gain.value = 1.0 - vocalFryMix

    // ─── Breathiness (Spectral Reshaping) ───────────────────────────
    // Makes the voice sound breathy by modifying its spectral balance.
    // No noise injection - we reshape the voice signal itself.
    //
    // Breathy speech has less chest resonance (weak lows) and more airflow
    // (strong highs). Two shelf filters simulate this:
    //   - Low-shelf CUT at 300 Hz: thins out the chest/body
    //   - High-shelf BOOST at 3 kHz: adds air, sibilance, brightness
    //
    // The amount of cut/boost scales with the breathiness parameter.
    // At 0 = flat (no change). At 1 = maximum reshaping.

    // Low-shelf filter - reduces low-frequency harmonics (chest weight).
    // At max breathiness, cuts up to -12 dB below 300 Hz.
    // This makes the voice sound thinner, like the speaker has less body.
    this.breathinessLowShelf = this.ctx.createBiquadFilter()
    this.breathinessLowShelf.type = 'lowshelf'
    this.breathinessLowShelf.frequency.value = 300
    this.breathinessLowShelf.gain.value = 0 // 0 dB = no change at default

    // High-shelf filter - boosts high-frequency energy (air/sibilance).
    // At max breathiness, boosts up to +9 dB above 3 kHz.
    // This simulates turbulent airflow through open vocal folds.
    this.breathinessHighShelf = this.ctx.createBiquadFilter()
    this.breathinessHighShelf.type = 'highshelf'
    this.breathinessHighShelf.frequency.value = 3000
    this.breathinessHighShelf.gain.value = 0 // 0 dB = no change at default

    // ── Wet/Dry Crossfade ───────────────────────────────────────────
    // Dry = original voice. Wet = spectrally reshaped voice.
    // The breathiness slider crossfades between them.
    this.breathinessDryGain = this.ctx.createGain()
    this.breathinessWetGain = this.ctx.createGain()
    this.breathinessBlend = this.ctx.createGain()
    this.breathinessBlend.gain.value = 1.0

    // Initialize crossfade based on default breathiness (0 = full dry)
    const breathAmount = DEFAULT_ENGINE_SNAPSHOT.breathiness
    this.breathinessDryGain.gain.value = 1.0 - breathAmount
    this.breathinessWetGain.gain.value = breathAmount

    // ─── Breathiness 2 (Vocal Processing Method) ──────────────────────
    // Close-mic breathy tone: duplicate voice, strip bass, boost air,
    // compress, then blend at reduced volume with the original.

    // High-pass at 500 Hz - removes the "body" of the voice, leaving
    // only the upper harmonics and sibilant/breath frequencies.
    this.b2HighPass = this.ctx.createBiquadFilter()
    this.b2HighPass.type = 'highpass'
    this.b2HighPass.frequency.value = 500
    this.b2HighPass.Q.value = 0.7

    // High-shelf boost at 8 kHz - emphasizes the airy frequencies above 8k.
    // At max breathiness2, boosts up to +12 dB. This is the "air" band
    // that gives the close-mic, intimate vocal character.
    this.b2HighShelf = this.ctx.createBiquadFilter()
    this.b2HighShelf.type = 'highshelf'
    this.b2HighShelf.frequency.value = 8000
    this.b2HighShelf.gain.value = 12 // Always boosted on the wet path

    // Compressor on the airy track - makes the breath noise consistent.
    // Low threshold catches even quiet breath sounds and brings them up.
    // High ratio squashes dynamics so the air layer is smooth and even.
    this.b2Compressor = this.ctx.createDynamicsCompressor()
    this.b2Compressor.threshold.value = -30  // Moderate threshold - catches breath without squashing
    this.b2Compressor.ratio.value = 4        // 4:1 - gentle compression to even out air track
                                             // (higher ratios make the voice harsh, not breathy)
    this.b2Compressor.knee.value = 10        // Soft knee for natural sound
    this.b2Compressor.attack.value = 0.003   // 3ms - fast attack catches consonants
    this.b2Compressor.release.value = 0.1    // 100ms - moderate release

    // Dry path: original voice passes through unchanged (always at 1.0).
    // Wet path: processed air track blended in on top (additive, not crossfade).
    this.b2DryGain = this.ctx.createGain()
    this.b2DryGain.gain.value = 1.0

    this.b2WetGain = this.ctx.createGain()
    this.b2WetGain.gain.value = DEFAULT_ENGINE_SNAPSHOT.breathiness2

    this.b2Blend = this.ctx.createGain()
    this.b2Blend.gain.value = 1.0

    // ─── Reverb (Tone.js + manual wet/dry routing) ────────────────────
    // Convolution reverb simulates acoustic spaces. Tone.Reverb generates
    // an impulse response based on the decay parameter.
    //
    // We set Tone.Reverb's internal wet=1.0 so it always outputs fully
    // reverbed signal. Our EXTERNAL dry/wet gain nodes control the mix.
    // This way, when reverbWetGain=0 and reverbDryGain=1, the Tone.Reverb
    // node is still connected but its output is muted - no convolver
    // artifacts leak into the dry signal.
    this.reverb = new Tone.Reverb({
      decay: DEFAULT_ENGINE_SNAPSHOT.reverbRoomSize * 10, // 0-1 -> 0-10 seconds decay
      wet: 1.0, // Always fully wet internally - external gains control the mix
    })

    // Manual wet/dry gains for reverb
    this.reverbDryGain = this.ctx.createGain()
    this.reverbDryGain.gain.value = 1.0 - DEFAULT_ENGINE_SNAPSHOT.wetDryMix.reverb
    this.reverbWetGain = this.ctx.createGain()
    this.reverbWetGain.gain.value = DEFAULT_ENGINE_SNAPSHOT.wetDryMix.reverb
    this.reverbBlend = this.ctx.createGain()
    this.reverbBlend.gain.value = 1.0

    // ─── Output Gain ─────────────────────────────────────────────────
    this.outputGain = this.ctx.createGain()
    this.outputGain.gain.value = 1.0

    // ─── Bypass Routing ──────────────────────────────────────────────
    // bypassGain: direct path from input to output (active when bypassed)
    // chainGain: gate for the chain output (muted when bypassed)
    this.bypassGain = this.ctx.createGain()
    this.bypassGain.gain.value = DEFAULT_ENGINE_SNAPSHOT.bypassed ? 1.0 : 0.0

    this.chainGain = this.ctx.createGain()
    this.chainGain.gain.value = DEFAULT_ENGINE_SNAPSHOT.bypassed ? 0.0 : 1.0

    // Output node - external connections go here → destination
    this._output = this.ctx.createGain()
    this._output.gain.value = 1.0

    // ─── Wire the Complete Chain ─────────────────────────────────────
    this._wireChain()
  }

  /**
   * Wires all nodes in the signal chain.
   * Called once in constructor. The chain topology is fixed - only
   * parameter values change at runtime via the setter methods.
   */
  private _wireChain(): void {
    // input → highPass
    this._input.connect(this.highPassFilter)

    // highPass → eq[0] → eq[1] → eq[2] → eq[3]
    let prevNode: AudioNode = this.highPassFilter
    for (const band of this.eqBands) {
      prevNode.connect(band)
      prevNode = band
    }

    // eq[3] → compressor
    prevNode.connect(this.compressor)

    // compressor → vibrato (Tone.js)
    // Native AudioNode.connect() doesn't accept Tone.js nodes directly.
    // Use Tone.connect() to bridge from native Web Audio into the Tone.js graph.
    Tone.connect(this.compressor, this.vibrato)

    // vibrato → tremolo (Tone.js to Tone.js - use Tone's connect)
    this.vibrato.connect(this.tremolo)

    // tremolo → vocal fry (manual wet/dry split)
    // Dry path: tremolo → dryGain → blend
    // Wet path: tremolo → modulator → wetGain → blend
    this.tremolo.connect(this.vocalFryDryGain)
    this.tremolo.connect(this.vocalFryModulator)
    this.vocalFryModulator.connect(this.vocalFryWetGain)
    this.vocalFryDryGain.connect(this.vocalFryBlend)
    this.vocalFryWetGain.connect(this.vocalFryBlend)

    // vocal fry blend → breathiness (ring modulation: noise × voice)
    //
    // Voice dry path: vocalFryBlend → breathinessDryGain → breathinessBlend
    // Ring mod path:  vocalFryBlend → ringModulator.gain (voice = modulator)
    //                 noiseSource → noiseFilter → ringModulator (noise = carrier)
    // vocal fry blend → breathiness (spectral reshaping)
    //
    // Dry path: vocalFryBlend → breathinessDryGain → breathinessBlend
    // Wet path: vocalFryBlend → lowShelf → highShelf → breathinessWetGain → blend
    //
    // The wet path is the spectrally reshaped "breathy" version of the voice.
    // Crossfading dry↔wet controls the breathiness amount.
    this.vocalFryBlend.connect(this.breathinessDryGain)
    this.breathinessDryGain.connect(this.breathinessBlend)
    // Wet path: voice → low-shelf cut → high-shelf boost → wet gain → blend
    this.vocalFryBlend.connect(this.breathinessLowShelf)
    this.breathinessLowShelf.connect(this.breathinessHighShelf)
    this.breathinessHighShelf.connect(this.breathinessWetGain)
    this.breathinessWetGain.connect(this.breathinessBlend)

    // breathiness blend --> breathiness 2 (vocal processing)
    //
    // Dry path: breathinessBlend --> b2DryGain --> b2Blend
    // Wet path: breathinessBlend --> b2HighPass --> b2HighShelf --> b2Compressor
    //           --> b2WetGain --> b2Blend
    //
    // This is ADDITIVE (not crossfade) - the original voice is always present,
    // and the compressed air track layers on top.
    this.breathinessBlend.connect(this.b2DryGain)
    this.b2DryGain.connect(this.b2Blend)
    // Wet path: voice --> HPF 500Hz --> shelf boost 8kHz --> compress --> wet gain
    this.breathinessBlend.connect(this.b2HighPass)
    this.b2HighPass.connect(this.b2HighShelf)
    this.b2HighShelf.connect(this.b2Compressor)
    this.b2Compressor.connect(this.b2WetGain)
    this.b2WetGain.connect(this.b2Blend)

    // breathiness 2 blend -> reverb (manual wet/dry split)
    //
    // Dry path: b2Blend -> reverbDryGain -> reverbBlend (no convolver, zero latency)
    // Wet path: b2Blend -> reverb (Tone.js) -> reverbWetGain -> reverbBlend
    //
    // At default (wetDryMix.reverb=0): dryGain=1, wetGain=0 -> pure dry signal,
    // no audio flows through the convolver output. This eliminates the reverb
    // bleed that Tone.Reverb's internal crossfade was causing.
    this.b2Blend.connect(this.reverbDryGain)
    this.reverbDryGain.connect(this.reverbBlend)
    // Wet path: bridge native GainNode into Tone.js Reverb using Tone.connect()
    Tone.connect(this.b2Blend, this.reverb)
    this.reverb.connect(this.reverbWetGain)
    this.reverbWetGain.connect(this.reverbBlend)

    // reverb blend -> output gain -> chain gain -> output
    this.reverbBlend.connect(this.outputGain)
    this.outputGain.connect(this.chainGain)
    this.chainGain.connect(this._output)

    // Bypass path: input → bypassGain → output (skips entire chain)
    this._input.connect(this.bypassGain)
    this.bypassGain.connect(this._output)
  }

  // ─── Public Accessors ──────────────────────────────────────────────────

  /** Connect source nodes TO this input */
  get input(): GainNode {
    return this._input
  }

  /** Connect this output TO AudioContext.destination */
  get output(): GainNode {
    return this._output
  }

  // ─── Parameter Setters ─────────────────────────────────────────────────
  // Each setter updates the corresponding audio node in real time.
  // Using AudioParam.setValueAtTime() for sample-accurate updates.

  // ── Inline Effects ─────────────────────────────────────────────────────

  setHighPassFrequency(hz: number): void {
    this.highPassFilter.frequency.setValueAtTime(hz, this.ctx.currentTime)
  }

  setEQBand(index: number, band: EQBand): void {
    if (index < 0 || index >= this.eqBands.length) return
    this.eqBands[index].gain.setValueAtTime(band.gain, this.ctx.currentTime)
    this.eqBands[index].frequency.setValueAtTime(band.frequency, this.ctx.currentTime)
  }

  setAllEQBands(bands: EQBand[]): void {
    bands.forEach((band, i) => this.setEQBand(i, band))
  }

  setCompressorThreshold(db: number): void {
    this.compressor.threshold.setValueAtTime(db, this.ctx.currentTime)
  }

  setCompressorRatio(ratio: number): void {
    this.compressor.ratio.setValueAtTime(ratio, this.ctx.currentTime)
  }

  setOutputGain(gain: number): void {
    this.outputGain.gain.setValueAtTime(gain, this.ctx.currentTime)
  }

  // ── Tone.js Effects ────────────────────────────────────────────────────

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
   * Sets tremolo rate (LFO frequency in Hz) and depth (0-1).
   * Rate controls how fast the volume pulses; depth controls intensity.
   * depth=0 means no tremolo regardless of rate or wet level.
   */
  setTremolo(rate: number, depth: number): void {
    this.tremolo.frequency.value = rate
    this.tremolo.depth.value = depth
  }

  /**
   * Sets reverb parameters.
   * @param roomSize - 0-1, maps to decay time (0 = tiny room, 1 = cathedral)
   * @param amount - 0-1, how much reverb signal to mix in (used as wet level)
   */
  setReverb(roomSize: number, amount: number): void {
    // Tone.Reverb.decay is in seconds. Map 0-1 to 0.1-10 seconds.
    // Minimum 0.1s so there's always a tiny bit of space even at minimum setting.
    this.reverb.decay = 0.1 + roomSize * 9.9
    // The reverbAmount from the snapshot controls the mix via wetDryMix.reverb,
    // but we also factor in the amount parameter for convenience.
    // Note: wet is set separately via setWetDry()
  }

  // ── Custom Effects ─────────────────────────────────────────────────────

  /**
   * Sets vocal fry intensity (0-1).
   * Controls the depth of the sub-audio AM oscillator.
   * 0 = no modulation (clean). 1 = heavy modulation (crackling fry).
   */
  setVocalFry(intensity: number): void {
    this.vocalFryLFOGain.gain.setValueAtTime(intensity, this.ctx.currentTime)
  }

  /**
   * Sets breathiness amount (0-1).
   * Controls spectral reshaping intensity AND wet/dry crossfade.
   *
   * At 0: no reshaping, full dry voice.
   * At 1: maximum reshaping (-12 dB low cut, +9 dB high boost), full wet.
   * In between: proportional reshaping with crossfade.
   *
   * The shelf filter gains scale linearly with the amount so the effect
   * intensifies smoothly. The crossfade ensures the overall volume stays
   * roughly consistent (dry fades out as wet fades in).
   */
  setBreathiness(amount: number): void {
    const t = this.ctx.currentTime

    // Scale shelf filter gains with breathiness amount.
    // Low-shelf: 0 to -12 dB (cuts chest resonance)
    // High-shelf: 0 to +9 dB (adds air/sibilance)
    this.breathinessLowShelf.gain.setValueAtTime(-12 * amount, t)
    this.breathinessHighShelf.gain.setValueAtTime(9 * amount, t)

    // Crossfade: dry voice fades out as breathy version fades in.
    this.breathinessDryGain.gain.setValueAtTime(1.0 - amount, t)
    this.breathinessWetGain.gain.setValueAtTime(amount, t)
  }

  /**
   * Sets breathiness 2 amount (0-1).
   * Controls the volume of the processed "air" track that layers on top
   * of the original voice. This is additive - the original is always present.
   * 0 = no air track. 1 = full air track blended in.
   */
  setBreathiness2(amount: number): void {
    this.b2WetGain.gain.setValueAtTime(amount, this.ctx.currentTime)
  }

  // ── Wet/Dry Mix ────────────────────────────────────────────────────────

  /**
   * Sets the wet/dry mix for a specific effect.
   * @param effect - Which effect to adjust
   * @param mix - 0.0 (full dry / effect bypassed) to 1.0 (full wet / effect fully applied)
   */
  setWetDry(effect: EffectName, mix: number): void {
    switch (effect) {
      case 'vibrato':
        // Tone.js Vibrato has a built-in wet property (Signal<number>)
        this.vibrato.wet.value = mix
        break
      case 'tremolo':
        // Tone.js Tremolo has a built-in wet property
        this.tremolo.wet.value = mix
        break
      case 'reverb':
        // Manual wet/dry routing - parallel gain nodes around Tone.Reverb.
        // At mix=0: dryGain=1, wetGain=0 -> convolver output is muted entirely.
        // At mix=1: dryGain=0, wetGain=1 -> full reverb, no dry signal.
        this.reverbDryGain.gain.setValueAtTime(1.0 - mix, this.ctx.currentTime)
        this.reverbWetGain.gain.setValueAtTime(mix, this.ctx.currentTime)
        break
      case 'vocalFry':
        // Manual wet/dry: adjust parallel gain nodes
        this.vocalFryWetGain.gain.setValueAtTime(mix, this.ctx.currentTime)
        this.vocalFryDryGain.gain.setValueAtTime(1.0 - mix, this.ctx.currentTime)
        break
      case 'breathiness':
        // Crossfade between dry (original) and wet (spectrally reshaped).
        // This is a true crossfade, not additive - so volume stays consistent.
        this.breathinessDryGain.gain.setValueAtTime(1.0 - mix, this.ctx.currentTime)
        this.breathinessWetGain.gain.setValueAtTime(mix, this.ctx.currentTime)
        break
      case 'breathiness2':
        // Additive mix - controls the processed air track volume.
        // Dry is always 1.0; wet layers on top.
        this.b2WetGain.gain.setValueAtTime(mix, this.ctx.currentTime)
        break
    }
  }

  // ── Bypass ─────────────────────────────────────────────────────────────

  /**
   * Enables or disables bypass mode.
   * When bypassed, the signal routes directly from input to output,
   * skipping the entire effects chain. This lets the user compare
   * processed vs. original audio instantly.
   */
  setBypass(bypassed: boolean): void {
    const t = this.ctx.currentTime
    if (bypassed) {
      // Mute the chain output, unmute the bypass path
      this.chainGain.gain.setValueAtTime(0.0, t)
      this.bypassGain.gain.setValueAtTime(1.0, t)
    } else {
      // Unmute the chain output, mute the bypass path
      this.chainGain.gain.setValueAtTime(1.0, t)
      this.bypassGain.gain.setValueAtTime(0.0, t)
    }
  }

  // ── Snapshot ────────────────────────────────────────────────────────────

  /**
   * Applies a full EngineSnapshot to all Stage 2 effect parameters.
   * Stage 1 params (pitch/formant/tempo) are ignored here.
   */
  applySnapshot(snapshot: EngineSnapshot): void {
    // Inline effects
    this.setHighPassFrequency(snapshot.highPassFrequency)
    this.setAllEQBands(snapshot.eq)
    this.setCompressorThreshold(snapshot.compressorThreshold)
    this.setCompressorRatio(snapshot.compressorRatio)

    // Tone.js effects
    this.setVibrato(snapshot.vibratoRate, snapshot.vibratoDepth)
    this.setTremolo(snapshot.tremoloRate, snapshot.tremoloDepth)
    this.setReverb(snapshot.reverbRoomSize, snapshot.reverbAmount)

    // Custom effects
    this.setVocalFry(snapshot.vocalFryIntensity)
    this.setBreathiness(snapshot.breathiness)
    this.setBreathiness2(snapshot.breathiness2)

    // Wet/dry mix for all effects
    this.setWetDry('vibrato', snapshot.wetDryMix.vibrato)
    this.setWetDry('tremolo', snapshot.wetDryMix.tremolo)
    this.setWetDry('reverb', snapshot.wetDryMix.reverb)
    this.setWetDry('vocalFry', snapshot.wetDryMix.vocalFry)
    this.setWetDry('breathiness', snapshot.wetDryMix.breathiness)
    this.setWetDry('breathiness2', snapshot.wetDryMix.breathiness2)

    // Bypass
    this.setBypass(snapshot.bypassed)
  }

  // ── Cleanup ─────────────────────────────────────────────────────────────

  /**
   * Disconnects all nodes and releases resources.
   * Call this when the AudioContext is being closed.
   */
  dispose(): void {
    // Stop oscillators
    try { this.vocalFryLFO.stop() } catch { /* already stopped */ }

    // Dispose Tone.js nodes (handles internal cleanup)
    this.vibrato.dispose()
    this.tremolo.dispose()
    this.reverb.dispose()

    // Disconnect all Web Audio nodes
    this._input.disconnect()
    this.highPassFilter.disconnect()
    for (const band of this.eqBands) {
      band.disconnect()
    }
    this.compressor.disconnect()
    this.vocalFryLFO.disconnect()
    this.vocalFryLFOGain.disconnect()
    this.vocalFryModulator.disconnect()
    this.vocalFryDryGain.disconnect()
    this.vocalFryWetGain.disconnect()
    this.vocalFryBlend.disconnect()
    this.breathinessLowShelf.disconnect()
    this.breathinessHighShelf.disconnect()
    this.breathinessDryGain.disconnect()
    this.breathinessWetGain.disconnect()
    this.breathinessBlend.disconnect()
    this.b2HighPass.disconnect()
    this.b2HighShelf.disconnect()
    this.b2Compressor.disconnect()
    this.b2DryGain.disconnect()
    this.b2WetGain.disconnect()
    this.b2Blend.disconnect()
    this.reverbDryGain.disconnect()
    this.reverbWetGain.disconnect()
    this.reverbBlend.disconnect()
    this.outputGain.disconnect()
    this.bypassGain.disconnect()
    this.chainGain.disconnect()
    this._output.disconnect()
  }
}
