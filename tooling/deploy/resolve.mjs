// Runs from the trusted default branch, never a failed run's checkout.
import { readFileSync, appendFileSync } from 'node:fs';
import { api, currentHead, validateRun } from './github.mjs';
import { download } from './download.mjs';
const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
const recovery = process.argv[2] === 'recovery';
let runId = recovery ? event.workflow_run.id : process.env.ARTIFACT_RUN;
if (!/^\d+$/.test(String(runId))) throw new Error('accepted artifact run ID required');
const publication = await api(`actions/runs/${runId}`);
const target = recovery ? (publication.path === '.github/workflows/dev-deploy.yml' ? 'dev' : 'production') : process.env.SELECT_TARGET ?? 'production';
const sha = recovery ? publication.head_sha : process.env.ROLLBACK_SHA;
if (!/^[a-f0-9]{40}$/.test(sha ?? '')) throw new Error('full target SHA required');
validateRun(publication, target, sha, { recovery });
let intendedArtifact;
if (recovery) {
  if (process.env.GITHUB_RUN_ATTEMPT !== '1') throw new Error('recovery cannot be rerun');
  await currentHead(target, sha);
  const jobs = (await api(`actions/runs/${runId}/jobs?filter=all&per_page=100`)).jobs;
  const publish = jobs.find(j => j.name === 'publish / publish');
  if (!publish || publish.conclusion !== 'failure' || !publish.steps.some(s => s.name === 'Publish accepted bytes' && s.started_at && !['success', 'skipped'].includes(s.conclusion))) throw new Error('failure was not during publication');
  const artifacts = (await api(`actions/runs/${runId}/artifacts?per_page=100`)).artifacts;
  const intentArtifact = artifacts.find(a => a.name === `publication-intent-${runId}-1` && !a.expired);
  if (!intentArtifact) throw new Error('durable publication intent missing');
  await download(String(intentArtifact.id), String(runId), intentArtifact.name, 'publication-intent', ['intent.json']);
  const intent = JSON.parse(readFileSync('publication-intent/intent.json', 'utf8'));
  if (intent.target !== target || intent.sha !== sha || intent.rollback || !/^\d+$/.test(intent.run) || !/^\d+$/.test(intent.artifact)) throw new Error('untrusted publication intent');
  const checkId = publish.check_run_url?.split('/').pop();
  const annotations = checkId ? await api(`check-runs/${checkId}/annotations?per_page=100`) : [];
  const runnerLost = annotations.some(a => /runner.*lost communication|lost communication.*runner/i.test(a.message));
  const status = artifacts.find(a => a.name === `publication-status-${runId}-1` && !a.expired);
  if (!runnerLost && !status) throw new Error('no confirmed retryable publication evidence');
  // Reject classified fatal outcomes in this read-only gate, before a protected
  // publication environment or deployment credentials are requested.
  if (status) {
    await download(String(status.id), String(runId), status.name, 'publication-status', ['status.json']);
    const evidence = JSON.parse(readFileSync('publication-status/status.json', 'utf8'));
    if (evidence.retry !== true || evidence.run !== intent.run || evidence.sha !== sha || !/^[a-f0-9]{64}$/.test(evidence.digest ?? '')) throw new Error('classified publication failure is not retryable');
  }
  appendFileSync(process.env.GITHUB_OUTPUT, `status_id=${status?.id ?? ''}\nstatus_run=${runId}\npublication_run=${runId}\nrunner_lost=${runnerLost}\n`);
  intendedArtifact = intent.artifact;
  runId = intent.run;
}
const origin = await api(`actions/runs/${runId}`);
validateRun(origin, target, sha);
if (!recovery && origin.conclusion !== 'success') throw new Error('redeploy/rollback requires a successful accepted run');
const jobs = (await api(`actions/runs/${runId}/jobs?filter=all&per_page=100`)).jobs;
if (!jobs.some(j => j.name === 'prepare / prepare' && j.conclusion === 'success')) throw new Error('checks/build/accept job not successful');
const artifacts = (await api(`actions/runs/${runId}/artifacts?per_page=100`)).artifacts;
const artifact = artifacts.find(a => a.name === `accepted-${runId}-1` && !a.expired);
if (!artifact || !artifact.digest?.startsWith('sha256:') || (intendedArtifact && String(artifact.id) !== intendedArtifact)) throw new Error('accepted artifact/digest missing, mismatched or expired');
appendFileSync(process.env.GITHUB_OUTPUT, `artifact_id=${artifact.id}\nrun_id=${runId}\nsha=${sha}\ntarget=${target}\n`);
