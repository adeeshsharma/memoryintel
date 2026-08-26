## Deployment
Not published to npm yet — see `business/roadmap.md` for that decision. Source is hosted at
https://github.com/adeeshsharma/memory-intel (public); the only way to use this project today is
still from source (clone, build, `npm link`) per README.md's local setup section, since nothing
is published to a package registry.
## Hosting

Not applicable — everything runs locally, per-machine. The dashboard daemon binds to loopback
only and is never exposed beyond the machine it runs on.

## CI/CD
GitHub Actions (`.github/workflows/ci.yml`), 3-OS matrix (ubuntu/windows/macos) on push/PR to
`master` - warranted by real platform-sensitive surface (the daemon's detached-spawn lifecycle,
`O_CREAT|O_EXCL` exclusive-lock files), confirmed rather than assumed: the matrix's first-ever
run caught three real Windows-only bugs on the first try (`assertSafePath`'s containment check
hardcoded a forward slash; the compression git-clean check built an OS-native path and compared
it against git's always-forward-slash porcelain output; a test hardcoded `/bin/sh`). All three
fixed, all three OS jobs green. Required on `master` via branch protection (`strict: true`,
`required_approving_review_count: 0` - single-maintainer project).
