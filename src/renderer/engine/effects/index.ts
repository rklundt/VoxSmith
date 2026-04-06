/**
 * VoxSmith — Voice Processing for Indie Game Developers
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
 * Barrel export for all effect modules.
 * Import individual effects from here rather than from their own files.
 */

export type { EffectModule } from './EffectModule'
export { HighPassEffect } from './HighPassEffect'
export { SpectralTiltEffect } from './SpectralTiltEffect'
export { EQEffect } from './EQEffect'
export { CompressorEffect } from './CompressorEffect'
export { VibratoEffect } from './VibratoEffect'
export { TremoloEffect } from './TremoloEffect'
export { VocalFryEffect } from './VocalFryEffect'
export { BreathinessEffect } from './BreathinessEffect'
export { Breathiness2Effect } from './Breathiness2Effect'
export { ReverbEffect } from './ReverbEffect'
