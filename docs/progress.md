# Progress

Read this first every session, and keep it under about 8 KB. Decisions are in `docs/decisions.md` (grep it, never read it whole), the session log in `docs/session-log.md` (append only), old reviews in `docs/archive/`.

## Current status
- **Stage 1, Phase 4 (Monitoring agent) in progress.** Last milestone built: M22 (focus tracking, outside time, screenshots → events). **The laptop run of M22 has not been done yet**: automated tests and a standalone helper start pass, the real Chrome trial is pending (manual test: `docs/milestones.md` M22).
- **Manual checks:** the user ran M02–M13 (2026-10-21) and M14–M21b (2026-10-25: real WFP filters and the installed agent service on the laptop) and reports them good; details were not recorded. Phase 2 accepted.
- **Next step:** run M22 on the laptop and fix what it shows; then M23 (app launches + process list at start). If the M21a/M21b laptop run is repeated, write what it shows (established connections, DHCP, IPv6, group policy, whether the lease and a killed service lift the block) into `docs/decisions.md` (M21a) and architecture §3.
- **M22 notes:** the installed agent service must be rebuilt and reinstalled (`pnpm dev:student:agent`) to get the new helper. The "What the agent saw" chip (M19) still works from `helper.log` but shows 0 pictures; remove it with the next agent-chip cleanup. `submit-socket.test.ts` "auto-submits after the grace…" failed once in a full `pnpm test` run (timing) and passes alone: watch for a flake.

## Completed milestones
`M## name — date — note`. Details: `docs/decisions.md` (grep the milestone), `docs/milestones.md`, `git log`.
- M01 Monorepo skeleton — 2026-10-18 — pnpm + Cargo workspaces, lint/test/clippy gates.
- M02 Electron shell + mode selection — 2026-10-18 — secure window, per-profile `mode.json`, student install lock.
- M03 Exam server in a utilityProcess — 2026-10-18 — Fastify loopback with token, supervised restart.
- M04 SQLite + migrations — 2026-10-18 — better-sqlite3, migration runner, `0001_init`.
- M05 Teacher password and login gate — 2026-10-19 — scrypt, lockout, setup/login screens.
- M06 Class list CSV import — 2026-10-19 — server-side parse with dry-run preview.
- M07 Exam CRUD and settings — 2026-10-19 — exam state machine, duplicate.
- M08 Question editor — 2026-10-19 — Monaco editor, criteria, `/ready` check.
- M09 Hosting: TLS, PIN, student listener — 2026-10-20 — self-signed cert, 6-digit PIN, sleep blocker.
- M10 Discovery + manual IP + cert pinning — 2026-10-20 — mDNS, fingerprint pin before any byte.
- M11 Student join + monitoring notice — 2026-10-20 — PIN + ID, one session per student.
- M12 WebSocket session, lobby, student-sim v1 — 2026-10-20 — roster, 200 sim students in 1.4 s.
- M13 Start + exam client shell — 2026-10-21 — shared deadline, fullscreen non-closable window, timer.
- M14 Monaco + per-language code buffers — 2026-10-21.
- M15 Local code runner (C, C++, JS) — 2026-10-21 — Rust `eg-runner` Job Object, WinLibs gcc.
- M15a SPIKE Exam terminal — 2026-10-21 — node-pty + xterm.js, pacman/npm shims.
- M15b Teacher terminal toggle + command logging — 2026-10-22.
- M15c Workspace runs, own flags, one run console — 2026-10-22.
- M15d Python runtime + pip — 2026-10-23.
- M15e Project folder for Run + Files panel — 2026-10-23.
- M15f Teacher-provided exam files — 2026-10-23.
- M16 Autosave + versions — 2026-10-23.
- M17 Offline queue, reconnect, same-PC resume — 2026-10-23.
- M18 Submit, auto-submit, receipt, student-sim v2 — 2026-10-23 — the Phase 3 demo.
- M19 SPIKE Agent service + helper — 2026-10-23 — laptop run passed 2026-10-23.
- M20 Agent service skeleton + helper lifecycle — 2026-10-23.
- M21 Pipe link, heartbeat, system check — 2026-10-24 — `/join` needs a passing check.
- M21a SPIKE Internet block with WFP — 2026-10-24 — filters run on the laptop; findings not recorded.
- M21b Teacher internet toggle — 2026-10-24 — teacher switch → server → app → agent lease → WFP.
- M22 Focus tracking, outside time, screenshots → events — 2026-10-26 — helper hooks + policy, evidence over the pipe, binary screenshot frames, events list; laptop run pending.

## Known issues / open questions
Cleaned up 2026-10-25 after the user's report that the manual tests up to M21b are good; what is left is real limitations and later work (details of that pass: `docs/decisions.md`, "Known-issues pass").

