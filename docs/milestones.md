# Milestones

Build order for Stage 1, organised by the phases in `requirements.md` §10. Each milestone fits one focused session. **[D]** = deferrable to Stage 2 if time runs short (decided at the checkpoint after Phase 4). **SPIKE** = proof of concept; keep the code if it's usable, otherwise record what you learned in `progress.md`.

Manual tests use the dev PC (teacher + student profiles, see CLAUDE.md "Dev safety") and the **second laptop** on the same LAN. Design details are in `architecture.md`, `protocol.md` and `data-model.md`. Milestones only reference them.

---

## Phase 1 — Foundation
*Done when: teacher app starts, server runs, database created, both modes open.*

### M01 Monorepo skeleton
- **Goal:** pnpm workspace + Cargo workspace build and test, with nothing app-specific yet.
- **Touches:** root `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json` (strict), ESLint (`no-explicit-any` = error), Prettier, Vitest config, `Cargo.toml` workspace with empty `agent/eg-agent` and `agent/eg-runner` crates, `packages/shared` with `PROTOCOL_VERSION` + one sample Zod schema + test, `.gitignore`, CLAUDE.md commands updated.
- **Accept:** `pnpm install`, `pnpm build`, `pnpm test`, `pnpm lint` and `cargo build` all pass. A file with `any` fails lint.
- **Manual test:** run the commands above. Add `const x: any = 1` and see lint fail.

### M02 Electron shell + mode selection
- **Goal:** the desktop app opens a secure window and the first-launch screen picks Teacher or Student.
- **Touches:** `apps/desktop` (electron-vite, React, Tailwind, shadcn init), `main/window.ts` (contextIsolation, sandbox, no nodeIntegration, DevTools off when packaged, CSP), `preload/` typed bridge, `main/install-type.ts` (reads `HKLM\Software\ExamGuard\InstallType`; `student` hides Teacher mode), `--profile` flag → separate userData, `pnpm dev:teacher` / `dev:student`.
- **Accept:** the mode is remembered per profile. Two profiles run at once. The renderer has no `require`/`process`.
- **Manual test:** start both dev scripts, pick a mode in each, restart, and the modes are remembered. In the dev console, `typeof require` is `undefined`.

### M03 Exam server in a utilityProcess
- **Goal:** Teacher mode starts `apps/server` as a utilityProcess and restarts it on crash.
- **Touches:** `apps/server/src/index.ts`, `http/teacher-app.ts` (loopback 47821, `/api/v1/health`, token check), `apps/desktop/main/server-host.ts` (spawn, backoff restart, MessagePort, token handoff to preload), logs.
- **Accept:** health returns 200 with the token and 401 without it. Killing the server process makes it restart and the UI banner shows "server restarted".
- **Manual test:** Teacher mode → status chip "Server running". End the utility process in Task Manager → it comes back within about 2 s.

### M04 SQLite + migrations
- **Goal:** the database is created in the data folder with the migration runner and the first tables.
- **Touches:** `apps/server/src/db/{connection,migrate}.ts`, `migrations/0001_init.sql` (settings, teacher; other tables come with their features), repo helpers, tests with a temp DB.
- **Accept:** a fresh profile creates `db/examguard.sqlite` in WAL mode with `user_version=1`. Re-running is a no-op. Tests pass.
- **Manual test:** delete the profile folder, start the app, and check the file exists (open it in DB Browser for SQLite).

### M05 Teacher password and login gate — **Phase 1 demo**
- **Goal:** first run sets the teacher password, and every later run asks for it before showing anything.
- **Touches:** `apps/server/src/auth/` (scrypt), `/auth/setup|login`, teacher renderer routes: setup, login, empty home shell with nav.
- **Accept:** the wrong password is rejected (with a rate limit). Teacher pages can't be reached without logging in. Student mode is unaffected.
- **Manual test (demo):** fresh profile → set password → restart → log in → home shown, server running, DB created. The student profile opens Student mode.

---

## Phase 2 — Exam setup & joining
*Done when: a student on another PC joins an exam and waits in the lobby.*

### M06 Class list CSV import
- **Goal:** import a class list from CSV with a preview and error report.
- **Touches:** migration (class_lists, class_students), papaparse import service, endpoints, Class Lists page (TanStack Table).
- **Accept:** handles BOM, quotes, Excel CSV, duplicate and blank IDs (reported, not imported). A list in use can't be deleted.
- **Manual test:** import a 200-row CSV with 3 bad rows → preview shows 3 errors, and 197 rows are saved.

### M07 Exam CRUD and settings
- **Goal:** create, edit, duplicate and delete exams with duration, monitoring settings and an assigned class list.
- **Touches:** migration (exams), exam service + state machine module (`exam-state.ts` with allowed transitions + tests), Exams list and Exam settings pages.
- **Accept:** duplicate copies settings and questions (once M08 lands) but no runtime data. Invalid state transitions are rejected.
- **Manual test:** create, duplicate, rename and delete exams. Duration and class list persist after restart.

