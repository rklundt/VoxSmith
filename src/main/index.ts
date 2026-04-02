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
 * VoxSmith - Main Process Entry Point
 *
 * Responsibilities:
 * - App lifecycle (ready, window-all-closed, activate)
 * - BrowserWindow creation with security settings
 * - Content Security Policy for WASM and AudioWorklet support
 * - Session logging initialization and log purge
 * - IPC handler registration
 *
 * RULE: Audio processing never runs here. Only file I/O, IPC, and FFmpeg.
 */

import { app, BrowserWindow, session, protocol, net } from 'electron'
import path from 'path'
import { loadSettings } from './fileSystem/settings'
import { initializeLogging } from './fileSystem/logManager'
import { registerIpcHandlers } from './ipc/index'

// ─── Custom Protocol Registration ────────────────────────────────────────────

/**
 * Register the 'portrait' custom protocol scheme.
 * MUST be called before app.whenReady() - Electron requires scheme registration
 * at startup so CSP and the renderer know it's a valid protocol.
 *
 * The portrait:// protocol serves image files from the portraits/ directory.
 * We need this because Electron's renderer (served from localhost in dev) blocks
 * file:// URIs for security. A custom protocol sidesteps this restriction cleanly.
 *
 * Usage in renderer: <img src="portrait://abc123.png" />
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'portrait',
    privileges: {
      // Allow the renderer to fetch resources via this protocol
      standard: false,
      secure: true,
      supportFetchAPI: true,
      // Allow use in <img> tags
      corsEnabled: false,
    },
  },
])

// ─── Settings and Logger Initialization ──────────────────────────────────────

// Load settings first (before logger, since settings control log level)
const settings = loadSettings()

// Initialize session logging - creates log file and purges old ones
const logger = initializeLogging(
  settings.logging.maxSessionFiles,
  settings.logging.logLevel
)

// ─── Content Security Policy ─────────────────────────────────────────────────

/**
 * Configure CSP headers for the renderer process.
 *
 * This is a Sprint 0 prerequisite for the Sprint 1 WASM spike:
 * - 'wasm-unsafe-eval' allows WASM instantiation (Rubber Band, SoundTouch)
 * - 'blob:' in worker-src covers AudioWorklet registration patterns
 *
 * Without this, WASM will silently fail to load in Electron's renderer.
 */
function configureCSP(): void {
  // In dev mode, Vite's HMR injects inline scripts and connects to localhost.
  // We must relax CSP to allow this. In production, strict CSP is enforced.
  const isDev = !app.isPackaged

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const csp = isDev
      ? // Dev: allow inline scripts (Vite HMR), localhost connections, and WASM.
        // 'unsafe-eval' is required because rubberband-web's Emscripten-compiled
        // bundle calls new Function() internally for its WASM dispatch tables.
        // 'wasm-unsafe-eval' alone only covers WebAssembly.instantiate/compile -
        // it does NOT cover new Function() string evaluation, which Emscripten uses.
        "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'; " +
        "worker-src 'self' blob:; " +
        "style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data: file: portrait:; " +
        "media-src 'self' file: blob:; " +
        "connect-src 'self' ws://localhost:* http://localhost:*"
      : // Production: 'unsafe-eval' is still required for Emscripten's new Function()
        // pattern inside rubberband-processor.js. This is a known cost of using
        // Emscripten-compiled WASM libraries. If the formant decision in Sprint 1
        // leads to a different approach, this requirement may be revisited.
        "default-src 'self'; " +
        "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; " +
        "worker-src 'self' blob:; " +
        "style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data: file: portrait:; " +
        "media-src 'self' file: blob:; " +
        "connect-src 'self'"

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp]
      }
    })
  })
  logger.info(`CSP configured (${isDev ? 'dev' : 'production'} mode): unsafe-eval + wasm-unsafe-eval enabled for Emscripten WASM, worker-src includes blob:`)
}

// ─── Window Creation ─────────────────────────────────────────────────────────

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: 'VoxSmith',
    webPreferences: {
      // Security: renderer has no direct Node.js access
      contextIsolation: true,
      nodeIntegration: false,
      // Preload script bridges main ↔ renderer via contextBridge
      preload: path.join(__dirname, '../preload/index.js'),
      // Allow Web Audio API to autoplay without user gesture
      // (needed for live mic monitoring and playback)
      autoplayPolicy: 'no-user-gesture-required',
    },
  })

  // In dev, load from electron-vite dev server (HMR enabled)
  // In production, load the built index.html
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
    // Open DevTools in dev mode for debugging
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  logger.info('Main window created')
}

// ─── App Lifecycle ───────────────────────────────────────────────────────────

app.whenReady().then(() => {
  // Configure CSP before creating any windows
  configureCSP()

  // Register the portrait:// protocol handler.
  // Maps portrait://filename.png to the local portraits/ directory.
  // This runs after app is ready because protocol.handle requires it.
  const portraitsDir = app.isPackaged
    ? path.join(process.resourcesPath, 'portraits')
    : path.join(app.getAppPath(), 'portraits')

  protocol.handle('portrait', (request) => {
    // Extract the filename from the URL: portrait://filename.png
    // URL parsing gives us the hostname as the filename for scheme://host format
    const url = new URL(request.url)
    // The filename is in the hostname (portrait://abc123.png -> hostname = "abc123.png")
    const filename = url.hostname + url.pathname
    const filePath = path.join(portraitsDir, filename)
    logger.debug(`Portrait protocol: serving ${filePath}`)
    return net.fetch(`file://${filePath}`)
  })
  logger.info(`Portrait protocol registered (dir: ${portraitsDir})`)

  // Register all IPC handlers before the renderer can call them
  registerIpcHandlers(logger)

  // Create the main application window
  createWindow()

  // macOS: re-create window when dock icon is clicked and no windows exist
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

// Quit when all windows are closed (Windows/Linux behavior)
// macOS apps typically stay open until Cmd+Q
app.on('window-all-closed', () => {
  logger.info('All windows closed - quitting')
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Log clean shutdown
app.on('will-quit', () => {
  logger.info('VoxSmith shutting down')
})
