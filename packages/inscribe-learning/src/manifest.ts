/**
 * Manifest loader. Bundlers inline the JSON at import time; the loader
 * validates before any consumer reads a field.
 */
import { parseManifest, tryParseManifest } from './schemas.ts'
import type { Manifest } from './schemas.ts'
import manifestData from '../data/inscribe-learning.manifest.json' with { type: 'json' }

export function loadManifest(): Manifest {
  return parseManifest(manifestData)
}

export function safeLoadManifest(): { ok: true; manifest: Manifest } | { ok: false; issues: string } {
  return tryParseManifest(manifestData)
}

export { manifestData as rawManifest }
