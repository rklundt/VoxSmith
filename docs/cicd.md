# VoxSmith - CI/CD

## Overview

VoxSmith uses a maturity-phased approach to CI/CD. Automation is added when the project reaches stable feature completion, keeping it off the critical path during active development.

---

## Stage 1 — Manual (Current)

No automation. All commands run manually by the developer.

### Manual Release Checklist

Run this sequence before marking any sprint as done or producing a distributable build:

1. `pnpm typecheck` — TypeScript compiles clean
2. `pnpm lint` — ESLint passes with no errors
3. `pnpm test` — All unit tests pass
4. `pnpm dev` — App launches, smoke test basic functionality
5. `pnpm dist` — Produces `.exe` in release directory
6. Smoke test the `.exe` on a clean Windows machine (or clean user profile)

### When to run the full checklist
- End of every sprint (required for Definition of Done)
- Before sharing any build externally
- After any dependency update

---

## Stage 2 — GitHub Actions (Post-Phase 1+2)

Implement when the project reaches stable feature completion after Sprint 8.

### Planned workflow: `ci.yml`

**Trigger:** Every push to `main` and every pull request.

**Steps:**
1. Checkout code
2. `pnpm install`
3. `pnpm typecheck`
4. `pnpm lint`
5. `pnpm test`

### Planned workflow: `release.yml`

**Trigger:** Tagged releases only (e.g., `v1.0.0`).

**Steps:**
1. All CI steps above
2. `pnpm dist`
3. Upload `.exe` artifact to GitHub release

### Not planned
- Auto-update delivery (deferred post-Phase 3, see Future Enhancements in phasesAndSprints.md)
- Mac/Linux builds (stretch goal, not prioritized)
- Automated audio testing (manual QA only, see testStrategy.md)
