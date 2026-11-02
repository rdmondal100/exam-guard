# Progress

Read this first every session, and keep it under about 8 KB. Decisions are in `docs/decisions.md` (grep it, never read it whole), the session log in `docs/session-log.md` (append only), old reviews in `docs/archive/`.

## Current status
- **Stage 1, Phase 4 code done except M28 (laptop integration); Phase 5 under way.** Batch built 2026-11-02 (second of the day): M29 (thumbnail spike, numbers in milestones.md), M33 (thumbnail grid), M35 (per-student actions). The user asks for several milestones per session and no manual tests. Automated tests pass. **Manual checks never run:** M22 laptop Chrome run, M25 paste guard, M26 laptop screens, M27 typing tool, M31/M32/M33/M35 dashboard with the sim and the laptop (M24 reported finished by the user).
- **Manual checks:** the user ran M02–M13 (2026-10-21) and M14–M21b (2026-10-25: real WFP filters and the installed agent service on the laptop) and reports them good; details were not recorded. Phase 2 accepted.
- **Refactor 2026-11-01 (not a milestone):** Express 5 layered server, Turborepo, Vite-style renderer folders (decisions.md, "Refactor 2026-11-01").
- **Next step:** M36 (global actions: extend all, end all, broadcast, audit log view), then M30 (WebRTC spike, laptop) and M34 [D]. M28 (laptop, installed service; fixes only + architecture §3) still waits for a laptop session. If the M21a/M21b laptop run is repeated, write what it shows into `docs/decisions.md` (M21a) and architecture §3.
- **Agent notes:** rebuild and reinstall the service (`pnpm dev:student:agent`) to get each new agent feature (M22–M26). In dev the relaunch only renders with a built app (limitations). Without the service: `EG_FAKE_AGENT_FAIL=lose` tries the lock, `EG_FAKE_AGENT_MONITORS=2` the roster screen chip.

## Completed milestones
`M## name — date — note`. Details: `docs/decisions.md` (grep the milestone), `docs/milestones.md`, `git log`.
- M01–M18 (Phases 1–3, 2026-10-18 → 10-23): monorepo, Electron shell, server in utilityProcess, SQLite, teacher login, class lists, exams, questions, hosting/TLS/PIN, discovery + pinning, join, WS lobby + sim, exam client, Monaco buffers, code runner + terminal (M15–M15f), autosave, offline resume, submit + receipt. Notes per milestone: `docs/milestones.md` ("Built" lines) and `git log`.
- M19–M21b (Phase 4 agent base, 2026-10-23 → 10-24): agent service + helper (laptop run passed), helper lifecycle, pipe link + heartbeat + system check (`/join` needs it), WFP internet block spike (findings not recorded) and the teacher internet toggle.
- M22 Focus, outside time, screenshots — 2026-10-26 — laptop run pending. M23 App launches — 2026-10-26.
- M24 Evidence buffer, app relaunch, tamper lock — 2026-11-02 — test finished per the user.
- M25 Clipboard and paste control — 2026-11-02 — manual test not run.
- M26 Second monitor + Task Manager / secure desktop — 2026-11-02 — laptop test pending.
- M27 Large text insertion — 2026-11-02 — burst watch by key time stamps, `large_insertion` high.
- M31 Classification, risk score, alert feed — 2026-11-02 — `EventRecorder`, live `alert` feed.
- M32 Roster + student detail — 2026-11-02 — 200-row sim check not run.
- M29 SPIKE Thumbnails for 200 sim students — 2026-11-02 — kept as code (`ThumbRelay`); 30 visible ≈ 2 % of one core and 113 KB/s, 200 visible 754 KB/s.
- M33 Thumbnail grid — 2026-11-02 — Screens view, only the visible page streams, `/thumbs/stats`; laptop check not run.
- M35 Per-student actions — 2026-11-02 — message/warning popups (re-sent until acked), lock/unlock with reason, extend, end, reset session; all logged.

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
- **M45 (agent logs):** the agent's logs still go to `%ProgramData%\ExamGuard\spike` (move them with the installer).
- **Classifier follow-ups (no owner yet):** Alt-Tab/Start-menu `explorer.exe` flicker is not filtered; thresholds and risk points are constants until M43.
- **Events UI (M33+):** `run_executed` and terminal events are stored but not in the monitoring view; the roster has no terminal column and the dashboard does not show where the terminal switch took effect.
- **M36 (global actions):** extend all (`global_extension_sec` is read in the deadline but nothing sets it yet), end all, broadcast, an audit log view of `teacher_actions`. A WS rate limit per token is not built (the 512 KB frame limit and 15 s idle drop are in).
- **M43 (Settings):** regenerate the cert (`loadOrCreateCert(dir, true)` exists; until then the "mismatched cert is refused" case is covered only by the `tls-pin` unit tests), change password (`POST /auth/change`, no password recovery in Stage 1), the data folder is not movable (M44), run limits as a Settings value instead of the `RUN_LIMITS` constants, a teacher value for the long wall time.
- **M45–M46 (installer):** packaged-build checks (DevTools off, real HKLM `InstallType` key) need the installer; the server entry path (`import.meta.resolve`) and asar-unpack for better-sqlite3 `.node`, node-pty's `conpty.dll` / `OpenConsole.exe`; trim Monaco to `editor.api` plus c/cpp/js (about 7 MB of chunks) and trim MSYS2 base (225 MB); package `eg-runner`, MinGW and Python (installer plus about 50 MB for Python) and check the gcc specs fix under `C:\Program Files`; the installed agent only reads the allowed program from the registry, so until the installer writes `AppPath` a packaged student app cannot link to the agent (M21).
- **M44 / cleanup:** run folders and the student workspace are not wiped at exam end (data-model says they should be); a retention rule for answer versions; `server.log` has no rotation.
- **M37+ (grading):** `exam_students.anon_id` exists and nothing uses it until the grading pipeline; no teacher view of answer versions yet (query `answer_versions` in the profile's `db/examguard.sqlite`).
- **Follow-ups without an owner yet (small, not defects):** tell the teacher which students' exam-file download failed (an app event in the hosting panel); show the exam from the first second after a relaunch by caching the last `SessionState` in the session file; copy/print/save for the receipt (the hash is shown in full); a "hosting stopped" screen for students whose socket drops because the teacher stopped hosting (they see "reconnecting" and retry); show offline PCs in "applied on N of M" and decide how a PC that lost its link is released from the internet block; a "switch exam without an uninstall" path for a student whose link is `connected` to the wrong exam (Settings); `confirm` does not check that the exam is still hosting; the join rate limiter is in memory and keyed by the socket IP; `resume.lastServerSeq` stays 0 (M35 re-sends messages after each welcome instead); the teacher login screen does not show the "server restarted" banner after a restart; exams list and class-list students view are not paginated; class lists cannot be renamed or edited per student, and re-import into an existing list is not built; the question form has no markdown preview or "unsaved changes" prompt; the answer store is not cleared between exams in one app run (question ids are unique, so harmless); the server's WS `notice` message from protocol §3 is not built.

## Manual recovery checklist (filled in during M48)
_Empty._
