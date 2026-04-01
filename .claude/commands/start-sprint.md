# /start-sprint

Use this command at the beginning of every sprint before writing any code.

## Steps

1. **Read the sprint definition**
   - Open `docs/phasesAndSprints.md`
   - Identify the current sprint by asking the developer: "Which sprint are we starting?"
   - Read all user stories and acceptance criteria for that sprint

2. **Read architecture constraints**
   - Open `docs/architecture.md`
   - Confirm which layers will be touched in this sprint
   - Call out any IPC channels that need to be added to `src/shared/constants.ts`
   - Call out any new types that need to be added to `src/shared/types.ts`

3. **Check tech stack**
   - Open `docs/techStack.md`
   - Confirm any new libraries being introduced in this sprint are listed
   - If a new library is needed, add it to techStack.md before installing

4. **Confirm scope with developer**
   Output a summary in this format before touching any code:

   ```
   Sprint [N] - [Name]
   
   User stories in scope:
   - [list]
   
   Files I expect to create:
   - [list]
   
   Files I expect to modify:
   - [list]
   
   New IPC channels needed:
   - [list or "none"]
   
   New types needed:
   - [list or "none"]
   
   New libraries to install:
   - [list or "none"]
   
   Ready to begin? (yes/no)
   ```

5. **Wait for developer confirmation before writing any code**

## Notes
- Never start coding before completing this checklist
- If the sprint touches AudioEngine, re-read the audio engine architecture section specifically
- If the sprint touches FFmpeg, re-read the FFmpeg export pipeline section specifically
- If this is Sprint 1, use `/spike-rubberband` instead of this command
