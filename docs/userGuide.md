# VoxSmith User Guide

Welcome to VoxSmith. This guide explains every feature, what it does, how it sounds, and how features work together. No audio engineering experience required.

---

## The Big Idea

Your voice has a natural sound - a pitch, a texture, a size. VoxSmith lets you reshape all of those qualities so that one voice (yours) can become many different characters. Think of it like a costume closet for your voice. Each saved character is called a **preset**.

---

## Basic Controls

These are always visible. They have the biggest impact on how different a character sounds.

---

### Pitch

**What it does:** Makes your voice higher or lower, measured in semitones. One semitone is one step on a piano keyboard.

**How it sounds:**
- Negative values (e.g. -6) make your voice deeper, like a large creature or a villain
- Positive values (e.g. +6) make your voice higher, like a child or a small creature
- Large values (±12 or more) start to sound supernatural or monstrous

**Works well with:** Formant. Pitch alone can sound like a chipmunk effect — unnatural and thin. Pairing pitch change with a matching formant shift makes the result sound like a genuinely different person rather than a processed voice.

**How to use:** Adjust the slider and click **Apply**. Pitch requires offline processing (1–3 seconds) so the change is not instant. A progress indicator shows while processing. The preview updates automatically when complete.

**Powered by:** Rubber Band Library (native CLI, offline processing)

---

### Formant

**What it does:** Changes the resonant character of your voice — whether it sounds like it comes from a large body or a small one — without necessarily changing the pitch. This is the feature that separates "sounds like a different person" from "sounds like my voice with a filter on it."

**How it sounds:**
- Negative values make your voice sound bigger and more cavernous, like a giant or a deep-voiced elder
- Positive values make your voice sound smaller and tighter, like a child or a small creature
- Subtle shifts (±0.3) are almost invisible but add convincing character depth

**Works well with:** Pitch. These two controls together are the core of making your voice sound like a distinct character. Adjust formant any time you change pitch. A good rule of thumb: if you raise pitch, also raise formant slightly. If you lower pitch, lower formant slightly.

**How to use:** Adjust the slider and click **Apply** (same as Pitch — both are processed together). A progress indicator shows while processing.

**Powered by:** Rubber Band Library (native CLI, offline processing)

---

### Reverb / Room Size

**What it does:** Adds the sound of a physical space around your voice. Reverb is how much echo is in the room. Room Size is how large that room feels.

**How it sounds:**
- Low reverb, small room: a close, intimate voice - like a character whispering nearby
- High reverb, large room: a distant, grand voice - like a character in a cathedral or throne room
- High reverb, small room: a hollow, slightly eerie sound useful for ghosts or spirits

**Works well with:** Speed and Pitch. A slower, lower-pitched voice with high reverb sounds ancient and powerful. A fast, high-pitched voice with low reverb sounds young and energetic.

**Powered by:** Tone.js (Reverb)

---

### Speed / Tempo

