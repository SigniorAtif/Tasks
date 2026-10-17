# CI and CD

> **Builds on:** [[Containers and images]]

What happens automatically between "I opened a pull request" and "the new version is on my phone". The files: `.github/workflows/ci.yml` and `deploy.yml`, walked through in [[Deploy and CI]].

## The two halves

- **CI (continuous integration)**: every pull request is checked on a fresh machine: lint, typecheck, tests, build. If any check is red, GitHub won't let the PR merge (branch protection). A typo can't reach `main`, even late at night before an exam.
- **CD (continuous delivery/deployment)**: every commit that lands on `main` is built into an image and deployed, then checked. Nobody SSHes in and runs commands by hand, so deploys are boring and repeatable.

## GitHub Actions vocabulary

| Word | Meaning | Example |
|---|---|---|
| Workflow | A YAML file in `.github/workflows/` | `ci.yml` |
| Trigger (`on:`) | What starts it | `pull_request`, `push` to `main`, a manual "Run workflow" |
| Job | A group of steps on one fresh machine (a **runner**). Jobs run in parallel unless one `needs` another | `Test core` |
| Step | One command (`run:`) or one reusable **action** (`uses:`) | `pnpm typecheck`; `actions/checkout` |
| Service container | A container started next to a job | Postgres 18 for the API tests |
| Secret | An encrypted value only workflows can read; never printed in logs | `DEPLOY_SSH_KEY` |
| Variable | A plain, non-secret setting | `DEPLOY_ENABLED`, `PUBLIC_URL` |
| `permissions` | What the job's automatic `GITHUB_TOKEN` may do | `contents: read`; `packages: write` only where the image is pushed |
| `concurrency` | Rules for overlapping runs | CI cancels a run when you push again; deploys queue, never cancel |
| Required status check | A job name branch protection insists is green | The five CI job names |

Most of these words in one real job, the one that runs the API and web tests:

*From `.github/workflows/ci.yml` (shortened):*
```yaml
  test-apps:
    name: Test API and web
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    # A real Postgres for the API's integration tests, started before the steps run.
    services:
      postgres:
        image: postgres:18.6@sha256:74935e72241653ca55e0414067e6d8763aceb8a810eb51b452253ec3dcfc4336
        env:
          POSTGRES_USER: tasks
          POSTGRES_PASSWORD: tasks
          POSTGRES_DB: tasks_test
        ports: ["5432:5432"]
        # …
    env:
      TEST_DATABASE_URL: postgres://tasks:tasks@localhost:5432/tasks_test
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        # …
      - run: pnpm install --frozen-lockfile
      # Every package under apps/; core has its own job below.
      - name: API and web tests
        run: pnpm --filter "./apps/*" run test
```

- `test-apps` is the job's id inside the file; `name:` is what GitHub shows, and what branch protection requires to be green.
- `runs-on` picks the fresh machine; `timeout-minutes` kills a stuck run instead of letting it burn 6 hours.
- `services:` starts Postgres before the first step. The password `tasks` isn't a secret: this database lives for a few minutes on a throwaway machine.
- `uses:` steps are reusable actions (pinned, see below); `run:` steps are shell commands. `--frozen-lockfile` makes the install fail if `pnpm-lock.yaml` doesn't match `package.json`, instead of quietly changing it.

The `concurrency` row is worth seeing in both files, because the two workflows want opposite things:

```yaml
# .github/workflows/ci.yml
concurrency:
  group: ci-${{ github.event.pull_request.number }}
  cancel-in-progress: true
# .github/workflows/deploy.yml
concurrency:
  group: deploy
  cancel-in-progress: false
```

CI's group is per PR (`ci-12` for PR #12), so a new push to the same PR cancels the now-outdated run, while other PRs run undisturbed. Deploy has one group for everything and never cancels: a deploy stopped halfway could leave the box between two versions, so a newer one waits its turn instead.

CI runs on `pull_request` only. It used to run on every push to a `release/**` branch as well, but a push to a branch with an open PR fires *both* triggers, and the two runs had different groups (`ci-4` and `ci-refs/heads/release/0.0.1` for PR #4), so neither cancelled the other and every job ran twice. Dropping the push trigger fixed it; the cost is that a release branch without a PR isn't checked until the PR is opened.

## Pinning actions

`uses: actions/checkout@3d3c42e5…  # v7.0.1`. A tag like `v7` can be moved by whoever controls the action's repo, so a hijacked action could steal secrets from every workflow that trusts the tag. A full commit SHA can't be moved. The comment says which release it is, for humans.

## Smoke tests

A **smoke test** is the simplest check that something is alive and is the right version ("turn it on and see if smoke comes out"). Ours asks `/healthz` which commit is running and compares it with the commit just deployed. Two places do it: `deploy.sh`, from inside the box, and the workflow, through the public URL (DNS, Cloudflare, Caddy, API).

## Alternatives

- **Deploy by hand** (`ssh box && git pull && restart`): fine for a weekend, but every deploy is slightly different and nothing stops a broken commit.
- **GitLab CI, CircleCI, Jenkins**: the same ideas. Actions is free for public repos and lives next to the code.
- **Pull-based deploys** (the box polls the registry, as Watchtower does): no SSH key in CI, but no clear "this deploy failed" signal back on the PR.

## Check yourself
- You open a PR with a type error in `apps/web`. Which job goes red, and which steps in that job still run? (Hint: look at the `if:` lines in `ci.yml`.)
- Two PRs are merged a minute apart. What does `concurrency: deploy` with `cancel-in-progress: false` do with the second deploy?
- Why is `packages: write` given to one job only, instead of at the top of `deploy.yml`?
