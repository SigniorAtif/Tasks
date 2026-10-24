# Secret scanning

> **Builds on:** [[CI and CD]]

How the repo guards against a password or key being committed. The repo is public, so this matters more than usual. The setup is `.gitleaks.toml` plus the `Scan for secrets` job in `.github/workflows/ci.yml`.

## Why history matters

A **secret** is anything that grants access: the Google client secret, the cookie-signing key, a database password, an SSH key. Commit one to a public repo, and bots that watch GitHub can find it within minutes.

Deleting the line in the next commit doesn't help, because the old commit is still in the history and anyone can check it out. That's why the scan reads the **whole history**, not just the latest files. And it's why the real fix for a leaked secret is to **rotate** it (revoke it and make a new one), not to delete it from the code.

## How gitleaks decides

**gitleaks** reads every commit and matches each added line against a list of **rules**:

- **Specific rules** recognise known formats with near certainty: GitHub tokens start with `ghp_`, AWS keys with `AKIA`, private keys with `-----BEGIN … PRIVATE KEY-----`.
- **The generic rule** (`generic-api-key`) guesses: a name like `secret`, `token` or `key`, followed by a value that looks random. "Looks random" is measured by **entropy**: `aaaaaaaa` has low entropy, `x9Kq2vLp…` has high. It's a guess, so it can be wrong.

A wrong guess is a **false positive**. Ours: the API's tests set `BETTER_AUTH_SECRET` to a made-up, random-looking value so the code runs in production mode. A real secret? No. Looks like one? Very much.

## The allowlist

`.gitleaks.toml` keeps every default rule and relaxes exactly one thing: the generic rule is off in `*.test.ts` / `*.test.tsx` files. The specific rules still check test files, so a real GitHub token pasted into a test would still be caught. This was checked by experiment: the same file content was flagged when named `same-content-not-a-test.ts`, and passed when named `dev-session.test.ts`.

*From `.gitleaks.toml` (shortened):*
```toml
[extend]
useDefault = true
# …
[[allowlists]]
description = "Made-up values in test files"
targetRules = ["generic-api-key"]
paths = ['''(^|/)[^/]+\.test\.tsx?$''']
```

- `useDefault = true` starts from gitleaks' full built-in rule list.
- `targetRules` is what keeps the exception narrow: the allowlist applies to the generic rule only, not to every rule.
- `paths` is a regular expression on the file path: any file whose name ends in `.test.ts` or `.test.tsx` (the `x?` makes the `x` optional), in any folder. `'''…'''` is TOML's "raw string", so the backslashes are kept as they are.

The narrower an allowlist, the better. "Ignore the whole `apps/` folder" would hide real mistakes too.

## Where it runs

- **In CI**, on every pull request, over the full history (`fetch-depth: 0`). A leak blocks the merge.
- **Locally**, with the same pinned image and the same config (the command is in `deploy/README.md`), before you push if you're unsure.

The CI job, whole apart from the boilerplate:

*From `.github/workflows/ci.yml` (shortened):*
```yaml
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          # The whole history: a secret deleted in a later commit is still in the old one.
          fetch-depth: 0
          persist-credentials: false
      # …
      - name: gitleaks
        run: >-
          docker run --rm -v "$PWD:/repo"
          zricethezav/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f
          git /repo --redact --verbose --no-banner
```

- `fetch-depth: 0` asks for every commit. Without it, `actions/checkout` fetches only the latest one (a depth of 1).
- `-v "$PWD:/repo"` lets the gitleaks container read the checked-out repo, and `git /repo` scans its git history, not just the files as they are now.
- `--redact` hides the secret's value in the output, so a finding doesn't leak the secret a second time into the public CI log.

## Check yourself
- You commit a real `GOOGLE_CLIENT_SECRET` in `.env.example`, notice, and delete it in the next commit before pushing. Is it safe? What about after pushing?
- Would the allowlist hide a real `ghp_…` GitHub token pasted into a test file? Why not?
- Why does the scan job need `fetch-depth: 0` while the other jobs don't?