### Before a real exam (lab IT, not code)
- Confirm with lab IT: admin install rights, antivirus/EDR tolerance of the agent and screen capture, reboot-restore software (Deep Freeze wipes the local queue on reboot), group policies (they may forbid the dynamic WFP session used by the internet toggle), that students are on one subnet, and that WFP changes and package downloads are allowed (requirements §12).
- Check Gemini's current data-use terms and use a paid tier for real student data.
- Teacher on Wi-Fi: the Windows network profile must be Private for mDNS (UDP 5353) and inbound rules; without it use manual IP. The first LAN listen may show the Windows Firewall prompt (the installer rule is M46). The README must cover this.
- Lab connection: 200 students installing packages at once need bandwidth (each workspace's first `pacman` call is about 0.6 MB, about 120 MB for 200, plus the packages); the installer is estimated at 300–400 MB. The 256 MB run memory limit may be tight for Python with large packages (NumPy and matplotlib fit).

### Accepted limitations
Moved to `docs/limitations.md` (read it when you touch that area).

### Deferred to a named milestone
- **M23–M24 (agent):** `app_launched`, `processes_at_start`, the encrypted evidence buffer, app relaunch and the heartbeat-loss lock are not built (evidence is held in the service's memory only, see limitations); the agent's logs still go to `%ProgramData%\ExamGuard\spike`.
- **M31+ (classifier):** the severity of agent events is a placeholder (`screenshots/placeholder-severity.ts`); `riskScore` is still 0; Alt-Tab/Start-menu `explorer.exe` flicker should be filtered there; a WS `alert` push to the teacher is not built (the Events list polls every 3 s).
- **M31+ (events UI):** `run_executed`, `network_*` and terminal events are stored but not shown to the teacher; to look, query the `events` table. The roster has no terminal column and the dashboard does not show where the terminal switch took effect (add with the monitor grid, M26+/M32).
- **M35–M36 (teacher actions):** a teacher "reset session" (clears `token_hash` and `device_id` so a student can re-join from another PC) and extensions (`extension_sec`, `global_extension_sec` are read in the deadline but nothing sets them yet). A WS rate limit per token is not built (the 512 KB frame limit and 15 s idle drop are in).
- **M43 (Settings):** regenerate the cert (`loadOrCreateCert(dir, true)` exists; until then the "mismatched cert is refused" case is covered only by the `tls-pin` unit tests), change password (`POST /auth/change`, no password recovery in Stage 1), the data folder is not movable (M44), run limits as a Settings value instead of the `RUN_LIMITS` constants, a teacher value for the long wall time.
- **M45–M46 (installer):** packaged-build checks (DevTools off, real HKLM `InstallType` key) need the installer; the server entry path (`import.meta.resolve`) and asar-unpack for better-sqlite3 `.node`, node-pty's `conpty.dll` / `OpenConsole.exe`; trim Monaco to `editor.api` plus c/cpp/js (about 7 MB of chunks) and trim MSYS2 base (225 MB); package `eg-runner`, MinGW and Python (installer plus about 50 MB for Python) and check the gcc specs fix under `C:\Program Files`; the installed agent only reads the allowed program from the registry, so until the installer writes `AppPath` a packaged student app cannot link to the agent (M21).
- **M44 / cleanup:** run folders and the student workspace are not wiped at exam end (data-model says they should be); a retention rule for answer versions; `server.log` has no rotation.
- **M37+ (grading):** `exam_students.anon_id` exists and nothing uses it until the grading pipeline; no teacher view of answer versions yet (query `answer_versions` in the profile's `db/examguard.sqlite`).
- **Follow-ups without an owner yet (small, not defects):** tell the teacher which students' exam-file download failed (an app event in the hosting panel); show the exam from the first second after a relaunch by caching the last `SessionState` in the session file; copy/print/save for the receipt (the hash is shown in full); a "hosting stopped" screen for students whose socket drops because the teacher stopped hosting (they see "reconnecting" and retry); show offline PCs in "applied on N of M" and decide how a PC that lost its link is released from the internet block; a "switch exam without an uninstall" path for a student whose link is `connected` to the wrong exam (Settings); `confirm` does not check that the exam is still hosting; the join rate limiter is in memory and keyed by the socket IP; `resume.lastServerSeq` is always 0 until server commands exist; the teacher login screen does not show the "server restarted" banner after a restart; exams list and class-list students view are not paginated; class lists cannot be renamed or edited per student, and re-import into an existing list is not built; the question form has no markdown preview or "unsaved changes" prompt; the answer store is not cleared between exams in one app run (question ids are unique, so harmless); the server's WS `notice` message from protocol §3 is not built.

## Manual recovery checklist (filled in during M48)
_Empty._
