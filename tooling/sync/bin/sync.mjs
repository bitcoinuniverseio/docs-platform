#!/usr/bin/env node
// Pinned-source synchronization for the documentation portal.
//
//   sync.mjs lock     Resolve every source repository's sourceRef to an exact
//                     commit SHA, validate its docs.manifest.json at that SHA,
//                     and write sources.lock.json.
//   sync.mjs fetch    Check out every locked repository at its exact SHA into
//                     sources/checkout/<repo> (never a moving branch).
//   sync.mjs verify   Confirm the lock file is internally valid and that every
//                     pinned manifest still validates.
//
// The registry of repositories lives in tooling/sync/sources.json.
// Auth: uses GH_TOKEN when set (recommended; avoids rate limits).

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const registryPath = join(here, "..", "sources.json");
const lockPath = join(repoRoot, "sources.lock.json");
const checkoutRoot = join(repoRoot, "sources", "checkout");
const validatorPath = join(repoRoot, "packages", "content-schema", "bin", "validate-manifest.mjs");

const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "";

async function gh(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "universe-docs-sync",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

async function rawFile(repo, sha, path) {
  const res = await fetch(`https://raw.githubusercontent.com/${repo}/${sha}/${path}`, {
    headers: { "user-agent": "universe-docs-sync", ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`raw ${repo}@${sha.slice(0, 12)}/${path} -> ${res.status}`);
  return res.text();
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function validateManifestText(repo, text) {
  const tmp = join(here, `.manifest-${repo.replace(/[^a-z0-9-]/gi, "_")}.tmp.json`);
  writeFileSync(tmp, text);
  try {
    execFileSync(process.execPath, [validatorPath, tmp], { encoding: "utf8" });
    return { ok: true, manifest: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: `${e.stdout ?? ""}${e.stderr ?? ""}`.trim() };
  } finally {
    rmSync(tmp, { force: true });
  }
}

async function cmdLock() {
  const registry = readJson(registryPath);
  const previous = existsSync(lockPath) ? readJson(lockPath) : { sources: {} };
  const lock = { schemaVersion: 1, generatedBy: "tooling/sync/bin/sync.mjs", sources: {} };
  let failures = 0;

  for (const entry of registry.sources) {
    const { repository, sourceRef } = entry;
    try {
      const commit = await gh(`/repos/${repository}/commits/${encodeURIComponent(sourceRef)}`);
      const sha = commit.sha;
      const manifestText = await rawFile(repository, sha, "docs.manifest.json");
      if (manifestText === null) throw new Error("docs.manifest.json missing at pinned commit");
      const result = validateManifestText(repository, manifestText);
      if (!result.ok) throw new Error(`manifest invalid:\n${result.error}`);
      lock.sources[repository] = {
        sourceRef,
        commit: sha,
        commitTimestamp: commit.commit?.committer?.date ?? null,
        manifestSha256: createHash("sha256").update(manifestText).digest("hex"),
        manifestId: result.manifest.id,
        lifecycle: result.manifest.lifecycle,
        docsRoot: result.manifest.docsRoot,
      };
      const prev = previous.sources?.[repository];
      const marker = !prev ? "NEW" : prev.commit === sha ? "unchanged" : `updated ${prev.commit.slice(0, 12)} -> ${sha.slice(0, 12)}`;
      console.log(`lock ${repository} @ ${sha.slice(0, 12)} (${marker})`);
    } catch (e) {
      failures++;
      console.error(`FAIL ${repository}: ${e.message}`);
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} source(s) failed; lock file NOT written.`);
    process.exit(1);
  }
  writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n");
  console.log(`\nwrote ${lockPath} with ${Object.keys(lock.sources).length} pinned sources`);
}

function cmdFetch() {
  const lock = readJson(lockPath);
  mkdirSync(checkoutRoot, { recursive: true });
  let failures = 0;
  for (const [repository, entry] of Object.entries(lock.sources)) {
    const dest = join(checkoutRoot, repository.split("/")[1]);
    try {
      if (!existsSync(join(dest, ".git"))) {
        rmSync(dest, { recursive: true, force: true });
        execFileSync("git", ["init", "-q", dest], { encoding: "utf8" });
        const url = token
          ? `https://x-access-token:${token}@github.com/${repository}.git`
          : `https://github.com/${repository}.git`;
        execFileSync("git", ["-C", dest, "remote", "add", "origin", url], { encoding: "utf8" });
      }
      execFileSync("git", ["-C", dest, "fetch", "-q", "--depth", "1", "origin", entry.commit], { encoding: "utf8" });
      execFileSync("git", ["-C", dest, "checkout", "-q", "--detach", entry.commit], { encoding: "utf8" });
      const head = execFileSync("git", ["-C", dest, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
      if (head !== entry.commit) throw new Error(`checkout mismatch: ${head}`);
      console.log(`fetch ${repository} @ ${entry.commit.slice(0, 12)} ok`);
    } catch (e) {
      failures++;
      console.error(`FAIL ${repository}: ${e.message}`);
    }
  }
  if (failures > 0) process.exit(1);
}

async function cmdVerify() {
  const lock = readJson(lockPath);
  let failures = 0;
  if (lock.schemaVersion !== 1) {
    console.error("lock schemaVersion must be 1");
    process.exit(1);
  }
  for (const [repository, entry] of Object.entries(lock.sources)) {
    try {
      if (!/^[0-9a-f]{40}$/.test(entry.commit)) throw new Error("commit is not a 40-hex SHA");
      const manifestText = await rawFile(repository, entry.commit, "docs.manifest.json");
      if (manifestText === null) throw new Error("manifest missing at pinned commit");
      const digest = createHash("sha256").update(manifestText).digest("hex");
      if (digest !== entry.manifestSha256) throw new Error("manifest hash mismatch against lock");
      const result = validateManifestText(repository, manifestText);
      if (!result.ok) throw new Error(`manifest invalid:\n${result.error}`);
      console.log(`verify ${repository} @ ${entry.commit.slice(0, 12)} ok`);
    } catch (e) {
      failures++;
      console.error(`FAIL ${repository}: ${e.message}`);
    }
  }
  if (failures > 0) process.exit(1);
  console.log(`\nverified ${Object.keys(lock.sources).length} pinned sources`);
}

const cmd = process.argv[2];
if (cmd === "lock") await cmdLock();
else if (cmd === "fetch") cmdFetch();
else if (cmd === "verify") await cmdVerify();
else {
  console.error("usage: sync.mjs <lock|fetch|verify>");
  process.exit(2);
}
