# ExamGuard AI — Requirements

Version 1.2 · 2026-10-21 · Source of truth for all design and development decisions.
If anything in later docs conflicts with this file, this file wins until it is explicitly updated.

---

## 1. Overview

ExamGuard AI is a Windows desktop examination platform for university computer labs. A teacher hosts an exam from their own PC; students take it on lab PCs over the local network. It combines exam management, a built-in code editor, live screen monitoring, activity monitoring, and AI-assisted grading — with the teacher making every final decision.

**Main goal:** Let a teacher run, monitor, and grade a programming exam for a full lab from one application, catching cheating through evidence and cutting grading time.

**Security approach:** *Monitor, record, and alert* — not block. Students can technically open other apps or websites, but everything they do outside ExamGuard is logged with a screenshot and shown live to the teacher. The evidence is what deters and catches cheating. The one exception is the teacher's **internet toggle** (8.8): the teacher may turn student internet off for an exam, and ExamGuard always restores it afterwards.

## 2. Context and constraints

| Item | Decision |
|---|---|
| Where exams run | University computer lab, Windows PCs |
| Network | All students and teacher on **one local network (LAN)**; wired recommended |
| Class size | **100–200 students** per exam |
| Hosting | **Teacher's PC is the server.** No cloud server, no VPS |
| Internet | **Available on student PCs** (students install packages from the exam terminal, 8.3). The teacher can turn it **off per exam** from the dashboard; ExamGuard restores it when the student's exam ends. Needed on the teacher PC for AI grading |
| Installation | Lab IT installs ExamGuard on student PCs with administrator rights (needed for the monitoring agent service) — **to be confirmed** |
| Developer | Solo developer, Windows PC, using Claude Code (Pro plan) |
| Pace | Phase-based (section 10). **Stage 1** = core product (~60%); **Stage 2** = everything else |

## 3. Objectives (Stage 1 is done when all of these work)

1. A teacher can create an exam, host it, and run it for up to 200 students without any other tool.
2. Students log in with student ID + exam PIN, answer questions in a built-in editor, run their own code locally, and submit.
3. No student work is lost on app crash, network drop, or power loss (autosave + resync).
4. Every app launch, window switch, and suspicious action on a student PC is logged with evidence (screenshot) and shown live to the teacher.
5. The teacher can see a grid of student screens and a live view of any single student, and can warn, lock, extend time for, or end the exam for any student.
6. After the exam, AI grades every answer against the teacher's sample answer and marking guide; the teacher reviews, edits, or re-evaluates, then finalizes and exports results.

## 4. Non-goals

- Blocking network access beyond the teacher's per-exam internet toggle (no per-site filtering, no changes that outlive the exam)
- **Blocking or closing other apps** (Stage 1; may appear as an optional strict mode in Stage 2)
- Remote / at-home exams, or exams on students' personal laptops
- Webcam or face monitoring
- Running or test-casing code on the teacher PC (grading is AI-only)
- Showing students sample tests, expected output, or hints
- Full LMS features (courses, semesters, gradebooks)
- macOS / Linux support

---

## 5. Architecture decisions

