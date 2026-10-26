// Fail closed on the GitHub artifact archive digest (download-artifact only
// warns on a mismatch). Extract the two known files, never archive paths.
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { api } from './github.mjs';
import { digest } from './cache.mjs';
export async function download(id, run, name, destination, files) {
if (!/^\d+$/.test(id ?? '')) throw new Error('artifact ID required');
const artifact = await api(`actions/artifacts/${id}`);
if (artifact.expired || artifact.name !== name || artifact.workflow_run?.id !== Number(run) || !/^sha256:[a-f0-9]{64}$/.test(artifact.digest ?? '')) throw new Error('artifact provenance invalid');
const response = await fetch(artifact.archive_download_url, { headers: { authorization: `Bearer ${process.env.GH_TOKEN}` }, signal: AbortSignal.timeout(30000) });
if (!response.ok) throw new Error(`artifact download failed: ${response.status}`);
const zip = Buffer.from(await response.arrayBuffer());
if (`sha256:${digest(zip)}` !== artifact.digest) throw new Error('GitHub artifact digest mismatch');
const temporary = mkdtempSync(join(tmpdir(), 'docs-artifact-'));
try {
  const path = join(temporary, 'artifact.zip');
  writeFileSync(path, zip);
  mkdirSync(destination, { recursive: true });
  for (const name of files) {
    const data = execFileSync('unzip', ['-p', path, name], { maxBuffer: 512 * 1024 * 1024 });
    writeFileSync(`${destination}/${name}`, data);
  }
} finally { rmSync(temporary, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const status = process.argv[2] === 'status';
  const run = status ? process.env.STATUS_RUN : process.env.ARTIFACT_RUN;
  await download(status ? process.env.STATUS_ID : process.env.ARTIFACT_ID, run,
    `${status ? 'publication-status' : 'accepted'}-${run}-1`, status ? 'publication-status' : 'accepted',
    status ? ['status.json'] : ['accepted.json', 'portal.tgz']);
}
