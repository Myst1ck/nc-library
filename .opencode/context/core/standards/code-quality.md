# Code Quality — Patterns That Worked

Stage: nc-book-pwa build. Patterns validated in practice; reuse on similar stages.

## Contract-first parallel delegation
- Define shared exports + ownership boundaries BEFORE spawning parallel agents.
- Pin one owner per mutable resource (e.g. IndexedDB schema owned by one module).
- Parallel agents must not both declare the same store/type — duplicate declarations drift.
- Works: 3 agents (oauth, webdav, pdf-engine) built against a frozen interface in one pass.

## Vue / Pinia + third-party proxies
- `markRaw()` any non-reactive class instance stored in Pinia (pdf.js document proxies).
  Vue's deep reactivity wraps proxies and breaks internal identity/`instanceof` checks.
- Store raw doc; derive reactive UI state separately.

## Async race safety
- Identity-check before `Map.delete`: `if (map.get(k) === entry) map.delete(k)`.
- Prevents deleting a newer in-flight write when an older one resolves late.
- Prefer last-write-wins + timestamp over locking for single-user sync.

## Defensive parsing
- Per-entry `try/catch` inside XML/collection parsing loops.
- One malformed entry logs + skips; never aborts the whole listing.

## Input validation
- Reject `.` and `..` path segments for any user-configurable path override.
- Validate per-segment, not just whole string — prevents traversal via nested paths.

## General
- Small pure helpers for merge/parse logic → trivially unit-testable.
- No silent catch: log + continue, or rethrow with context.
