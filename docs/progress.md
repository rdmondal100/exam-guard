# Progress

Read this first every session, and keep it under about 8 KB. Decisions are in `docs/decisions.md` (grep it, never read it whole), the session log in `docs/session-log.md` (append only), old reviews in `docs/archive/`.

## Current status
- **Stage 1 code is done.** Latest 2026-11-03: M30 + M34 WebRTC live view (fast thumbnail kept as fallback), app icon, final installer `release/ExamGuard-Setup-0.1.0.exe` (210 MB, 1177 MB installed, unsigned). The user asks for several milestones per session and no manual tests. Suites pass.
- **Manual checks never run** (the user ran M02–M21b and M24 and reports them good): M22/M25/M26/M27 on the laptop; M31–M36 dashboard with the sim + laptop (Phase 5 demo); M37 real Gemini (`pnpm record-fixture`); M38–M42 in the app (`$env:EG_FAKE_GRADER='1'; pnpm dev:teacher`: grade, review, re-evaluate, finalize, CSV in Excel; then one real run); M43 Settings (persist, key text not in the data folder); M44 (move and back, retention 0 days, move refused while hosting); M45–M46 + M49 demo (install `release/ExamGuard-Setup-0.1.0.exe` (built 2026-11-03, Electron 44.10.1, with icon) on a reset laptop as Student and the dev PC as Teacher, silent `/S /TYPE=student`, standard-user login → agent running, firewall rule diff, full join, uninstall); M30/M34 live view laptop → teacher PC (≥5 fps, <1 s, teacher on Wi-Fi, open/close 10×); M47 with the laptop as a real student (ID 9001); the M48 checklist below.
- **Next step:** only laptop work is left in Stage 1: M28 (Phase 4 integration) and the manual runs above. Then Stage 2 (break it into milestones first). If the M21a/M21b laptop run is repeated, write what it shows into `docs/decisions.md` (M21a) and architecture §3.
- **Agent notes:** rebuild and reinstall the service (`pnpm dev:student:agent`) to get each new agent feature. Without the service: `EG_FAKE_AGENT_FAIL=lose` tries the lock, `EG_FAKE_AGENT_MONITORS=2` the roster screen chip.

## Load test (M47, 2026-11-03)
Dev PC (i5-13600K), server in its own Node process, sim + teacher socket in another, `pnpm sim -- --scenario full --students 200 --minutes 30`: 200 joined in 6.3 s, 0 failed · 35 228 saves, none waiting, ack p50 161 / p95 265 / max 814 ms (250 ms batch commit) · 6 516 events (3 903 with a 150 KB screenshot), all stored once, ack p95 9 ms · alert lag p50 3 / p95 9 / max 440 ms · 200 good receipts · 1 059 drops/reconnects · server CPU avg 6.3 % / max 23 % of one core, RSS max 202 MB, heap 41 MB, event loop p99 ≤ 26 ms · students up 452 KB/s · teacher socket 131 KB/s (30 thumbnails). Every check passed; no perf fix needed.

## Stage 1 objectives (requirements §3)
1. Create, host and run an exam for 200 students — code done; sim 200 × 30 min passed; real lab not tried.
2. Student ID + PIN, editor, local run, submit — code done; laptop runs up to M21b passed.
3. No work lost on crash, network drop, power loss — code done; M17/M18/M48 tests; checklist below not run.
4. Every launch, switch and suspicious action logged with evidence, live — code done; laptop runs of M22–M27 pending.
5. Grid of screens, live view, warn/lock/extend/end — code done (WebRTC live view checked on the dev PC with a harness; laptop run pending).
6. AI grading, review, edit, re-evaluate, finalize, export — code done; no real Gemini run yet.