### M08 Question editor
- **Goal:** code and written questions with a marking guide, allowed languages, a note to students, a sample answer and AI notes. Reorderable.
- **Touches:** migration (questions, marking_criteria), shared schemas, question editor UI (Monaco for the sample answer), half-mark input, `POST /exams/:id/ready` validation.
- **Accept:** marks = sum of criteria. Ready fails with clear reasons (no questions, no class list, missing sample answer or criteria). Reorder persists.
- **Manual test:** build a 3-question exam (2 code, 1 written) and mark it Ready. Remove a criterion and Ready is refused.

### M09 Hosting: TLS, PIN, student listener
- **Goal:** "Start hosting" opens the student HTTPS/WSS listener with a self-signed cert and shows the hosting screen.
- **Touches:** `server/tls/cert.ts` (selfsigned, stored in `certs/`, fingerprint + 4-char code), `http/student-app.ts` (0.0.0.0:47820, only while hosting), `/info`, PIN generation, hosting screen (PIN, LAN addresses, port, fp code, join counts), power-save blocker in main.
- **Accept:** `curl -k https://<ip>:47820/api/v1/info` works while hosting and is refused after stopping. Sleep is blocked while hosting.
- **Manual test:** start hosting and run the curl from the laptop. `powercfg /requests` on the teacher PC lists ExamGuard.

### M10 Discovery + manual IP + cert pinning
- **Goal:** the student app finds hosting teachers over mDNS or by manual IP, and pins the cert.
- **Touches:** server mDNS advertiser (bonjour-service, TXT v/exam/fp), student main `discovery.ts` + `tls-pin.ts` (custom `checkServerIdentity` / Electron `setCertificateVerifyProc` limited to the pinned fp), student "Find exam" screen with the fp code shown for manual IP.
- **Accept:** the laptop discovers the teacher on the LAN. Manual IP works. A mismatched cert (regenerated mid-session) is refused with a clear message.
- **Manual test:** on the laptop, the exam appears in the list. Enter the IP manually and compare the 4-char code with the teacher screen.

### M11 Student join + monitoring notice
- **Goal:** join with student ID + PIN, confirm the name, accept the monitoring notice, one session per student.
- **Touches:** migration (exam_students, events, teacher_actions), `/join`, `/join/confirm`, token issue/hash, deviceId (MachineGuid hash, read in student main), duplicate-login rejection + `duplicate_login` event, rate limit, student join + notice screens. Agent check stubbed (`agent: {ok:true}` in dev) and enforced in M21.
- **Accept:** a wrong PIN or someone not on the list is rejected. The same ID from a different device is rejected and logged. The same device re-joins (resume).
- **Manual test:** join from the laptop, then try the same ID from the dev-PC student profile → rejected, and an event row exists.

### M12 WebSocket session, lobby, student-sim v1 — **Phase 2 demo**
- **Goal:** the student's WS connects to the lobby. The teacher sees a live roster and join counts.
- **Touches:** `server/ws/student-socket.ts` (hello/welcome, ping/pong clock, protocol check, connected flag), teacher WS `subscribe` + `roster`/`hosting` messages, student lobby screen, `tools/student-sim` v1 (N students: join → lobby, CLI flags `--host --pin --students --csv`).
- **Accept:** roster updates within 1 s. Disconnecting shows the student as disconnected. The sim with 200 students holds the lobby stable.
- **Manual test (demo):** the laptop student joins and waits in the lobby, and the teacher sees them. Then `pnpm sim -- --students 200` → hosting counts show 201.

---

## Phase 3 — Taking the exam
*Done when: a student completes and submits a full exam, surviving a network drop.*

### M13 Start + exam client shell
- **Goal:** the teacher clicks Start. Students get questions, the server-authoritative timer, and a fullscreen window that can't be closed.
- **Touches:** `/start`, deadline computation module + tests (late join = same end), `state` push, student exam window (fullscreen, not always-on-top, close/quit prevented while active), question list/navigation, written answer box, timer, connection indicator, "monitoring active" badge (static for now).
- **Accept:** late joiners see the same deadline. Alt+F4 and the close button do nothing during the exam. The timer stays within ±1 s of the server.
- **Manual test:** start with the laptop in the lobby, try Alt+F4, join late from the sim, and compare the timers.

### M14 Monaco + per-language code buffers
- **Goal:** code questions use Monaco with a language dropdown (allowed languages only) and a buffer per language.
- **Touches:** student renderer editor components, local Monaco workers (no CDN), Zustand store `answers[questionId][language]`, "will submit: C++" indicator, note to students display.
- **Accept:** switching C++ → JS → C++ restores the C++ code. Only the allowed languages are listed.
- **Manual test:** write code in two languages, switch back and forth, and change questions.

