#!/usr/bin/env node
// Generates data/capability-snapshot.json from the Core protocol registry.
//
// Core is a private repository. This generator runs on a machine that has a Core
// checkout, reads the registry module, and emits a public snapshot that records
// the exact Core commit it came from. The portal builds from the committed
// snapshot and never reads Core, so nothing private is needed to build the site.
//
// Usage:
//   node bin/generate-capability-snapshot.mjs --core <path-to-core-checkout> [--ref <sha>]
//
// The generator refuses to write a snapshot containing anything that looks like a
// host, address, credential, or filesystem path. Capability truth is public;
// infrastructure detail is not.

import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'data', 'capability-snapshot.json');
const REGISTRY_RELATIVE = 'backend/packages/ecosystem-contracts/lib/protocols.js';

// Surfaces are the Universe applications a protocol can appear in.
const SURFACE_LABELS = {
  main: 'Core',
  wallet: 'Wallet',
  inscribe: 'Inscribe',
  stampdex: 'StampDEX',
};

// Anything matching these in a published string is a leak, not documentation.
const FORBIDDEN = [
  { name: 'IPv4 address', re: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/ },
  { name: 'URL with host', re: /\bhttps?:\/\/(?!(?:docs\.)?bitcoinuniverse\.io)[^\s"']+/i },
  { name: 'Windows path', re: /\b[A-Za-z]:\\/ },
  { name: 'private hostname', re: /\b[\w-]+\.(?:hstgr\.cloud|local|internal)\b/i },
  { name: 'credential-shaped token', re: /\b(?:ghp_|gho_|AKIA|xox[baprs]-)[A-Za-z0-9]{8,}/ },
  { name: 'password assignment', re: /\b(?:password|passwd|secret|api[_-]?key)\s*[:=]\s*\S/i },
];

function parseArgs(argv) {
  const args = { core: null, ref: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--core') args.core = argv[++i];
    else if (argv[i] === '--ref') args.ref = argv[++i];
  }
  return args;
}

function git(cwd, ...rest) {
  return execFileSync('git', rest, { cwd, encoding: 'utf8' }).trim();
}

// Walks every string in the snapshot and refuses to publish a leak.
function assertPublishable(value, trail = '$') {
  if (typeof value === 'string') {
    for (const rule of FORBIDDEN) {
      if (rule.re.test(value)) {
        throw new Error(
          `Refusing to publish: ${trail} looks like it contains a ${rule.name}.\n  value: ${value}`,
        );
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertPublishable(item, `${trail}[${i}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) assertPublishable(v, `${trail}.${k}`);
  }
}

function buildActionSupport(policy) {
  if (!policy || !policy.capabilities) return null;
  const supported = [];
  const unsupported = [];
  for (const [action, detail] of Object.entries(policy.capabilities)) {
    if (detail.supported) {
      supported.push({ action, mode: detail.mode ?? policy.mode ?? null });
    } else {
      // The reason a thing is not supported is the most useful sentence on the page.
      unsupported.push({ action, reason: detail.reason ?? 'Not supported.' });
    }
  }
  return { supported, unsupported };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const coreRoot = args.core ?? process.env.UNIVERSE_CORE_PATH;
  if (!coreRoot) {
    console.error('error: pass --core <path-to-core-checkout> or set UNIVERSE_CORE_PATH.');
    process.exit(2);
  }
  const registryPath = path.join(coreRoot, REGISTRY_RELATIVE);
  if (!existsSync(registryPath)) {
    console.error(`error: no protocol registry at ${REGISTRY_RELATIVE} under the given Core path.`);
    process.exit(2);
  }

  const require = createRequire(import.meta.url);
  const mod = require(registryPath);
  const caps = mod.PROTOCOL_CAPABILITIES;
  const market = mod.MARKETPLACE_PROTOCOL_REGISTRY;

  const sourceCommit = args.ref ?? git(coreRoot, 'rev-parse', 'HEAD');
  const registryCommit = git(coreRoot, 'log', '-1', '--format=%H', '--', REGISTRY_RELATIVE);
  const registryCommittedAt = git(coreRoot, 'log', '-1', '--format=%cI', '--', REGISTRY_RELATIVE);

  const protocols = {};
  for (const [id, cap] of Object.entries(caps)) {
    const surfaces = {};
    for (const [surface, actions] of Object.entries(cap.actions ?? {})) {
      if (!actions || actions.length === 0) continue;
      surfaces[surface] = { label: SURFACE_LABELS[surface] ?? surface, actions: [...actions] };
    }
    const policy = cap.marketplacePolicy ?? null;
    const registryEntry = market[id] ?? null;

    protocols[id] = {
      id,
      displayName: cap.displayName,
      aliases: [...(cap.aliases ?? [])],
      chain: cap.chain,
      ownershipModel: cap.ownershipModel,
      decimals: cap.decimals,
      addressRoles: [...(cap.addressRoles ?? [])],
      surfaces,
      marketplace: policy
        ? {
            owner: policy.owner ?? null,
            availability: policy.availability,
            mode: policy.mode ?? null,
            featureGate: policy.featureGate ?? null,
            actions: buildActionSupport(policy),
          }
        : null,
      // These four fields are the honest operational picture of a protocol.
      sourceOfTruth: registryEntry?.sourceOfTruth ?? null,
      indexer: registryEntry?.indexer ?? null,
      freshness: registryEntry?.freshness ?? null,
      confirmation: registryEntry?.confirmation ?? null,
      reorg: registryEntry?.reorg ?? null,
    };
  }

  const snapshot = {
    $schema: './capability-snapshot.schema.json',
    description:
      'Protocol capability truth for Bitcoin Universe applications, generated from the Core protocol registry. Support recorded here is what the product code implements; it is not a promise that a protocol is enabled in production, which the status pages report separately.',
    provenance: {
      repository: 'bitcoinuniverseio/core',
      sourcePath: REGISTRY_RELATIVE,
      sourceCommit,
      registryCommit,
      registryCommittedAt,
      generatedBy: 'packages/ecosystem-registry/bin/generate-capability-snapshot.mjs',
    },
    counts: {
      protocols: Object.keys(protocols).length,
      marketplaceProtocols: Object.keys(market).length,
    },
    protocols,
  };

  assertPublishable(snapshot);
  writeFileSync(OUT, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(
    `wrote ${path.relative(process.cwd(), OUT)}: ${snapshot.counts.protocols} protocols from core@${sourceCommit.slice(0, 12)}`,
  );
}

main();
