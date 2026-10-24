import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync, statSync, mkdirSync, rmSync, cpSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { shipped } from './scope.mjs';
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function fingerprint(entries, environment) {
  return digest(JSON.stringify([environment, entries.slice().sort((a,b) => a[0].localeCompare(b[0]))]));
}
export function tracked() {
  return execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
}
export function buildKey(environment) {
  const files = tracked().filter(f => shipped(f) && existsSync(f));
  // lastUpdated is rendered from Git history, so identical text with different
  // content commit dates is a distinct build input.
  const history = execFileSync('git', ['log', '-1', '--format=%H:%cI', '--', 'apps/portal/src/content'], { encoding: 'utf8' });
  return fingerprint(files.map(f => [f, digest(readFileSync(f))]), { ...environment, history, version: 1 });
}
export function checksums(root, prefix = '') {
  return Object.fromEntries(readdirSync(join(root, prefix)).sort().flatMap(name => {
    const rel = prefix ? `${prefix}/${name}` : name;
    const full = join(root, rel);
    return statSync(full).isDirectory() ? Object.entries(checksums(root, rel)) : [[rel, digest(readFileSync(full))]];
  }));
}
export function validOutput(root, expected) {
  if (!existsSync(root)) return false;
  return JSON.stringify(checksums(root)) === JSON.stringify(expected);
}
export function restoreOutput(cache, output, key) {
  const path = join(cache, 'record.json');
  let record;
  try { record = JSON.parse(readFileSync(path, 'utf8')); } catch { return false; }
  if (record.key !== key || !validOutput(join(cache, 'dist'), record.files)) return false;
  rmSync(output, { recursive: true, force: true });
  cpSync(join(cache, 'dist'), output, { recursive: true });
  return true;
}
export function saveOutput(cache, output, key) {
  mkdirSync(cache, { recursive: true });
  rmSync(join(cache, 'dist'), { recursive: true, force: true });
  cpSync(output, join(cache, 'dist'), { recursive: true });
  writeFileSync(join(cache, 'record.json'), JSON.stringify({ key, files: checksums(output) }));
}
