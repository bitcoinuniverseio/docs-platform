import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const bin = join(here, "..", "bin", "sync.mjs");
const registryPath = join(here, "..", "sources.json");

// CLI refuses unknown commands.
let code = 0;
try {
  execFileSync(process.execPath, [bin, "bogus"], { encoding: "utf8" });
} catch (e) {
  code = e.status;
}
assert.equal(code, 2, "unknown command must exit 2");

// Registry is valid and covers the complete public estate exactly once.
const registry = JSON.parse(readFileSync(registryPath, "utf8"));
assert.ok(Array.isArray(registry.sources), "sources must be an array");
assert.equal(registry.sources.length, 40, "registry must pin all 40 public repositories");

// The registry once covered 38 repositories and reported 38 of 38 ingestable,
// which was true but incomplete: the two central repositories named in the
// organization mandate were not in it at all, so the estate was not counting
// itself. These two assertions are why that cannot happen again quietly.
for (const central of ["bitcoinuniverseio/docs-platform", "bitcoinuniverseio/.github"]) {
  assert.ok(
    registry.sources.some((s) => s.repository === central),
    `the registry must track the central repository ${central}`,
  );
}
const names = registry.sources.map((s) => s.repository);
assert.equal(new Set(names).size, names.length, "no duplicate repositories");
for (const s of registry.sources) {
  assert.match(s.repository, /^bitcoinuniverseio\/[A-Za-z0-9_.-]+$/, `bad repository: ${s.repository}`);
  assert.ok(typeof s.sourceRef === "string" && s.sourceRef.length > 0, `bad sourceRef for ${s.repository}`);
}

console.log("sync: all assertions passed");
