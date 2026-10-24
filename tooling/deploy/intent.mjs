import { mkdirSync, writeFileSync } from 'node:fs';
const { TARGET, TARGET_SHA, ARTIFACT_RUN, ARTIFACT_ID, ROLLBACK } = process.env;
if (!['dev', 'production'].includes(TARGET) || !/^[a-f0-9]{40}$/.test(TARGET_SHA ?? '') || !/^\d+$/.test(ARTIFACT_RUN ?? '') || !/^\d+$/.test(ARTIFACT_ID ?? '')) throw new Error('invalid publication intent');
mkdirSync('publication-intent', { recursive: true });
writeFileSync('publication-intent/intent.json', JSON.stringify({ target: TARGET, sha: TARGET_SHA, run: ARTIFACT_RUN, artifact: ARTIFACT_ID, rollback: ROLLBACK === 'true' }));