## Completed milestones
`M## name — date — note`. Details: `docs/decisions.md` (grep the milestone), `docs/milestones.md` ("Built" lines), `git log`.
- M01–M18 (Phases 1–3, 10-18 → 10-23): monorepo, shell, server, SQLite, login, class lists, exams, questions, hosting/TLS/PIN, discovery, join, lobby + sim, exam client, Monaco, runner + terminal, autosave, offline resume, submit + receipt.
- M19–M21b (10-23 → 10-24): agent service + helper, pipe link + system check, WFP spike and internet toggle.
- M22–M27 (10-26 → 11-02): focus + screenshots, app launches, evidence buffer + relaunch + tamper lock, paste control, second monitor / secure desktop, large insertion.
- M29, M31–M36 (11-02 → 11-03): `ThumbRelay`, classification + risk + alerts, roster + detail, grid, per-student and global actions, audit log; M34 fallback only (`thumbs.focus`).
- M37–M42 (11-03): grading provider + pipeline, review, accept/edit, re-evaluate, finalize + CSV.
- M43–M46 (11-03): Settings, data folder move + retention, NSIS installer (210 MB, 1178 MB installed) with service, firewall rules and uninstall.
- M47 Load test — 2026-11-03 — sim v3 full scenario, `load-host` server process, report; passed (above).
- M48 Crash-recovery tests — 2026-11-03 — `RestartableExam` + `recovery.socket.test.ts`; checklist below.
- M49 Hardening + lab-IT README — 2026-11-03 — permission allow-list, Electron 44.10.1, DOMPurify override, audit, `docs/lab-it-readme.md`; fresh-PC demo pending.
- M30 + M34 WebRTC live view — 2026-11-03 — `LiveRelay`, hidden capture window per session, `LiveView` with fast-thumbnail fallback; harness on the dev PC: 1280×720 at 8 fps, host candidates, no leaks over 10 rounds. App icon (`scripts/make-icon.mjs`), installer rebuilt.

## Known issues / open questions
### Before a real exam (lab IT, not code)
- Section 1 of `docs/lab-it-readme.md` (admin rights, AV/EDR, reboot-restore, group policy, one subnet, downloads, network profile Private). Check Gemini's data-use terms and use a paid tier for real student data. The 256 MB run memory limit may be tight for Python with large packages.

### Accepted limitations
Moved to `docs/limitations.md` (read it when you touch that area).

### Deferred / no owner yet
- **Classifier:** Alt-Tab/Start-menu `explorer.exe` flicker is not filtered; thresholds and risk points are constants (not in Settings).
- **Events UI:** `run_executed` and terminal events are not in the monitoring view; no terminal column in the roster.
- **After M43:** no password recovery; a regenerated cert is only covered by `tls-pin` unit tests.
- **Installer:** a real install has not run (DevTools off and `InstallType` in a packaged build, gcc/pacman/pip under `C:\Program Files`, `AppPath` link, uninstall components page).
- **Cleanup (from M44):** no move progress bar; run folders and student workspace not wiped at exam end; no retention for answer versions; no `server.log` rotation; no automatic backup at exam end; backups and exports never pruned.
- **Grading:** record real fixtures; no teacher view of answer versions.
- **Small follow-ups:** end of `docs/limitations.md`.

## Manual recovery checklist (M48, laptop + sim; not run yet)
Run with `pnpm dev:teacher` hosting a running exam, the laptop as a student (installed build) and `pnpm sim -- --host <ip> --pin <pin> --students 50 --autosave-ms 10000 --events-every-ms 60000`. After each step: the student's latest text is on the server (`/answers/latest` after re-join), the events list has no gap or duplicate, and the timer shows the same end time.
1. **Server kill:** end the `utilityProcess` in Task Manager → back within about 2 s, banner, students reconnect by themselves.
2. **Teacher app kill:** end ExamGuard.exe on the teacher PC, start it, log in → the exam reopens with the same PIN and certificate code.
3. **Student app kill:** end the app on the laptop mid-typing → the agent relaunches it, the exam resumes with the text, `app_relaunched` shows.
4. **Laptop power-off:** hold the power button mid-exam, boot, log in, open ExamGuard → re-join on the same PC, text back except the last unsaved seconds, offline time shown as `network_lost`/`network_restored`.
5. **Cable pull:** unplug for 1 min while typing and switching windows, plug back → queued saves and events arrive, nothing doubled.
6. **Agent helper kill:** end the helper process → `agent_lost` and the tamper lock within about 5 s; the service restarts the helper; the teacher unlocks.
7. **Deadline during downtime:** stop the teacher app across the exam's end, start it → the exam ends by itself with the answers saved in time.
