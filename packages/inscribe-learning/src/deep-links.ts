/**
 * Safe Inscribe deep links. The builder accepts only validated, non-sensitive
 * fields, rejects anything that could carry a secret or user content, and
 * produces URLs the application parser accepts unchanged. Opening a link may
 * select a workspace and prefill safe options; it can never create an order,
 * connect a wallet, sign, pay, or broadcast.
 */
import * as v from 'valibot'
import { DeepLinkIntent } from './schemas.ts'
import type { DeepLinkIntent as DeepLinkIntentType } from './schemas.ts'

/** Query keys allowed in a documentation-to-app handoff URL. */
const ALLOWED_KEYS = [
  'sub',
  'action',
  'protocol',
  'ticker',
  'destination',
  'surface',
  'network',
  'guide',
  'step',
  'scenario',
  'experience',
  'docsReturn',
] as const

export interface BuildLinkOptions {
  /** Inscribe application origin, e.g. https://inscribe.bitcoinuniverse.io */
  appOrigin: string
  intent: DeepLinkIntentType
  /** Approved documentation origins for the return path. */
  docsReturnOrigins: readonly string[]
}

export class UnsafeLinkError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsafeLinkError'
  }
}

export function buildInscribeLink(options: BuildLinkOptions): string {
  const intent = v.parse(DeepLinkIntent, options.intent)
  const origin = new URL(options.appOrigin)
  if (origin.protocol !== 'https:' && origin.hostname !== '127.0.0.1' && origin.hostname !== 'localhost') {
    throw new UnsafeLinkError(`app origin must be https: ${options.appOrigin}`)
  }

  const url = new URL(`/${intent.workspace.replace(/_/g, '-')}`, origin)

  if (intent.docsReturn != null) {
    assertApprovedReturn(intent.docsReturn, options.docsReturnOrigins)
  }

  const params = new URLSearchParams()
  for (const key of ALLOWED_KEYS) {
    const value = intent[key]
    if (value == null || value === '') continue
    params.set(key, String(value))
  }
  url.search = params.toString()
  return url.toString()
}

export function assertApprovedReturn(docsReturn: string, approved: readonly string[]): void {
  if (docsReturn.includes('..')) {
    throw new UnsafeLinkError('docsReturn must not contain path traversal')
  }
  let parsed: URL
  try {
    parsed = new URL(docsReturn, 'https://placeholder.invalid')
  } catch {
    throw new UnsafeLinkError('docsReturn is not a valid URL or path')
  }
  if (parsed.origin === 'https://placeholder.invalid') {
    // A relative path is allowed; the browser resolves it against the docs site.
    if (!parsed.pathname.startsWith('/') || parsed.pathname.includes('..')) {
      throw new UnsafeLinkError('docsReturn path must be absolute within the docs site')
    }
    return
  }
  if (!approved.includes(parsed.origin)) {
    throw new UnsafeLinkError(`docsReturn origin is not approved: ${parsed.origin}`)
  }
}

const SENSITIVE_PATTERNS: Array<[RegExp, string]> = [
  [/^(bc1|tb1|bcrt1|[123mn2])[a-z0-9]{20,}$/i, 'bitcoin address'],
  [/^[0-9a-f]{64}$/i, 'transaction or order hash'],
  [/:/, 'outpoint'],
  [/psbt/i, 'PSBT material'],
]

/**
 * Guard for values about to enter a shareable URL. Throws when a value looks
 * like an address, a hash, an outpoint, or PSBT material. The planner never
 * collects these values, this guard is the second line of defense.
 */
export function assertNoSensitiveValue(key: string, value: string): void {
  for (const [pattern, label] of SENSITIVE_PATTERNS) {
    if (pattern.test(value)) {
      throw new UnsafeLinkError(`refusing to place a ${label} in URL field "${key}"`)
    }
  }
}

/** Parse and validate a link produced by buildInscribeLink. */
export function parseInscribeLink(href: string): DeepLinkIntentType {
  const url = new URL(href)
  const workspace = url.pathname.replace(/^\/+|\/+$/g, '').split('/')[0] ?? ''
  const raw: Record<string, string> = {}
  for (const key of ALLOWED_KEYS) {
    const value = url.searchParams.get(key)
    if (value != null) raw[key] = value
  }
  return v.parse(DeepLinkIntent, { workspace, ...raw })
}