### M15 Local code runner (C, C++, JS)
- **Goal:** Run/Stop with stdin, Output/Errors tabs, exit code, run time and limits.
- **Touches:** `agent/eg-runner` (Job Object launcher + tests), `scripts/fetch-toolchains` (WinLibs MinGW → `resources/toolchains`), `apps/desktop/main/runner/{languages,run,parse-gcc}.ts`, run panel UI, Monaco markers from gcc, cooldown, `run_executed` event.
- **Accept:** an infinite loop is stopped at 5 s, a 1 GB allocation at 256 MB, and output is capped at 64 KB, each with a clear message. A compile error underlines the line. Fork bombs are contained (process limit).
- **Manual test:** run hello world in C, C++ and JS, then try `while(1);`, a big malloc, printing in a loop, and a syntax error.

### M15a SPIKE — Exam terminal (node-pty + xterm.js)
- **Goal:** prove a real terminal works in the student window and that packages install without admin rights.
- **Touches:** node-pty (ConPTY) in student main (native module under Electron 44: prebuilt or rebuild), xterm.js tab under the editor, IPC stream main ↔ renderer (no Node in renderer), workspace `%LOCALAPPDATA%\ExamGuard\run\<examStudentId>\workspace`, PATH with the bundled tools, the terminal's processes in a Job Object (killed on close), MSYS2 `pacman` alongside WinLibs (or MSYS2's own UCRT gcc instead, decided here), bundled `npm` with a `node` shim (`node.cmd` → ExamGuard.exe as Node), **MinGW trimmed to C/C++** in `fetch-toolchains` (drop Fortran/Objective-C/Ada/docs; keep gcc, g++, binutils) with the size recorded.
- **Accept:** in a dev run, `npm i lodash` and `pacman -S mingw-w64-ucrt-x86_64-freeglut` work as a standard user; a GLUT program builds from the terminal; closing the terminal kills a running `ping -t`. Result and the toolchain choice recorded in progress.md.
- **Manual test:** open the terminal in an exam, install one npm package and one pacman library, build and run a small program, close the terminal.

### M15b Teacher terminal toggle + command logging
- **Goal:** the teacher turns the exam terminal on/off (optionally "for N minutes"); every command is logged.
- **Touches:** shared `state.terminal` (`{enabled, until}`), `POST /exams/:id/actions {type:'terminal', enabled, minutes?}` + `teacher_actions`, server timer for the window (server time), dashboard toggle with countdown, student main enforces it, `terminal_opened|terminal_closed|terminal_command|package_installed` events, transcript storage + teacher view.
- **Accept:** turning it off mid-command closes the terminal and kills its processes within 1 s; the "N minutes" window closes on time; late joiners get the current state; every command line appears as an event.
- **Manual test:** turn on for 2 minutes from the teacher, run commands on the laptop, watch the events and the auto-off.

### M15c Workspace runs, own flags, one console for every run
- **Goal:** Run builds against what the student installed, accepts their flags, can run window programs, and supports step-by-step input, all in one console with no mode to choose.
- **Touches:** runner config: workspace include/lib paths, `node_modules`, extra flags per answer (stored with the answer, shown in the run panel), the program always runs in a pseudo-console (xterm.js) with typed input; window programs open their own window; wall time 10 min with Stop (replaces the 5 s of M15); `run_executed` details include flags.
- **Accept:** an OpenGL/GLUT window program and a graphics.h program run from Run; an interactive `scanf` loop works in the console; memory, process and output limits are the M15 ones, and the wall time is 10 min.
- **Manual test:** install freeglut (M15a), run a spinning-cube program and Stop it; run a menu-driven C program and type into it.

### M15d Python runtime + pip
- **Goal:** Python 3 as an allowed language with `pip` installs into the workspace.
- **Touches:** a Python 3 build **with tkinter** (python-build-standalone `install_only` 3.13, not the embeddable zip) fetched by `fetch-toolchains`, `QUESTION_LANGUAGES` (`py`) + runner config + Monaco, workspace `site-packages` (`PIP_TARGET` and `PYTHONPATH`), `python`/`pip` shims in the terminal, question editor checkbox (it lists `QUESTION_LANGUAGES`).
- **Accept:** `pip install numpy` in the terminal, then a NumPy program runs from Run; a matplotlib window opens from Run; Python runs meet the limits.
- **Manual test:** a Python question with numpy and a matplotlib plot.

