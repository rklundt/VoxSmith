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

import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

/**
 * electron-vite configuration
 *
 * Handles three build targets in one config:
 * - main: Electron main process (Node.js)
 * - preload: Preload script (contextBridge between main and renderer)
 * - renderer: React UI (Chromium browser context)
 *
 * externalizeDepsPlugin() ensures Node.js dependencies (electron, fs, path, etc.)
 * are not bundled into the main/preload builds - they're available at runtime.
 */
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/main',
      rollupOptions: {
        input: {
          index: 'src/main/index.ts'
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      // Preload must be CommonJS - Electron's sandboxed preload context
      // does not support ESM import statements
      rollupOptions: {
        input: {
          index: 'src/preload/index.ts'
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].js'
        }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    build: {
      outDir: '../../out/renderer',
      rollupOptions: {
        input: {
          index: 'src/renderer/index.html'
        }
      }
    },
    plugins: [react()]
  }
})
