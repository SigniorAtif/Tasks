# Deploying

How a commit on `main` becomes the app at <https://tasks.ahmedatif.in>, and the one-time
setup only you can do. Once set up, deploying is automatic: merge a PR, and about three
minutes later `/healthz` reports the new commit.

| File | What it is |
|---|---|
| `../Dockerfile`, `../.dockerignore` | Builds the image: the API plus the built PWA, which the API serves |
| `compose.prod.yaml` | The stack on the box: Caddy, the API, Postgres, and a one-off `migrate` |
| `Caddyfile` | HTTPS and forwarding to the API; trusts Cloudflare's visitor-IP header |
| `deploy.sh` | Runs on the box: pull, dump the database, migrate, swap, check, roll back on failure |
| `env.example` | Template for the box's `~/tasks/.env` (every setting, with comments) |
| `../.github/workflows/ci.yml` | Checks on every pull request |
| `../.github/workflows/deploy.yml` | On `main`: build and push the image, then deploy it |

## One-time setup, in order

### 1. Google sign-in client

1. <https://console.cloud.google.com> → create a project named `tasks`.
2. **Google Auth Platform → Branding**: app name `Tasks`, your email as support and
   developer contact. **Audience**: External; leave it in *Testing* and add yourself under
   *Test users* (only listed test users can sign in, a second allowlist for free).
3. **Clients → Create client → Web application**:
   - Authorised JavaScript origins: `https://tasks.ahmedatif.in`
   - Authorised redirect URIs: `https://tasks.ahmedatif.in/api/auth/callback/google`
     (add `http://localhost:5173/api/auth/callback/google` too, for development)
4. Keep the client ID and secret for step 4 (and your local `.env`).

### 2. Get a box

- **Oracle Cloud Always Free, one evening at most.** Sign up with the home region
  *India South (Hyderabad)* or *India West (Mumbai)*; free resources exist only in the home
  region, and it can't be changed later. Create an instance: Ubuntu 24.04, shape
  `VM.Standard.A1.Flex` (Ampere, arm64), 2 OCPU and 12 GB. If it says "out of host
  capacity", try another availability domain, or again later that evening. Set a budget
  alert of ₹1 on the account.
- **Otherwise** buy a 2 GB VPS in Mumbai, Bangalore or Delhi with Ubuntu 24.04.

The image is built for both arm64 and x86, so either works. Note the box's public IP.

### 3. Set up the host

SSH in as the provider's default user (`ubuntu` on Oracle), then:

```sh
sudo apt update && sudo apt full-upgrade -y

# Docker Engine and the compose plugin, from Docker's own apt repository
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt update && sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# A 2 GB swap file, so a memory spike slows things down instead of killing Postgres
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# The user GitHub Actions logs in as. Being in the docker group makes it as powerful as
# root on this box, so its key lives only in GitHub's secrets.
sudo adduser --disabled-password --gecos "" deploy
sudo usermod -aG docker deploy
sudo install -d -m 700 -o deploy -g deploy /home/deploy/.ssh /home/deploy/tasks
```

On **your laptop**, make the deploy key and send its public half to the box:

```sh
ssh-keygen -t ed25519 -N "" -C "tasks deploy (GitHub Actions)" -f ~/.ssh/tasks_deploy
ssh ubuntu@BOX_IP "sudo tee /home/deploy/.ssh/authorized_keys" < ~/.ssh/tasks_deploy.pub
ssh ubuntu@BOX_IP "sudo chown deploy:deploy /home/deploy/.ssh/authorized_keys && sudo chmod 600 /home/deploy/.ssh/authorized_keys"
ssh -i ~/.ssh/tasks_deploy deploy@BOX_IP docker ps   # must work before going on
```

Back on the box, allow SSH keys only (keep your current session open until a new login works):

```sh
printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin no\n' \
  | sudo tee /etc/ssh/sshd_config.d/10-keys-only.conf
sudo systemctl reload ssh
```

**Firewall: open 22, 80 and 443 (443 over UDP too, for HTTP/3), nothing else.**

- *A regular VPS:*
  ```sh
  sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw allow 443/udp
  sudo ufw enable
  ```