### M15e Project folder for Run + Files panel
- **Goal:** programs can read and write files (`open('data.txt')`, `fopen`, `savefig`), the files stay between runs, and the student can create, edit and look at them without the terminal.
- **Touches:** Run's cwd is the exam `workspace` (the terminal's folder), not the wiped per-question run folder, which keeps only the source, the build output and helper files; the workspace is also on `PYTHONPATH`, `NODE_PATH` and the C/C++ include path. A light Files panel in the student exam screen (list, new file/folder, rename, delete, text editor, in-app image preview) over `files:*` IPC with a path-escape guard and size limits. Teacher switch per exam (`exams.files_enabled`, migration 0007, default on). Files stay on the student PC: not submitted, not graded.
- **Accept:** a Python or C program reads a file made in the Files panel; a file the program writes shows in the panel after the run and is still there after the next run; a `savefig` PNG previews in the panel; the terminal's `dir` shows the same files; a path that climbs out of the folder (`..`, a drive letter, a junction) is refused; with Files off the button is gone and the IPC refuses.
- **Manual test:** `pnpm dev:teacher` and `pnpm dev:student`, `cargo build -p eg-runner` first. (1) Files → New file `data.txt`, type text, run `print(open('data.txt').read())`. (2) Run `open('out.txt','w').write('hi')` twice; `out.txt` shows in the panel after Refresh or the run. (3) With matplotlib installed, `plt.savefig('a.png')`; click `a.png` to preview. (4) In the terminal, `dir` shows the same files; `fopen("data.txt","r")` works in C. (5) Try the names `..\x`, `con` and `a:b`; each is refused. (6) Turn Files off in the exam settings (draft or ready exam) and host a new run: the Files button is gone.

### M15f Teacher-provided exam files
- **Goal:** the teacher attaches the files a question needs (a data file, a picture a program loads) to the exam once, and every student gets them in their project folder without doing anything.
- **Touches:** migration 0008 `exam_files` + bytes on disk (`<dataDir>/exam-files/<examId>/<fileId>`); teacher routes `GET/POST/DELETE /exams/:id/files` (raw upload, replace by name, draft/ready only, 25 MB per file, 50 MB and 50 files per exam); duplicate copies the files and deleting an exam removes them; `SessionState.examFiles` (the manifest: id, name, size, SHA-256); student route `GET /api/v1/exam-files/:fileId` (session token, own exam, hosting or running, Files switch on); a shared file-name rule (`checkFileName`); student main `ExamFileSync` + streaming `downloadExamFile` over the pinned connection: files download into a hidden staging folder in the lobby and are copied into the project folder when the exam runs; "Exam files" section in the teacher's exam page; progress and Try again in the lobby and the exam screen.
- **Accept:** a file attached to a draft exam is in every joined student's project folder right after Start; the lobby shows the download finish; a file the student deleted does not come back after a reconnect or restart; a wrong checksum, wrong size or a name that is not allowed is never written; with the Files switch off, nothing is sent; after hosting begins the teacher cannot change the files.
- **Manual test:** `pnpm dev:teacher` and `pnpm dev:student`. (1) Attach `data.csv` and `logo.png` to a draft exam, mark it ready, host. (2) Join as a student: the lobby says "Your exam files are ready (2)". (3) Start: both files are in the Files panel, and a Python program reads `data.csv`. (4) Delete `data.csv`, close and reopen the student app, rejoin: it is not back. (5) Try a file over 25 MB, a name with `:` and a second file with the same name in other letter case (it replaces). (6) Duplicate the exam: the files are copied. (7) Once hosting, Add files is disabled and the route answers 409.

### M16 Autosave + versions
- **Goal:** answers autosave to the server as versions.
- **Touches:** migration (answer_versions), `answer.save`/`answer.ack`, `answer.select`, batched writer (250 ms/200 rows), student autosave scheduler (10 s on change + Run/switch/submit triggers).
- **Accept:** saves are idempotent on clientSeq. Versions are stored per language. 200 sim students saving every 10 s → server CPU stays low and nothing is lost.
- **Manual test:** type, wait 10 s, and check the version rows. Switch language → a `switch_language` version is saved.

### M17 Offline queue, reconnect, same-PC resume
- **Goal:** no work lost when the network drops or the app or PC restarts.
- **Touches:** student `queue/` (encrypted JSONL), reconnect with backoff, `hello.resume`, session file, restore of buffers and the selected language, server-side `network_lost/restored` events.
- **Accept:** unplugging the laptop's network for 60 s while typing, then reconnecting → every edit arrives. Killing the student app and relaunching → resumes into the exam on the same PC.
- **Manual test:** do exactly the above on the laptop, then compare the final version with what was on screen.

### M18 Submit, auto-submit, receipt, student-sim v2 — **Phase 3 demo**
- **Goal:** final submission with a hash + receipt, auto-submit at the deadline with grace.
- **Touches:** migration (final_answers), submit flow + confirmation dialog, deadline scheduler (survives restart), grace handling, receipt screen, sim v2 (answers, autosaves, random disconnects, submit).
- **Accept:** submitted answers can't be changed (server rejects later saves). At time-up, everyone not submitted is auto-submitted with their selected language. Queued pre-deadline saves within 60 s are included.
- **Manual test (demo):** the laptop student does a full exam, pull the cable mid-way, reconnect, submit → receipt hash matches the DB. Run a 2-minute exam with 200 sim students to test auto-submit.

