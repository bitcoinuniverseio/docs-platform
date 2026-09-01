#!/usr/bin/env node
// Zero-dependency validator for docs.manifest.json.
// Mirrors schemas/docs.manifest.schema.json exactly; any divergence between the
// two is a bug in this file. Runs with bare Node so every repository can call it
// in CI without installing anything.
//
// Usage: node validate-manifest.mjs <manifest.json> [more...]

import { readFileSync } from "node:fs";

const CLASSIFICATIONS = ["product", "product-docs", "protocol", "indexer", "implementation", "infrastructure", "ci", "archive"];
const LIFECYCLES = ["stable", "beta", "experimental", "deprecated", "archived"];
const CHAINS = ["bitcoin", "dogecoin", "zcash"];
const NETWORKS = ["mainnet", "testnet", "testnet4", "signet", "regtest"];
const AUDIENCES = ["user", "collector", "app-developer", "protocol-implementer", "indexer-operator", "infrastructure-operator", "security-verifier"];
const RELATIONSHIPS = ["fork", "port", "mirror", "derived"];
const REQUIRED = ["schemaVersion", "id", "name", "classification", "repository", "documentationUrl", "docsRoot", "sourceRef", "lifecycle", "chains", "audiences", "owners", "securityClassification", "lastVerified"];
const KNOWN_KEYS = new Set([...REQUIRED, "releasedRef", "releaseVersion", "protocols", "specifications", "contracts", "capabilityManifest", "statusSources", "upstream", "redirects", "archived"]);
const CONTRACT_KEYS = ["openapi", "asyncapi", "jsonSchema", "cli", "sdk"];

