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
 * FFmpeg Binary Path Resolution
 *
 * Resolves the path to the bundled FFmpeg binary (ffmpeg.exe on Windows).
 * Same pattern as Rubber Band path resolution in rubberband/binaryPath.ts.
 *
 * Dev: binary lives in src/assets/ffmpeg/ (copied by postinstall script)
 * Production: binary is in process.resourcesPath/ffmpeg/ (via extraResources)
 */

import path from 'path'
import fs from 'fs'
import { app } from 'electron'

/**
 * Returns the absolute path to the FFmpeg binary.
 *
 * Throws an error if the binary is not found - the caller (IPC handler)
 * catches this and returns an error result to the renderer.
 */
export function getFFmpegPath(): string {
  // In production, electron-builder copies extraResources to process.resourcesPath
  const productionPath = path.join(process.resourcesPath, 'ffmpeg', 'ffmpeg.exe')

  // In dev, the binary is in src/assets/ffmpeg/ relative to the compiled output
  const devPath = path.join(__dirname, '../../src/assets/ffmpeg/ffmpeg.exe')

  // Also try relative to project root (when running from source via electron-vite)
  const devAltPath = path.join(app.getAppPath(), 'src/assets/ffmpeg/ffmpeg.exe')

  if (app.isPackaged && fs.existsSync(productionPath)) {
    return productionPath
  }

  if (fs.existsSync(devPath)) {
    return devPath
  }

  if (fs.existsSync(devAltPath)) {
    return devAltPath
  }

  throw new Error(
    `FFmpeg binary not found. Searched:\n` +
    `  Production: ${productionPath}\n` +
    `  Dev: ${devPath}\n` +
    `  Dev alt: ${devAltPath}\n` +
    `Run "pnpm install" to trigger the postinstall script that fetches it.`
  )
}
