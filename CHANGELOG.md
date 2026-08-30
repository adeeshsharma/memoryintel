# Changelog

## [1.1.1](https://github.com/adeeshsharma/memoryintel/compare/memoryintel-v1.1.0...memoryintel-v1.1.1) (2026-08-30)


### Bug Fixes

* spell out the exact TOON update-plan syntax in generated instructions.md ([#6](https://github.com/adeeshsharma/memoryintel/issues/6)) ([5556d32](https://github.com/adeeshsharma/memoryintel/commit/5556d329947479bf7572291af4cf7a21ed4b20e3))

## [1.1.0](https://github.com/adeeshsharma/memoryintel/compare/memoryintel-v1.0.2...memoryintel-v1.1.0) (2026-08-30)


### Features

* memoryintel doctor - refresh generated files on existing projects ([#7](https://github.com/adeeshsharma/memoryintel/issues/7)) ([8be4cdc](https://github.com/adeeshsharma/memoryintel/commit/8be4cdcba2f9422d994004d55460c1c501780928))

## [1.0.2](https://github.com/adeeshsharma/memoryintel/compare/memoryintel-v1.0.1...memoryintel-v1.0.2) (2026-08-30)


### Bug Fixes

* make the agent pointer block a hard checklist, not a soft aside ([#4](https://github.com/adeeshsharma/memoryintel/issues/4)) ([9cf6ef5](https://github.com/adeeshsharma/memoryintel/commit/9cf6ef54d607201d78c62efad805fc803b32599c))

## [1.0.1](https://github.com/adeeshsharma/memoryintel/compare/memoryintel-v1.0.0...memoryintel-v1.0.1) (2026-08-26)


### Bug Fixes

* normalize import's path labels to forward slashes on Windows ([#2](https://github.com/adeeshsharma/memoryintel/issues/2)) ([f5f6d37](https://github.com/adeeshsharma/memoryintel/commit/f5f6d37b2bf34f058992f05260afa1ffb4bc90a2))

## [0.1.2](https://github.com/adeeshsharma/memory-intel/compare/memoryintel-v0.1.1...memoryintel-v0.1.2) (2026-08-23)


### Features

* self-hosted plugin marketplace, replacing --plugin-dir as the primary install path ([#6](https://github.com/adeeshsharma/memory-intel/issues/6)) ([a68ddcd](https://github.com/adeeshsharma/memory-intel/commit/a68ddcd3f82da079783790eb04b862a7683d0f47))

## [0.1.1](https://github.com/adeeshsharma/memory-intel/compare/memoryintel-v0.1.0...memoryintel-v0.1.1) (2026-08-23)


### Features

* add .memoryintel discovery engine ([643154d](https://github.com/adeeshsharma/memory-intel/commit/643154d810454d76d113197836ac571545ca2fef))
* add /memory-intel:init Claude Code plugin command ([723deef](https://github.com/adeeshsharma/memory-intel/commit/723deefd66a3c25bb510f7e6e6ef11d27fc7da64))
* add atomic file writes and a retrying file-based update lock ([87ce5a4](https://github.com/adeeshsharma/memory-intel/commit/87ce5a4f2630c7d1e179d3d84196e844b9b653e4))
* add Claude Code hook adapter with once-only stop nudge ([ff85570](https://github.com/adeeshsharma/memory-intel/commit/ff855705a90eb2e8aae5a1bfb53243a9b775d9f0))
* add createSkillMarkdown, sourced from the CLI's own USAGE text ([99e8bd1](https://github.com/adeeshsharma/memory-intel/commit/99e8bd14a7662111cdf8ca467fd2debd063e2b5f))
* add daemon handle tracking, liveness check, and free-port picker ([080b04a](https://github.com/adeeshsharma/memory-intel/commit/080b04ade17ad4de4dfdab7d9dd7ffcab248e822))
* add daemon start command as the dashboard process entrypoint ([714e93a](https://github.com/adeeshsharma/memory-intel/commit/714e93a8aa9d46d9fe3d21927d74aea2382a72fd))
* add dashboard HTTP server with registry and project routes ([7b624bd](https://github.com/adeeshsharma/memory-intel/commit/7b624bdb69a370e9bb5155d8e80b68b046dc95ba))
* add deterministic markdown section writer with drift-resistant addressing ([7ca8aa7](https://github.com/adeeshsharma/memory-intel/commit/7ca8aa748b03013a81436de6b6d327c5effd3da3))
* add generic pointer-file adapter for Cursor/Codex/Gemini/opencode/pi ([93ddc8e](https://github.com/adeeshsharma/memory-intel/commit/93ddc8e7be9bfa4e15e3fa43c308f5c2ff0e3c1a))
* add global dashboard enable/disable commands ([56c8318](https://github.com/adeeshsharma/memory-intel/commit/56c831863986aac9c18dde9b0008bad6c9c9cc5d))
* add global paths and dashboard enable/disable settings ([f4eb2ab](https://github.com/adeeshsharma/memory-intel/commit/f4eb2ab5215d0ec6d0b93e206fc099be4758157b))
* add global project registry with computed per-tool wiring status ([361d772](https://github.com/adeeshsharma/memory-intel/commit/361d772d1361c34b3d7765a91838859565b891d5))
* add heading normalization, matching, and fuzzy-suggestion utilities ([c0aadc9](https://github.com/adeeshsharma/memory-intel/commit/c0aadc9e3515110024f4e9ccd474a36ad61aba1f))
* add HTML page shell and escaping helper for dashboard views ([6af6fe3](https://github.com/adeeshsharma/memory-intel/commit/6af6fe39a1c3046489d75a85d12416b0b692545f))
* add lazy, self-healing daemon start-up decision and spawn ([dab73ad](https://github.com/adeeshsharma/memory-intel/commit/dab73adca8846199ccde153888cbf568a3bb5ac0))
* add memory-index and event-log persistence helpers ([5b8489a](https://github.com/adeeshsharma/memory-intel/commit/5b8489a4d4288f26a4dd8c15ffbfa6f35121e356))
* add minimal TOON table encode/decode for the update-plan boundary ([8fe3374](https://github.com/adeeshsharma/memory-intel/commit/8fe337411c45ed76a58c63102f5bb49a6fe2458e))
* add path-safety validator restricting update targets to known files ([9e2eb25](https://github.com/adeeshsharma/memory-intel/commit/9e2eb2575cb76c042e59ab7545b3473418014c69))
* add per-file staleness computation from the memory index ([b413f2d](https://github.com/adeeshsharma/memory-intel/commit/b413f2dee1e639a8abbeaef2eb9d4bd08ff418d8))
* add project view with mental model, file browser, and event timeline ([64b4157](https://github.com/adeeshsharma/memory-intel/commit/64b415792dc03ee0d6bbc286c4782cb3a29f8c54))
* add registry landing page view ([ee8b922](https://github.com/adeeshsharma/memory-intel/commit/ee8b922ab6910cdc1758a471e3558967d99b9ebb))
* clear the check-stop nudge marker on a successful update ([12ce3bb](https://github.com/adeeshsharma/memory-intel/commit/12ce3bba084c4058c360cb7e7393be33dd95c104))
* gate kind=compress update rows on the target file being git-clean ([0045df5](https://github.com/adeeshsharma/memory-intel/commit/0045df5771e096be077d76050497763573c5e4a1))
* generate the memory-intel skill, add build pipeline, README, and plugin manifest ([322de55](https://github.com/adeeshsharma/memory-intel/commit/322de55eeb1f1d06aea16136660ed97a51a21000))
* implement init command with seeded starter headings and idempotent re-run ([f571e36](https://github.com/adeeshsharma/memory-intel/commit/f571e36c277cfaf0924526e467984690712d9da4))
* implement load command with always-load and domain-conditional files ([80a4c6a](https://github.com/adeeshsharma/memory-intel/commit/80a4c6a5b58305f4a1f58d5f191fac3940dcd7a2))
* implement status command for human-readable memory debugging ([9adf48c](https://github.com/adeeshsharma/memory-intel/commit/9adf48c2fc3354c0165ff2c690de9de9056ff272))
* implement update command with atomic, lock-guarded plan application ([13e988f](https://github.com/adeeshsharma/memory-intel/commit/13e988f85ef42ee3d81a753ab06cd3a57aa526af))
* move Claude Code hooks to plugin-level hooks.json, eliminate per-project settings.json mutation ([db8a3f7](https://github.com/adeeshsharma/memory-intel/commit/db8a3f767471b10ecff0f2ac5bd2340a64042f61))
* release-please + npm Trusted Publishing, README reflects real npm publish ([#1](https://github.com/adeeshsharma/memory-intel/issues/1)) ([e3ff687](https://github.com/adeeshsharma/memory-intel/commit/e3ff687c96dbc9e78ccccb30599933905efd965a))
* replace inert session-marker booleans with a live git-diff check-stop nudge ([1fe3772](https://github.com/adeeshsharma/memory-intel/commit/1fe37722ae915c1e06eaf7b6cf595a12d256dde2))
* scaffold memoryintel CLI package with command dispatch ([4cbdd0a](https://github.com/adeeshsharma/memory-intel/commit/4cbdd0a7fe88c3198e323100f72c9da6623dd79f))
* surface per-file compression ceiling status in load()'s manifest ([db0ac49](https://github.com/adeeshsharma/memory-intel/commit/db0ac496c8b7168b55daec944c910b481bdb0418))
* wire lazy daemon start and registry upsert into load and update ([b08bd64](https://github.com/adeeshsharma/memory-intel/commit/b08bd64ac254f08f04e6a62430a45760fe1b7820))


### Bug Fixes

* assertSafePath rejected every write on Windows (found by first real CI run) ([78193a9](https://github.com/adeeshsharma/memory-intel/commit/78193a94a9d060ee9f3845c8c82398b33111ba25))
* **cli:** stop truncating piped stdout, and fail with clear errors ([9b5f35a](https://github.com/adeeshsharma/memory-intel/commit/9b5f35a3c58354c6e70f2369c1bcffe7b6b858eb))
* **commands:** scope dedup to appends, harden init adapters, reject unknown actions ([d8ff755](https://github.com/adeeshsharma/memory-intel/commit/d8ff755c228af4cdd46b9d2bb1563800d4f00399))
* compression-row git-clean check always saw every file as clean on Windows ([f161ca3](https://github.com/adeeshsharma/memory-intel/commit/f161ca35be1661984f95b23b6443b950db1d1b44))
* preserve interior blank lines in append and use normalizeHeading in isNearDuplicate ([c111928](https://github.com/adeeshsharma/memory-intel/commit/c11192829b260bd92239c393b2dcf7d9b6177120))
* resolve the check-stop marker to the current diff, not null ([1fc319f](https://github.com/adeeshsharma/memory-intel/commit/1fc319f83327b5e5f3ebbdd1146c4b731cc3e101))
* restore dashboard enable/disable guidance in instructions.md ([c378a32](https://github.com/adeeshsharma/memory-intel/commit/c378a32201a5aa46cf930b7cebdd3e728c43abcd))
* **toon:** parse quoted fields across newlines and validate field counts ([76adf52](https://github.com/adeeshsharma/memory-intel/commit/76adf52343ab806811ba2051cda618e6902d680b))
* **update:** thread per-path content across rows and scope duplicate check to target section ([efcaad1](https://github.com/adeeshsharma/memory-intel/commit/efcaad1ded6b351112841d9f5e0f6ec5eb5f02d2))
