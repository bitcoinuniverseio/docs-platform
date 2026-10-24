export async function api(path) {
  const response = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/${path}`, {
    headers: { authorization: `Bearer ${process.env.GH_TOKEN}`, accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`GitHub ${path.split('?')[0]}: ${response.status}`);
  return response.json();
}
export async function currentHead(target, sha) {
  const branch = target === 'dev' ? 'develop' : 'main';
  if ((await api(`git/ref/heads/${branch}`)).object.sha !== sha) throw new Error(`superseded ${branch} SHA`);
}
export function validateRun(run, target, sha, { recovery = false } = {}) {
  const branch = target === 'dev' ? 'develop' : 'main';
  const path = `.github/workflows/${target === 'dev' ? 'dev-deploy' : 'deploy'}.yml`;
  if (run.repository?.full_name !== process.env.GITHUB_REPOSITORY || run.head_repository?.full_name !== process.env.GITHUB_REPOSITORY ||
      run.head_branch !== branch || run.head_sha !== sha || run.path !== path ||
      !['push', 'workflow_dispatch'].includes(run.event) || (target === 'production' && run.event !== 'workflow_dispatch') ||
      run.run_attempt !== 1 || (recovery && (run.conclusion !== 'failure' || run.status !== 'completed'))) throw new Error('untrusted run or exhausted retry budget');
}
