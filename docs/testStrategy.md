# VoxSmith - Test Strategy

## Overview

VoxSmith uses a layered testing approach: automated unit tests for pure logic, and manual QA checklists for audio processing and UI behavior.

---

## Automated Tests (Vitest)

### Scope
Unit tests cover pure functions with no Web Audio API, Electron, or DOM dependencies:

- `src/shared/` — type guards, constants validation, utility functions
- `src/data/` — preset serialization/deserialization, settings validation, IPC channel mapping

### Configuration
- **Framework:** Vitest
- **Config file:** `vitest.config.ts` at project root (standalone, separate from `electron.vite.config.ts`)
- **Run command:** `pnpm test` (CI/one-shot) or `pnpm vitest` (watch mode)

### What NOT to automate
- AudioWorklet processors (WASM, custom DSP) — validated manually during Sprint 1 spike and re-verified when the effects chain changes
- Electron IPC round-trips — validated manually per sprint
- UI component rendering — validated manually via QA checklists

---

## Manual QA Checklists

Each sprint in `docs/phasesAndSprints.md` includes a **QA Checklist** section with testable steps derived from the acceptance criteria.

### When to run
- After completing a sprint, before marking it done
- After any change to the AudioEngine or effects chain
- After packaging a new `.exe` build

---

## Audio Sanity Checklist

Run this checklist whenever a sprint touches the AudioEngine, effects chain, or input routing:

- [ ] Bypass toggle: A/B between processed and dry signal — instant switch, no dropout
- [ ] Parameter extremes: set each parameter to its min and max value — no crashes, no NaN audio
- [ ] Input source switch: switch between file input and mic input — no engine crash or orphaned nodes
- [ ] Full chain: enable all effects simultaneously — no audible glitches or frame drops
- [ ] Silence: load a silent WAV, process with all effects — no unexpected noise floor or artifacts
- [ ] Long playback: play a 2+ minute file through full chain — no memory leak or degradation

---

## QA Results Tracking

QA results are recorded in the `testResults/` directory at the project root.

### File Structure

```
testResults/
  regression-master.md         # Cumulative regression checklist — grows with each sprint
  qa-sprint0-2026-03-31.md     # Individual QA run result
  qa-sprint1-2026-04-07.md
  ...
```

### Individual QA Run Files

One file per QA run, named `qa-sprint{N}-{YYYY-MM-DD}.md`. Contains:
- The sprint's QA checklist with each item marked pass `[x]` or fail `[ ]` with notes
- Regression items from all prior sprints, re-verified
- Audio sanity checklist results (if sprint touches AudioEngine)
- Tester name, date, app version, and any issues found

**Rolling retention:** Keep the last 7 QA run files. Delete older files when a new run is recorded.

### Regression Master

`testResults/regression-master.md` is a living document that accumulates key regression checks from each completed sprint. When a sprint is marked done:
1. Extract the critical checks from that sprint's QA checklist (the items most likely to regress)
2. Add them to the regression master under a sprint heading
3. All subsequent QA runs include the full regression master as part of their test pass

Regression items may be modified when new features change existing behavior — document the reason for any modification.

---

## Adding Tests

When adding a new pure function to `src/shared/` or `src/data/`:
1. Create a corresponding `.test.ts` file next to the source file
2. Cover normal cases, edge cases, and error cases
3. Run `pnpm test` to confirm all tests pass
