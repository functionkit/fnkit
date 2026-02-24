# Deploy Pipelines

FnKit supports three methods for automated git-push-to-deploy. Push to your main branch and your function is built, deployed, and health-checked automatically.

## How It Works

### Remote (recommended)

```
git push → bare repo on server → post-receive hook → docker build → deploy → health check
```

No Forgejo, no runner, no workflow files. Just a bare git repo with a deploy hook — the simplest possible git-push-to-deploy. FnKit sets it all up via SSH.

### Forgejo

```
git push → Forgejo runner builds Docker image on host → deploys container → health check
```

The runner has Docker socket access, so it builds and deploys directly on the same machine — no registry needed.

### GitHub

```
git push → GitHub Actions builds image → pushes to GHCR → SSHs to server → pulls and deploys → health check
```

GitHub Actions builds the image in CI, pushes to GitHub Container Registry, then SSHs to your server to pull and deploy.

## Quick Start

The easiest way to set up deployment:

```bash
cd my-function

# Remote deploy (recommended — no Forgejo needed)
fnkit deploy remote --host root@your-server
git add . && git commit -m "deploy" && git push deploy main
```

Or use Forgejo/GitHub Actions:

```bash
# Interactive setup wizard (Forgejo/GitHub)
fnkit deploy setup
```

This checks prerequisites (git, Docker, Dockerfile, remote), generates the workflow file, and prints a checklist of remaining steps.

### Or Generate the Workflow Directly

```bash
# Forgejo (default)
fnkit deploy init

# GitHub Actions
fnkit deploy init --provider github
```

## Remote Deployment

The simplest deploy method — no CI/CD platform needed.

### 1. Set Up Remote Deploy

```bash
fnkit deploy remote --host user@your-server
```

This command:

1. SSHs to your server
2. Creates a bare git repo at `/opt/fnkit/repos/<function>.git`
3. Installs a `post-receive` hook that builds and deploys on push
4. Adds a `deploy` git remote to your local project
5. Saves the host to `.fnkit` for future use

### 2. Push to Deploy

```bash
git add . && git commit -m "deploy" && git push deploy main
```

### What the Hook Does

1. Checks out your code to a temp directory
2. Builds a Docker image tagged `fnkit-fn-<name>:latest`
3. Tags the current image as `:prev` for rollback
4. Stops and removes the existing container
5. Starts a new container on `fnkit-network` with `CACHE_URL` set
6. Runs a health check (waits 3s, checks container is running)
7. On failure: auto-rolls back to the `:prev` image
8. Cleans up temp files and dangling images

### Re-running Setup

Running `fnkit deploy remote` again (with or without `--host`) updates the hook and remote. The host is saved in `.fnkit` so you don't need to pass `--host` every time.

### Requirements

The server needs:
- SSH access (key-based recommended)
- Git installed
- Docker installed and running

### .fnkit Config File

The `--host` is saved to a `.fnkit` file in your project root:

```json
{
  "host": "root@your-server.com"
}
```

Add `.fnkit` to `.gitignore` if you don't want to commit it, or leave it in for team sharing.

## Forgejo Deployment

### 1. Generate the Workflow

```bash
fnkit deploy init
```

Creates `.forgejo/workflows/deploy.yml` in your function project.

### 2. Set Up the Runner

The Forgejo runner executes CI workflows and needs Docker socket access to build and deploy on the host.

```bash
fnkit deploy runner
```

This creates a `fnkit-runner/` directory with:

| File                 | Purpose                                   |
| -------------------- | ----------------------------------------- |
| `docker-compose.yml` | Runner container with Docker socket mount |
| `.env.example`       | Environment variable template             |
| `README.md`          | Setup instructions                        |

### 3. Configure the Runner

On your server:

```bash
cd fnkit-runner
cp .env.example .env
```

Edit `.env` with your values:

| Variable                | Required | Description                                       |
| ----------------------- | -------- | ------------------------------------------------- |
| `FORGEJO_INSTANCE`      | ✅       | Your Forgejo URL (e.g. `https://git.example.com`) |
| `FORGEJO_RUNNER_TOKEN`  | ✅       | Registration token from Forgejo admin             |
| `FORGEJO_RUNNER_NAME`   |          | Runner display name (default: `fnkit-runner`)     |
| `FORGEJO_RUNNER_LABELS` |          | Runner labels (default: `ubuntu-latest:host`)     |

To get a registration token: **Site Administration → Actions → Runners → Create new runner**

### 4. Start the Runner

```bash
docker compose up -d
```

The runner auto-registers with Forgejo on first startup. Registration persists in the `runner-data` volume.

### 5. Enable Actions in Forgejo

**Site Administration → Actions → Enable**

Or add `FORGEJO__actions__ENABLED=true` to your Forgejo service environment variables.

### 6. Push to Deploy

```bash
git add . && git commit -m "deploy" && git push
```

### What the Pipeline Does

1. Checks out your code
2. Builds a Docker image tagged `fnkit-fn-<name>:latest`
3. Tags the current image as `:prev` for rollback
4. Stops and removes the existing container
5. Starts a new container on `fnkit-network` with `CACHE_URL` set
6. Runs a health check (waits 3s, checks container is running)
7. On failure: auto-rolls back to the `:prev` image
8. Cleans up dangling images

## GitHub Deployment

### 1. Generate the Workflow

```bash
fnkit deploy init --provider github
```

Creates `.github/workflows/deploy.yml` in your function project.

### 2. Configure GitHub Secrets

Go to **Settings → Secrets → Actions** in your GitHub repository and add:

| Secret              | Description                                                   |
| ------------------- | ------------------------------------------------------------- |
| `DEPLOY_HOST`       | Remote server IP or hostname                                  |
| `DEPLOY_USER`       | SSH username (e.g. `root`)                                    |
| `DEPLOY_SSH_KEY`    | Private SSH key for the server                                |
| `DEPLOY_GHCR_TOKEN` | GitHub PAT with `read:packages` scope (for pulling on server) |

### 3. Push to Deploy

```bash
git add . && git commit -m "deploy" && git push
```

### What the Pipeline Does

1. Checks out your code
2. Logs in to GitHub Container Registry (GHCR)
3. Builds and pushes the image to `ghcr.io/<owner>/<function>:latest`
4. SSHs to your server
5. Pulls the image, stops the old container, starts the new one
6. Runs a health check
7. Cleans up old images

## Checking Deploy Status

```bash
fnkit deploy status
```

Shows:

- Which pipeline is configured (remote, Forgejo, or GitHub)
- Git remote and last commit
- Uncommitted changes
- Container status (running/stopped, image, deploy timestamp)

## Deploy Labels

Deployed containers are labelled for identification:

| Label            | Value                                                    |
| ---------------- | -------------------------------------------------------- |
| `fnkit.fn`       | `true` — marks this as an fnkit function                 |
| `fnkit.deployed` | ISO timestamp of deployment                              |
| `fnkit.rollback` | `true` — if this is a rolled-back version (Forgejo only) |

---

← [Back to README](../README.md) · [Proxy →](proxy.md) · [Production →](production.md)
