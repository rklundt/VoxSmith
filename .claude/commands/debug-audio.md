# /debug-audio

Use this command when the developer reports any audio issue.
Work through these steps in order before suggesting code changes.

## Step 1 - Get the log file

Ask the developer:
> "Please share the most recent log file from the `logs/` folder in the VoxSmith directory."

If they cannot find it, the path is:
- Dev: `[project root]/logs/session-[timestamp].log`
- Packaged: `%APPDATA%\VoxSmith\logs\session-[timestamp].log`

## Step 2 - Identify the issue category

Read the log and classify the issue:

| Category | Log signals |
|---|---|
| WASM load failure | `error` entry with "rubberband" or "wasm" + load failure message |
| AudioContext failure | `error` with "AudioContext" or "suspended" state |
| IPC failure | `error` or `warn` on any IPC channel |
| FFmpeg failure | `error` with FFmpeg command + exit code |
| Mic input failure | `error` with "getUserMedia" or device enumeration |
| Parameter not applying | `debug` entries show param set but no audible change |
| Export corruption | FFmpeg command logged but output file invalid |

## Step 3 - Diagnostic questions by category

### WASM load failure
- Was the binary path logged on startup? Does it resolve to an actual file?
- Is the app packaged or running in dev? (Binary resolution differs - see techStack.md)
- Are there CSP errors in the renderer console?

### AudioContext failure
- Is AudioContext in "suspended" state? (Common in Electron - requires user gesture to resume)
- Is there a call to `audioContext.resume()` on first user interaction?

### IPC failure
- Which IPC channel failed? Is it defined in `src/shared/constants.ts`?
- Is the handler registered in `src/main/ipc/`?
- Is the preload script exposing the channel correctly?

### FFmpeg failure
- Copy the full FFmpeg command from the logs and run it manually in a terminal
- Check the exit code and stderr output
- Is the input file path valid? Is the output directory writable?

### Mic input failure
- Is `getUserMedia` permission granted in Electron? (`session.defaultSession.setPermissionRequestHandler`)
- Is the selected device ID valid? Log the full device list.

### Parameter not applying
- Is the parameter flowing through: UI → hook → AudioEngine method → Web Audio node?
- Are debug logs showing the value being set on the engine?
- Is the effects chain connected correctly? (Check `EffectsChain.ts` node graph)

## Step 4 - Before making any code changes

State clearly:
1. What the log shows
2. What the root cause is
3. What file and function needs to change
4. What the fix is

Wait for developer to confirm before editing code.

## Step 5 - After fixing

- Confirm the fix is logged at the appropriate level
- Confirm no new console errors appear
- Ask developer to reproduce the original issue and confirm it is resolved
