---
name: release
description: Use this skill when the user wants to release a new version of @onurkerem/muninn. Triggers on phrases like "release a new version", "publish to npm", "bump version and release", "create a release", "ship it", "deploy new version", "cut a release". This skill handles the complete release workflow including committing changes, version bumping, git tagging, and triggering CI/CD for npm publishing.
---

# Release Workflow for @onurkerem/muninn

This skill guides the complete release process for the muninn MCP server package.

## Overview

- **Package**: `@onurkerem/muninn`
- **Registry**: npm (scoped package - public)
- **CI/CD**: GitHub Actions with Trusted Publishing (OIDC)
- **Repository**: `onurkerem/muninn`

## Prerequisites

### Trusted Publisher Setup (One-time)

Before your first release, configure Trusted Publishing on npm:

1. Go to https://www.npmjs.com/package/@onurkerem/muninn/settings
2. Scroll to **Trusted Publisher** section
3. Click **GitHub Actions**
4. Configure:
   - **Organization or user**: `onurkerem`
   - **Repository**: `muninn`
   - **Workflow filename**: `release.yml`
   - **Environment name**: (leave empty)
5. Click **Add trusted publisher**

**Benefits of Trusted Publishing:**
- No long-lived tokens to manage or rotate
- Short-lived, cryptographically-signed credentials
- Automatic provenance generation for transparency
- More secure than traditional token-based publishing

## Pre-Release Checklist

Before starting, verify:

- [ ] Build succeeds: `npm run build`
- [ ] No uncommitted changes that shouldn't be released
- [ ] Breaking changes are intentional and documented
- [ ] Trusted publisher is configured on npm (first release only)

## Release Workflow

### Step 1: Check Current State

First, check for uncommitted changes:

```bash
git status
```

If there are **no changes** to commit, skip to Step 3.

If there are **uncommitted changes**, proceed to Step 2.

### Step 2: Commit Changes (if needed)

Stage and commit all changes:

```bash
git add .
git commit -m "<descriptive message about what changed>"
```

**Commit message guidelines:**
- Describe what changed and why
- Use conventional commits style when appropriate:
  - `feat:` for new features
  - `fix:` for bug fixes
  - `docs:` for documentation
  - `refactor:` for code refactoring
  - `chore:` for maintenance tasks

**Important:** Do NOT add agent/LLM attributions to commit messages.

### Step 3: Determine Version Bump

Ask the user which version type is appropriate, or infer from changes:

| Type | When to use | Example |
|------|-------------|---------|
| **patch** | Bug fixes, minor improvements | 0.1.0 → 0.1.1 |
| **minor** | New features, backwards compatible | 0.1.1 → 0.2.0 |
| **major** | Breaking changes | 0.2.0 → 1.0.0 |

**Inference guide:**
- Bug fixes only → `patch`
- New tools/features without breaking changes → `minor`
- Breaking API changes or major refactors → `major`

### Step 4: Bump Version

Run the version bump command:

```bash
npm version <patch|minor|major>
```

This command:
- Updates `version` in package.json
- Creates a git commit with the version bump
- Creates a git tag (e.g., `v0.2.0`)

### Step 5: Push to Trigger Release

Push commits and tags to trigger CI/CD:

```bash
git push && git push --tags
```

### Step 6: Verify CI/CD

After pushing, GitHub Actions will automatically:
1. Build the package
2. Authenticate via OIDC (no token needed)
3. Publish to npm with provenance

Monitor the workflow:

```bash
# Check latest workflow run
gh run list --limit 1

# Watch the workflow in real-time
gh run watch

# View logs if there's an issue
gh run view --log
```

### Step 7: Verify Publication

Once CI completes (usually 1-2 minutes), verify:

```bash
# Check published version
npm view @onurkerem/muninn version

# List all published versions
npm view @onurkerem/muninn versions

# Test the published package
npx @onurkerem/muninn --version
```

## Error Handling

### Uncommitted changes blocking npm version

```bash
# Check what's uncommitted
git status

# Either commit or stash changes
git stash  # temporary
# or
git add . && git commit -m "message"
```

### Push rejected

```bash
# Pull and rebase
git pull --rebase

# Resolve conflicts if any, then
git rebase --continue

# Retry push
git push && git push --tags
```

### CI/CD failure

1. Check logs: `gh run view --log`
2. Common causes:
   - Build errors (TypeScript compilation)
   - Trusted publisher not configured correctly on npm
   - Workflow filename mismatch (must be exactly `release.yml`)
3. Fix the issue locally
4. Create a patch release

**Trusted publisher troubleshooting:**
- Verify workflow filename matches exactly (case-sensitive, with `.yml` extension)
- Ensure using GitHub-hosted runners (not self-hosted)
- Confirm `id-token: write` permission is in the workflow

### Version already exists on npm

```bash
# Check what's published
npm view @onurkerem/muninn versions

# Bump to next version
npm version patch  # or minor/major as appropriate
```

### Authentication errors

If you see "Unable to authenticate":
1. Verify trusted publisher is configured on npmjs.com
2. Check that organization, repository, and workflow filename match exactly
3. Ensure the workflow has `permissions: id-token: write`

## Quick Reference

```bash
# Full release flow (with uncommitted changes)
git add . && git commit -m "feat: add new feature"
npm version minor
git push && git push --tags

# Full release flow (no uncommitted changes)
npm version patch
git push && git push --tags

# Check status
git status && npm run build && gh run list --limit 1
```

## Security Best Practices

After enabling trusted publishing, consider restricting token access on npm:

1. Go to package **Settings** → **Publishing access**
2. Select **"Require two-factor authentication and disallow tokens"**
3. This ensures only OIDC-based publishes are allowed