- *Oracle:* two firewalls, and both must allow the traffic.
  1. Console → your instance's VCN → *Security Lists* → Default → add ingress rules from
     `0.0.0.0/0`: TCP 80, TCP 443, UDP 443.
  2. The Ubuntu image ships its own iptables rules that reject everything except SSH (don't
     install ufw on top; the two fight over the same rules). Add the ports above the
     final `REJECT` line and save:
     ```sh
     sudo iptables -L INPUT --line-numbers            # find the REJECT line, say it's 5
     sudo iptables -I INPUT 5 -p tcp --dport 80 -m state --state NEW -j ACCEPT
     sudo iptables -I INPUT 5 -p tcp --dport 443 -m state --state NEW -j ACCEPT
     sudo iptables -I INPUT 5 -p udp --dport 443 -j ACCEPT
     sudo netfilter-persistent save
     ```

A firewall like ufw does **not** filter ports that Docker publishes; Docker writes its own
rules ahead of it. That's why only Caddy publishes ports and Postgres never does.

### 4. The box's settings file

From the repo on your laptop: `scp -i ~/.ssh/tasks_deploy deploy/env.example deploy@BOX_IP:tasks/`.
Then on the box:

```sh
sudo -iu deploy
cd ~/tasks
cp env.example .env && chmod 600 .env
openssl rand -hex 32      # → POSTGRES_PASSWORD, and the same value inside DATABASE_URL
openssl rand -base64 32   # → BETTER_AUTH_SECRET
nano .env                 # fill in those, the Google client and AUTH_ALLOWED_EMAILS
```

Leave `TAG` empty; `deploy.sh` fills it in. Keep a copy of `.env` in your password manager:
it's the only thing on the box that isn't in git.

### 5. Cloudflare DNS

1. **DNS → Add record**: type `A`, name `tasks`, the box's IPv4 (plus an `AAAA` record if
   it has IPv6). Proxy status **DNS only** (grey cloud) for now.
2. **SSL/TLS → Overview**: *Full (strict)*. Never *Flexible*: it would send your traffic to
   the box unencrypted.
3. **SSL/TLS → Edge Certificates**: Minimum TLS 1.2. Leave *Always Use HTTPS* **off**: Caddy
   already redirects HTTP to HTTPS, and leaving it off keeps Let's Encrypt's plain-HTTP
   renewal check able to reach Caddy through Cloudflare.
4. **Security → Bots**: *Bot Fight Mode* off (it would challenge the future CLI and git hook).

Why grey first: in *Full (strict)* Cloudflare insists on a valid certificate on the box,
and Caddy can only get one after Let's Encrypt has reached it. Step 9 turns the proxy on.

### 6. Let the box pull the image

The first merge to `main` pushes `ghcr.io/signioratif/tasks`. New packages start private.
Either:

- **Make it public** (simplest; the repo is public and `.dockerignore` keeps `private/`,
  `vault/` and `.env` files out of every image): github.com → your profile → *Packages* →
  `tasks` → *Package settings* → *Change visibility* → Public. Or,
- keep it private and, on the box as `deploy`: `docker login ghcr.io -u SigniorAtif` with a
  classic token that has only the `read:packages` scope.

### 7. GitHub secrets and variables

Repository → *Settings → Secrets and variables → Actions*. With the GitHub CLI, from the
repo on your laptop:

```sh
gh secret set DEPLOY_HOST --body BOX_IP            # the IP: tasks.ahmedatif.in points at Cloudflare, which doesn't carry SSH
gh secret set DEPLOY_USER --body deploy
gh secret set DEPLOY_SSH_KEY < ~/.ssh/tasks_deploy
gh secret set DEPLOY_KNOWN_HOSTS --body "$(ssh-keyscan -t ed25519 BOX_IP)"
gh variable set PUBLIC_URL --body https://tasks.ahmedatif.in   # optional, this is the default
```

Check the scanned host key is really your box's: `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`
on the box must print the same fingerprint as `ssh-keyscan -t ed25519 BOX_IP | ssh-keygen -lf -`.

### 8. Protect `main`

