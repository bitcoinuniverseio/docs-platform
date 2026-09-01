import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const bin = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "validate-manifest.mjs");
const dir = mkdtempSync(join(tmpdir(), "manifest-test-"));

function run(manifest) {
  const file = join(dir, "docs.manifest.json");
  writeFileSync(file, JSON.stringify(manifest));
  try {
    execFileSync(process.execPath, [bin, file], { encoding: "utf8" });
    return { ok: true, out: "" };
  } catch (e) {
    return { ok: false, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

const valid = {
  schemaVersion: 1,
  id: "dust-20",
  name: "DUST-20",
  classification: "protocol",
  repository: "bitcoinuniverseio/dust-20",
  documentationUrl: "https://docs.bitcoinuniverse.io/protocols/dust-20/",
  docsRoot: ".",
  sourceRef: "main",
  releasedRef: "v1.0.0",
  releaseVersion: "1.0.0",
  lifecycle: "stable",
  chains: [{ chain: "bitcoin", networks: ["mainnet", "signet"] }],
  protocols: ["dust-20"],
  audiences: ["protocol-implementer", "app-developer"],
  owners: ["bitcoinuniverseio"],
  securityClassification: "public",
  lastVerified: { commit: "a".repeat(40).replace(/a/g, "0"), timestamp: "2026-09-01T00:00:00Z" },
};

let r = run(valid);
assert.ok(r.ok, `valid manifest should pass: ${r.out}`);

r = run({ ...valid, lifecycle: "archived" });
assert.ok(!r.ok && r.out.includes("archived requires"), "archived without archive block must fail");

r = run({ ...valid, lifecycle: "archived", archived: { date: "2026-01-15", replacement: null, reason: "superseded" } });
assert.ok(r.ok, `archived with block should pass: ${r.out}`);

const { releasedRef, releaseVersion, ...rest } = valid;
r = run(rest);
assert.ok(!r.ok && r.out.includes("requires releasedRef"), "stable without releasedRef must fail");

r = run({ ...rest, lifecycle: "experimental" });
assert.ok(r.ok, `experimental without release info should pass: ${r.out}`);

r = run({ ...valid, extraField: true });
assert.ok(!r.ok && r.out.includes("unknown field: extraField"), "unknown field must fail");

r = run({ ...valid, chains: [{ chain: "solana", networks: ["mainnet"] }] });
assert.ok(!r.ok, "unknown chain must fail");

r = run({ ...valid, statusSources: ["http://insecure.example"] });
assert.ok(!r.ok, "non-https status source must fail");

r = run({ ...valid, securityClassification: "internal" });
assert.ok(!r.ok, "non-public security classification must fail");

r = run({ ...valid, lastVerified: { commit: "short", timestamp: "2026-09-01T00:00:00Z" } });
assert.ok(!r.ok, "bad commit SHA must fail");

rmSync(dir, { recursive: true, force: true });
console.log("validate-manifest: all assertions passed");
