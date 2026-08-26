## Overview

Memory Intel is a persistent project-memory system for AI coding agents — full source of truth is
`prd.md` at the repo root. In short: a person initializes it once per project, and from then on
agents load project understanding at session start and selectively update it, without being
asked, across new chats, new sessions, and different tools.
