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
 * Postinstall Script - Binary Copy
 *
 * Runs automatically after `npm install` via the postinstall hook in package.json.
 *
 * Copies bundled binaries from node_modules to src/assets/ so they are available
 * for both development (electron-vite dev) and packaging (electron-builder).
 *
 * Neither binary is committed to git - this script is what makes the build
 * self-contained after a fresh clone.
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

/**
 * Copies a file or directory, creating destination directories as needed.
 */
function copyRecursive(src: string, dest: string): void {
  if (!fs.existsSync(src)) {
    console.warn(`  ⚠ Source not found: ${src}`)
    return
  }

  const stat = fs.statSync(src)
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true })
    for (const item of fs.readdirSync(src)) {
      copyRecursive(path.join(src, item), path.join(dest, item))
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(src, dest)
  }
}

console.log('📦 VoxSmith postinstall: copying bundled binaries...\n')

// ─── FFmpeg ──────────────────────────────────────────────────────────────────

try {
  // ffmpeg-static exports the path to the ffmpeg binary
  const ffmpegStaticPath = path.join(projectRoot, 'node_modules', 'ffmpeg-static', 'ffmpeg.exe')
  const ffmpegAltPath = path.join(projectRoot, 'node_modules', 'ffmpeg-static', 'ffmpeg')
  const ffmpegDest = path.join(projectRoot, 'src', 'assets', 'ffmpeg')

  fs.mkdirSync(ffmpegDest, { recursive: true })

  if (fs.existsSync(ffmpegStaticPath)) {
    fs.copyFileSync(ffmpegStaticPath, path.join(ffmpegDest, 'ffmpeg.exe'))
    console.log('  ✓ FFmpeg binary copied to src/assets/ffmpeg/ffmpeg.exe')
  } else if (fs.existsSync(ffmpegAltPath)) {
    // On non-Windows platforms, the binary has no .exe extension
    fs.copyFileSync(ffmpegAltPath, path.join(ffmpegDest, 'ffmpeg'))
    console.log('  ✓ FFmpeg binary copied to src/assets/ffmpeg/ffmpeg')
  } else {
    console.warn('  ⚠ FFmpeg binary not found in node_modules/ffmpeg-static/')
    console.warn('    This is expected if ffmpeg-static did not download the binary for this platform.')
  }
} catch (err) {
  console.error('  ✗ Failed to copy FFmpeg binary:', err)
}

// ─── Rubber Band CLI Binary ──────────────────────────────────────────────────
// The native Rubber Band CLI binary (rubberband.exe) is used for Stage 1
// offline processing (pitch, formant, tempo). It's downloaded separately
// via scripts/fetch-rubberband.ts - here we just verify it exists.

try {
  const rubberbandExe = path.join(projectRoot, 'src', 'assets', 'rubberband', 'rubberband.exe')
  if (fs.existsSync(rubberbandExe)) {
    console.log('  ✓ Rubber Band CLI binary found at src/assets/rubberband/rubberband.exe')
  } else {
    console.warn('  ⚠ Rubber Band CLI binary not found at src/assets/rubberband/rubberband.exe')
    console.warn('    Run "pnpm tsx scripts/fetch-rubberband.ts" to download it.')
  }
} catch (err) {
  console.error('  ✗ Failed to check Rubber Band CLI binary:', err)
}

// ─── Rubber Band WASM (Sprint 1 spike - retained for backwards compatibility) ─

try {
  const rubberbandSrc = path.join(projectRoot, 'node_modules', 'rubberband-web', 'dist')
  const rubberbandDest = path.join(projectRoot, 'src', 'assets', 'rubberband-wasm')

  if (fs.existsSync(rubberbandSrc)) {
    copyRecursive(rubberbandSrc, rubberbandDest)
    console.log('  ✓ Rubber Band WASM files copied to src/assets/rubberband-wasm/')
  } else {
    // Try alternate paths - rubberband-web may structure differently
    const altSrc = path.join(projectRoot, 'node_modules', 'rubberband-web')
    const wasmFiles = fs.existsSync(altSrc)
      ? fs.readdirSync(altSrc).filter(f => f.endsWith('.wasm') || f.endsWith('.js'))
      : []

    if (wasmFiles.length > 0) {
      fs.mkdirSync(rubberbandDest, { recursive: true })
      for (const file of wasmFiles) {
        fs.copyFileSync(path.join(altSrc, file), path.join(rubberbandDest, file))
      }
      console.log(`  ✓ Rubber Band WASM files (${wasmFiles.length}) copied to src/assets/rubberband-wasm/`)
    } else {
      console.warn('  ⚠ Rubber Band WASM files not found in node_modules/rubberband-web/')
      console.warn('    Will be resolved during Sprint 1 spike.')
    }
  }
} catch (err) {
  console.error('  ✗ Failed to copy Rubber Band WASM files:', err)
}

console.log('\n📦 Postinstall complete.\n')