| Area | Decision |
|---|---|
| App | **One Electron + TypeScript desktop app** with two modes: **Teacher mode** and **Student mode** |
| UI | React 18, electron-vite, Tailwind, shadcn/ui, Zustand, TanStack Query/Table |
| Exam server | Node.js + TypeScript (Fastify for HTTPS, WebSocket for real-time), runs **inside the teacher app as a separate background process** (Electron `utilityProcess`), auto-restarted if it crashes |
| Database | **SQLite** (better-sqlite3, WAL mode) on the teacher PC; files (screenshots, exports) in an app data folder |
| Shared code | A shared package with TypeScript types and Zod schemas for every API and message |
| Monitoring agent | **Rust**, runs as a **Windows service** on student PCs (plus a helper in the user session where needed, since a service can't see the desktop). **Observes and reports; its only change to the PC is the teacher's internet toggle** (temporary Windows Filtering Platform filters, always removed when the exam ends or the agent stops). Talks to the student app over a local authenticated channel (named pipe) |
| Code editor | **Monaco** editor embedded in the student app |
| Local code run | Students choose the language per code question (within what the teacher allows). Stage 1: C/C++ via a **bundled MinGW-w64 gcc/g++** trimmed to C/C++ (+ MSYS2 `pacman` for libraries); JavaScript via **Electron's built-in Node runtime** (`ELECTRON_RUN_AS_NODE`) + bundled `npm`; **Python** (bundled Python 3 with tkinter + `pip`). Stage 2: Java (bundled trimmed JDK). The runner is config-driven so adding a language is a config entry |
| Exam terminal | A real shell (ConPTY via node-pty, shown with xterm.js) in the student exam window, in the student's exam workspace, so students install the packages they need. The teacher turns it on/off |
| Screens | Small JPEG thumbnails over WebSocket for the grid; **WebRTC peer-to-peer** (signaled through the exam server) for the single live view |
| AI grading | Behind a **provider interface**; **Google Gemini** adapter first, others (e.g. OpenAI) later. Called from the teacher PC after the exam; teacher enters their API key; model name configurable |
| Repo | Monorepo (pnpm workspaces + Cargo workspace): `apps/desktop`, `apps/server`, `packages/shared`, `agent/` (Rust), `tools/student-sim` |

---

## 6. Roles and login

### Teacher
- Uses ExamGuard in Teacher mode on their own PC.
- Protected by a local teacher password (so a student can't use the teacher PC's app).
- Stage 1: one teacher profile per installation.

### Students
- The teacher imports a **class list as CSV** (columns: student ID, name).
- When the teacher starts hosting, the server generates a **6-digit exam PIN**.
- A student joins with **student ID + exam PIN**; the app shows their name from the class list to confirm.
- Only students on the class list assigned to the exam can join.
- One active session per student ID. A second login attempt is rejected and logged; the teacher can reset a student's session (e.g. if they move to another PC).

---

## 7. Exam workflow

**Exam states:** Draft → Ready → Hosting (lobby open) → Running → Ended → Grading → In review → Finalized

**Per-student states:** Not joined → In lobby → Active → (Locked) → Submitted / Ended by teacher · Disconnected is tracked separately

1. **Prepare** (teacher, anytime, offline): create exam, add questions, set duration and monitoring settings, assign a class list.
2. **Host:** teacher clicks "Start hosting". Server starts, shows exam PIN, PC address, and how many students have joined.
3. **Join:** student app finds the teacher PC automatically on the LAN (mDNS), or the student enters the teacher PC's address manually. Student enters ID + PIN, reads and accepts the monitoring notice, passes a system check (agent running, screen capture working), and waits in the lobby.
4. **Start:** teacher clicks Start. Questions are released, the timer starts, the agent starts monitoring.
5. **During the exam:** students work; autosave runs; agent and app report events; teacher monitors and acts.
6. **End:** student submits, or the exam auto-submits at time-up (server timer is authoritative). Monitoring stops when the student's exam ends.
7. **Grade:** teacher runs AI grading.
8. **Review and finalize:** teacher reviews every answer, adjusts, finalizes, exports.

---

## 8. Stage 1 features

### 8.1 Exam management (teacher)
- Create, edit, duplicate, delete exams.
- Exam settings: title, duration, start mode (teacher starts manually), monitoring settings, assigned class list.
- Question types:
  - **Code question:** problem statement, marks, **allowed languages** (checkboxes; all supported languages ticked by default), optional **note to students** shown with the question (e.g. "Use recursion", "Do not use STL sort"), **sample answer** (in any one language), **marking guide** (language-neutral criteria with marks, e.g. "Correct logic: 5, Edge cases: 3, Clarity: 2"), optional notes for the AI (e.g. "any sorting algorithm is acceptable").
  - **Written question** (theory or numeric answer): question text, marks, sample answer, marking guide, optional notes for the AI.
- Marking guides are stored as structured criteria (name + max marks), so AI output can be validated per criterion.
- Questions have an order; students can move freely between questions.

### 8.2 Student exam client
- Fullscreen exam window that **cannot be closed** until the student submits or the teacher ends their exam. (The student can still switch to other apps — every switch is logged; see 8.5.)
- Shows: question list, current question, timer (synced to server), connection status, a visible "monitoring active" indicator, submit button.
- Written questions: plain text answer box.
- Code questions: Monaco editor (see 8.3).
- Teacher messages and warnings appear as popups.
- When locked by the teacher, the screen shows a lock overlay until unlocked.

### 8.3 Code editor and local run
- **Language dropdown** per code question, listing **only the languages the teacher allowed** for that question. The teacher's note to students is shown with the question.
- **Each language keeps its own code** for that question: switching from C++ to JavaScript and back restores the C++ code. Each language's code is autosaved separately.
- The language **selected at submission** (or at time-up) is the one submitted and graded; the student is shown which language will be submitted.
- Monaco editor with syntax highlighting, basic autocomplete (no AI suggestions), and error underlines from compiler output.
- Panel below the editor with an **input box (stdin)** and **Output / Errors** tabs, showing exit code and run time. An **interactive console** (xterm.js) lets programs that prompt for input step by step be used directly.
- Buttons: **Run**, **Stop**.
- Run happens **on the student's PC only**. It is for the student's own checking; results are **not** used for grading.
- Compile and run settings (same for everyone, configurable in one place):
  - C: `gcc -std=c11 -O2 -Wall`
  - C++: `g++ -std=c++17 -O2 -Wall`
  - JavaScript: Electron's Node runtime
  - Python: bundled Python 3 (with tkinter, so turtle and matplotlib windows work)
  - Stage 2 — Java: bundled JDK (`javac` + `java`); the runner detects the `public class` name and names the file to match; jars from `workspace/lib`
  - Students may add **their own compile/link flags** per answer (e.g. `-lfreeglut -lopengl32`) for the libraries they installed.
- Limits per run: time limit (default 5 s), output cap (default 64 KB), memory limit (default 256 MB, via a Windows Job Object launcher). Exceeding a limit stops the program with a clear message.
- **GUI run mode** for programs that open a window (OpenGL, graphics.h, image viewers): the window is allowed, the time limit is longer (configurable), and Stop always works.
- Runs happen in the student's **exam workspace**; one run at a time; minimum gap between runs (default 2 s). Runs build against the packages installed in the workspace (include/lib paths, `node_modules`, Python packages).
- Every run is logged (timestamp, language, exit status) as an event.
- **No sample tests, expected outputs, or hints are ever shown to students.**

**Exam terminal**
- Each student can install the libraries and packages **they** need (students may choose different languages and packages, so the teacher does not declare them in advance).
- A real terminal (PowerShell) in the exam window, opened in the student's exam workspace (`%LOCALAPPDATA%\ExamGuard\run\<examStudentId>\workspace`). The bundled runtimes and package managers are on PATH: gcc/g++ + MSYS2 `pacman`, Node + `npm`, Python + `pip`. Packages install into the workspace or per-user folders; **no administrator rights** are needed.
- **The teacher turns the terminal on or off** for the exam from the dashboard, optionally "on for the first N minutes" (8.8). When it is turned off or the student's exam ends, the terminal closes and everything started from it is stopped.
- Installing packages needs internet; the teacher keeps internet on while students install (8.8).
- Every command is logged as an event (`terminal_command`, plus `terminal_opened`/`terminal_closed`; recognised installs as `package_installed`), and the teacher can read each student's terminal transcript.

### 8.4 Autosave and submission
- Answers autosave to the server every ~10 seconds when changed, and on every Run, question switch, language switch, and submit. Each save is stored as a **version** with its language (this enables code replay in Stage 2).
- If the network drops, saves are queued locally (encrypted cache) and synced on reconnect; the app reconnects automatically.
- If the student app crashes or the PC restarts, the student can resume on the **same PC** automatically; moving to a different PC needs a teacher session reset.
- Final submission is stored and hashed (SHA-256); the student sees a submission receipt.
- Students may join after the exam has started, but everyone shares the same end time (start + duration + any extensions); late joiners get less time unless the teacher extends theirs. Locking a student does not pause their timer.
- At time-up the server auto-submits the latest saved version. A short grace period (default 60 s) allows queued saves stamped before the deadline to sync.
- Submitted answers cannot be changed.

### 8.5 Monitoring agent (Rust Windows service)
Runs on student PCs. Starts monitoring when the exam starts and stops when the student's exam ends. **It observes and reports; it never blocks or closes apps.** Its only change to the PC is applying the teacher's **internet toggle** (see below).

**Internet toggle (applied by the agent)**
- When the teacher turns internet off, the agent adds **Windows Filtering Platform filters** that block outbound traffic except loopback, DHCP and the teacher PC, so the exam, screens and live view keep working.
- Filters are **temporary** and always removable: they are created in a dynamic session (Windows removes them if the agent process dies), and the agent removes them when the teacher turns internet on, when the student's exam ends (submit/end), when the service stops, when the app has not been heard from for a few minutes (lease), and on service start (cleanup after a crash). A crash must never leave a lab PC offline.
- Each change is reported as an event (`internet_blocked` / `internet_allowed`), so the teacher sees on which PCs it took effect.

**In-app protections (enforced by the ExamGuard app, not the agent)**
- **Exam window:** fullscreen, cannot be closed.
- **Clipboard:** cleared at exam start. The editor and answer boxes accept paste **only of text copied inside the exam**; outside pastes are blocked and logged.

**Detection (logged, screenshotted, alerted)**
- Students **may open other apps and websites.** Every app launch and every switch away from ExamGuard is **logged with a screenshot and shown as a live alert** on the teacher dashboard, including the app name and window title (so e.g. "Chrome — ChatGPT" or "WhatsApp" is visible to the teacher).
- Screenshot policy while a student is outside ExamGuard: one at the switch, one whenever the foreground window title changes (e.g. a new browser tab), and one every 20 s while outside; at most 1 screenshot per 5 s per student.
- Time spent outside ExamGuard is measured per switch and in total.
- Running processes at exam start (shown to teacher).
- Second monitor connected (at join and during the exam).
- Large text insertions in the editor (e.g. many lines appearing at once).
- Task Manager / Ctrl+Alt+Del security screen opened.
- Network disconnection from the teacher PC.

**Tamper protection**
- The agent runs as a Windows service with system rights; a normal student account cannot stop it.
- Agent ↔ student app heartbeat every few seconds. A student cannot join without a working agent. If the heartbeat stops mid-exam, the student's exam is **locked** and the teacher gets a **critical alert**.

### 8.6 Security events
- Every event: student, timestamp (server time), type, severity, details, optional screenshot.
- Severity levels: Low, Medium, High, Critical. Examples:
  - Low: Run executed, short switch away from ExamGuard to a non-browser app
  - Medium: other app opened, switched away from ExamGuard, outside paste blocked, Task Manager opened
  - High: browser or messaging app in focus (e.g. Chrome, Edge, WhatsApp, Telegram), long time outside ExamGuard, large text insertion, second monitor connected mid-exam
  - Critical: agent stopped or heartbeat lost, duplicate login attempt
- The list of apps treated as high severity (browsers, messaging, remote-access tools) is configurable.
- Each student has a **risk score** computed from their events; the dashboard sorts by it.
- Events are buffered locally if the network drops and synced on reconnect.

### 8.7 Live monitoring (teacher dashboard)
- **Thumbnail grid** of student screens (entire screen, not just the ExamGuard window): about 320 px wide JPEG, every ~4 seconds. Grid is **paginated** (~25–30 per page), sortable by risk score, name, or status. Only students on the visible page stream thumbnails. Thumbnails are kept in memory only, not stored.
- Click a student → **live view** of their screen (WebRTC, higher quality), plus their event timeline and status.
- **Live alert feed** across all students, filterable by severity.
- Network budget target: total thumbnail traffic ≈ 1 MB/s or less.

### 8.8 Teacher actions (live)
Per student: send message/warning, lock/unlock screen, extend time, end exam (saves and submits), reset session. Global: extend time for all, end exam for all, broadcast message, **exam terminal on/off** (optionally "on for N minutes"), **student internet on/off** (default on; per student later). Terminal and internet state are server-authoritative, apply to late joiners, and are shown on the dashboard with where they took effect. **All teacher actions are logged.**

### 8.9 AI grading
**Inputs per answer:** question text, question type, allowed languages, the teacher's note to students, total marks, sample answer (and its language), marking guide, optional AI notes, the student's answer and **the language the student used**. The AI grades the logic against the sample answer even when the student's language differs from the sample's, and checks the answer against instructions in the teacher's note (e.g. "use recursion"). **Student identity is never sent** — only an anonymous ID.

**Process**
- Teacher clicks "Evaluate with AI" after the exam.
- Grading runs **question by question across all students** (same instructions for everyone on a question), with a concurrency limit, retries with backoff, and a progress display.
- Low temperature for consistency. Prompt version, provider, model name, and raw response are stored with each evaluation.

**Output (structured JSON, validated)**
```json
{
  "criteria": [{ "name": "Correct logic", "max": 5, "awarded": 4, "reason": "..." }],
  "total": 8,
  "feedback": "Explanation of marks, suitable to show the student",
  "teacher_notes": [{ "line": 14, "issue": "Off-by-one in loop bound" }],
  "confidence": "high | medium | low"
}
```
- Awarded marks must never exceed max; invalid responses are retried, then flagged for manual grading.

### 8.10 Review and results (teacher dashboard)
- Per question: table of all students with AI total, confidence, and status (AI graded / Verified / Modified / Needs manual grading). Low-confidence answers highlighted.
- Per answer: student answer (with the language used) beside the sample answer, AI criteria breakdown, feedback, teacher notes, and the student's event timeline with screenshots.
- Teacher can: **accept**, **edit marks or feedback**, or **re-evaluate with an instruction** (e.g. "also accept recursive solutions") for **one student or all students on that question**.
- **Full history** of every AI evaluation and every teacher edit is kept.
- **Finalize** locks marks.
- **CSV export:** student ID, name, marks per question, total, number of events by severity, total time outside ExamGuard.

### 8.11 Settings
- Teacher password, AI provider + API key (stored encrypted on the teacher PC), model name.
- Default exam duration, default monitoring settings (screenshot on switch, high-severity app list), run limits.
- Data folder location and backup (copy database + files).

### 8.12 Installer
- One Windows installer containing both modes, the bundled runtimes and package managers (MinGW trimmed to C/C++ + MSYS2 pacman, npm, Python + pip), and the Rust agent service. Everything is always included (no optional components), so every lab PC is identical.
- The **installer asks for the install type** (Teacher or Student); lab IT can pass a silent flag (e.g. `/TYPE=student`) for mass deployment.
  - **Student install:** registers the agent service and locks the app to Student mode. The installer adds no firewall rules; during an exam the agent may apply the teacher's temporary internet-off filters (8.5).
  - **Teacher install:** adds inbound firewall rules for the ExamGuard app (exam port and WebRTC) so students can connect. No agent is installed.
- Installer is unsigned in Stage 1; a short README for lab IT covers Windows SmartScreen and antivirus warnings.

---

## 9. Non-functional requirements

**Scale and performance**
- 200 concurrent students on one teacher PC. Suggested minimum teacher PC: 4-core CPU, 8 GB RAM, wired LAN (to validate in testing).
- The teacher PC may be a laptop on Wi-Fi: manual IP entry must work, and the teacher PC's IP must stay the same during an exam.
- Database writes batched where possible (events, autosaves).

**Reliability**
- Teacher PC sleep is blocked while hosting.
- If the server process restarts, it resumes the exam from the database (timer based on stored start time); students reconnect automatically.
- Students' work is never lost: local queue + server versions.

**Security**
- All student ↔ server traffic encrypted (TLS with a self-signed certificate generated by the teacher app). The certificate fingerprint is published in the mDNS record and pinned by the student app. With manual IP entry, the student app shows a 4-character code derived from the fingerprint that must match the code on the teacher's hosting screen. A pinned student never accepts a different certificate during the exam.
- Authenticated sessions (token per student per exam), rate limiting, strict validation of every message (Zod), message size limits.
- Server only accepts student connections while hosting.
- Electron security best practices: context isolation, sandboxed renderer, no Node in renderer, DevTools disabled in release builds. Exception: the `RunAsNode` fuse stays enabled because the JavaScript runner uses `ELECTRON_RUN_AS_NODE` (alternative if this becomes a problem: bundle a standalone `node.exe`).
- The exam terminal runs as the student user (no elevation), inside a Job Object, and only while the teacher has it on. Terminal input/output stays in student main and the renderer's xterm.js view; the renderer never gets Node access.
- Internet-off filters are applied only by the agent service, only during an exam, only on the teacher's instruction relayed through the authenticated app ↔ agent pipe, and are removed by every exit path listed in 8.5.

**Privacy**
- Students see and accept a monitoring notice before the exam; a visible "monitoring active" indicator during the exam.
- All data stays on the teacher PC. Only anonymized answers are sent to the AI provider during grading.
- Screenshots stored only for logged events. Configurable data retention.
- Check the AI provider's current data-use terms before real exams; the paid tier is preferable for student data.

**Testability**
- No lab access until Stage 1 is built: development and testing use the dev PC, a second laptop on the same LAN, and a **student simulator tool** (`tools/student-sim`) that simulates up to 200 students.
- Tests never call the real AI API; they use recorded responses.

---

## 10. Development phases

Each phase ends with something that **works and can be demonstrated**. Phases are done in order, at the developer's own pace. Each phase is broken into small milestones in `docs/milestones.md`, each completable in one focused Claude Code session.

### Stage 1 — Core product

| Phase | Goal | Done when |
|---|---|---|
| **1. Foundation** | Monorepo skeleton, shared schemas, exam server in the teacher app, SQLite, teacher login, Teacher/Student mode | Teacher app starts, server runs, database created, both modes open |
| **2. Exam setup & joining** | Class list import, exam and question editor, hosting, PIN, LAN discovery + manual IP, TLS, student login, lobby | A student on another PC joins an exam and waits in the lobby |
| **3. Taking the exam** | Exam client, Monaco editor, language dropdown, local run (C, C++, JS, Python) with limits, exam terminal with package installs (teacher on/off, logged), workspace runs, GUI run mode, interactive console, autosave, offline queue, reconnect, submit, auto-submit | A student completes and submits a full exam, surviving a network drop |
| **4. Monitoring agent** | Rust service + user-session helper, named-pipe link to the app, app launches, window switches, time outside ExamGuard, screenshots, second monitor, Task Manager, heartbeat + tamper lock, clipboard/paste control, teacher internet toggle (WFP filters) | Opening Chrome or WhatsApp on a student PC creates a logged event with a screenshot |
| **5. Live dashboard** | Live alert feed, events, risk score, thumbnail grid (paginated), WebRTC live view, teacher actions (warn, lock, extend, end, reset, broadcast) | Teacher watches students live, sees alerts, and acts on them |
| **6. AI grading & results** | Provider interface + Gemini adapter, grading pipeline, review screen (accept / edit / re-evaluate), history, finalize, CSV export | A finished exam is graded, reviewed, finalized, and exported |
| **7. Packaging & hardening** | Settings screen, Windows installer, lab-IT README, load test with 200 simulated students, crash-recovery tests, bug fixing | One installer works on a fresh Windows PC; 200-student simulation passes |

**Checkpoint after Phase 4:** review progress against available time. If behind, lower-priority milestones (marked as deferrable in `docs/milestones.md`) move to Stage 2.

**Risky parts to prove early** with small proof-of-concept spikes, before their phase: the Rust service + user-session helper seeing the desktop and taking screenshots; thumbnail streaming for 200 simulated students; WebRTC live view on the LAN; the exam terminal (node-pty under Electron, package managers working without admin rights); blocking internet with WFP filters from the service and always restoring it.

### Stage 2 — Remaining features (after Stage 1)

- **Java support:** bundled trimmed JDK, runner config entry, jars from `workspace/lib` on the classpath
- Code typing replay (built on Stage 1 autosave versions)
- Similarity / plagiarism check between students' answers
- **Optional strict mode:** close non-allowed apps automatically, block Alt+Tab / Windows key shortcuts, lock on focus loss
- Per-student internet and terminal toggles; a package cache/mirror on the teacher PC for labs without internet
- Virtual machine and remote desktop detection; USB storage detection
- App integrity / tamper checks of the student app
- PDF reports; releasing results/feedback to students
- Question bank and reusing questions across exams
- MCQ questions
- More AI providers (e.g. OpenAI)
- Multiple teachers / admin role, bulk management
- Analytics across exams

---

## 11. Known limitations (accepted)

- **Students can reach the internet during the exam unless the teacher turns it off.** While it is on, ExamGuard records its use (app, window title, screenshot, time spent) and alerts the teacher live. Invigilators and the teacher's judgment act on the evidence.
- The internet toggle depends on the agent service and on lab policy: a group policy that forbids local firewall/WFP changes stops it from working (the dashboard shows where it did not take effect). A student's own phone is outside its reach.
- The exam terminal runs inside ExamGuard, so using it is not a "switch away" event. Commands are logged and the transcript is readable, but what a student reads in the terminal (e.g. output of an AI command-line tool) is only visible in that transcript.
- Package installs need internet (the teacher keeps it on while students install). Reboot-restore software (e.g. Deep Freeze) wipes installed packages on reboot.
- Window titles and screenshots show *that* a student used a browser or messaging app, and usually *what* was on screen, but not every keystroke or page visited.
- Ctrl+Alt+Delete cannot be blocked by any app; it is detected and logged.
- Phones, paper notes, and talking to neighbors are outside software control; invigilation and (Stage 2) similarity checks address this.
- AI grading judges code by reading it, not running it; it can miss subtle bugs. Teacher review is required before finalizing.
- Monitoring depends on the agent being installed as a service with administrator rights.

## 12. Assumptions to confirm

- Lab IT installs ExamGuard with administrator rights on student PCs.
- Lab PC environment (antivirus/EDR, reboot-restore software, group policies) doesn't block the agent or screen capture — confirm with lab IT before a real exam.
- All students on one subnet so mDNS discovery works; manual address entry is the fallback.
- If lab PCs use reboot-restore software (e.g. Deep Freeze), a reboot wipes the student app's local queue; only work not yet synced to the server is at risk.
- The teacher PC's Windows network profile is set to **Private** during exams (a Public profile blocks mDNS and inbound connections).
- Lab policy allows the agent service to add temporary WFP filters, and the lab network allows package downloads (npm, PyPI, MSYS2) while internet is on.

## 13. Confirmed decisions

| Decision |
|---|
| UI stack: React 18 + electron-vite + Tailwind + shadcn/ui + Zustand + TanStack |
| AI grading behind a provider interface; Gemini first, OpenAI later; small API budget, so tests use recorded responses |
| No lab access until Stage 1 is built; test with dev PC, a second laptop on the same LAN, and the student simulator (no VMs: Windows 11 Home has no Hyper-V) |
| Unsigned installer in Stage 1; lab-IT README covers SmartScreen and antivirus warnings |
| Teacher PC may be a laptop on Wi-Fi; manual IP fallback and a fixed IP during exams |
| ~~No internet blocking~~ (replaced 2026-10-21, below); cheating is handled by monitoring, evidence, and the teacher's judgment |
| 2026-10-21: Students may choose their own languages (within the teacher's allowed list) and packages, so they install packages themselves in a teacher-controlled **exam terminal**; every command is logged |
| 2026-10-21: The teacher can turn **student internet off/on** per exam; the agent applies temporary WFP filters that are always restored |
| 2026-10-21: **Python (with pip)** moves from Stage 2 into Stage 1; **Java stays in Stage 2**; the interactive console moves into Stage 1 |
| 2026-10-21: Bundle size: MinGW is trimmed to C/C++ only; one installer always contains everything (target download ≤ 450 MB) |
| Phase-based plan with no fixed deadlines; work proceeds at the developer's pace |
