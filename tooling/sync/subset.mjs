// Shared structural validation for explicit deployment subsets. Default verify
// remains all-source; an empty explicit subset performs no network requests.
export function selectPins(lock, registry, selected) {
  if (lock.schemaVersion !== 1 || !lock.sources || typeof lock.sources !== 'object' || Array.isArray(lock.sources)) throw new Error('invalid lock structure');
  if (!Array.isArray(registry.sources)) throw new Error('invalid registry structure');
  const names = new Set();
  for (const e of registry.sources) {
    if (!/^bitcoinuniverseio\/[A-Za-z0-9_.-]+$/.test(e.repository) || typeof e.sourceRef !== 'string' || !e.sourceRef || names.has(e.repository)) throw new Error('invalid or duplicate registry entry');
    names.add(e.repository);
  }
  const repositories = selected === undefined ? Object.keys(lock.sources) : selected;
  if (!Array.isArray(repositories) || repositories.some(r => typeof r !== 'string')) throw new Error('subset must be an array of repository names');
  return [...new Set(repositories)].map(repository => {
    const entry = lock.sources[repository];
    const registered = registry.sources.find(e => e.repository === repository);
    if (!entry || !registered) throw new Error(`missing selected pin or registry entry: ${repository}`);
    if (!/^[a-f0-9]{40}$/.test(entry.commit) || !/^[a-f0-9]{64}$/.test(entry.manifestSha256) || entry.sourceRef !== registered.sourceRef || typeof entry.docsRoot !== 'string' || !entry.manifestId) throw new Error(`malformed selected pin: ${repository}`);
    return [repository, entry];
  });
}