**What it does:** Changes how fast your recorded voice plays back. Unlike a simple speed-up, this does not affect pitch (pitch is handled separately by Rubber Band's time-stretch algorithm).

**How it sounds:**
- Slower speeds (0.7-0.9): elderly characters, tired characters, powerful ancient beings
- Faster speeds (1.1-1.4): young characters, nervous characters, small creatures
- Extreme speeds in either direction start to sound unnatural, which can be useful for non-human creatures

**Works well with:** Pitch and Reverb. Speed alone changes timing but the combination of all three basic controls creates the most convincing character personality.

**How to use:** Adjust the slider and click **Apply** (processed together with Pitch and Formant). A progress indicator shows while processing.

**Powered by:** Rubber Band Library (native CLI, offline processing)

---

### Volume

**What it does:** Controls how loud the voice sounds during preview playback (up to 400%). This adjusts the monitoring level before effects are applied.

**Important:** This does not affect the exported audio file. It is only for monitoring while you work. If your speakers are quiet, turn this up instead of cranking your system volume. Values above 200% can cause clipping — watch the level meter.

**Works well with:** Compression Threshold. If you boost volume and hear clipping, lower the compression threshold to tame peaks.

**Powered by:** Web Audio API (GainNode)

---

## Advanced Controls

Click the **Advanced** toggle to reveal these. They add texture, personality, and detail to a character voice.

---

### Vibrato Rate and Depth

**What it does:** Adds a wavering up-and-down variation to the pitch of your voice, like a singer's natural vibrato.

- **Rate:** How fast the wobble happens (slow = dramatic, fast = nervous or elderly)
- **Depth:** How wide the wobble is (low = subtle warmth, high = exaggerated trembling)

**How it sounds:** A slow, deep vibrato sounds theatrical and dramatic. A fast, shallow vibrato sounds anxious or aged.

**Works well with:** Tremolo. Vibrato wobbles the pitch while Tremolo wobbles the volume. Using both together creates a rich, organic wavering effect.

**Note:** Keep depth subtle for most characters. Heavy vibrato quickly becomes distracting.

**Powered by:** Tone.js (Vibrato)

---

### Tremolo Rate and Depth

**What it does:** Makes the volume of your voice pulse up and down rhythmically.

- **Rate:** How fast the volume pulses
- **Depth:** How dramatic the volume difference is between pulses

**How it sounds:** Subtle tremolo sounds like a voice shaking with emotion or old age. Heavy tremolo sounds mechanical or supernatural.

**Works well with:** Vibrato. The two effects together create a more complex, layered wavering that feels organic rather than processed.

**Powered by:** Tone.js (Tremolo)

---

### Vocal Fry

**What it does:** Adds a low, crackling texture to your voice - the gravelly quality you hear in the lowest register of a voice.

**How it sounds:** Low intensity adds a slight roughness that makes a voice sound weathered or world-weary. High intensity sounds raspy, monstrous, or corrupted.

**Works well with:** Low Pitch and High-Pass Filter off (leave the low end intact). Vocal fry lives in the low frequencies - removing them with the High-Pass Filter will cancel out the effect.

**Powered by:** Web Audio API (custom AudioWorklet)

---

### Breathiness / Air

**What it does:** Adds the sound of air and breath to your voice, making it sound whispery, soft, or exhausted.

**How it sounds:** Low values add a gentle intimacy. High values sound like a character who is whispering, weak, or ethereal.

**Works well with:** Low Reverb (for close whisper) or High Reverb (for ghostly, distant whisper). Also works well with a slight Speed reduction for a tired or dying character.

**Powered by:** Web Audio API (custom AudioWorklet)

---

### 4-Band EQ

**What it does:** EQ (Equalizer) lets you boost or cut different frequency ranges of your voice. Think of it like a tone control with four separate handles.

The four bands roughly correspond to:
- **Band 1 (Low):** The chest and body weight of a voice
- **Band 2 (Low-Mid):** Warmth and fullness
- **Band 3 (High-Mid):** Presence, nasal quality, clarity
- **Band 4 (High):** Brightness, air, and crispness

**How it sounds:**
- Boosting Band 1: heavier, more imposing
- Cutting Band 1: thinner, younger
- Boosting Band 3: nasal, more forward and present
- Cutting Band 3: warmer, smoother

**Works well with:** Formant. EQ shapes the tonal color while Formant shapes the perceived body size. Together they give you very precise control over voice character.

**Powered by:** Web Audio API (BiquadFilterNode)

---

### Compression

**What it does:** Evens out the volume of your voice so that loud moments are brought down and quiet moments come up. The result is a more consistent, controlled sound.

- **Threshold:** The volume level at which compression kicks in
- **Ratio:** How aggressively the compression squashes volume above the threshold

**How it sounds:** Light compression makes a voice sound polished and professional. Heavy compression makes a voice sound dense and intense.

**Works well with:** Noise Gate. The Noise Gate removes silence and background noise before the signal reaches the compressor. Compressing a noisy signal will bring up the noise along with the voice, so always use Noise Gate first.

**Powered by:** Web Audio API (DynamicsCompressorNode)

---

### High-Pass Filter

**What it does:** Removes low frequency sounds below a set point. Anything below the cutoff frequency is filtered out.

**How it sounds:** A low cutoff (100Hz) just removes rumble and hum. A higher cutoff (400Hz+) removes the chest and weight from a voice, making it sound thinner, younger, or like it is coming through a telephone or radio.

**Works well with:** EQ. The High-Pass Filter is a broad cut tool. Use EQ for precise frequency shaping after the filter has cleaned up the low end.

**Note:** Keep this off if you are using Vocal Fry - they work against each other.

**Powered by:** Web Audio API (BiquadFilterNode)

---

### Wet/Dry Mix

**What it does:** Every effect has a mix control. Wet is the processed signal. Dry is your original unprocessed voice. The mix blends between them.

**How it sounds:** Full wet means the effect is fully applied. Full dry means the effect is bypassed for that signal path. A 50/50 mix blends both.

**Works well with:** All effects. This is especially useful with Reverb (to avoid drowning the voice) and Vocal Fry (to add just a hint of texture without overdoing it).

**Powered by:** Web Audio API (GainNode blending)

---

## Noise Gate and Export Options

---

### Noise Gate

**What it does:** Automatically silences the audio below a volume threshold. This removes background noise, room hum, and the silence between words.

**How it sounds:** Clean, professional audio with no noise floor.

**Works well with:** Silence Padding. After the noise gate removes silence, add a few milliseconds of padding back at the start and end so your game engine does not clip the first and last sounds.

**Powered by:** FFmpeg

---

### Silence Padding

**What it does:** Adds a precise amount of silence (in milliseconds) to the very beginning and end of your exported audio file.

**Why it matters:** Game engines often trigger audio very close to the moment an event happens. Without a small buffer of silence, the very first millisecond of a voice line can get clipped before the engine has started playing it. 20-50ms at the start and end is usually enough.

**Powered by:** FFmpeg

---

### Normalize on Export

**What it does:** Automatically adjusts the volume of your exported file so that the loudest point reaches a consistent level (just below maximum).

**Why it matters:** Without normalization, some characters will sound louder than others depending on how loud you recorded. Normalization ensures all your exported files play at a consistent volume in your game.

**Powered by:** FFmpeg

---

### Bit Depth

**What it does:** Controls the audio quality and file size of your export. Higher bit depth = more detail = larger file.

- **16-bit:** Standard CD quality. Works in all game engines. Smallest file size.
- **24-bit:** Studio quality. Recommended default for game audio.
- **32-bit:** Maximum quality. Only necessary for further processing in a DAW.

**Powered by:** FFmpeg

---

## Preset System

---

### Character Presets

**What it does:** Saves all your current settings under a character name so you can recall them instantly.

**Tips:**
- Save early and often as you dial in a character
- Use the notes field to record performance direction (e.g. "Finn - nervous energy, speaks quickly, slight tremolo")
- Add a portrait so you can remember the character visually when your preset list gets long

---

### Emotion Sub-Presets

**What it does:** Saves variations of the same character for different emotional states. A character still sounds like themselves when angry versus whispering - but with adjustments.

**Tips:** Start from the base character preset, make adjustments for the emotion, then save as a sub-preset. Common emotions to prepare: default, angry, whisper, sad, afraid.

---

### A/B Toggle

**What it does:** Loads two presets into slot A and slot B so you can switch between them. Stage 2 effects (reverb, EQ, etc.) switch instantly. Stage 1 settings (pitch, formant, speed) update visually but require Apply to hear the change.

**Works well with:** When you are deciding between two versions of a character and want to toggle settings on the same audio.

---

### Preset Categories

**What it does:** Organizes presets into folders such as Heroes, Villains, Creatures, NPCs.

**Tips:** Set up your categories before you start creating presets. Rename them to match your game's character structure.

---

## Recording

---

### Noise Suppression

**What it does:** Filters ambient noise from your mic signal using AI-based noise removal (RNNoise). Removes background noise like fan hum, air conditioning, room tone, and keyboard clicks from the monitoring path in real time.

**How it works:** Enabled by default when mic monitoring starts. Toggle on/off with the button in the Recording panel. Noise suppression only affects what you hear through the effects chain — recorded takes always capture raw audio so you can re-process later.

**Aggressiveness slider:** Controls how hard residual noise is gated after the neural network processes it. At gentle (low %), some natural room ambience leaks through. At aggressive (high %), non-speech frames are pushed closer to silence — great for noisy environments, but very high settings may clip the start or end of quiet words. The default (50%) is a good balance.

**Tips:** Leave noise suppression on unless you specifically want to hear room noise for reference. If background noise is still noticeable, raise the aggressiveness slider. The neural network adds ~10ms of latency, which is imperceptible during monitoring.

---

### Mic Gain

**What it does:** Software pre-amp that boosts (or cuts) the raw microphone signal. Compensates for an OS mic level that's set too low.

**How it works:** The slider goes from 0% to 400%. The input level meter bar above it shows your live signal strength in real time — green is healthy, amber is strong, red means clipping. Unlike the Volume slider (which only affects monitoring), mic gain also affects recorded takes.

**Tips:** If the level meter barely moves when you talk, boost the mic gain until it sits in the green range. If you see red, back off — clipping distorts the signal and can't be undone in post.

---

### Count-In

**What it does:** Plays a countdown (1 to 4 beats) before recording begins so you have time to get into character before the first word.

---

### Take Management

**What it does:** Every recording is saved as a numbered take. You can audition each take and keep the best one without re-recording.

**Tips:** Record 2-3 takes of every line before auditioning. Fresh ears often choose a different take than you expect.

---

### Punch-In Recording

**What it does:** Lets you re-record a specific section of a take without re-recording the whole thing. Mark a start and end point on the waveform, then record - only that region is replaced.

**Works well with:** Take Management. Punch-in lets you fix a single word or phrase in an otherwise good take.

---

## Phase 3 - Production Pipeline

---

### Script Import

**What it does:** Lets you import all your dialogue lines at once and work through them in order, one recording per line.

**Tip:** Format your script as a CSV with columns for character, scene, line number, emotion, and text.

---

### Batch Export

**What it does:** Exports all completed lines in one action, automatically naming each file based on its metadata.

**Example output:** `finn_scene2_line4_angry.wav`

**Why it matters:** Game engines often load audio by file name. Consistent, predictable naming means your exported files slot directly into your project without renaming.

---

### Export Manifest

**What it does:** Generates a JSON and CSV file listing every exported audio file along with its character, scene, line number, and emotion.

**Why it matters:** You can reference the manifest directly in your game code to know which audio file to play for each dialogue line.

---

### Variation Engine

**What it does:** Applies subtle randomized differences to each export of the same line so that repeated playbacks in your game do not sound identical.

**How it sounds:** Almost imperceptible on any single play. Over repeated triggers in-game, it prevents the "broken record" effect where the exact same audio file plays over and over.

---

## Quick Reference: Which Features Work Together

| Goal | Key Features to Combine |
|---|---|
| Sound like a large, imposing character | Low Pitch + Low Formant + Low Reverb/Large Room |
| Sound like a small creature | High Pitch + High Formant + Fast Speed |
| Sound ancient or powerful | Low Pitch + Slow Speed + High Reverb + Slight Tremolo |
| Sound like a ghost or spirit | High Breathiness + High Reverb + Low Formant |
| Sound young and nervous | High Pitch + Fast Speed + Fast Vibrato (shallow) |
| Sound raspy and villainous | Low Pitch + Vocal Fry + Compression |
| Sound like a radio transmission | High-Pass Filter (400Hz+) + Low Reverb |
| Clean up a noisy home recording | Noise Gate + Compression + Normalize on Export |
