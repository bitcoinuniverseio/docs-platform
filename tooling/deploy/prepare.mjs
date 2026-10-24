import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, appendFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname, join } from 'node:path';
import { buildKey, checksums, restoreOutput, saveOutput, tracked, fingerprint, digest } from './cache.mjs';
import { selectPins } from '../sync/subset.mjs';
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' });
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const phase = process.argv[2];
const scope = json('scope.json');
const environment = { node: process.version, platform: process.platform, arch: process.arch, pnpm: '10.34.5',
  SITE_URL: process.env.SITE_URL ?? 'https://docs.bitcoinuniverse.io', BASE_PATH: process.env.BASE_PATH ?? '', NODE_ENV: 'production' };
const out = (key, value) => appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
const dist = 'apps/portal/dist';
const cache = '.cache/docs-deploy/output';
const start = Date.now();
if (phase === 'keys') {
  const inputs = tracked().filter(f => /(^|\/)package.json$|pnpm-lock.yaml$|pnpm-workspace.yaml$|^patches\/|^\.npmrc$|^\.node-version$|^\.nvmrc$/.test(f));
  out('dependencies', fingerprint(inputs.map(f => [f, digest(readFileSync(f))]), environment));
  out('build', buildKey(environment));
  out('browser', fingerprint([['pnpm-lock.yaml', digest(readFileSync('pnpm-lock.yaml'))], ['quality', digest(readFileSync('packages/docs-quality/package.json'))]], environment));
} else if (phase === 'browser-key') {
  const quality = createRequire(resolve('packages/docs-quality/package.json'));
  const playwright = quality.resolve('playwright/package.json');
  const core = createRequire(playwright).resolve('playwright-core/package.json');
  out('version', json(playwright).version);
  out('revision', json(join(dirname(core), 'browsers.json')).browsers.find(b => b.name === 'chromium').revision);
} else if (phase === 'checks') {
  if (!scope.ship) throw new Error('unshipped scope must skip installation and preparation');
  const lint = scope.inputs.filter(f => existsSync(f) && /\.(astro|mdx?|ts|js|mjs|css)$/.test(f));
  const styled = lint.filter(f => f.startsWith('apps/portal/src/') || f.startsWith('packages/design-system/styles/'));
  writeFileSync('.cache/docs-deploy/lint.json', JSON.stringify(styled));
  if (styled.length) run('node', ['apps/portal/test/style.test.mjs', '--files-json', '.cache/docs-deploy/lint.json']);
  for (const file of lint.filter(f => /\.(mjs|js)$/.test(f))) run('node', ['--check', file]);
  for (const test of scope.tests.filter(t => t !== 'apps/portal/test/style.test.mjs')) run('node', [test]);
  if (scope.verifyPins.length) {
    writeFileSync('.cache/docs-deploy/pins.json', JSON.stringify(scope.verifyPins));
    run('node', ['tooling/sync/bin/sync.mjs', 'verify', '--pins-file', '.cache/docs-deploy/pins.json']);
  }
  // Removed pins must be removed from both registry and lock, never silently
  // accepted as missing selected entries.
  const lock = json('sources.lock.json'), registry = json('tooling/sync/sources.json');
  if (scope.inputs.some(f => f === 'sources.lock.json' || f.startsWith('tooling/sync/'))) selectPins(lock, registry, []);
  for (const pin of scope.pins.filter(p => p.change === 'removed')) {
    if (lock.sources[pin.repository] || registry.sources.some(e => e.repository === pin.repository)) throw new Error(`removed pin still registered: ${pin.repository}`);
  }
  for (const project of scope.typeProjects) {
    if (project === 'apps/portal') run('pnpm', ['--filter', '@universe/docs-portal', 'exec', 'astro', 'sync']);
    run('pnpm', ['--dir', project, 'exec', 'tsc', '--noEmit', '--incremental', '--tsBuildInfoFile', `${process.cwd()}/.cache/docs-deploy/${project.replaceAll('/', '-')}.tsbuildinfo`]);
  }
} else if (phase === 'build') {
  const key = buildKey(environment);
  const reused = restoreOutput(cache, dist, key);
  if (!reused) {
    run('pnpm', ['--filter', '@universe/docs-portal', 'build']);
    integrity(dist);
    saveOutput(cache, dist, key);
  }
  integrity(dist);
  writeFileSync('.cache/docs-deploy/build.json', JSON.stringify({ key, reused, seconds: (Date.now() - start) / 1000 }));
  console.log(`portal output reuse=${reused}; key=${key}`);
} else if (phase === 'audit') {
  if (scope.routes.length) run('node', ['packages/docs-quality/bin/check-accessibility.mjs', '--dist', dist, '--routes', scope.routes.join(',')]);
  else console.log('No affected routes: browser and accessibility audit skipped');
} else if (phase === 'accept') {
  integrity(dist);
  mkdirSync('accepted', { recursive: true });
  writeFileSync(`${dist}/RELEASE`, scope.sha + '\n');
  writeFileSync(`${dist}/universe-dev-release.txt`, scope.sha + '\n');
  rmSync(`${dist}/CHECKSUMS.sha256`, { force: true });
  const files = checksums(dist);
  writeFileSync(`${dist}/CHECKSUMS.sha256`, Object.entries(files).map(([f,h]) => `${h}  ${f}`).join('\n') + '\n');
  run('tar', ['-czf', 'accepted/portal.tgz', '-C', dist, '.']);
  const accepted = { version: 1, sha: scope.sha, target: scope.target, run: process.env.GITHUB_RUN_ID,
    attempt: process.env.GITHUB_RUN_ATTEMPT, repository: process.env.GITHUB_REPOSITORY,
    workflow: process.env.GITHUB_WORKFLOW, ref: process.env.GITHUB_REF, acceptedAt: new Date().toISOString(),
    digest: digest(readFileSync('accepted/portal.tgz')), configuration: environment, scope,
    build: json('.cache/docs-deploy/build.json') };
  writeFileSync('accepted/accepted.json', JSON.stringify(accepted, null, 2));
} else throw new Error('unknown preparation phase');
function integrity(root) {
  for (const file of ['index.html', 'pagefind/pagefind.js', 'sitemap-index.xml']) if (!existsSync(`${root}/${file}`)) throw new Error(`missing build output: ${file}`);
  if (!Object.keys(checksums(root)).some(f => f.startsWith('_astro/'))) throw new Error('missing built assets');
}
