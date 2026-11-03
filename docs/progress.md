# Progress

Read this first every session, and keep it under about 8 KB. Decisions are in `docs/decisions.md` (grep it, never read it whole), the session log in `docs/session-log.md` (append only), old reviews in `docs/archive/`.

## Current status
- **Phase 5 code done except WebRTC (M30 spike + M34 proper, laptop); Phase 6 code done (M37–M42); Phase 7 M43–M46 built (Settings, data folder, installer).** Latest 2026-11-03: M45 + M46; installer 210 MB, installed 1178 MB; suites, typecheck, lint passed. The user asks for several milestones per session and no manual tests. Suites pass. **Manual checks never run:** M22 laptop Chrome run, M25 paste guard, M26 laptop screens, M27 typing tool, M31–M36 dashboard with the sim and the laptop (the Phase 5 demo), M37 real Gemini smoke test (`pnpm record-fixture`), M38–M42 in the app (`$env:EG_FAKE_GRADER='1'; pnpm dev:teacher` on a sim exam: grade, review, re-evaluate, finalize, export and open the CSV in Excel; then one real run with the key saved in Settings), M43 Settings (change each, restart, search the data folder for the key text), M44 (move the data folder to another drive and back, restart; retention 0 days on an ended test exam; a move while hosting is refused), M45–M46 (install `release/ExamGuard-Setup-0.1.0.exe` on the laptop as Student and on the dev PC as Teacher, silent `/S /TYPE=student` from an admin cmd, standard-user login → agent running, `netsh advfirewall firewall show rule name=all` diff, full join, uninstall both) (M24 reported finished by the user).
- **Manual checks:** the user ran M02–M21b (2026-10-21, 10-25: real WFP filters and the installed service on the laptop) and reports them good; details not recorded.
- **Next step:** M47 (load test: student-sim v3 full scenario, 200 students for 30 min, metrics report). Then M48 (crash-recovery tests) and M49 (hardening + lab-IT README). M30 (WebRTC spike) and the rest of M34 wait for a laptop session. M28 (laptop, installed service; fixes only + architecture §3) still waits for a laptop session. If the M21a/M21b laptop run is repeated, write what it shows into `docs/decisions.md` (M21a) and architecture §3.
- **Agent notes:** rebuild and reinstall the service (`pnpm dev:student:agent`) to get each new agent feature (M22–M26). In dev the relaunch only renders with a built app (limitations). Without the service: `EG_FAKE_AGENT_FAIL=lose` tries the lock, `EG_FAKE_AGENT_MONITORS=2` the roster screen chip.

## Completed milestones
`M## name — date — note`. Details: `docs/decisions.md` (grep the milestone), `docs/milestones.md`, `git log`.
- M01–M18 (Phases 1–3, 2026-10-18 → 10-23): monorepo, Electron shell, server in utilityProcess, SQLite, teacher login, class lists, exams, questions, hosting/TLS/PIN, discovery + pinning, join, WS lobby + sim, exam client, Monaco buffers, code runner + terminal (M15–M15f), autosave, offline resume, submit + receipt. Notes per milestone: `docs/milestones.md` ("Built" lines) and `git log`.
- M19–M21b (Phase 4 agent base, 2026-10-23 → 10-24): agent service + helper (laptop run passed), helper lifecycle, pipe link + heartbeat + system check (`/join` needs it), WFP internet block spike (findings not recorded) and the teacher internet toggle.
- M22–M27 (Phase 4 monitoring, 2026-10-26 → 11-02): focus + outside time + screenshots (laptop run pending), app launches, evidence buffer + relaunch + tamper lock (tested by the user), clipboard/paste control, second monitor + Task Manager / secure desktop (laptop test pending), large insertion.
- M29, M31–M33, M35 (2026-11-02): thumbnail spike kept as `ThumbRelay` (30 visible ≈ 2 % of one core, 113 KB/s), classification + risk + live alerts, sortable roster + student detail, thumbnail grid, per-student actions.
- M36 Global actions + audit view — 2026-11-03 — extend all, broadcast, lifecycle logged, action log panel. M34 (fallback only) — 2026-11-03 — fast thumbnail via `thumbs.focus`; no WebRTC.
- M37–M40 (2026-11-03): grading provider/prompt/validation (fake + Gemini, hand-written fixtures), pipeline (resumable jobs, dev fake grader `EG_FAKE_GRADER=1`, key now from Settings, `EG_GEMINI_API_KEY` as dev fallback), review screens, accept/edit + history. No real Gemini call yet.
- M41–M42 (2026-11-03): re-evaluate with an instruction (one / all, include edited; grade kept until regraded, migration 0014), finalize (readiness check, backup, lock) and results CSV to `exports/` with "Show in folder". CSV not opened in a real Excel yet.
- M43 Settings — 2026-11-03 — password change, AI model/pool + key (`safeStorage` → `secrets.bin`), new-exam defaults, run limits (copied at hosting start, migration 0015), student port, certificate regenerate, manual backup.
- M44 Data folder move + retention — 2026-11-03 — move in main with the server stopped (release, copy, SHA-256 verify, switch via `data-location.json`, delete old; rollback), refused while hosting/running or grading; `retention.screenshotDays` purges at start and on save, live exams skipped.
- M45–M46 Installer — 2026-11-03 — `pnpm package` (deploy stage + electron-builder), Teacher/Student page + `/TYPE=`, `InstallType`/`AppPath`, agent service (student), firewall rules (teacher), uninstall cleanup; 210 MB installer, 1178 MB installed. Not installed on a PC yet.

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
- **Classifier follow-ups (no owner yet):** Alt-Tab/Start-menu `explorer.exe` flicker is not filtered; thresholds and risk points are still constants (not in Settings).
- **Events UI (M33+):** `run_executed` and terminal events are stored but not in the monitoring view; the roster has no terminal column and the dashboard does not show where the terminal switch took effect.
- **No owner yet:** a WS rate limit per token is not built (the 512 KB frame limit and 15 s idle drop are in).
- **After M43 (no owner yet):** no password recovery in Stage 1; risk thresholds/points and a teacher value for the long wall time are still constants; a regenerated cert is only covered by the `tls-pin` unit tests (no end-to-end "student refuses the new cert" test).
- **After M45–M46 (manual / M49):** a real install has not run yet: DevTools off and the HKLM `InstallType` key in a packaged build, the gcc specs fix and pacman/pip under `C:\Program Files`, the agent link from the installed app (`AppPath`), the uninstall components page. Trimming Monaco to `editor.api` plus c/cpp/js (about 7 MB of chunks) was not needed for the size target. No app icon (default Electron icon).
- **Cleanup (no owner yet, left from M44):** the move has no progress bar (Settings shows "Moving…", then a message box); run folders and the student workspace are not wiped at exam end (data-model says they should be); a retention rule for answer versions; `server.log` has no rotation; the automatic backup at exam end is not built (only before finalize), and old backups and exports are never pruned.
- **Grading follow-ups:** record real fixtures with `pnpm record-fixture`; no teacher view of answer versions yet (query `answer_versions` in the profile's `db/examguard.sqlite`).
- **Small follow-ups without an owner:** listed at the end of `docs/limitations.md` (UI niceties, pagination, receipt copy, join limiter, WS `notice`).

## Manual recovery checklist (filled in during M48)
_Empty._
