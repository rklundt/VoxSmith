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
 * Fetch Rubber Band CLI Binary
 *
 * Downloads the official prebuilt Rubber Band CLI binary for Windows from
 * breakfastquay.com. This runs as part of the postinstall step or manually.
 *
 * The binary is placed at src/assets/rubberband/rubberband.exe along with
 * any required DLLs (libsndfile-1.dll typically ships alongside).
 *
 * This follows the same pattern as FFmpeg: binary is fetched on install,
 * not committed to git, resolved via process.resourcesPath in production.
 */

import fs from 'fs'
import path from 'path'
import https from 'https'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

const RUBBERBAND_VERSION = '4.0.0'
const DOWNLOAD_URL = `https://breakfastquay.com/files/releases/rubberband-${RUBBERBAND_VERSION}-gpl-executable-windows.zip`
const DEST_DIR = path.join(projectRoot, 'src', 'assets', 'rubberband')
const ZIP_PATH = path.join(DEST_DIR, 'rubberband.zip')

/**
 * Downloads a file from a URL to a local path.
 * Follows redirects (up to 5 hops).
 */
function downloadFile(url: string, dest: string, redirectCount = 0): Promise<void> {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      reject(new Error('Too many redirects'))
      return
    }

    const file = fs.createWriteStream(dest)
    https.get(url, (response) => {
      // Follow redirects (301, 302, 303, 307, 308)
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close()
        fs.unlinkSync(dest)
        downloadFile(response.headers.location, dest, redirectCount + 1).then(resolve).catch(reject)
        return
      }

      if (response.statusCode !== 200) {
        file.close()
        fs.unlinkSync(dest)
        reject(new Error(`HTTP ${response.statusCode} downloading ${url}`))
        return
      }

      response.pipe(file)
      file.on('finish', () => {
        file.close()
        resolve()
      })
    }).on('error', (err) => {
      file.close()
      if (fs.existsSync(dest)) fs.unlinkSync(dest)
      reject(err)
    })
  })
}

async function main(): Promise<void> {
  console.log(`\n🎵 Fetching Rubber Band CLI v${RUBBERBAND_VERSION} for Windows...\n`)

  // Create destination directory
  fs.mkdirSync(DEST_DIR, { recursive: true })

  // Check if binary already exists
  const exePath = path.join(DEST_DIR, 'rubberband.exe')
  if (fs.existsSync(exePath)) {
    console.log('  ✓ rubberband.exe already exists, skipping download.')
    return
  }

  // Download the ZIP
  console.log(`  Downloading from: ${DOWNLOAD_URL}`)
  try {
    await downloadFile(DOWNLOAD_URL, ZIP_PATH)
    console.log('  ✓ Downloaded ZIP file')
  } catch (err) {
    console.error(`  ✗ Download failed: ${err}`)
    console.error('  You can manually download from: https://breakfastquay.com/rubberband/')
    console.error(`  Place rubberband.exe in: ${DEST_DIR}`)
    return
  }

  // Extract using PowerShell (available on all Windows 10+)
  try {
    console.log('  Extracting...')
    execSync(
      `powershell -Command "Expand-Archive -Path '${ZIP_PATH}' -DestinationPath '${DEST_DIR}' -Force"`,
      { stdio: 'pipe' }
    )

    // The ZIP typically extracts to a subfolder like rubberband-4.0.0-gpl-executable-windows/
    // Move contents up to DEST_DIR if needed
    const extractedSubdir = path.join(DEST_DIR, `rubberband-${RUBBERBAND_VERSION}-gpl-executable-windows`)
    if (fs.existsSync(extractedSubdir)) {
      const files = fs.readdirSync(extractedSubdir)
      for (const file of files) {
        const src = path.join(extractedSubdir, file)
        const dest = path.join(DEST_DIR, file)
        if (!fs.existsSync(dest)) {
          fs.renameSync(src, dest)
        }
      }
      // Clean up the now-empty subfolder
      fs.rmSync(extractedSubdir, { recursive: true, force: true })
    }

    // Clean up the ZIP
    if (fs.existsSync(ZIP_PATH)) {
      fs.unlinkSync(ZIP_PATH)
    }

    // Verify the binary exists
    if (fs.existsSync(exePath)) {
      console.log(`  ✓ rubberband.exe extracted to ${DEST_DIR}`)
    } else {
      // The exe might have a different name in the ZIP - list what we got
      const extracted = fs.readdirSync(DEST_DIR)
      console.log(`  ⚠ rubberband.exe not found after extraction. Files found: ${extracted.join(', ')}`)
      console.log(`  You may need to rename the binary to rubberband.exe`)
    }
  } catch (err) {
    console.error(`  ✗ Extraction failed: ${err}`)
    console.error('  You can manually extract the ZIP and place rubberband.exe in:', DEST_DIR)
  }
}

main().catch(console.error)
