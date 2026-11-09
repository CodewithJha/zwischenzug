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
- [x] 26 unit tests (timing, sustain, signal loss, fallback, cap, override, escalation)

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
- [x] `PresageProvider` (renderer SDK, PULSE_RATE only, telemetry off, stable + validation gating)
- [x] Validation hints and SDK error -> timer fallback mapping (real "too dark" -> timer, Nov 8)
- [x] Calibration (60 s, median of stable readings, retry / timer-only): real baselines
      80.7 bpm / 60 samples (Nov 7) and 77.3 bpm / 36 samples (Nov 8)
- [x] Live pulse vs baseline on the cooldown screen: real losses unlocked by pulse (Nov 7, 8)
- [x] Diagnostics screen under Settings › Advanced (SDK/key/camera status, session running vs stopped, raw readings, stats)
- [x] `npm run presage:check`: key check without a camera (bad key -> `kAuthenticationFailed`)
- [x] Provider: serialized teardown (shared preload port), camera released on SDK errors
- [x] Run with a real API key on this Mac (Nov 7, 8: calibration, loss -> lock -> pulse unlock)
- [ ] Record time to first reading, readings per second, share of `stable`, start/stop
      latency and credit usage per session (docs/MANUAL_TESTS.md)

## Phase 2 hardening

- [x] Steady clock (system clock changes ignored while running); future start clamped on restore
- [x] Lichess DevTools disabled; focus moved off the hidden Lichess view
- [x] Single instance per data folder; renderer rejections logged
- [x] Log: consecutive losses per game; CSV/JSON export
- [~] Failure cases needing hardware or a key: see docs/MANUAL_TESTS.md

## Phase 3: polish (Nov 7)

- [x] P0: play only with a verified Lichess sign-in as the configured account
      (`/account/info` via the embedded session; logged-out path verified live)
- [~] P0: signed-in / wrong-account paths (sign-in and sign-out verified on real Lichess,
  Nov 8; wrong account and Wi-Fi off unit-tested only, manual test 5)
- [x] P1: cooldown screen redesign: live bpm vs your band, active unlock path (pulse / waiting
      / timer) with the reason, progress rows; screenshots in `docs/screenshots/`
- [x] P2: side panel (identity card, labelled facts, sections), calibration idle/progress states
- [x] P3: app icon (`build/icon.svg`, `npm run icon`), app name, dev dock icon
- [ ] P4: SDK exposes a real breathing rate (`MetricType.BREATHING_RATE`); not wired yet
      because it is unverified on a real face. The fixed 4/6 guide stays, labelled as a guide

## M6: Log, delete-all, restart

- [x] Game log with baseline, pulse at loss, time to unlock, unlock reason
- [x] Delete-all (refused during an active cooldown)
- [x] Restart during cooldown keeps the lock and its timing
- [x] Unsigned macOS package (`npm run dist:dir`) launches and loads the SDK

## Next (in priority order)

1. [~] Presage verified end to end with a key (Nov 7, 8); still tune `calibration.minSamples`,
   `signalTimeoutSec` and `sustainSec` from more real data
2. [ ] Verify camera-denied path (System Settings > Camera off)
3. [ ] Self-experiment: about 30 real games; export the log for the write-up (export ready)
4. [ ] "You after losses" summary (average pulse change, time to unlock) above the log
5. [ ] Breathing-driven visual (SDK breathing trace) instead of the fixed 4/6 animation
6. [~] App icon and cooldown screenshots done; README GIF, demo video
7. [ ] DEV post (template sections incl. Consent and Data Handling)
8. [ ] Signed/notarized DMG (needs Apple Developer identity), or document unsigned run steps
9. [x] MIT license, public README, refined icon; `npm run dev` shows Zwischenzug, not Electron

## Cut line

Drop in this order if behind: breathing visual -> summary stats (keep raw log) -> escalation
suggestion -> config file support (keep env).
Never cut: consent screen, check-in, lock on loss, pulse-band unlock, timer fallback,
override, local log + delete-all, data-handling section.

## Post-challenge

- Chess.com `GameSource` (browser extension or embedded view)
- OAuth `/api/stream/event` as an alternative Lichess source
- Coach mode export (summary only, never video)
