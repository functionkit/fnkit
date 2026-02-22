---
layout: default
title: Deploy Pipelines
nav_order: 9
---

# Deploy Pipelines

FnKit supports automated git-push-to-deploy via **Forgejo Actions** (default) or **GitHub Actions**. Push to your main branch and your function is built, deployed, and health-checked automatically.

## How It Works

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

# Interactive setup wizard
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

| File | Purpose |
|:-----|:--------|
| `docker-compose.yml` | Runner container with Docker socket mount |
| `.env.example` | Environment variable template |
| `README.md` | Setup instructions |

### 3. Configure the Runner

On your server:

```bash
cd fnkit-runner
cp .env.example .env
```

Edit `.env` with your values:

| Variable | Required | Description |
|:---------|:---------|:------------|
| `FORGEJO_INSTANCE` | ✅ | Your Forgejo URL (e.g. `https://git.example.com`) |
| `FORGEJO_RUNNER_TOKEN` | ✅ | Registration token from Forgejo admin |
| `FORGEJO_RUNNER_NAME` | | Runner display name (default: `fnkit-runner`) |
| `FORGEJO_RUNNER_LABELS` | | Runner labels (default: `ubuntu-latest:host`) |

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

| Secret | Description |
|:-------|:------------|
| `DEPLOY_HOST` | Remote server IP or hostname |
| `DEPLOY_USER` | SSH username (e.g. `root`) |
| `DEPLOY_SSH_KEY` | Private SSH key for the server |
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

- Which pipeline is configured (Forgejo or GitHub)
- Git remote and last commit
- Uncommitted changes
- Container status (running/stopped, image, deploy timestamp)

## Deploy Labels

Deployed containers are labelled for identification:

| Label | Value |
|:------|:------|
| `fnkit.fn` | `true` — marks this as an fnkit function |
| `fnkit.deployed` | ISO timestamp of deployment |
| `fnkit.rollback` | `true` — if this is a rolled-back version (Forgejo only) |
