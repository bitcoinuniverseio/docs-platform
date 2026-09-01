#!/usr/bin/env node
// Documentation health audit across every repository in the source registry.
//
// Unlike `sync.mjs lock`, this never fails the run on a missing manifest. A
// missing manifest is the finding, not an error: the whole point is to publish a
// standing, honest picture of which repositories are wired into the estate and
// which are not yet.
//
//   audit.mjs            write packages/ecosystem-registry/data/docs-health.json
//   audit.mjs --print    also print a summary table
//
// Auth: uses GH_TOKEN when set.

import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const registryPath = join(here, '..', 'sources.json');
const validatorPath = join(repoRoot, 'packages', 'content-schema', 'bin', 'validate-manifest.mjs');
const outPath = join(repoRoot, 'packages', 'ecosystem-registry', 'data', 'docs-health.json');

const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
const headers = {
  accept: 'application/vnd.github+json',
  'user-agent': 'universe-docs-audit',
  ...(token ? { authorization: `Bearer ${token}` } : {}),
};

async function gh(path) {
  const res = await fetch(`https://api.github.com${path}`, { headers });
  if (!res.ok) throw new Error(`GitHub API ${path} -> ${res.status}`);
  return res.json();
}

async function rawFile(repo, sha, path) {
  const res = await fetch(`https://raw.githubusercontent.com/${repo}/${sha}/${path}`, { headers });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`raw ${path} -> ${res.status}`);
  return res.text();
}

function validateManifestText(repo, text) {
  const tmp = join(here, `.audit-${repo.replace(/[^a-z0-9-]/gi, '_')}.tmp.json`);
  writeFileSync(tmp, text);
  try {
    execFileSync(process.execPath, [validatorPath, tmp], { encoding: 'utf8' });
    return { valid: true, manifest: JSON.parse(text) };
  } catch (error) {
    const detail = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim();
    return { valid: false, error: detail.split('\n').slice(1).join('; ').trim() || 'invalid' };
  } finally {
    rmSync(tmp, { force: true });
  }
}

// Governance files a public documentation repository is expected to carry.
const GOVERNANCE = ['README.md', 'SECURITY.md', 'CONTRIBUTING.md', 'SUPPORT.md'];

async function auditRepository(entry) {
  const { repository, sourceRef } = entry;
  const record = {
    repository,
    sourceRef,
    commit: null,
    commitTimestamp: null,
    manifest: { present: false, valid: false, error: null },
    lifecycle: null,
    classification: null,
    documentationUrl: null,
    releaseVersion: null,
    chains: [],
    audiences: [],
    // Interface contracts and specifications the repository declares it owns.
    // This is what the API and SDK directory is built from, so it is recorded
    // from the manifest rather than assembled by hand on a portal page.
    contracts: { openapi: [], asyncapi: [], jsonSchema: [], cli: [], sdk: [] },
    specifications: [],
    statusSources: [],
    lastVerified: null,
    lastVerifiedAgeDays: null,
    releases: [],
    governance: {},
    machineReadable: {},
    problems: [],
  };

  try {
    const commit = await gh(`/repos/${repository}/commits/${encodeURIComponent(sourceRef)}`);
    record.commit = commit.sha;
    record.commitTimestamp = commit.commit?.committer?.date ?? null;
  } catch (error) {
    record.problems.push(`cannot resolve ${sourceRef}: ${error.message}`);
    return record;
  }

  const manifestText = await rawFile(repository, record.commit, 'docs.manifest.json').catch(
    () => null,
  );
  if (manifestText === null) {
    record.problems.push('no docs.manifest.json, so the portal cannot ingest this repository');
  } else {
    record.manifest.present = true;
    const result = validateManifestText(repository, manifestText);
    record.manifest.valid = result.valid;
    if (!result.valid) {
      record.manifest.error = result.error;
      record.problems.push(`manifest invalid: ${result.error}`);
    } else {
      const m = result.manifest;
      record.lifecycle = m.lifecycle;
      record.classification = m.classification;
      record.documentationUrl = m.documentationUrl;
      record.releaseVersion = m.releaseVersion ?? null;
      record.chains = m.chains ?? [];
      record.audiences = m.audiences ?? [];
      record.specifications = m.specifications ?? [];
      record.statusSources = m.statusSources ?? [];
      for (const kind of Object.keys(record.contracts)) {
        record.contracts[kind] = m.contracts?.[kind] ?? [];
      }
      record.lastVerified = m.lastVerified?.timestamp ?? null;
      if (record.lastVerified) {
        const ageMs = Date.now() - Date.parse(record.lastVerified);
        record.lastVerifiedAgeDays = Math.max(0, Math.round(ageMs / 86_400_000));
      }
    }
  }

  // Recent published releases, for the aggregated changelog. Repositories with
  // no releases are recorded as having none rather than being omitted, because
  // "this project has never cut a release" is itself worth knowing.
  try {
    const releases = await gh(`/repos/${repository}/releases?per_page=5`);
    record.releases = releases.map((release) => ({
      tag: release.tag_name,
      name: release.name,
      publishedAt: release.published_at,
      prerelease: release.prerelease,
      url: release.html_url,
    }));
  } catch {
    record.releases = [];
  }

  // Presence checks only. A file existing is not a claim that it is good.
  //
  // An archived repository is exempt from CONTRIBUTING.md: the repository is
  // frozen, so inviting contributions that cannot be accepted would be worse
  // than the missing file. SECURITY.md and SUPPORT.md still apply, because a
  // reader of frozen documentation may still need to report something.
  const archived = record.lifecycle === 'archived';
  for (const file of GOVERNANCE) {
    const text = await rawFile(repository, record.commit, file).catch(() => null);
    record.governance[file] = text !== null;
    if (text === null && !(archived && file === 'CONTRIBUTING.md')) {
      record.problems.push(`missing ${file}`);
    }
  }
  for (const file of ['llms.txt', 'robots.txt', 'sitemap.xml']) {
    const text = await rawFile(repository, record.commit, file).catch(() => null);
    record.machineReadable[file] = text !== null;
  }

  return record;
}

async function main() {
  const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
  const repositories = [];

  for (const entry of registry.sources) {
    const record = await auditRepository(entry);
    repositories.push(record);
    if (process.argv.includes('--print')) {
      const state = record.manifest.valid
        ? `ok (${record.lifecycle})`
        : record.manifest.present
          ? 'manifest invalid'
          : 'no manifest';
      console.log(`${record.repository.padEnd(46)} ${state}`);
    }
  }

  const ingestable = repositories.filter((r) => r.manifest.valid).length;
  const report = {
    description:
      'Standing documentation health across every repository in the portal source registry. A missing manifest is a finding, not an error: it records that a repository is not yet wired into the estate.',
    generatedBy: 'tooling/sync/bin/audit.mjs',
    generatedAt: new Date().toISOString(),
    summary: {
      total: repositories.length,
      ingestable,
      notIngestable: repositories.length - ingestable,
    },
    repositories,
  };

  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `\nwrote docs-health.json: ${ingestable} of ${repositories.length} repositories are ingestable`,
  );
}

await main();