---

### M19 SPIKE — Agent service + helper sees the desktop
- **Goal:** prove that a service-launched SYSTEM helper in the user session can hook foreground changes and capture a non-black screenshot on the target hardware.
- **Touches:** `agent/eg-agent` (minimal: install/uninstall, session-logon launch of the helper, foreground hook log, one BitBlt capture to `%ProgramData%\ExamGuard\spike\`).
- **Accept:** on the laptop, as a standard user, switching windows logs the exe + title, the screenshot shows the real desktop, the student can't kill the helper or stop the service, and it survives logoff/logon. Learnings recorded.
- **Manual test:** install as admin on the laptop, log in as a standard user, switch to Chrome, check the log + JPEG, and try `taskkill` and `sc stop`.

## Phase 4 — Monitoring agent
*Done when: opening Chrome or WhatsApp on a student PC creates a logged event with a screenshot.*

### M20 Agent service skeleton + helper lifecycle
- **Goal:** a production-shaped service: SCM integration, config, logging, helper launch/restart, `--console` mode.
- **Touches:** `agent/eg-agent/src/{service,helper,session,config,log}.rs`, `scripts/dev-install-agent.ps1` (admin, laptop/dev only) + uninstall.
- **Accept:** killing the helper → restarted within 1 s and logged. `--console` runs both parts without SCM.
- **Manual test:** install on the laptop, kill the helper as admin, and watch it return.

### M21 Pipe link, heartbeat, system check
- **Goal:** the student app and agent talk over the verified named pipe. Join requires a healthy agent.
- **Touches:** `agent/.../pipe.rs` (peer verification), shared pipe schemas, `apps/desktop/main/agent-client.ts` + fake agent (`EG_FAKE_AGENT=1`), system-check screen, `/join` enforcement, `agent.status` WS message.
- **Accept:** join is refused with the agent stopped (admin-stopped) or the helper missing. A fake client process (e.g. PowerShell pipe client) is rejected.
- **Manual test:** on the laptop, stop the service as admin → the join screen shows "Monitoring agent not running". Start it → join works.

### M21a SPIKE — Internet block with WFP (laptop only)
- **Goal:** the agent service blocks outbound internet while keeping the teacher PC reachable, and can never leave the PC offline.
- **Touches:** `agent/eg-agent` WFP code (dynamic session, permit loopback/DHCP/teacher address, block other outbound on all interfaces), lease timer, cleanup on service start/stop, a CLI test switch in `--console` mode.
- **Accept:** with filters on, a browser and `curl https://example.com` fail while the exam (HTTPS/WSS to the teacher) keeps working; killing the service process restores internet at once; the lease restores it after the app goes silent. Run **only on the second laptop** (manual, admin).
- **Manual test:** as above, plus reboot the laptop mid-block → internet is back after boot.

### M21b Teacher internet toggle
- **Goal:** the teacher turns student internet off/on per exam from the dashboard.
- **Touches:** shared `state.internet`, `POST /exams/:id/actions {type:'internet', enabled}` + `teacher_actions`, pipe `net.set {blocked, allow}` (teacher address from the pinned session), app relays on welcome/state, removal on submit/end/`monitor.stop`, `internet_blocked|internet_allowed` events, dashboard toggle with "applied on N of M PCs".
- **Accept:** toggling off blocks internet on the laptop within 2 s and the event shows; ending the exam or submitting restores it; a late joiner gets the current state; the fake agent (`EG_FAKE_AGENT=1`) acknowledges without touching the network.
- **Manual test:** laptop as student: toggle off → browser fails, exam still works; toggle on → browser works; end exam while off → internet returns.

### M22 Focus tracking, outside time, screenshots → events
- **Goal:** switches away from ExamGuard produce events with screenshots following the policy (switch, title change, every 20 s, ≥5 s gap).
- **Touches:** helper `focus.rs`, `capture.rs`, `policy.rs`, `exam.window` handling, evidence forwarding app → server, binary screenshot upload, server event store + screenshot files (severity from a simple placeholder rule until M31), minimal teacher "Events" list with a screenshot viewer.
- **Accept:** a switch to Chrome → `focus_lost` with exe/title + screenshot. Switching tabs → a title-change shot. Returning → `focus_returned` with duration. Outside totals add up.
- **Manual test:** on the laptop, open Chrome to a site for 45 s → about 4 screenshots, and the teacher list shows them.

### M23 App launches + processes at start
- **Goal:** every new user process is reported, and the process list is captured at exam start.
- **Touches:** service `procwatch.rs`, `processes_at_start` evidence, teacher events list shows them.
- **Accept:** launching Notepad (even without focus) logs `app_launched`. The start snapshot lists the running apps.
- **Manual test:** start the exam with Spotify/Discord open, then launch Notepad mid-exam.

### M24 Evidence buffer, app relaunch, tamper lock
- **Goal:** evidence survives an app kill or reboot. Heartbeat loss locks the student.
- **Touches:** service `buffer.rs` (AES-GCM, ack-based delete), helper `relaunch.rs`, app heartbeat watchdog → lock overlay + `agent_lost` critical, teacher unlock stub, `monitor.start/stop` tied to student state.
- **Accept:** killing ExamGuard → it relaunches within ~3 s and the events from the gap arrive with screenshots. Heartbeat loss → locked + critical event. Monitoring stops after submit.
- **Manual test:** on the laptop, kill ExamGuard from Task Manager, open Chrome while it's down, and confirm the events appear after the relaunch.

### M25 Clipboard and paste control
- **Goal:** the clipboard is cleared at start, and only text copied inside the exam can be pasted.
- **Touches:** student main clipboard clear, renderer copy/cut tracking (hash set), Monaco + textarea paste interception, `paste_blocked` event.
- **Accept:** pasting from Notepad is blocked and logged. Copy/paste between questions works.
- **Manual test:** copy from a browser, paste in the editor → blocked. Copy inside the exam → paste works.

### M26 [D] Second monitor + Task Manager / secure desktop
- **Goal:** detect monitor-count changes and Ctrl+Alt+Del / Task Manager.
- **Touches:** helper `monitors.rs`, `desktop.rs`; procwatch `taskmgr.exe` rule; system check reports monitors at join.
- **Accept:** plugging a monitor mid-exam → `monitor_changed`. Ctrl+Alt+Del → `secure_desktop`. Task Manager → `taskmgr_opened`.
- **Manual test:** on the laptop with an external monitor, press Ctrl+Alt+Del and open Task Manager.

### M27 [D] Large text insertion detection
- **Goal:** flag one-shot insertions over 200 chars or 5 lines that weren't an allowed paste.
- **Touches:** Monaco `onDidChangeModelContent` + textarea input handler, `large_insertion` event with size.
- **Accept:** an AutoHotkey or typing-tool burst is flagged. Normal typing and internal paste aren't.
- **Manual test:** use a text-expander or `SendKeys` script to type 300 chars at once.

### M28 Phase 4 integration — **Phase 4 demo**
- **Goal:** end-to-end on the laptop with the installed service and a standard user account.
- **Touches:** fixes only. Update `architecture.md` §3 with what the spike/agent work taught.
- **Accept / demo:** a student on the laptop opens Chrome and WhatsApp (web or desktop) → the teacher sees logged events with screenshots, and nothing is lost if ExamGuard is killed.

> **CHECKPOINT after Phase 4.** Compare progress with available time. If behind, move [D] milestones (M26, M27, M34, M41, M44) to Stage 2 and log the decision in `progress.md`.

---

### M29 SPIKE — Thumbnails for 200 simulated students
- **Goal:** prove the subscription model and server fan-out at scale.
- **Touches:** sim sends synthetic 15 KB JPEGs on `thumb.start`, server latest-frame cache + forwarding, a throwaway grid page.
- **Accept:** 200 sim students connected, a 30-visible page at 4 s → server CPU under ~15 % on the dev PC, teacher traffic ≈110 KB/s, page switch updates within one interval. Numbers recorded.
- **Manual test:** run the sim and watch Task Manager while flipping pages.

### M30 SPIKE — WebRTC live view on the LAN
- **Goal:** prove desktop capture → WebRTC → teacher renderer with signaling over the existing WS.
- **Touches:** student `live/` capture + peer, server `rtc.signal` relay, teacher test viewer.
- **Accept:** laptop screen visible on the teacher PC at ≥5 fps, <1 s latency, host candidates only, works with the teacher on Wi-Fi.
- **Manual test:** open a live view of the laptop and move a window.

## Phase 5 — Live dashboard
*Done when: the teacher watches students live, sees alerts, and acts on them.*

### M31 Event classification, risk score, alert feed
- **Goal:** the server assigns severities from config, computes the risk score, and streams a filterable alert feed.
- **Touches:** `server/events/{classify,risk}.ts` + tests (high-severity app list, long-outside threshold), `alert` WS message, alert feed panel with severity filter.
- **Accept:** Chrome in focus → High. Short Notepad switch → Low. Risk score updates live. Feed filters work.
- **Manual test:** generate events from the laptop and the sim's scripted events, then filter by High.

### M32 Roster + student detail
- **Goal:** sortable roster (risk, name, status) and a student detail panel with event timeline + screenshots.
- **Touches:** dashboard page (TanStack Table), student detail drawer, screenshot viewer, outside-time totals.
- **Accept:** 200 sim rows sort smoothly. The timeline shows screenshots inline.
- **Manual test:** sort by risk with the sim running and open the laptop student's detail.

### M33 Thumbnail grid
- **Goal:** paginated grid (25–30/page) streaming only the visible students.
- **Touches:** student main capture (`desktopCapturer`, 320 px JPEG) on `thumb.start/stop`, grid UI with sort and paging, built on the M29 learnings.
- **Accept:** only visible students send frames (check in server stats). Thumbnails aren't stored.
- **Manual test:** grid shows the laptop screen updating every ~4 s. Change page → its stream stops.

### M34 [D] WebRTC live view
- **Goal:** click a student → a live view panel (max 2 open), built on M30.
- **Touches:** student `live/`, teacher live panel, `live.*` messages, auto-close after 60 s hidden.
- **Accept:** opening and closing 10 times leaves no leaked peer connections. Failure falls back to the fast thumbnail.
- **Fallback if deferred:** "fast thumbnail" mode in M33 (960 px every 1 s for the selected student).
- **Manual test:** open a live view of the laptop, close it, reopen it.

### M35 Per-student actions
- **Goal:** message/warning, lock/unlock, extend time, end exam (save + submit), reset session.
- **Touches:** action endpoint + `teacher_actions` log, student popups, lock overlay, deadline recompute, reset clears token/device.
- **Accept:** each action reaches the student within 1 s and is logged. Reset lets the student join from another PC.
- **Manual test:** run each action on the laptop student. Reset, then join the same ID from the dev-PC student profile.

### M36 Global actions + audit view — **Phase 5 demo**
- **Goal:** extend all, end all, broadcast, and a teacher action log view.
- **Touches:** global action endpoint, confirmation dialogs, audit log tab.
- **Accept / demo:** the teacher watches the laptop + 200 sim students, sees a Chrome alert from the laptop, opens its live view (or fast thumbnail), warns and locks the student, extends time for all, and ends the exam.

---

## Phase 6 — AI grading & results
*Done when: a finished exam is graded, reviewed, finalized, and exported.*

### M37 Provider interface, prompt, validation, Gemini adapter
- **Goal:** `GradingProvider` + versioned prompt + strict output validation, FakeProvider with fixtures, Gemini adapter.
- **Touches:** `server/grading/{provider,prompt,validate}.ts`, `providers/{gemini,fake}.ts`, `fixtures/grading/`, `scripts/record-fixture` (manual, uses the teacher key, never in tests).
- **Accept:** validation rejects awarded > max, non-half steps, wrong criteria and a total mismatch. All tests use the fake. Inputs contain only the anon ID.
- **Manual test:** run a one-answer smoke script against real Gemini with your key, then inspect the stored raw response.

### M38 Grading pipeline + progress
- **Goal:** "Evaluate with AI" grades question by question with concurrency, retries, flagging and progress.
- **Touches:** migrations (grading_jobs, evaluations, answer_grades), `pipeline.ts`, resumable jobs, `grading.progress`, exam states Ended → Grading → In review, grading UI.
- **Accept:** with FakeProvider fixtures that include 429s and invalid JSON → retries happen, persistent failures become `needs_manual`, and a restart mid-job resumes.
- **Manual test:** grade a sim exam with the fake provider (dev toggle), then one small real run.

### M39 Review screens
- **Goal:** per-question table and per-answer view (student answer + language vs sample, criteria, feedback, line notes, event timeline).
- **Touches:** review pages, Monaco read-only diff-like side-by-side view, low-confidence highlighting.
- **Accept:** all statuses are shown, and low confidence is highlighted. The timeline with screenshots is reachable from the answer.
- **Manual test:** browse a graded exam and open a low-confidence answer.

### M40 Accept / edit + history
- **Goal:** the teacher accepts or edits marks and feedback, and the full history is kept.
- **Touches:** accept/edit endpoints writing teacher `evaluations` rows, status transitions (Verified/Modified), history panel.
- **Accept:** edits can't exceed criterion max. History shows every AI and teacher entry in order.
- **Manual test:** edit one criterion, accept another answer, and view the history.

### M41 [D] Re-evaluate with instruction
- **Goal:** re-run the AI with a teacher instruction for one student or all students on a question.
- **Touches:** reevaluate endpoint + job kind, scope selector (include edited?), prompt instruction slot.
- **Accept:** by default Verified/Modified answers are skipped. New results are appended to history.
- **Manual test:** "also accept recursive solutions" on all → only unedited answers change.

### M42 Finalize + CSV export — **Phase 6 demo**
- **Goal:** finalize locks marks, and CSV export produces the required columns.
- **Touches:** finalize endpoint (requires no `pending`/`needs_manual`, takes a backup), CSV builder (UTF-8 BOM for Excel), exports folder.
- **Accept / demo:** a finished exam is graded → reviewed → finalized → exported. The CSV opens correctly in Excel with marks per question, total, event counts by severity and outside time. Edits after finalizing are refused.

---

## Phase 7 — Packaging & hardening
*Done when: one installer works on a fresh Windows PC; 200-student simulation passes.*

### M43 Settings screen
- **Goal:** change password, AI provider/key/model, default duration/monitoring/high-severity list, run limits, port, regenerate cert, manual backup.
- **Touches:** settings pages, `safeStorage` key storage in main, settings schema.
- **Accept:** the key is never visible after saving or present in DB/logs. Changed run limits reach students at the next exam.
- **Manual test:** change each setting, restart, and confirm it persisted. Search the data folder for the key text → not found.

### M44 [D] Data folder relocation + retention
- **Goal:** move the data folder, and purge screenshots older than N days.
- **Touches:** move service (copy, verify, switch, delete old), retention job at startup.
- **Accept:** a move during non-hosting works and is refused while hosting. Purge nulls the paths.
- **Manual test:** move to another drive and restart. Set retention to 0 days on a test exam.

### M45 Installer: build + install type
- **Goal:** electron-builder NSIS installer with a Teacher/Student page and a silent `/TYPE=student|teacher`, bundling MinGW (C/C++ only) + MSYS2 pacman, npm, Python + pip, node-pty, eg-runner and eg-agent. One installer always contains everything.
- **Touches:** `apps/desktop/electron-builder.yml`, `build/installer.nsh`, registry `InstallType`, fuses config (RunAsNode kept on, see progress.md).
- **Accept:** a student install hides Teacher mode. A silent install works from an admin cmd. Installer and installed sizes are recorded in progress.md (target download ≤ 450 MB).
- **Manual test:** install both types on the laptop (uninstalling in between).

### M46 Installer: service, firewall, uninstall
- **Goal:** a student install registers and starts the agent service. A teacher install adds the program firewall rules. Uninstall removes everything.
- **Touches:** NSIS steps calling `eg-agent install/uninstall`, `netsh advfirewall` rules (teacher only), uninstall cleanup (keeps the teacher data folder unless ticked).
- **Accept:** a fresh standard-user login on a student install → agent running. The installer adds no firewall rules on student installs (`netsh advfirewall firewall show rule name=all` diff); internet-off filters (M21b) exist only during an exam.
- **Manual test:** fresh-ish laptop install as Student, dev PC as Teacher, full join.

### M47 Load test: 200 simulated students
- **Goal:** student-sim v3 runs a full exam: join, autosave, events with screenshots, thumbnails on page, disconnects, submit.
- **Touches:** sim scenarios + metrics report (CPU, RAM, event lag, save lag, bandwidth), perf fixes.
- **Accept:** 200 students for 30 min on the dev PC (teacher) with no lost saves or events, p95 save ack < 1 s, alert lag < 2 s. The results table is recorded in progress.md.
- **Manual test:** `pnpm sim -- --students 200 --scenario full --minutes 30`, plus the laptop as a real student.

### M48 Crash-recovery tests
- **Goal:** a scripted and checklist-based verification of every recovery path.
- **Touches:** integration tests (server restart mid-exam, deadline during downtime, duplicate replays), manual checklist in `docs/progress.md`.
- **Accept:** server kill, teacher app kill, student app kill, laptop power-off, cable pull, and agent helper kill all end with no lost work or evidence and correct timers.
- **Manual test:** follow the checklist with the laptop + sim.

### M49 Hardening + lab-IT README — **Phase 7 demo / Stage 1 done**
- **Goal:** security pass and the lab-IT README.
- **Touches:** review rate/size limits, CSP, DevTools off, IPC surface, dependency audit, `docs/lab-it-readme.md` (install, silent flags, SmartScreen/AV, service, firewall, mDNS/subnet, uninstall).
- **Accept / demo:** one installer works on a freshly reset Windows PC (laptop) as Student and on the teacher PC, and the M47 run passes on the final build. Every requirements §3 objective is ticked in progress.md.

---

## Stage 2 (not broken down)
Java support (trimmed JDK, jars in `workspace/lib`) · code typing replay · similarity/plagiarism check · optional strict mode · per-student internet/terminal toggles · package cache on the teacher PC for labs without internet · VM/remote-desktop/USB detection · app integrity/tamper checks · PDF reports and releasing results to students · question bank · MCQ questions · more AI providers (OpenAI) · multiple teachers/admin role · analytics across exams · plus any [D] milestones deferred at the checkpoint. (Python and the interactive terminal moved into Phase 3 on 2026-10-21; Java stays here.)
