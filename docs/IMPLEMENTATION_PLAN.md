# Implementation plan

Deadline: Nov 22, 2026, 11:59 PM PST. Solo entry; all code written from Nov 7, 2026.
Status legend: [x] done and verified, [~] implemented but not verified, [ ] not started.

## M1: Tooling and secure shell

- [x] esbuild bundles (main/preload/renderer), strict TypeScript (node + web configs)
- [x] ESLint (typescript-eslint strict) + Prettier + Vitest
- [x] App window: contextIsolation, sandbox, no nodeIntegration, CSP, navigation blocked
- [x] Lichess `WebContentsView`: own partition, no preload, permissions denied, lichess.org-only navigation
- [x] Smoke mode (`ZZ_SMOKE_DIR`) for scripted verification

## M2: Config, persistence, consent

- [x] Config: defaults <- `zwischenzug.config.json` <- env, validated
- [x] Atomic JSON store, corrupt-file quarantine
- [x] Presage key via env or safeStorage
- [x] Typed IPC with sender validation
- [x] Consent screen (camera / timer-only), Lichess username, side panel

## M3: Cooldown engine

- [x] Pure state machine + unlock rule + derived view
- [x] 23 unit tests (timing, sustain, signal loss, fallback, cap, override, escalation)

## M4: Lichess detection and lock

- [x] Poll `current-game`, stream `/api/stream/game/{id}`, export fallback, 429 backoff
- [x] Parser for both status shapes (tested with real payloads)
- [x] Layer 1: hide Lichess view while locked
- [x] Layer 2: webRequest blocking of seek/challenge/rematch/join and lobby/game sockets
- [x] Cooldown screen: rule, countdowns, breathing prompt, override
- [x] Verified live against lichess.org

## M5: Presage integration

- [x] Main: lazy native load + `bindSmartSpectraIpc`; packaged native path
- [x] Preload: SDK bridge bundled into our sandboxed preload
- [~] `PresageProvider` (renderer SDK, PULSE_RATE only, telemetry off, stable + validation gating)
- [~] Validation hints and SDK error -> timer fallback mapping
- [~] Calibration (60 s, median of stable readings, retry / timer-only)
- [~] Live pulse vs baseline on the cooldown screen
- [x] Diagnostics screen (SDK/key/camera status, REAL SDK vs FALLBACK, raw readings, stats)
- [x] `npm run presage:check`: key check without a camera (bad key -> `kAuthenticationFailed`)
- [x] Provider: serialized teardown (shared preload port), camera released on SDK errors
- [ ] **Run with a real API key on this Mac** (docs/MANUAL_TESTS.md): time to first reading,
      readings per second, share of `stable`, start/stop latency, credit usage per session

## Phase 2 hardening

- [x] Steady clock (system clock changes ignored while running); future start clamped on restore
- [x] Lichess DevTools disabled; focus moved off the hidden Lichess view
- [x] Single instance per data folder; renderer rejections logged
- [x] Log: consecutive losses per game; CSV/JSON export
- [~] Failure cases needing hardware or a key: see docs/MANUAL_TESTS.md

## Phase 3: polish (Nov 7)

- [x] P0: play only with a verified Lichess sign-in as the configured account
      (`/account/info` via the embedded session; logged-out path verified live)
- [~] P0: signed-in / wrong-account paths (unit-tested; manual test 5)

## M6: Log, delete-all, restart

- [x] Game log with baseline, pulse at loss, time to unlock, unlock reason
- [x] Delete-all (refused during an active cooldown)
- [x] Restart during cooldown keeps the lock and its timing
- [x] Unsigned macOS package (`npm run dist:dir`) launches and loads the SDK

## Next (in priority order)

1. [ ] Verify Presage end to end with a key (M5 boxes above); tune `calibration.minSamples`,
       `signalTimeoutSec` and `sustainSec` from real data
2. [ ] Verify camera-denied path (System Settings > Camera off)
3. [ ] Self-experiment: about 30 real games; export the log for the write-up (export ready)
4. [ ] "You after losses" summary (average pulse change, time to unlock) above the log
5. [ ] Breathing-driven visual (SDK breathing trace) instead of the fixed 4/6 animation
6. [ ] App icon, README screenshots/GIF, demo video
7. [ ] DEV post (template sections incl. Consent and Data Handling)
8. [ ] Signed/notarized DMG (needs Apple Developer identity), or document unsigned run steps

## Cut line

Drop in this order if behind: breathing visual -> summary stats (keep raw log) -> escalation
suggestion -> config file support (keep env).
Never cut: consent screen, check-in, lock on loss, pulse-band unlock, timer fallback,
override, local log + delete-all, data-handling section.

## Post-challenge

- Chess.com `GameSource` (browser extension or embedded view)
- OAuth `/api/stream/event` as an alternative Lichess source
- Coach mode export (summary only, never video)
