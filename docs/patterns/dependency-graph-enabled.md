# Pattern: Dependency Graph enabled for dependency-review CI

## What this records

The `dependency-review` GitHub Actions job (in `.github/workflows/security.yml`) requires the GitHub Dependency Graph feature to be active on the repository. On public repositories this feature is available at no cost and is independent of GitHub Advanced Security (GHAS).

## How it was enabled

The Dependency Graph was enabled on 2026-05-24 via the GitHub REST API:

1. Set vulnerability alerts on the repository:

   `gh api -X PATCH "/repos/timdixon82/sophies-escape-witchs-castle" --field has_vulnerability_alerts=true`

2. Enable vulnerability alerts (Dependency Graph trigger):

   `gh api -X PUT "/repos/timdixon82/sophies-escape-witchs-castle/vulnerability-alerts"`

Both calls returned success (200 and 204 respectively). No GitHub Advanced Security licence is required for public repositories.

## Why this matters

The `actions/dependency-review-action` reads the GitHub Dependency Graph to compare dependency changes between the base and head commits of a pull request. If the graph is not populated, the action fails with a message about the feature not being enabled. Enabling vulnerability alerts causes GitHub to build and maintain the graph automatically from `package-lock.json` and similar lock files.

## Cross-cutting note

This is the same class of issue as the team-repo secret-scanning exception. For any new public repository, enable vulnerability alerts via the API at repository creation time to avoid a failing `dependency-review` job on the first pull request.

## Status

- State: Active
