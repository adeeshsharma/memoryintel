## Current Focus
Just pushed to https://github.com/adeeshsharma/memory-intel (public) and wired as `origin`. `package.json` now carries real `repository`/`homepage`/`bugs` fields, and README's placeholder URLs are filled in.

Immediate open items, in order: decide whether to publish to the npm registry or stay
git-clone-only for now; add a LICENSE file (`package.json` currently says `"UNLICENSED"` as an
honest placeholder, not a real license choice); and run one real manual verification pass inside
a live Claude Code session — everything verified so far is automated-test-based (fixtures + the
built binary), not a live session.
