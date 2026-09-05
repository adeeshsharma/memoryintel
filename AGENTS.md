# Project Instructions

<!-- memoryintel:managed:start -->
This project uses Memory Intel (`.memoryintel/`) for persistent, cross-session project memory.
Read `.memoryintel/instructions.md` for the full mechanism. Two hard requirements, not optional
background context:

1. **Session start:** run `memoryintel load` before doing anything else and treat its output as
   real project context, not a formality to skip past.
2. **Before ending any task that changed project understanding** (new architecture, feature,
   decision, integration, or roadmap item — not formatting/typos): draft an update-plan and run
   `memoryintel update <plan-file>`. This applies even in a long session covering many sub-tasks —
   that is exactly when it is easiest to reach the end and have forgotten this step was ever
   pending. If nothing meaningful changed, skip it; do not skip it just because the task grew long.

Tell the user when you do this — do not do it silently.
<!-- memoryintel:managed:end -->
