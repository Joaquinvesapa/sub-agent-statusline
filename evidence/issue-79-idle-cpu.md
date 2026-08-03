# Issue #79 Idle CPU Reproduction Evidence

## Pre-Fix Structural Risk

At base SHA `04083a532cfb3386451b069e776c6a1bae20f020`, the production TUI scheduled unconditional one-second maintenance that cloned state and hydrated retained children before determining whether state changed. This deterministically exposed idle work that could scale with retained children and their histories.

Historical benchmark results, instrumentation counts, timings, and commands from the deleted `src/issue-79-idle-cpu.bench.test.ts` and its removed export are pre-fix evidence only. They are obsolete and invalid for attributing current performance.

## Current Regression Guarantees

`src/tui-maintenance.test.ts` proves that terminal-only state performs no fast elapsed work, while reconciliation still runs on its separate maintenance timer. It also proves that a terminal child with a complete token total causes zero status, message, and part reads during maintenance.

Terminal children without complete tokens retain the fallback-read path, and expired terminal children remain prunable while idle.

## Scope Limit

This evidence establishes the pre-fix deterministic structural risk and the current regression guarantees above. It makes no end-to-end OpenCode or JavaScriptCore CPU-percentage claim.

## Review Metadata

- Skill resolution: `paths-injected`
- Loaded: `/home/joaquinvesapa/.claude/skills/judgment-day/SKILL.md`
- Judges were not run, as requested.
