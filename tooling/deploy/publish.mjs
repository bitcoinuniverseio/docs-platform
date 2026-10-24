import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { digest } from './cache.mjs';
import { api, currentHead, validateRun } from './github.mjs';
export function retryable(error) {
  return error.kind === 'ssh-reset' || error.kind === 'verification-timeout';
}
export function retryEvidence(status, expected, archiveDigest, runnerLost) {
  // Surviving classified evidence always vetoes inference from runner loss.
  if (status) return status.run === expected.run && status.sha === expected.sha && status.digest === archiveDigest && status.retry === true;
  return runnerLost;
}
export function queueSeconds(run, jobs) {
  const active = jobs.filter(j => j.conclusion !== 'skipped' && j.started_at);
  if (!active.length) return 0;
  const initial = Math.max(0, (Math.min(...active.map(j => Date.parse(j.started_at))) - Date.parse(run.created_at)) / 1000);
  const publish = active.find(j => j.name.endsWith('/ publish'));
  const dependencies = active.filter(j => j !== publish && j.completed_at);
  const publication = publish && dependencies.length ? Math.max(0, (Date.parse(publish.started_at) - Math.max(...dependencies.map(j => Date.parse(j.completed_at)))) / 1000) : 0;
  return initial + publication;
}
export function assertAccepted(a, bytes, expected) {
  if (a.version !== 1 || a.sha !== expected.sha || a.target !== expected.target || a.run !== expected.run || a.attempt !== '1' ||
      a.repository !== expected.repository || a.ref !== `refs/heads/${a.target === 'dev' ? 'develop' : 'main'}` ||
      a.workflow !== (a.target === 'dev' ? 'Dev deploy' : 'deploy') || a.digest !== digest(bytes) || a.scope?.sha !== a.sha || a.scope?.target !== a.target || !a.scope.ship || !a.build?.key) throw new Error('accepted artifact validation/digest failed');
}
export async function verifyLive(a, fetcher = fetch) {
  const base = a.target === 'dev' ? 'https://dev.docs.bitcoinuniverse.io' : 'https://docs.bitcoinuniverse.io';
  const marker = a.target === 'dev' ? '/universe-dev-release.txt' : '/RELEASE';
  const get = async (path, status = 200) => {
    let r;
    try { r = await fetcher(`${base}${path}`, { signal: AbortSignal.timeout(12000), cache: 'no-store' }); }
    catch (e) { if (e.name === 'TimeoutError' || e.name === 'AbortError' || e.cause?.code === 'UND_ERR_CONNECT_TIMEOUT') throw Object.assign(new Error('verification transport timeout'), { kind: 'verification-timeout' }); throw e; }
    if (r.status !== status) throw new Error(`health failed ${path}: ${r.status}, expected ${status}`);
    return r.text();
  };
  const live = (await get(marker)).trim();
  if (live !== a.sha) return false;
  for (const route of ['/', '/pagefind/pagefind.js', '/sitemap-index.xml', ...a.scope.routes]) await get(route);
  for (const route of a.scope.removedRoutes) await get(route, 404);
  const html = await get('/');
  const assets = [...html.matchAll(/(?:src|href)=["']([^"']*\/_astro\/[^"']+)["']/g)].map(m => new URL(m[1], base).pathname);
  if (!assets.length) throw new Error('live index references no built assets');
  for (const asset of new Set(assets)) await get(asset);
  return true;
}
// One independent retry consumes identical immutable bytes. No preparation
// callbacks exist; ambiguous activation first checks identity and full health.
export async function publishAccepted(a, bytes, { recovery, check, publish, verify }) {
  await check();
  if (await verify()) return { alreadyLive: true };
  await check();
  await publish(bytes);
  if (!await verify()) throw new Error(`live marker mismatch: expected ${a.sha}`);
  return { alreadyLive: false, recovery };
}
async function main() {
  const accepted = JSON.parse(readFileSync('accepted/accepted.json', 'utf8'));
  const bytes = readFileSync('accepted/portal.tgz');
  const expected = { sha: process.env.TARGET_SHA, target: process.env.TARGET, run: process.env.ARTIFACT_RUN, repository: process.env.GITHUB_REPOSITORY };
  assertAccepted(accepted, bytes, expected);
  const recovery = process.env.RECOVERY === 'true';
  const rollback = process.env.ROLLBACK === 'true';
  const origin = await api(`actions/runs/${expected.run}`);
  validateRun(origin, expected.target, expected.sha);
  const publication = recovery ? await api(`actions/runs/${process.env.PUBLICATION_RUN}`) : await api(`actions/runs/${process.env.GITHUB_RUN_ID}`);
  validateRun(publication, expected.target, rollback ? publication.head_sha : expected.sha, { recovery });
  const jobs = (await api(`actions/runs/${expected.run}/jobs?filter=all&per_page=100`)).jobs;
  if (!jobs.some(j => j.name === 'prepare / prepare' && j.conclusion === 'success')) throw new Error('artifact preparation has not succeeded');
  if (recovery) {
    if (process.env.GITHUB_RUN_ATTEMPT !== '1') throw new Error('retry budget exhausted');
    const status = process.env.HAS_STATUS === 'true' ? JSON.parse(readFileSync('publication-status/status.json', 'utf8')) : null;
    if (!retryEvidence(status, expected, accepted.digest, process.env.RUNNER_LOST === 'true')) throw new Error('publication failure is not retryable');
  }
  const temporary = mkdtempSync(join(tmpdir(), 'docs-publish-'));
  const began = Date.now();
  const command = (cmd, args, input) => {
    const r = spawnSync(cmd, args, { input, encoding: input ? undefined : 'utf8', maxBuffer: 16 * 1024 * 1024 });
    if (r.status !== 0) {
      const error = String(r.stderr ?? '');
      const kind = r.status === 255 && /Connection reset by peer|Connection reset by .* port \d+/i.test(error) && !/Permission denied|Host key verification failed|REMOTE HOST IDENTIFICATION/i.test(error) ? 'ssh-reset' : 'fatal';
      throw Object.assign(new Error(`${cmd} failed (exit ${r.status}): ${error}`), { kind });
    }
  };
  try {
    const key = join(temporary, 'key'), known = join(temporary, 'known_hosts');
    if ((!process.env.DEPLOY_KEY && !process.env.DOCS_PASSWORD) || !process.env.KNOWN_HOSTS) throw new Error('protected SSH authentication and pinned known_hosts required');
    writeFileSync(known, process.env.KNOWN_HOSTS + '\n', { mode: 0o600 });
    const options = ['-o', 'StrictHostKeyChecking=yes', '-o', `UserKnownHostsFile=${known}`, '-o', 'ConnectTimeout=15'];
    if (process.env.DEPLOY_KEY) {
      writeFileSync(key, process.env.DEPLOY_KEY + '\n', { mode: 0o600 });
      options.push('-i', key, '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes');
    } else {
      if (expected.target === 'dev') throw new Error('dev forced-command key required');
      const askpass = join(temporary, 'askpass');
      writeFileSync(askpass, '#!/bin/sh\nprintf "%s\\n" "$DOCS_PASSWORD"\n', { mode: 0o700 });
      Object.assign(process.env, { SSH_ASKPASS: askpass, SSH_ASKPASS_REQUIRE: 'force', DISPLAY: 'docs-deploy' });
      options.push('-o', 'BatchMode=no', '-o', 'NumberOfPasswordPrompts=1');
    }
    await publishAccepted(accepted, bytes, {
      recovery,
      check: async () => { if (!rollback) await currentHead(expected.target, expected.sha); },
      verify: () => verifyLive(accepted),
      publish: async archive => {
        if (expected.target === 'dev') command('ssh', [...options, 'universe-dev@82.29.173.47', `deploy docs ${accepted.sha}`], archive);
        else {
          const host = process.env.DOCS_HOST;
          if (!/^[a-zA-Z0-9_.@-]+$/.test(host ?? '') || host.startsWith('-')) throw new Error('invalid protected DOCS_HOST');
          const remote = `/tmp/docs-${accepted.sha}-${accepted.digest}.tgz`;
          command('scp', [...options, 'accepted/portal.tgz', `${host}:${remote}`]);
          command('ssh', [...options, host, 'bash', '-s', '--', accepted.sha, accepted.digest], readFileSync('tooling/deploy/activate.sh'));
        }
      },
    });
    const verified = new Date();
    const order = publication;
    const orderJobs = (await api(`actions/runs/${publication.id}/jobs?filter=all&per_page=100`)).jobs;
    const recoveryRun = recovery ? await api(`actions/runs/${process.env.GITHUB_RUN_ID}`) : null;
    const recoveryJobs = recovery ? (await api(`actions/runs/${process.env.GITHUB_RUN_ID}/jobs?filter=all&per_page=100`)).jobs : [];
    const seconds = (verified - new Date(order.created_at)) / 1000;
    const summary = { original_trigger: order.event, created_at: order.created_at, run_started_at: order.run_started_at,
      artifact_created_at: origin.created_at,
      queue_seconds: queueSeconds(order, orderJobs) + (recovery ? queueSeconds(recoveryRun, recoveryJobs) : 0),
      original_jobs: orderJobs.map(j => ({ name: j.name, started_at: j.started_at, completed_at: j.completed_at })),
      recovery_jobs: recoveryJobs.map(j => ({ name: j.name, started_at: j.started_at, completed_at: j.completed_at })),
      build_seconds: String(publication.id) === accepted.run ? accepted.build.seconds : 0,
      artifact_build_seconds: accepted.build.seconds, build_output_reused: accepted.build.reused,
      publish_seconds: (Date.now() - began) / 1000, recovery, verified_live: verified.toISOString(), deploy_seconds: seconds, sha: accepted.sha };
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\nDocumentation deployment timing\n\n\`\`\`json\n${JSON.stringify(summary, null, 2)}\n\`\`\`\n${seconds > 300 ? 'WARNING: trigger/order to verified live exceeded 300 seconds.\n' : ''}`);
  } catch (e) {
    mkdirSync('publication-status', { recursive: true });
    writeFileSync('publication-status/status.json', JSON.stringify({ run: expected.run, sha: expected.sha, digest: accepted.digest, retry: !recovery && !rollback && retryable(e), kind: e.kind ?? 'fatal' }));
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `\nPublication failed: ${e.kind ?? 'validation/health'}. Original created_at=${origin.created_at}; run_started_at=${origin.run_started_at}; build_seconds=${accepted.build.seconds}; publication_seconds=${(Date.now() - began) / 1000}; elapsed_seconds=${(Date.now() - new Date(origin.created_at)) / 1000}; verified_live=PENDING.\n`);
    throw e;
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
