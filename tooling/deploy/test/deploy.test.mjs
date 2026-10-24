import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { plan, parseDiff, pinChanges, resolveBase, routeFor, markerUrls, shippingFiles, shippingPrefixes } from '../scope.mjs';
import { fingerprint, digest, restoreOutput, saveOutput } from '../cache.mjs';
import { publishAccepted, assertAccepted, retryable, verifyLive, retryEvidence, queueSeconds } from '../publish.mjs';
import { validateRun } from '../github.mjs';
const changed = (...files) => files.map(path => ({ status: 'M', path }));
const smoke = ['/', '/start/safety/', '/products/core/', '/protocols/ordinals/'];
test('repository prose skips every deployment selection', () => {
  const scope = plan({ changes: changed('README.md', 'docs/operators.md', 'services/docs-mcp/src/server.mjs', 'packages/design-system/README.md', 'tooling/deploy/README.md') });
  for (const key of ['routes', 'tests', 'pins', 'verifyPins', 'builds', 'typeProjects']) assert.deepEqual(scope[key], []);
  assert.equal(scope.ship, false);
});
test('published Markdown and MDX each deploy and audit only their page', () => {
  for (const [file, route] of [['start/safety.md', '/start/safety/'], ['index.mdx', '/']]) {
    const scope = plan({ changes: changed(`apps/portal/src/content/docs/${file}`), smoke });
    assert.equal(scope.ship, true); assert.deepEqual(scope.routes, [route]);
    assert.deepEqual(scope.tests, ['apps/portal/test/style.test.mjs']);
  }
});
test('route slugs, index normalization and URL encoding are explicit', () => {
  assert.equal(routeFor('apps/portal/src/content/docs/x.md', '---\nslug: "guide/custom"\n---'), '/guide/custom/');
  assert.equal(routeFor('apps/portal/src/content/docs/developers/index.md'), '/developers/');
  assert.equal(routeFor('apps/portal/src/content/docs/a b.md'), '/a%20b/');
  assert.equal(routeFor('apps/portal/src/content/docs/a.md', 'slug: /'), '/');
  const added = plan({ changes: [{ path: 'apps/portal/src/content/docs/a.md', status: 'A' }], read: () => 'slug: /actual' });
  assert.deepEqual(added.removedRoutes, []);
});
test('changed and deleted registry entries select exact dynamic pages beyond template representatives', () => {
  const scope = plan({ changes: changed('packages/ecosystem-registry/data/products.json'),
    beforeCatalogs: { products: [{ id: 'old' }, { id: 'core', name: 'before' }] },
    afterCatalogs: { products: [{ id: 'new' }, { id: 'core', name: 'after' }] } });
  assert.deepEqual(scope.routes, ['/products/core/', '/products/new/']);
  assert.deepEqual(scope.removedRoutes, ['/products/old/']);
});
test('NUL diff handles deletions, renames, copies and hostile filenames without shell parsing', () => {
  const raw = 'R100\0apps/portal/src/content/docs/old name.md\0apps/portal/src/content/docs/new\nname.mdx\0D\0apps/portal/src/content/docs/gone.md\0M\0README $(whoami).md\0';
  const changes = parseDiff(raw);
  assert.equal(changes.length, 3);
  const scope = plan({ changes });
  assert.deepEqual(scope.routes, ['/new%0Aname/']);
  assert.deepEqual(scope.removedRoutes, ['/gone/', '/old%20name/']);
});
test('a changed slug verifies removal of the old route', () => {
  const scope = plan({ changes: changed('apps/portal/src/content/docs/page.md'), read: (_, revision) => `slug: ${revision}` });
  assert.deepEqual(scope.routes, ['/after/']); assert.deepEqual(scope.removedRoutes, ['/before/']);
});
test('shared templates/styles select bounded, explicitly representative smoke', () => {
  for (const file of ['packages/design-system/styles/universe.css', 'apps/portal/src/components/CapabilityTable.astro', 'apps/portal/astro.config.mjs', 'packages/ecosystem-registry/data/products.json']) {
    const scope = plan({ changes: changed(file), smoke });
    assert.deepEqual(scope.routes, smoke.slice().sort());
    assert.match(scope.routeCoverage, /representative/);
    assert.deepEqual(scope.builds, ['@universe/docs-portal']);
  }
});
test('source pin additions/modifications/removals select entries rather than the full lock', () => {
  const before = { removed: { commit: 'a' }, modified: { commit: 'a' }, same: { commit: 'a' } };
  const after = { added: { commit: 'b' }, modified: { commit: 'b' }, same: { commit: 'a' } };
  assert.deepEqual(pinChanges(before, after), [{ repository: 'added', change: 'added' }, { repository: 'modified', change: 'modified' }, { repository: 'removed', change: 'removed' }]);
  const scope = plan({ changes: changed('sources.lock.json'), beforePins: before, afterPins: after, smoke });
  assert.deepEqual(scope.verifyPins, ['added', 'modified']);
  const registryScope = plan({ changes: changed('tooling/sync/sources.json'), beforeRegistry: [{ repository: 'r', sourceRef: 'main' }], afterRegistry: [] });
  assert.deepEqual(registryScope.pins, [{ repository: 'r', change: 'removed' }]);
});
test('valid live base is fetched when missing; unknown base diagnoses HEAD~1, initial commit is explicit', () => {
  const calls = [], warnings = [], sha = 'a'.repeat(40);
  let fetched = false;
  assert.equal(resolveBase(sha, 'HEAD', args => { calls.push(args); if (args[0] === 'fetch') fetched = true; else if (!fetched) throw Error(); return ''; }), sha);
  assert.equal(calls.filter(a => a[0] === 'fetch').length, 1);
  assert.equal(resolveBase('garbage', 'HEAD', args => { assert.deepEqual(args, ['rev-parse', 'HEAD~1']); return sha; }, x => warnings.push(x)), sha);
  assert.match(warnings[0], /Unknown live base/);
  assert.equal(resolveBase('', 'HEAD', args => { if (args[0] === 'rev-parse') throw Error(); assert.deepEqual(args, ['hash-object', '-w', '-t', 'tree', '--stdin']); return 'empty'; }, x => warnings.push(x)), 'empty');
  assert.match(warnings.at(-1), /Initial commit/);
  assert.equal(markerUrls.production, 'https://docs.bitcoinuniverse.io/RELEASE');
});
test('cache invalidates on source content, pins, configuration, dependencies and environment', () => {
  const entries = [['page.md', 'text'], ['sources.lock.json', 'pin'], ['astro.config.mjs', 'config'], ['pnpm-lock.yaml', 'deps']];
  const env = { node: '24.19.0', pnpm: '10.34.5', SITE_URL: 'https://docs.bitcoinuniverse.io' };
  const key = fingerprint(entries, env);
  assert.equal(key, fingerprint(entries.slice().reverse(), env));
  for (let i = 0; i < entries.length; i++) assert.notEqual(key, fingerprint(entries.map((e,j) => j === i ? [e[0], 'changed'] : e), env));
  assert.notEqual(key, fingerprint(entries, { ...env, SITE_URL: 'https://other.example' }));
});
test('warm task output is actually reused; changed key and corrupted bytes rebuild', () => {
  mkdirSync('.tmp', { recursive: true });
  const root = mkdtempSync('.tmp/deploy-cache-'), cache = join(root, 'cache'), output = join(root, 'dist');
  let builds = 0;
  const build = key => {
    if (restoreOutput(cache, output, key)) return true;
    builds++; mkdirSync(output, { recursive: true }); writeFileSync(join(output, 'index.html'), 'verified'); saveOutput(cache, output, key); return false;
  };
  try {
    assert.equal(build('one'), false); rmSync(output, { recursive: true }); assert.equal(build('one'), true);
    assert.equal(builds, 1); assert.equal(readFileSync(join(output, 'index.html'), 'utf8'), 'verified');
    assert.equal(build('two'), false); writeFileSync(join(cache, 'dist/index.html'), 'corrupt'); assert.equal(build('two'), false); assert.equal(builds, 3);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('one transport retry publishes identical immutable bytes; ambiguous live success publishes nothing', async () => {
  const bytes = Buffer.from('accepted immutable fixture'), hashes = [];
  let live = false;
  const options = { check: async () => {}, verify: async () => live, publish: async b => { hashes.push(digest(b)); if (hashes.length === 1) throw Object.assign(Error('reset'), { kind: 'ssh-reset' }); live = true; } };
  await assert.rejects(publishAccepted({}, bytes, options), /reset/);
  await publishAccepted({}, bytes, { ...options, recovery: true });
  assert.deepEqual(hashes, [digest(bytes), digest(bytes)]);
  await publishAccepted({}, bytes, { ...options, recovery: true }); assert.equal(hashes.length, 2);
  const activation = readFileSync('tooling/deploy/activate.sh', 'utf8');
  assert.doesNotMatch(activation, /rm -rf.*\$(DEST|SHA|RELEASES)/);
  assert.match(activation, /if \[ -d "\$DEST" \]/); assert.match(activation, /sha256sum --check/);
});
test('retry classification never includes validation, authentication, health, cancellation or checksum failures', () => {
  for (const kind of ['fatal', 'validation', 'authentication', 'health', 'cancelled', 'checksum']) assert.equal(retryable({ kind }), false);
  for (const kind of ['ssh-reset', 'verification-timeout']) assert.equal(retryable({ kind }), true);
});
test('fatal classified evidence vetoes runner-loss inference and queue timing includes scheduling waits', () => {
  const expected = { run: '123', sha: 'abc' };
  assert.equal(retryEvidence({ ...expected, digest: 'digest', retry: false }, expected, 'digest', true), false);
  assert.equal(retryEvidence(null, expected, 'digest', true), true);
  assert.equal(retryEvidence(null, expected, 'digest', false), false);
  assert.equal(queueSeconds({ created_at: '2026-10-24T09:00:00Z' }, [
    { name: 'prepare / prepare', started_at: '2026-10-24T09:00:10Z', completed_at: '2026-10-24T09:00:30Z', conclusion: 'success' },
    { name: 'publish / publish', started_at: '2026-10-24T09:00:35Z', conclusion: null },
  ]), 15);
});
test('accepted metadata binds SHA/configuration archive, repository, target and original run', () => {
  const bytes = Buffer.from('immutable');
  const expected = { sha: 'a'.repeat(40), target: 'production', run: '123', repository: 'bitcoinuniverseio/docs-platform' };
  const a = { version: 1, ...expected, attempt: '1', ref: 'refs/heads/main', workflow: 'deploy', digest: digest(bytes), scope: { sha: expected.sha, target: 'production', ship: true }, build: { key: 'config' } };
  assert.doesNotThrow(() => assertAccepted(a, bytes, expected));
  for (const patch of [{ sha: 'b'.repeat(40) }, { digest: 'bad' }, { run: '124' }, { target: 'dev' }, { repository: 'attacker/fork' }, { attempt: '2' }]) assert.throws(() => assertAccepted({ ...a, ...patch }, bytes, expected));
});
test('trusted recovery rejects PRs, wrong workflows/branches, cancelled and superseded attempts', () => {
  const repository = process.env.GITHUB_REPOSITORY;
  process.env.GITHUB_REPOSITORY = 'bitcoinuniverseio/docs-platform';
  const run = { repository: { full_name: process.env.GITHUB_REPOSITORY }, head_repository: { full_name: process.env.GITHUB_REPOSITORY }, head_branch: 'develop', head_sha: 'sha', path: '.github/workflows/dev-deploy.yml', event: 'push', run_attempt: 1, conclusion: 'failure', status: 'completed' };
  try {
    assert.doesNotThrow(() => validateRun(run, 'dev', 'sha', { recovery: true }));
    for (const patch of [{ event: 'pull_request' }, { head_branch: 'main' }, { path: '.github/workflows/ci.yml' }, { run_attempt: 2 }, { conclusion: 'cancelled' }]) assert.throws(() => validateRun({ ...run, ...patch }, 'dev', 'sha', { recovery: true }));
  } finally { if (repository === undefined) delete process.env.GITHUB_REPOSITORY; else process.env.GITHUB_REPOSITORY = repository; }
});
test('live normal and rollback identities compare the selected target; page/search/sitemap/assets remain checked', async () => {
  const sha = 'b'.repeat(40), visited = [];
  const a = { target: 'production', sha, scope: { routes: ['/changed/'], removedRoutes: ['/gone/'] } };
  const fetcher = async url => { const path = new URL(url).pathname; visited.push(path); return new Response(path === '/RELEASE' ? sha : '<link href="/_astro/main.css">', { status: path === '/gone/' ? 404 : 200 }); };
  assert.equal(await verifyLive(a, fetcher), true);
  for (const path of ['/RELEASE', '/changed/', '/gone/', '/pagefind/pagefind.js', '/sitemap-index.xml', '/_astro/main.css']) assert.ok(visited.includes(path));
  assert.equal(await verifyLive({ ...a, sha: 'a'.repeat(40) }, fetcher), false);
});
test('workflow contracts preserve full CI and block accidental full deployment checks', () => {
  const read = f => readFileSync(`.github/workflows/${f}.yml`, 'utf8');
  const prod = read('deploy'), dev = read('dev-deploy'), prep = read('deploy-prepare'), publish = read('deploy-publish'), recovery = read('deploy-recovery');
  assert.doesNotMatch(prod, /^  push:/m); assert.match(prod, /inputs.confirm == 'DEPLOY-PRODUCTION'/); assert.match(prod, /inputs.confirm == 'ROLLBACK-PRODUCTION'/);
  assert.match(publish, /'production'/); assert.match(dev, /cancel-in-progress: true/); assert.match(dev, /refs\/heads\/develop/);
  for (const text of [prod, dev, prep, publish, recovery]) {
    assert.doesNotMatch(text, /universe-runners-1|pnpm test|pnpm typecheck|pnpm sync:verify|npx |--with-deps|pnpm -r build/);
    for (const chunk of text.split('uses: actions/checkout@').slice(1)) assert.match(chunk.split('- uses:')[0], /persist-credentials: false/);
  }
  assert.match(prep, /pnpm install --frozen-lockfile --prefer-offline/); assert.match(prep, /exec playwright install chromium/);
  assert.match(read('ci'), /run: pnpm test/); assert.match(read('ci'), /run: pnpm typecheck/);
  assert.match(read('ci'), /check-accessibility.mjs --dist apps\/portal\/dist\s*$/m);
  for (const path of [...shippingFiles, ...shippingPrefixes.map(p => p + '**')]) assert.ok(dev.includes(`"${path}"`), `missing trigger ${path}`);
  assert.match(readFileSync('packages/docs-quality/bin/check-accessibility.mjs', 'utf8'), /args.has\('routes'\) && !args.get\('routes'\)\?\.trim\(\)/);
  assert.doesNotMatch(readFileSync('tooling/deploy/publish.mjs', 'utf8'), /StrictHostKeyChecking=(no|accept-new)/);
});
test('explicit empty accessibility routes exit before dist discovery or browser startup', () => {
  const result = spawnSync(process.execPath, ['packages/docs-quality/bin/check-accessibility.mjs', '--dist', '.tmp/no-built-site', '--routes', ''], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /explicit empty route selection; skipped/);
});
