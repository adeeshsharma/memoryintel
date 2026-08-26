# Releasing

Releases are automated with [release-please](https://github.com/googleapis/release-please).
Every push to `master` keeps a Release PR open, proposing the next version from
[Conventional Commits](https://www.conventionalcommits.org/) (`fix:`, `feat:`, `feat!:`/
`BREAKING CHANGE:`, `chore:`, etc.) merged since the last release. Merging that PR tags the
release, builds, tests, and `npm publish`es automatically via npm's
[Trusted Publishing](https://docs.npmjs.com/trusted-publishers/) (OIDC) — no long-lived npm token
stored as a repo secret.

## Ongoing releases

1. Land changes on `master` through PRs (branch protection requires it), using Conventional
   Commit messages.
2. Check the open Release PR any time to see what the next release would contain.
3. Merge it when ready — build, test, and `npm publish --access public` happen automatically in
   `.github/workflows/release-please.yml`.

## One-time bootstrap (already done for this repo)

npm Trusted Publishing cannot perform a package's *first-ever* publish — the package has to exist
on the registry before a Trusted Publisher can be configured for it. This is a one-time, manual
step, never repeated after:

1. `npm login`, then `npm publish --access public` from a clean checkout.
2. Configure the Trusted Publisher on the resulting `npmjs.com` package settings page: GitHub
   Actions, owner `adeeshsharma`, repo `memoryintel`, workflow filename `release-please.yml`
   (just the filename, case-sensitive), action `npm publish`.

## Provenance

This repo is public, so once Trusted Publishing is configured, npm generates a provenance
attestation automatically as part of the OIDC flow — no `--provenance` flag needed or passed.
