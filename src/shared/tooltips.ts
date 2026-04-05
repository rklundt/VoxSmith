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
 * VoxSmith Tooltip Content
 *
 * Single source of truth for all UI tooltip copy.
 * Import this wherever tooltip text is needed in the UI.
 *
 * Each tooltip has:
 *   label     - the feature name shown in the UI
 *   short     - one sentence shown on hover (keep under 12 words)
 *   detail    - 2-3 sentences shown on extended hover or help icon click
 *   pairsWith - features that work well together (shown as "Works well with:")
 *   poweredBy - library/tech responsible (shown as small print at bottom)
 */

export interface TooltipContent {
  label: string
  short: string
  detail: string
  pairsWith: string[]
  poweredBy: string
}

export const TOOLTIPS: Record<string, TooltipContent> = {

  // ─── Basic Controls ────────────────────────────────────────────────

  pitch: {
    label: 'Pitch',
    short: 'Makes your voice higher or lower.',
    detail:
      'Measured in semitones - negative values go deeper, positive go higher. ' +
      'Large shifts (±12 or more) start to sound supernatural. ' +
      'For the most natural result, always adjust Formant when you change Pitch.',
    pairsWith: ['Formant'],
    poweredBy: 'Rubber Band Library (native CLI, offline processing)',
  },

  formant: {
    label: 'Formant',
    short: 'Changes body size of the voice, not just pitch.',
    detail:
      'Formant shapes whether a voice sounds like it comes from a large or small body. ' +
      'Negative values sound bigger and deeper; positive values sound smaller and lighter. ' +
      'This is the feature that makes your voice sound like a genuinely different person rather than a processed version of yourself.',
    pairsWith: ['Pitch', '4-Band EQ'],
    poweredBy: 'Rubber Band Library API via Koffi FFI (setFormantScale, offline processing)',
  },

  reverb: {
    label: 'Reverb',
    short: 'Adds the sound of a physical space around your voice.',
    detail:
      'More reverb makes your voice sound like it is in a larger, more reflective space. ' +
      'Combine with Room Size - a large room with high reverb sounds like a throne room; ' +
      'a small room with high reverb sounds hollow and eerie.',
    pairsWith: ['Room Size', 'Speed', 'Wet/Dry Mix'],
    poweredBy: 'Tone.js (Reverb)',
  },

  roomSize: {
    label: 'Room Size',
    short: 'Controls how large the reverb space feels.',
    detail:
      'Small values sound like a closet or cave alcove. ' +
      'Large values sound like a cathedral or open cavern. ' +
      'Always adjust Room Size alongside Reverb - one without the other gives incomplete results.',
    pairsWith: ['Reverb'],
    poweredBy: 'Tone.js (Reverb)',
  },

  speed: {
    label: 'Speed',
    short: 'Changes how fast the voice plays back without affecting pitch.',
    detail:
      'Slower speeds suggest age, power, or exhaustion. ' +
      'Faster speeds suggest youth, nervousness, or small creature energy. ' +
      'Because pitch is controlled separately, speed changes do not cause the chipmunk effect.',
    pairsWith: ['Pitch', 'Reverb', 'Tremolo'],
    poweredBy: 'Web Audio API (AudioBufferSourceNode)',
  },

  volume: {
    label: 'Volume',
    short: 'Controls how loud the voice sounds during preview.',
    detail:
      'Adjusts the playback loudness before effects are applied. ' +
      'This does not affect the exported audio file - it is only for monitoring. ' +
      'If your speakers are quiet, turn this up instead of cranking system volume.',
    pairsWith: ['Compression Threshold'],
    poweredBy: 'Web Audio API (GainNode)',
  },

  // ─── Advanced Controls ─────────────────────────────────────────────

  vibratoRate: {
    label: 'Vibrato Rate',
    short: 'How fast your voice wavers up and down in pitch.',
    detail:
      'Slow rates sound theatrical or deliberate. ' +
      'Fast rates sound anxious, elderly, or out of control. ' +
      'Pair with Vibrato Depth - rate without depth has no audible effect.',
    pairsWith: ['Vibrato Depth', 'Tremolo Rate'],
    poweredBy: 'Tone.js (Vibrato)',
  },

  vibratoDepth: {
    label: 'Vibrato Depth',
    short: 'How wide the pitch wavering is.',
    detail:
      'Low depth adds a warm, subtle character. ' +
      'High depth creates an exaggerated, dramatic wobble. ' +
      'Keep depth subtle for most characters - heavy vibrato is quickly distracting.',
    pairsWith: ['Vibrato Rate', 'Tremolo Depth'],
    poweredBy: 'Tone.js (Vibrato)',
  },

  tremoloRate: {
    label: 'Tremolo Rate',
    short: 'How fast your voice pulses in volume.',
    detail:
      'Tremolo pulses the volume rhythmically, unlike Vibrato which pulses the pitch. ' +
      'Slow rates sound emotional or shaky. ' +
      'Fast rates sound mechanical or supernatural.',
    pairsWith: ['Tremolo Depth', 'Vibrato Rate'],
    poweredBy: 'Tone.js (Tremolo)',
  },

  tremoloDepth: {
    label: 'Tremolo Depth',
    short: 'How dramatic the volume pulsing is.',
    detail:
      'Low values add subtle organic movement to the voice. ' +
      'High values create a pronounced pulsing effect. ' +
      'Pairing Tremolo with Vibrato creates a layered, complex wavering that sounds more natural than either alone.',
    pairsWith: ['Tremolo Rate', 'Vibrato Depth'],
    poweredBy: 'Tone.js (Tremolo)',
  },

  vocalFry: {
    label: 'Vocal Fry',
    short: 'Adds a low, crackling roughness to the voice.',
    detail:
      'Low intensity adds weathered, world-weary texture. ' +
      'High intensity sounds raspy, monstrous, or corrupted. ' +
      'Avoid using the High-Pass Filter with Vocal Fry - it removes the low frequencies the effect lives in.',
    pairsWith: ['Pitch (low)', 'Wet/Dry Mix'],
    poweredBy: 'Web Audio API (AM synthesis via OscillatorNode + GainNode)',
  },

  breathiness: {
    label: 'Breathiness',
    short: 'Adds an airy, whispery texture to the voice.',
    detail:
      'Low values create intimacy. ' +
      'High values sound like a whisper, a weak character, or a spirit. ' +
      'Pair with low Reverb for a close whisper, or high Reverb for a ghostly, distant effect.',
    pairsWith: ['Reverb', 'Speed (slow)', 'Wet/Dry Mix'],
    poweredBy: 'Web Audio API (filtered noise injection via AudioBufferSourceNode + BiquadFilterNode)',
  },

  breathiness2: {
    label: 'Breathiness 2',
    short: 'Close-mic breathy tone via vocal processing.',
    detail:
      'Duplicates the voice, strips the bass with a high-pass at 500 Hz, boosts frequencies above 8 kHz, ' +
      'then compresses the airy upper track to make the breath noise consistent. ' +
      'Blending this with the original creates a close-mic, intimate vocal tone.',
    pairsWith: ['Breathiness', 'Reverb', 'Compression'],
    poweredBy: 'Web Audio API (BiquadFilterNode + DynamicsCompressorNode)',
  },

  eq: {
    label: '4-Band EQ',
    short: 'Adjusts tone in four frequency ranges.',
    detail:
      'Band 1 (Low) controls chest weight and body. ' +
      'Band 2 (Low-Mid) controls warmth and fullness. ' +
      'Band 3 (High-Mid) controls presence and nasal quality. ' +
      'Band 4 (High) controls brightness and air. ' +
      'Use EQ for precise tonal shaping after Formant has set the overall character.',
    pairsWith: ['Formant', 'High-Pass Filter'],
    poweredBy: 'Web Audio API (BiquadFilterNode)',
  },

  compressorThreshold: {
    label: 'Compression Threshold',
    short: 'The volume level at which compression kicks in.',
    detail:
      'Sounds louder than the threshold are reduced in volume. ' +
      'Lower the threshold to compress more of the signal. ' +
      'Always use Noise Gate before Compression - compressing a noisy recording brings up the noise too.',
    pairsWith: ['Compression Ratio', 'Noise Gate'],
    poweredBy: 'Web Audio API (DynamicsCompressorNode)',
  },

  compressorRatio: {
    label: 'Compression Ratio',
    short: 'How aggressively loud sounds are brought down.',
    detail:
      'A ratio of 2:1 is gentle and natural. ' +
      'A ratio of 8:1 or higher is dense and intense. ' +
      'Pair with Threshold - ratio without an appropriate threshold has little effect.',
    pairsWith: ['Compression Threshold'],
    poweredBy: 'Web Audio API (DynamicsCompressorNode)',
  },

  highPass: {
    label: 'High-Pass Filter',
    short: 'Removes low frequencies below the cutoff point.',
    detail:
      'A low cutoff (80-150Hz) just removes room rumble. ' +
      'A higher cutoff (300-500Hz) removes chest and weight, making the voice sound younger, thinner, or like a radio. ' +
      'Do not use with Vocal Fry - it cancels out the effect.',
    pairsWith: ['4-Band EQ'],
    poweredBy: 'Web Audio API (BiquadFilterNode)',
  },

  wetDry: {
    label: 'Wet/Dry Mix',
    short: 'Blends the processed signal with the original.',
    detail:
      'Full Wet means the effect is completely applied. ' +
      'Full Dry means the effect is bypassed for this signal path. ' +
      'Use this to add just a hint of an effect without overwhelming the voice - especially useful for Reverb and Vocal Fry.',
    pairsWith: ['All effects'],
    poweredBy: 'Web Audio API (GainNode)',
  },

  // ─── Waveform and Monitoring ────────────────────────────────────────

  waveform: {
    label: 'Waveform Display',
    short: 'Visual representation of your audio file.',
    detail:
      'The waveform shows the shape of your audio over time. ' +
      'Tall peaks are loud sections; quiet sections are nearly flat. ' +
      'Click anywhere on the waveform to seek to that position during playback.',
    pairsWith: ['Level Meter', 'Playback Controls'],
    poweredBy: 'WaveSurfer.js',
  },

  levelMeter: {
    label: 'Level Meter',
    short: 'Shows how loud the audio is right now.',
    detail:
      'Green means safe volume levels. Yellow means approaching maximum. ' +
      'Red means clipping - the audio is too loud and will distort. ' +
      'If you see red, reduce the Volume or Output Gain before exporting.',
    pairsWith: ['Volume', 'Compression Threshold'],
    poweredBy: 'Web Audio API (AnalyserNode)',
  },

  // ─── Export and Processing ─────────────────────────────────────────

  noiseGate: {
    label: 'Noise Gate',
    short: 'Removes background noise and silence from the recording.',
    detail:
      'Sounds below the gate threshold are silenced, cleaning up room hum, mic hiss, and gaps between words. ' +
      'After using the Noise Gate, add a few milliseconds of Silence Padding so game engine audio triggers do not clip.',
    pairsWith: ['Silence Padding', 'Compression'],
    poweredBy: 'FFmpeg',
  },

  silencePadding: {
    label: 'Silence Padding',
    short: 'Adds milliseconds of silence to the start and end of the file.',
    detail:
      'Game engines trigger audio very close to an event. Without padding, the first few milliseconds of a line can be clipped. ' +
      '20-50ms at the start and end is usually sufficient. ' +
      'Use this after Noise Gate has stripped existing silence.',
    pairsWith: ['Noise Gate'],
    poweredBy: 'FFmpeg',
  },

  normalize: {
    label: 'Normalize on Export',
    short: 'Makes all exported files the same volume level.',
    detail:
      'Without normalization, some characters will be louder than others depending on how loud you recorded. ' +
      'Normalization adjusts every export to a consistent peak volume so all characters sound balanced in your game.',
    pairsWith: ['Bit Depth'],
    poweredBy: 'FFmpeg',
  },

  bitDepth: {
    label: 'Bit Depth',
    short: 'Controls audio quality and file size on export.',
    detail:
      '16-bit is standard quality, works everywhere, smallest file. ' +
      '24-bit is studio quality and the recommended default for game audio. ' +
      '32-bit is maximum quality, only needed if you plan to do further processing in another audio tool.',
    pairsWith: ['Sample Rate'],
    poweredBy: 'FFmpeg',
  },

  sampleRate: {
    label: 'Sample Rate',
    short: 'How many audio samples per second are in the exported file.',
    detail:
      '44100 Hz (44.1kHz) is the standard for most game engines and is the recommended default. ' +
      '48000 Hz is used in video and some game engines. ' +
      'Check your game engine documentation if unsure.',
    pairsWith: ['Bit Depth'],
    poweredBy: 'FFmpeg',
  },

  // ─── Preset System ─────────────────────────────────────────────────

  characterPreset: {
    label: 'Character Preset',
    short: 'Saves all current settings under a character name.',
    detail:
      'Load a preset instantly to recall every setting for that character. ' +
      'Use the Notes field to record performance direction so you remember the character months later. ' +
      'Add a portrait image so you can identify presets visually as your library grows.',
    pairsWith: ['Emotion Sub-Presets', 'A/B Toggle'],
    poweredBy: 'Zustand (state) + presets.json (storage)',
  },

  emotionSubPreset: {
    label: 'Emotion Sub-Preset',
    short: 'Saves variations of a character for different emotions.',
    detail:
      'A character sounds like themselves whether angry or whispering, but with subtle adjustments. ' +
      'Start from the base character preset, adjust for the emotion, then save as a sub-preset. ' +
      'Common emotions to prepare: default, angry, whisper, sad, afraid.',
    pairsWith: ['Character Preset'],
    poweredBy: 'Zustand (state) + presets.json (storage)',
  },

  abToggle: {
    label: 'A/B Toggle',
    short: 'Switch instantly between two loaded presets.',
    detail:
      'Load one preset into slot A and another into slot B, then toggle between them. ' +
      'Stage 2 effects (reverb, EQ, etc.) switch instantly. Stage 1 settings (pitch, formant, speed) ' +
      'update visually but require Apply to hear the change.',
    pairsWith: ['Character Preset'],
    poweredBy: 'Zustand (state)',
  },

  bypass: {
    label: 'Bypass',
    short: 'Switch between your processed voice and original recording.',
    detail:
      'Bypass removes all effects instantly so you can compare the processed result against your raw recording. ' +
      'Use this to judge how much the effects are contributing before committing to a preset.',
    pairsWith: ['A/B Toggle'],
    poweredBy: 'Web Audio API (GainNode routing)',
  },

  // ─── Recording ─────────────────────────────────────────────────────

  micInput: {
    label: 'Microphone Input',
    short: 'Record your voice through VoxSmith effects.',
    detail:
      'Select your mic and hear your voice through the effects chain in real time. ' +
      'Stage 1 effects (pitch, formant, tempo) are applied after recording via the Apply button. ' +
      'Use a dedicated recording mic for best results — built-in laptop mics add noise.',
    pairsWith: ['Count-In', 'Take Management'],
    poweredBy: 'Web Audio API (getUserMedia + MediaStreamSource)',
  },

  // Noise Suppression — deferred to Sprint 7.2 (RNNoise WASM AudioWorklet).
  // Electron/Chromium ignores the getUserMedia noiseSuppression constraint.
  // Sprint 7.2 will add a real RNNoise-based noise suppressor in the signal chain.
  // Tooltip preserved here so the copy is ready when the UI toggle is re-added.
  noiseSuppression: {
    label: 'Noise Suppression',
    short: 'Filters ambient noise from your mic signal using AI-based noise removal.',
    detail:
      'Uses RNNoise (a neural-network noise suppressor) running as a WASM AudioWorklet ' +
      'to remove background noise (fan hum, air conditioning, room tone, keyboard clicks) ' +
      'in real time before audio enters the effects chain. On by default. Turn off in a ' +
      'quiet/treated studio for the cleanest possible signal.',
    pairsWith: ['Microphone Input', 'Monitor Mute'],
    poweredBy: 'RNNoise WASM (AudioWorklet)',
  },

  countIn: {
    label: 'Count-In',
    short: 'Plays a countdown before recording starts.',
    detail:
      'Gives you time to get into character before the first word. ' +
      'Set to 1-4 beats. Most voice actors prefer 2 beats.',
    pairsWith: ['Take Management'],
    poweredBy: 'Web Audio API (scheduling)',
  },

  takeManagement: {
    label: 'Take Management',
    short: 'Record multiple takes and keep the best one.',
    detail:
      'Every recording is saved as a numbered take. ' +
      'Audition each before committing - fresh ears often choose a different take than you expect. ' +
      'Record at least 2-3 takes of every line before deciding.',
    pairsWith: ['Punch-In Recording', 'Count-In'],
    poweredBy: 'Web Audio API (MediaRecorder)',
  },

  punchIn: {
    label: 'Punch-In Recording',
    short: 'Re-record a specific section without redoing the whole take.',
    detail:
      'Click the waveform to position the cursor, then use Mark Start and Mark End to define the region. ' +
      'Press P or click Punch In to re-record just that section. ' +
      'The rest of the take is preserved exactly.',
    pairsWith: ['Take Management', 'Waveform Display'],
    poweredBy: 'Web Audio API (MediaRecorder + buffer splicing)',
  },

  // ─── Phase 3 ───────────────────────────────────────────────────────

  scriptImport: {
    label: 'Script Import',
    short: 'Load all your dialogue lines and record them in order.',
    detail:
      'Import a plain text or CSV file with your dialogue lines. ' +
      'VoxSmith queues them up so you can move through the script without manual management. ' +
      'Tag each line with character, scene, and emotion as you go.',
    pairsWith: ['Batch Export', 'Take Management'],
    poweredBy: 'Node.js (fs, csv-parse)',
  },

  batchExport: {
    label: 'Batch Export',
    short: 'Export all recorded lines at once with automatic file naming.',
    detail:
      'All completed lines export in one action. ' +
      'Files are named automatically using your configured naming template (e.g. finn_scene2_line4_angry.wav). ' +
      'Files are ready to drop directly into your game project.',
    pairsWith: ['Script Import', 'Export Manifest'],
    poweredBy: 'FFmpeg + Node.js (fs)',
  },

  exportManifest: {
    label: 'Export Manifest',
    short: 'Generates a file listing every export with its metadata.',
    detail:
      'After batch export, a JSON and CSV manifest is created listing every audio file with its character, scene, line number, and emotion. ' +
      'Reference the manifest in your game code to load the right file for each dialogue line.',
    pairsWith: ['Batch Export'],
    poweredBy: 'Node.js (fs, json, csv)',
  },

  variationEngine: {
    label: 'Variation Engine',
    short: 'Adds subtle randomness so repeated lines never sound identical.',
    detail:
      'Almost imperceptible on any single play. ' +
      'Over repeated in-game triggers, it prevents the "broken record" effect where the exact same audio file plays over and over. ' +
      'Control the intensity - keep it subtle so character voice identity is preserved.',
    pairsWith: ['Batch Export'],
    poweredBy: 'Rubber Band Library (WASM) + Web Audio API',
  },

  loopMarkers: {
    label: 'Loop Markers',
    short: 'Mark loop start and end points for ambient voice files.',
    detail:
      'Mark a start and end point on a recording. ' +
      'The markers are embedded in the exported WAV file metadata. ' +
      'Game engines that support loop markers will loop the audio cleanly between those points.',
    pairsWith: ['Batch Export'],
    poweredBy: 'FFmpeg (metadata embedding)',
  },

}
