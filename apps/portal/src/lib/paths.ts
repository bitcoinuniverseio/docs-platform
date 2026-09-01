// Astro does not rewrite hand-written hrefs when `base` is set, so every internal
// link the generated catalog pages emit goes through here. The production build
// has no base and this is the identity function; the GitHub Pages build serves
// from a project subpath and needs the prefix.
const BASE = import.meta.env.BASE_URL ?? '/';

/** Prefix an absolute site path with the configured base. */
export function withBase(path: string): string {
  if (!path.startsWith('/')) return path;
  const base = BASE.endsWith('/') ? BASE.slice(0, -1) : BASE;
  return `${base}${path}`;
}

/** The absolute origin this build is published under, without a trailing slash. */
export function siteOrigin(site: URL | undefined): string {
  const origin = site?.href ?? 'https://docs.bitcoinuniverse.io/';
  return origin.endsWith('/') ? origin.slice(0, -1) : origin;
}

/** A fully qualified URL for a site path, used by the machine-readable routes. */
export function absoluteUrl(site: URL | undefined, path: string): string {
  return `${siteOrigin(site)}${withBase(path)}`;
}