*Settings → Rules → Rulesets → New branch ruleset*, target `main`: require a pull request,
block force pushes, and **require status checks** (they're offered once CI has run once):

- `Lint, typecheck and build`
- `Test API and web`
- `Test core`
- `Scan for secrets`
- `Build and boot the image`

### 9. First deploy

1. `gh variable set DEPLOY_ENABLED --body true`
2. Actions → *Deploy* → *Run workflow* (or merge any PR).
3. On the box, watch it: `cd ~/tasks && docker compose -f compose.prod.yaml logs -f caddy api`.
   Caddy logs `certificate obtained successfully` within a minute.
4. Check: `curl -s https://tasks.ahmedatif.in/healthz` → `{"sha":"<commit>","dbOk":true,…}`,
   where `<commit>` matches `git rev-parse origin/main`.
5. In Cloudflare, switch the `tasks` record to **Proxied** (orange cloud) and check `/healthz`
   again. From now on, visitors only ever see Cloudflare.
6. Sign in on your phone and install the PWA.

## Day to day

**Deploy:** merge to `main`. The *Deploy* run is green when the public `/healthz` reports the
new commit.

**See what's running:** `curl -s https://tasks.ahmedatif.in/healthz`; on the box,
`docker compose -f compose.prod.yaml ps` and `cat deploy-history.log`.

**Roll back:** if a deploy fails its checks, `deploy.sh` already put the previous version
back (the run is red and says so). To go back to an older commit by hand:
`ssh deploy@BOX_IP ./tasks/deploy.sh <older-sha>` (past ones are in `deploy-history.log`).
That's always safe because migrations only ever add to the schema; the usual way, though,
is to revert the commit on `main` and let it deploy.

**Pre-deploy dumps:** every deploy first writes
`~/tasks/backups/tasks-<UTC time>-before-<sha>.sql.gz`; the newest 10 are kept. They live
only on the box. To restore one (it holds the schema of the commit that ran *before* `<sha>`):

```sh
cd ~/tasks
docker compose -f compose.prod.yaml stop api
docker compose -f compose.prod.yaml exec -T db dropdb --username=tasks --force tasks
docker compose -f compose.prod.yaml exec -T db createdb --username=tasks tasks
gunzip -c backups/FILE.sql.gz | docker compose -f compose.prod.yaml exec -T db psql --username=tasks --dbname=tasks --quiet --set ON_ERROR_STOP=1
./deploy.sh <the sha that ran before, from deploy-history.log>
```

## The production stack on a laptop

The same files run locally over plain HTTP, which is how the stack is tested before a box
exists. From the repo root:

```sh
docker build --build-arg GIT_SHA=local -t tasks-local:local .
cp deploy/env.example deploy/.env     # git-ignored
# in deploy/.env: IMAGE=tasks-local  SITE_ADDRESS=http://localhost  HTTP_PORT=8080
#   HTTPS_PORT=8443  BETTER_AUTH_URL=http://localhost:8080, plus the passwords and secrets
deploy/deploy.sh local                 # the tag must equal the GIT_SHA you built with
curl -s http://localhost:8080/healthz
docker compose -f deploy/compose.prod.yaml down     # add -v to delete its database too
```

## Checking changes to these files

From the repo root (gitleaks needs a normal checkout, not a `git worktree`):

```sh
docker run --rm -v "$PWD:/mnt" koalaman/shellcheck:stable deploy/deploy.sh
docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.12
docker run --rm -v "$PWD/deploy/Caddyfile:/etc/caddy/Caddyfile:ro" -e SITE_ADDRESS=http://localhost caddy:2.11.7 caddy validate --config /etc/caddy/Caddyfile
docker compose -f deploy/compose.prod.yaml config --quiet     # needs deploy/.env
docker run --rm -v "$PWD:/repo" zricethezav/gitleaks:v8.30.1 git /repo --redact
```

## Deliberately later

- **Off-box backups** (v0.3, D-065): a nightly `pg_dump` encrypted with `age`, sent to
  Cloudflare R2, plus one timed restore drill written up in JOURNEY. Until then, the
  pre-deploy dumps above are the only backups, and they die with the box.
- **Only Cloudflare may reach 80/443**: restrict those ports to Cloudflare's IP ranges in
  the provider firewall, so nobody can bypass it by finding the box's IP.
- **A narrower deploy key**: a `command=` restriction in `authorized_keys`, so a leaked key
  can only run the deploy, not open a shell.
- **Automatic update PRs** (Dependabot or Renovate) for the pinned image digests and action
  SHAs, which otherwise stay put until edited by hand.
- **Staging and a manual promote to production** (v2, D-066).
