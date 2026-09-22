# Test Coverage — Current Gap

Status: nc-book-pwa shipped with ZERO test infrastructure. Flagged gap, not accepted baseline.

## Gap
- No vitest, no `@vue/test-utils`, no test script in `package.json`.
- Pure logic (merge, parsing) untested despite being ideal candidates.
- Manual validation only — regressions in sync logic would go undetected.

## Recommended next stage
- Add `vitest` + `@vue/test-utils` (Vite-native, minimal config).
- Priority order:
  1. Progress merge logic — last-write-wins by `updatedAt`, offline queue re-queue.
  2. DAV `PROPFIND` XML parsing — per-entry skip, malformed input, path encoding.
- Both are pure functions → no network/browser harness needed.

## Standard going forward
- Any stage with sync/merge/parse logic must land tests with the feature.
- Target: pure-logic units first; component tests only where state wiring is risky.
