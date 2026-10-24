import { execFileSync } from 'node:child_process';
import { writeFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const markerUrls = {
  dev: 'https://dev.docs.bitcoinuniverse.io/universe-dev-release.txt',
  production: 'https://docs.bitcoinuniverse.io/RELEASE',
};
export const shippingPrefixes = ['apps/portal/', 'packages/design-system/', 'packages/ecosystem-registry/',
  'packages/content-schema/', 'packages/docs-quality/', 'tooling/sync/', 'tooling/deploy/', 'sources/generated/', 'patches/'];
export const shippingFiles = ['sources.lock.json', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml',
  '.npmrc', '.node-version', '.nvmrc', 'tsconfig.base.json', '.github/workflows/dev-deploy.yml',
  '.github/workflows/deploy.yml', '.github/workflows/deploy-prepare.yml', '.github/workflows/deploy-publish.yml',
  '.github/workflows/deploy-recovery.yml'];
export const shipped = f => {
  if (/(^|\/)(README|AGENTS|CONTRIBUTING|CHANGELOG)\.md$/i.test(f) && !f.startsWith('apps/portal/src/content/docs/')) return false;
  return shippingFiles.includes(f) || shippingPrefixes.some(p => f.startsWith(p));
};
const sorted = values => [...new Set(values)].sort();
export function parseDiff(raw) {
  const tokens = raw.split('\0');
  const changes = [];
  for (let i = 0; i < tokens.length && tokens[i];) {
    const status = tokens[i++];
    const path = tokens[i++];
    if (/^[RC]/.test(status)) changes.push({ status, oldPath: path, path: tokens[i++] });
    else changes.push({ status, path });
  }
  return changes;
}
export function pinChanges(before = {}, after = {}) {
  return sorted([...Object.keys(before), ...Object.keys(after)]).filter(k => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    .map(repository => ({ repository, change: !before[repository] ? 'added' : !after[repository] ? 'removed' : 'modified' }));
}
export function routeFor(file, text = '') {
  const relative = file.replace(/^apps\/portal\/src\/(content\/docs|pages)\//, '');
  if (relative === file || /\[|\.json\.|\.txt\.|^404\./.test(relative)) return null;
  // Explicit content slugs override file routes; read both revisions for removals/renames.
  const slug = text.match(/^slug:\s*['"]?([^\n'"\r]+)['"]?\s*$/m)?.[1]?.trim();
  const value = slug ?? relative.replace(/\.(mdx?|astro)$/, '').replace(/(^|\/)index$/, '');
  const segments = value.split('/').filter(Boolean).map(encodeURIComponent);
  return segments.length ? '/' + segments.join('/') + '/' : '/';
}
export function plan({ changes, beforePins = {}, afterPins = {}, beforeRegistry = [], afterRegistry = [], beforeCatalogs = {}, afterCatalogs = {}, read = () => '', smoke = [], includeMapping = true }) {
  const files = sorted(changes.flatMap(c => [c.path, c.oldPath].filter(Boolean)));
  const inputs = files.filter(shipped);
  const pins = pinChanges(beforePins, afterPins);
  const registryChanges = pinChanges(Object.fromEntries(beforeRegistry.map(e => [e.repository, e])), Object.fromEntries(afterRegistry.map(e => [e.repository, e])));
  for (const e of registryChanges) if (!pins.some(p => p.repository === e.repository)) pins.push(e);
  const routes = [], removedRoutes = [], tests = [], packages = [], typeProjects = [];
  let shared = false;
  for (const file of inputs) {
    packages.push(file.startsWith('packages/') ? file.split('/').slice(0, 2).join('/') : 'apps/portal');
    const change = changes.find(c => c.path === file || c.oldPath === file);
    const page = /^apps\/portal\/src\/(content\/docs\/.*\.mdx?$|pages\/.*\.astro$)/s.test(file);
    if (page && !file.includes('[')) {
      const old = change.status === 'A' || (change.oldPath && change.oldPath !== file) || change.status.startsWith('C') ? null : routeFor(file, read(file, 'before'));
      const current = routeFor(file, read(file, 'after'));
      if (change.status === 'D' || change.oldPath === file) { if (old) removedRoutes.push(old); }
      else {
        if (current) routes.push(current);
        if (old && old !== current) removedRoutes.push(old);
      }
    } else shared = true;
    if (file.startsWith('apps/portal/') || file.startsWith('packages/design-system/')) tests.push('apps/portal/test/style.test.mjs');
    if (/^apps\/portal\/.*\.ts$/.test(file) || file === 'apps/portal/tsconfig.json' || file === 'tsconfig.base.json' || file === 'packages/ecosystem-registry/src/index.d.ts') typeProjects.push('apps/portal');
    if (file.startsWith('packages/ecosystem-registry/')) tests.push('packages/ecosystem-registry/test/registry.test.mjs');
    if (file.startsWith('packages/content-schema/')) {
      tests.push('packages/content-schema/test/validate-manifest.test.mjs', 'packages/ecosystem-registry/test/registry.test.mjs');
      typeProjects.push('packages/content-schema');
    }
    if (file.startsWith('tooling/sync/') || file === 'sources.lock.json') tests.push('tooling/sync/test/sync.test.mjs', 'tooling/sync/test/subset.test.mjs');
    if (file.startsWith('tooling/deploy/') || file.startsWith('.github/workflows/')) tests.push('tooling/deploy/test/deploy.test.mjs');
    if (['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.base.json', '.npmrc', '.node-version', '.nvmrc', 'apps/portal/package.json'].includes(file) || file.startsWith('patches/')) {
      tests.push('apps/portal/test/style.test.mjs', 'packages/ecosystem-registry/test/registry.test.mjs', 'packages/content-schema/test/validate-manifest.test.mjs');
      typeProjects.push('apps/portal', 'packages/content-schema');
    }
  }
  // Data-driven routes: audit every added/modified entity itself, and prove
  // deleted IDs are gone. Other shared templates retain bounded smoke coverage.
  for (const kind of ['products', 'protocols']) {
    const before = Object.fromEntries((beforeCatalogs[kind] ?? []).map(e => [e.id, e]));
    const after = Object.fromEntries((afterCatalogs[kind] ?? []).map(e => [e.id, e]));
    const entries = pinChanges(before, after);
    for (const { repository: id, change } of entries) {
      const route = `/${kind}/${encodeURIComponent(id)}/`;
      (change === 'removed' ? removedRoutes : routes).push(route);
    }
    for (const entry of Object.values(after)) {
      if (pins.some(p => [entry.documentationRepository, entry.repository, entry.sourceRepository].includes(p.repository))) routes.push(`/${kind}/${encodeURIComponent(entry.id)}/`);
    }
  }
  if (shared) routes.push(...smoke);
  const result = { version: 1, ship: inputs.length > 0, files, inputs, pins: pins.sort((a,b) => a.repository.localeCompare(b.repository)),
    verifyPins: pins.filter(p => p.change !== 'removed').map(p => p.repository).sort(),
    packages: sorted(packages), routes: sorted(routes), removedRoutes: sorted(removedRoutes).filter(r => !routes.includes(r)),
    routeCoverage: shared ? 'representative-template-smoke-plus-changed-pages' : 'changed-pages',
    tests: sorted(tests), typeProjects: sorted(typeProjects), builds: inputs.length ? ['@universe/docs-portal'] : [] };
  if (includeMapping) result.mapping = changes.filter(c => [c.path, c.oldPath].some(f => f && shipped(f))).map(change => {
    const source = [change.path, change.oldPath].some(f => f === 'sources.lock.json' || f === 'tooling/sync/sources.json');
    const registry = [change.path, change.oldPath].some(f => f?.startsWith('packages/ecosystem-registry/'));
    const selection = plan({ changes: [change], read, smoke, includeMapping: false,
      beforePins: source ? beforePins : {}, afterPins: source ? afterPins : {},
      beforeRegistry: source ? beforeRegistry : [], afterRegistry: source ? afterRegistry : [],
      beforeCatalogs: registry ? beforeCatalogs : afterCatalogs, afterCatalogs });
    return { change, pins: selection.pins, packages: selection.packages, routes: selection.routes,
      removedRoutes: selection.removedRoutes, tests: selection.tests, typeProjects: selection.typeProjects, builds: selection.builds };
  });
  return result;
}
export function resolveBase(candidate, head, git, diagnostic = console.warn) {
  if (/^[a-f0-9]{40}$/.test(candidate ?? '')) {
    try { git(['cat-file', '-e', `${candidate}^{commit}`]); return candidate; } catch {
      try { git(['fetch', '--no-tags', '--depth=1', 'origin', candidate]); git(['cat-file', '-e', `${candidate}^{commit}`]); return candidate; } catch { /* diagnostic below */ }
    }
  }
  diagnostic('Unknown live base; using HEAD~1 (affected-only checks, never full suites).');
  try { return git(['rev-parse', `${head}~1`]).trim(); } catch {
    diagnostic('Initial commit: compare against the empty tree.');
    return git(['hash-object', '-w', '-t', 'tree', '--stdin'], '').trim();
  }
}
export async function main() {
  const target = process.argv[2];
  if (!markerUrls[target]) throw new Error('scope target must be dev or production');
  const git = (args, input) => execFileSync('git', args, { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'] });
  const head = process.env.GITHUB_SHA ?? git(['rev-parse', 'HEAD']).trim();
  let candidate;
  try { const r = await fetch(markerUrls[target], { signal: AbortSignal.timeout(8000), cache: 'no-store' }); if (r.ok) candidate = (await r.text()).trim(); } catch { /* resolveBase diagnoses */ }
  const base = resolveBase(candidate, head, git);
  const read = (file, revision) => { try { return git(['show', `${revision === 'before' ? base : head}:${file}`]); } catch { return ''; } };
  const json = (file, rev, fallback) => { const text = read(file, rev); return text ? JSON.parse(text) : fallback; };
  const smoke = ['/', '/start/safety/', '/ask/', '/chains/', '/changelog/', '/developers/interfaces/', '/products/', '/protocols/', '/status/live/', '/status/documentation-health/'];
  for (const kind of ['products', 'protocols']) {
    const id = json(`packages/ecosystem-registry/data/${kind}.json`, 'after', {})[kind]?.[0]?.id;
    if (id) smoke.push(`/${kind}/${encodeURIComponent(id)}/`);
  }
  const catalogs = rev => Object.fromEntries(['products', 'protocols'].map(kind => [kind, json(`packages/ecosystem-registry/data/${kind}.json`, rev, {})[kind] ?? []]));
  const manifest = { ...plan({ changes: parseDiff(git(['diff', '--name-status', '-z', '--find-renames', base, head])),
    beforePins: json('sources.lock.json', 'before', {}).sources, afterPins: json('sources.lock.json', 'after', {}).sources,
    beforeRegistry: json('tooling/sync/sources.json', 'before', {}).sources, afterRegistry: json('tooling/sync/sources.json', 'after', {}).sources,
    beforeCatalogs: catalogs('before'), afterCatalogs: catalogs('after'), read, smoke }), base, sha: head, target };
  writeFileSync('scope.json', JSON.stringify(manifest, null, 2) + '\n');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `ship=${manifest.ship}\naudit=${manifest.routes.length > 0}\n`);
  console.log(JSON.stringify(manifest, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