function validate(m) {
  const errors = [];
  const err = (msg) => errors.push(msg);
  const isStr = (v) => typeof v === "string";
  const isStrArray = (v) => Array.isArray(v) && v.every(isStr);

  if (typeof m !== "object" || m === null || Array.isArray(m)) return ["manifest root must be a JSON object"];

  for (const k of REQUIRED) if (!(k in m)) err(`missing required field: ${k}`);
  for (const k of Object.keys(m)) if (!KNOWN_KEYS.has(k)) err(`unknown field: ${k}`);

  if (m.schemaVersion !== undefined && m.schemaVersion !== 1) err("schemaVersion must be 1");
  if (m.id !== undefined && !(isStr(m.id) && /^[a-z0-9][a-z0-9-]{1,63}$/.test(m.id))) err("id must be lowercase kebab-case, 2-64 chars");
  if (m.name !== undefined && !(isStr(m.name) && m.name.length >= 1 && m.name.length <= 120)) err("name must be a 1-120 char string");
  if (m.classification !== undefined && !CLASSIFICATIONS.includes(m.classification)) err(`classification must be one of: ${CLASSIFICATIONS.join(", ")}`);
  if (m.repository !== undefined && !(isStr(m.repository) && /^bitcoinuniverseio\/[A-Za-z0-9_.-]+$/.test(m.repository))) err("repository must be bitcoinuniverseio/<name>");
  if (m.documentationUrl !== undefined && !(isStr(m.documentationUrl) && /^https:\/\/\S+$/.test(m.documentationUrl))) err("documentationUrl must be an https URL");
  if (m.docsRoot !== undefined && !isStr(m.docsRoot)) err("docsRoot must be a string");
  if (m.sourceRef !== undefined && !(isStr(m.sourceRef) && m.sourceRef.length > 0)) err("sourceRef must be a non-empty string");
  if (m.releasedRef !== undefined && !isStr(m.releasedRef)) err("releasedRef must be a string");
  if (m.releaseVersion !== undefined && !isStr(m.releaseVersion)) err("releaseVersion must be a string");
  if (m.lifecycle !== undefined && !LIFECYCLES.includes(m.lifecycle)) err(`lifecycle must be one of: ${LIFECYCLES.join(", ")}`);

  if (m.chains !== undefined) {
    if (!Array.isArray(m.chains)) err("chains must be an array");
    else m.chains.forEach((c, i) => {
      if (typeof c !== "object" || c === null) return err(`chains[${i}] must be an object`);
      if (!CHAINS.includes(c.chain)) err(`chains[${i}].chain must be one of: ${CHAINS.join(", ")}`);
      if (!Array.isArray(c.networks) || c.networks.length < 1 || !c.networks.every((n) => NETWORKS.includes(n))) err(`chains[${i}].networks must be a non-empty array of: ${NETWORKS.join(", ")}`);
      for (const k of Object.keys(c)) if (!["chain", "networks"].includes(k)) err(`chains[${i}] has unknown field: ${k}`);
    });
  }

  if (m.protocols !== undefined && !(isStrArray(m.protocols) && m.protocols.every((p) => /^[a-z0-9][a-z0-9_-]*$/.test(p)))) err("protocols must be an array of lowercase registry ids (hyphens and underscores allowed)");
  if (m.audiences !== undefined && !(Array.isArray(m.audiences) && m.audiences.length >= 1 && m.audiences.every((a) => AUDIENCES.includes(a)))) err(`audiences must be a non-empty array of: ${AUDIENCES.join(", ")}`);
  if (m.specifications !== undefined && !isStrArray(m.specifications)) err("specifications must be an array of strings");

  if (m.contracts !== undefined) {
    if (typeof m.contracts !== "object" || m.contracts === null || Array.isArray(m.contracts)) err("contracts must be an object");
    else {
      for (const k of Object.keys(m.contracts)) {
        if (!CONTRACT_KEYS.includes(k)) err(`contracts has unknown field: ${k}`);
        else if (!isStrArray(m.contracts[k])) err(`contracts.${k} must be an array of strings`);
      }
    }
  }

  if (m.capabilityManifest !== undefined && !isStr(m.capabilityManifest)) err("capabilityManifest must be a string");
  if (m.statusSources !== undefined && !(isStrArray(m.statusSources) && m.statusSources.every((u) => /^https:\/\/\S+$/.test(u)))) err("statusSources must be an array of https URLs");
  if (m.owners !== undefined && !(isStrArray(m.owners) && m.owners.length >= 1)) err("owners must be a non-empty array of strings");

  if (m.upstream !== undefined) {
    const u = m.upstream;
    if (typeof u !== "object" || u === null) err("upstream must be an object");
    else {
      for (const k of ["project", "url", "license", "relationship"]) if (!(k in u)) err(`upstream missing required field: ${k}`);
      for (const k of Object.keys(u)) if (!["project", "url", "license", "relationship", "divergenceSummary"].includes(k)) err(`upstream has unknown field: ${k}`);
      if (u.relationship !== undefined && !RELATIONSHIPS.includes(u.relationship)) err(`upstream.relationship must be one of: ${RELATIONSHIPS.join(", ")}`);
    }
  }

  if (m.redirects !== undefined) {
    if (!Array.isArray(m.redirects)) err("redirects must be an array");
    else m.redirects.forEach((r, i) => {
      if (typeof r !== "object" || r === null) return err(`redirects[${i}] must be an object`);
      if (!(isStr(r.from) && r.from.startsWith("/"))) err(`redirects[${i}].from must start with /`);
      if (!(isStr(r.to) && r.to.length > 0)) err(`redirects[${i}].to must be a non-empty string`);
      for (const k of Object.keys(r)) if (!["from", "to"].includes(k)) err(`redirects[${i}] has unknown field: ${k}`);
    });
  }

  if (m.lastVerified !== undefined) {
    const v = m.lastVerified;
    if (typeof v !== "object" || v === null) err("lastVerified must be an object");
    else {
      if (!(isStr(v.commit) && /^[0-9a-f]{40}$/.test(v.commit))) err("lastVerified.commit must be a 40-hex commit SHA");
      if (!(isStr(v.timestamp) && !Number.isNaN(Date.parse(v.timestamp)))) err("lastVerified.timestamp must be an ISO date-time");
      for (const k of Object.keys(v)) if (!["commit", "timestamp"].includes(k)) err(`lastVerified has unknown field: ${k}`);
    }
  }

  if (m.securityClassification !== undefined && m.securityClassification !== "public") err('securityClassification must be "public"');

  if (m.lifecycle === "archived") {
    if (m.archived === undefined) err("lifecycle archived requires the archived object");
  }
  if (m.archived !== undefined) {
    const a = m.archived;
    if (typeof a !== "object" || a === null) err("archived must be an object");
    else {
      if (!(isStr(a.date) && /^\d{4}-\d{2}-\d{2}$/.test(a.date))) err("archived.date must be YYYY-MM-DD");
      if (!("replacement" in a) || !(a.replacement === null || isStr(a.replacement))) err("archived.replacement must be a string or null");
      if (a.reason !== undefined && !isStr(a.reason)) err("archived.reason must be a string");
      for (const k of Object.keys(a)) if (!["date", "reason", "replacement"].includes(k)) err(`archived has unknown field: ${k}`);
    }
  }
  if (["stable", "beta", "deprecated"].includes(m.lifecycle)) {
    if (m.releasedRef === undefined) err(`lifecycle ${m.lifecycle} requires releasedRef`);
    if (m.releaseVersion === undefined) err(`lifecycle ${m.lifecycle} requires releaseVersion`);
  }

  return errors;
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: validate-manifest.mjs <docs.manifest.json> [more...]");
  process.exit(2);
}

let failed = false;
for (const file of files) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    console.error(`FAIL ${file}: unreadable or invalid JSON (${e.message})`);
    failed = true;
    continue;
  }
  const errors = validate(parsed);
  if (errors.length === 0) {
    console.log(`OK   ${file} (${parsed.id}, ${parsed.lifecycle})`);
  } else {
    failed = true;
    console.error(`FAIL ${file}:`);
    for (const e of errors) console.error(`  - ${e}`);
  }
}
process.exit(failed ? 1 : 0);

export { validate };
