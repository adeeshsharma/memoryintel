# Memory Intel

## Executive summary

Memory Intel is a persistent project intelligence system for agentic coding and knowledge work environments.

A user initializes Memory Intel once within a project using:

```bash
/memory-intel init
```

After initialization, Memory Intel operates autonomously.

Any agent session that enters a project containing a `.memoryintel` directory should automatically discover, load, maintain, and evolve project knowledge without requiring additional user interaction.

The system acts as a long-term memory layer that survives:

* New chat sessions
* New agent sessions
* Agent handoffs
* Tool changes (Claude Code, Cursor, Codex, Gemini CLI, etc.)

Memory Intel is not a note-taking system.

Memory Intel is a project intelligence system that continuously maintains the agent's understanding of a project and selectively updates project memory based on meaningful changes.

---

# Problem statement

Current AI coding assistants suffer from context loss.

Typical workflow:

```text
Session 1
↓
Agent learns project
↓
Session ends
↓
Session 2
↓
Agent starts from scratch
```

Consequences:

* Repeated onboarding
* Lost architectural context
* Lost business rationale
* Lost implementation decisions
* Inconsistent recommendations
* Wasted tokens

Existing memory-bank solutions partially solve this problem but require manual maintenance and frequent user interaction.

Most systems:

* Store markdown files
* Require explicit update commands
* Depend on users remembering workflows
* Lack intelligent classification of changes
* Lack automatic memory evolution

Memory Intel aims to make project memory autonomous.

---

# Product vision

A user should only need to run:

```bash
/memory-intel init
```

once.

After that:

* Agents automatically discover project memory
* Relevant context is loaded automatically
* Memory is updated automatically
* Context evolves continuously

The user should never need to manually manage project memory.

---

# Core principles

## Principle 1

Memory should be invisible.

Users should not manage memory.

Agents should manage memory.

---

## Principle 2

Memory updates should be selective.

Not every task requires memory updates.

Only meaningful changes should affect memory.

---

## Principle 3

Memory should represent understanding.

Memory should not be a changelog.

Memory should reflect:

* Current understanding
* Decisions
* Objectives
* Progress
* Relationships

---

## Principle 4

Memory should survive tool changes.

Memory Intel should not depend on a specific agent.

It should work across:

* Claude Code
* Cursor
* Gemini CLI
* Codex
* Future agents

---

# User stories

## Story 1

As a developer,

I want to initialize Memory Intel once,

so that future agent sessions understand my project.

---

## Story 2

As a developer,

I want a new session to inherit project context,

so that I do not need to repeatedly explain architecture.

---

## Story 3

As a product manager,

I want project goals and decisions preserved,

so that future sessions maintain strategic alignment.

---

## Story 4

As a researcher,

I want findings and conclusions preserved,

so that future work builds on prior discoveries.

---

# Commands

## Initialize

```bash
/memory-intel init
```

Creates:

```text
.memoryintel/
```

Initializes project memory.

Installs project instructions.

Creates memory templates.

Registers project metadata.

---

## Optional initialization

```bash
/memory-intel init <path>
```

Creates memory store in specified directory.

---

# No additional commands

The following should NOT be required:

```bash
/memory-intel update
/memory-intel sync
/memory-intel save
/memory-intel refresh
```

Memory maintenance must be autonomous.

---

# Memory Intel directory structure

```text
.memoryintel/

├── instructions.md
├── memory-config.json
├── memory-index.json
├── memory-events.jsonl

├── context/
│   ├── projectBrief.md
│   ├── objectives.md
│   ├── activeContext.md
│   ├── decisions.md
│   ├── progress.md
│   ├── learnings.md
│   └── currentMentalModel.md

├── technical/
│   ├── architecture.md
│   ├── techContext.md
│   ├── patterns.md
│   ├── integrations.md
│   └── infrastructure.md

├── business/
│   ├── productContext.md
│   ├── roadmap.md
│   ├── stakeholders.md
│   └── marketContext.md

├── research/
│   ├── findings.md
│   ├── references.md
│   └── hypotheses.md

└── intelligence/
    ├── entities.json
    ├── relationships.json
    └── metadata.json
```

---

# Architecture

## Component 1

Memory Discovery Engine

Responsibilities:

* Detect `.memoryintel`
* Load project instructions
* Load relevant memory
* Determine context requirements

---

## Component 2

Memory Loader

Responsibilities:

* Read project memory
* Determine relevance
* Minimize token usage
* Load only necessary files

---

## Component 3

Change Analyzer

Responsibilities:

