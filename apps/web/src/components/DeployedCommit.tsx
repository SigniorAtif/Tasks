import { useQuery } from '@tanstack/react-query';
import { healthzQuery } from '../lib/queries.ts';

/**
 * The commit the server was built from, from the public /healthz. The v0.0
 * demo: merge a PR, wait for the deploy, open this and see the new commit.
 */
export function DeployedCommit() {
  const health = useQuery(healthzQuery);

  let text: string;
  if (health.data !== undefined) {
    const sha = health.data.sha;
    // Git's usual 7-character short form; `dev` (run from source) stays as is.
    text = `${/^[0-9a-f]{40}$/.test(sha) ? sha.slice(0, 7) : sha} · database ${health.data.dbOk ? 'ok' : 'down'}`;
  } else if (health.isError) {
    text = 'unavailable';
  } else {
    text = '…';
  }

  return (
    <p className="text-xs text-slate-500 dark:text-slate-400">
      Deployed commit{' '}
      <span className="font-mono" title={health.data?.sha}>
        {text}
      </span>
    </p>
  );
}
