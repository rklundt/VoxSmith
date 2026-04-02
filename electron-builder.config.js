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
 * electron-builder configuration
 *
 * Packages VoxSmith as a Windows NSIS .exe installer.
 * FFmpeg and Rubber Band WASM binaries are included via extraResources
 * so they ship alongside the app without requiring user installation.
 */
module.exports = {
  appId: 'com.voxsmith.app',
  productName: 'VoxSmith',
  directories: {
    output: 'dist',
    buildResources: 'build'
  },
  files: [
    'out/**/*'
  ],
  win: {
    target: 'nsis',
    // icon: 'src/assets/icon.ico' - uncomment when icon is available
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true
  },
  extraResources: [
    { from: 'src/assets/ffmpeg', to: 'ffmpeg', filter: ['**/*'] },
    // Rubber Band CLI binary - used for Stage 1 offline processing (pitch/formant/tempo)
    { from: 'src/assets/rubberband', to: 'rubberband', filter: ['*.exe', '*.dll'] },
    // Rubber Band WASM - retained from Sprint 1 spike (may be removed in future)
    { from: 'src/assets/rubberband-wasm', to: 'rubberband-wasm', filter: ['**/*'] },
    { from: 'config', to: 'config', filter: ['settings.json'] }
  ]
}