* Observe task outputs
* Inspect modified files
* Analyze git changes
* Generate change summaries

Inputs:

* Agent activity
* File modifications
* Git diff
* User requests

Outputs:

* Structured observations

---

## Component 4

Memory Classification Engine

Responsibilities:

Determine:

* Whether memory should be updated
* Which memory files are affected
* Confidence score

Example:

Input:

```text
Implemented JWT refresh tokens.
Created authentication middleware.
```

Output:

```json
{
  "architecture": true,
  "techContext": true,
  "progress": true
}
```

---

## Component 5

Memory Update Planner

Responsibilities:

Generate update plans.

Example:

```json
{
  "file": "architecture.md",
  "action": "append",
  "section": "Authentication",
  "reason": "New JWT refresh architecture introduced"
}
```

Updates should be deterministic.

---

## Component 6

Memory Writer

Responsibilities:

Apply approved updates.

Preserve structure.

Avoid duplication.

Avoid corruption.

---

# Session lifecycle

## Session start

When an agent enters a workspace:

```text
Search for .memoryintel
↓
Load instructions.md
↓
Load currentMentalModel.md
↓
Load activeContext.md
↓
Determine task domain
↓
Load additional context if needed
↓
Begin work
```

---

## Session end

Upon task completion:

```text
Analyze work performed
↓
Determine meaningful changes
↓
Classify memory impact
↓
Generate update plan
↓
Apply updates
↓
Update currentMentalModel.md
```

---

# Context loading strategy

Always load:

```text
currentMentalModel.md
activeContext.md
```

Conditionally load:

Technical task:

```text
architecture.md
techContext.md
patterns.md
```

Business task:

```text
productContext.md
roadmap.md
stakeholders.md
```

Research task:

```text
findings.md
hypotheses.md
```

Goal:

Minimize token consumption.

---

# Memory update rules

## Rule 1

Do not update memory for trivial changes.

Examples:

* Formatting
* Typo fixes
* Linting
* Comment updates

---

## Rule 2

Update memory when project understanding changes.

Examples:

* New architecture
* New feature
* New decision
* New integration
* New roadmap item

---

## Rule 3

Only update affected memory artifacts.

Never rewrite all memory files.

---

## Rule 4

Maintain concise summaries.

Memory should remain useful and readable.

---

# Current Mental Model

This is the most important memory file.

Purpose:

Represent the agent's current understanding of reality.

Example:

```markdown
# Current Mental Model

Authentication migration is 70% complete.

Legacy OAuth remains active.

Customer Portal depends on Auth Service.

Next milestone:
Token rotation rollout.

Current risks:
Backward compatibility concerns.
```

Every session should read this file first.

---

# Event logging

Every meaningful update generates an event.

Example:

```json
{
  "timestamp": "2026-08-20T10:00:00Z",
  "type": "architecture-change",
  "summary": "JWT refresh token architecture introduced",
  "affectedFiles": [
    "src/auth/*"
  ]
}
```

Stored in:

```text
memory-events.jsonl
```

---

# Future roadmap

Semantic retrieval, a knowledge graph, and an MCP server were considered and
dropped — none are needed to solve the problem this tool exists for (agents
restarting from scratch each session), and none are worth building ahead of
that scale actually showing up.

The one real next-phase item: self-compression. As `.memoryintel/` content
files grow, an agent should be able to compress/summarize older material to
keep load-time token cost down, without losing the historic context that
compression would otherwise discard. Design lives in
`docs/superpowers/specs/` once written.

---

# Success metrics

## Adoption

* User runs init once
* No additional commands required

---

## Context continuity

* New sessions achieve project understanding within minutes

---

## Memory quality

* Relevant memory updates
* Minimal noise
* Minimal duplication

---

## Automation

* > 90% of memory maintenance performed automatically

---

# Non-goals

Memory Intel is not:

* A task manager
* A project management system
* A wiki
* A note-taking application
* A document repository

Memory Intel exists to preserve and evolve project understanding across agent sessions.

---

# MVP scope

Included:

* Initialization
* Discovery
* Memory loading
* Change analysis
* Classification
* Selective updates
* Mental model maintenance
* Web dashboard (read-only, single global daemon across projects)

Excluded:

* Vector search
* Knowledge graph
* MCP server
* Multi-project intelligence (cross-project reasoning/correlation — the dashboard's project registry is a listing/health view only, not intelligence)
* Cloud synchronization

These are not deferred to a later version — they're not needed for what this
tool does. Focus stays on a reliable autonomous memory layer, including
keeping that layer's own footprint (token cost, file size) under control as
projects grow.
