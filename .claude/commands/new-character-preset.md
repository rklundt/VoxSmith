# /new-character-preset

Use this command any time work involves changing the preset data shape, adding preset fields,
or modifying how presets are saved, loaded, or displayed.

## Preset Data Shape

The canonical preset type lives in `src/shared/types.ts`. Any change to the shape must start there.

```typescript
interface Preset {
  id: string                    // uuid
  name: string                  // character name
  category: string              // folder/category label
  portraitPath?: string         // relative path in userData/portraits/ (no base64)
  notes?: string                // free text performance notes
  emotionVariants: EmotionVariant[]  // sub-presets per emotion
  engineSnapshot: EngineSnapshot     // all parameter values
  createdAt: string             // ISO timestamp
  updatedAt: string             // ISO timestamp
}

interface EmotionVariant {
  id: string
  emotion: string               // e.g. "angry", "whisper", "sad", "default"
  engineSnapshot: EngineSnapshot
}

interface EngineSnapshot {
  pitch: number
  formant: number
  reverbAmount: number
  reverbRoomSize: number
  speed: number
  vibratoRate: number
  vibratoDepth: number
  tremoloRate: number
  tremoloDepth: number
  vocalFryIntensity: number
  breathiness: number
  eq: EQBand[]
  compressorThreshold: number
  compressorRatio: number
  highPassFrequency: number
  wetDryMix: Record<EffectName, number>
  bypassed: boolean
}
```

## Checklist for Any Preset Change

- [ ] Update `Preset` or `EngineSnapshot` interface in `src/shared/types.ts`
- [ ] Update `presetStore.ts` if store shape changes
- [ ] Update `src/data/presets.ts` read/write functions
- [ ] Handle migration: if loading an old preset.json that lacks the new field, provide a safe default
- [ ] Update any React components that render preset data
- [ ] Confirm `IPC.PRESET_SAVE` and `IPC.PRESET_LOAD_ALL` still handle the new shape correctly
- [ ] Test: save a preset, close app, reopen, load preset - all fields present
- [ ] Test: load an old preset JSON without the new field - app does not crash, default applied

## Migration Pattern

When adding a new field to EngineSnapshot, always provide a default in the load function:

```typescript
// src/data/presets.ts
function migrateSnapshot(raw: Partial<EngineSnapshot>): EngineSnapshot {
  return {
    ...DEFAULT_ENGINE_SNAPSHOT,  // base defaults
    ...raw                        // override with saved values
  }
}
```

`DEFAULT_ENGINE_SNAPSHOT` must be defined in `src/shared/constants.ts` and kept up to date.

## Logging Requirements

All preset operations must be logged:
- Save: `info` - preset name and id
- Load: `info` - preset name and id
- Delete: `info` - preset name and id
- Migration applied: `warn` - preset name, which fields were defaulted
- Failure: `error` - operation, preset name, error message
