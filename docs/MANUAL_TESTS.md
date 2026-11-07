# Manual tests

Steps that need a Presage key, a camera or a person in front of it. Everything else is
covered by `npm run check` and the scripted smoke runs (see ARCHITECTURE.md, "Verified vs
planned"). Run from the repo root. If you launch from a Cursor/VS Code terminal, prefix
Electron commands with `env -u ELECTRON_RUN_AS_NODE`.

Use a throwaway profile so tests do not touch your real data:
`ZZ_USER_DATA_DIR=/tmp/zz-manual env -u ELECTRON_RUN_AS_NODE npm run dev`.

## 1. Presage key (no camera needed)

1. Create an account at <https://physiology.presagetech.com/auth/register> and copy the API
   key from the dashboard.
2. Create `.env` in the repo root with one line: `PRESAGE_API_KEY=<your key>`.
3. Run `npm run presage:check` (about 20 s, sends blank frames, never prints the key).
   - Pass: last line `OK: Presage accepted the key and the pipeline is running.`
   - `FAIL: kAuthenticationFailed`: wrong key. `kCreditExhausted`: no credits.
     `kNetworkError`: no connection to Presage.

## 2. Live measurement on the diagnostics screen

1. Launch with a throwaway profile (above). Choose "Allow camera between games", enter any
   Lichess username, then on the check-in screen click **Presage diagnostics**.
2. Check the facts: SDK `loaded (v3.4.0)`, API key present `yes (PRESAGE_API_KEY)`, and
   "Cooldowns will use: REAL SDK".
3. Click **Start measurement**. macOS asks for camera access the first time. In dev builds
   the prompt may name Electron or the terminal app you launched from; allow it.
4. Sit still, face lit from the front, for about 60 s. The label must read
   `REAL SDK: Presage session running` and rows must appear under "Latest readings".
5. Click **Stop**. The camera light must go off within a few seconds.

## 3. Check-in (calibration)

Click **Back**, then **Start check-in** and sit still for one minute. Pass: the app moves to
the playing screen and the panel shows "Baseline: NN bpm". On failure it shows how many
usable readings it got.

## 4. Failure cases (diagnostics screen unless noted)

| Case            | How                                                               | Expected                                                                       |
| --------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| No face         | Start, then move out of frame for 20 s                            | Hint "No face in view"; no new stable readings                                 |
| Poor light      | Start in a dark room                                              | Hint "Too dark..."; stable share drops                                         |
| Camera in use   | Open Photo Booth first, then Start                                | FALLBACK: "The camera is in use by another app."; camera light off afterwards  |
| Camera denied   | System Settings > Privacy & Security > Camera: turn off the entry | FALLBACK: "Camera access is off..." (re-enable it afterwards)                  |
| Bad key         | Launch with `PRESAGE_API_KEY=wrong`                               | FALLBACK: "Presage rejected the API key."; event `kAuthenticationFailed`       |
| Network loss    | Wi-Fi off, then Start                                             | Note the message and event shown (expected `kNetworkError`)                    |
| Signal lost     | During a real cooldown, leave the frame                           | "No pulse reading right now. Timer fallback in ..." and the timer still unlock |
| Lichess offline | Wi-Fi off while playing                                           | Panel: "cannot reach Lichess; retrying"; recovers when Wi-Fi is back           |

## 5. Lichess sign-in check

The logged-out case is verified by a smoke run. The signed-in cases need your account:

1. Launch with your test profile. While Lichess is signed out, the amber bar above Lichess
   reads "Sign in to Lichess as @you to play. Games are blocked until then." Click a pool
   (e.g. 1+0): no game starts.
2. Click **Open Lichess sign-in** and sign in as the configured account. Within about a second
   the bar disappears and the panel shows "Signed in as @you · play allowed". The log line is
   `lichess sign-in: ... -> verified`. Start a casual game: it works.
3. Sign out from the Lichess avatar menu. The bar returns immediately; pools do nothing.
4. Sign in as a different account (if you have one): the bar says "Signed in as @other. Sign
   out and sign in to Lichess as @you to play."; no game starts.
5. Turn Wi-Fi off and wait up to a minute: the bar says it could not check the sign-in. Turn
   Wi-Fi on: it clears within about 10 s.

## 6. Real cooldown

1. On Lichess (left pane, signed in) play a casual game, make at least two moves each (fewer
   counts as aborted, not a loss), then resign.
2. Within a few seconds Lichess must disappear and the cooldown screen appear with the camera
   on and "Your pulse now" filling in.
3. Wait without overriding. It unlocks after at least 60 s once your pulse stays at or below
   the band for 15 s. The log row must say `(pulse settled)`.
4. Lose again, then quit (Cmd+Q) during the cooldown and relaunch: still locked, the minimum
   pause continues where it was.
5. Lose again and close the laptop lid for 2 minutes: after waking, the time asleep counts.
6. **Export CSV** in the panel and open the file.

## What to report back

From step 1: the last line of `npm run presage:check`.

From step 2 (the stats line and the readings table):

1. Time to first reading (s)
2. Readings per second
3. Stable share (%)
4. Typical BPM and confidence range in the table
5. Validation hints and errors in "SDK events"
6. Seconds from Stop until the camera light went off

From steps 3-6: your baseline and sample count, the expected/actual result for each failure
case, and for the real cooldown the pulse at loss, time to unlock and unlock reason from the
log. Also anything that was confusing on screen.
