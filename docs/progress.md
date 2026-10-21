# Progress

Read this first every session. Update it at the end of every session.

## Current status
- **Stage:** 1
- **Phase:** 2 — Exam setup & joining
- **Current milestone:** M14 built, automated checks pass, manual check pending. Phase 2 accepted.
- **Next step:** run the M14 manual test, then start M15 (code run). 

## Completed milestones
Format: `- M01 Monorepo skeleton — <date> — <one-line note>`
- M01 Monorepo skeleton — 2026-10-18 — pnpm + Cargo workspaces; build/test/lint/typecheck/clippy all pass; `any` and `unwrap()` are rejected.
- M02 Electron shell + mode selection — 2026-10-18 — secure window, per-profile mode.json, student install lock; manual check passed 2026-10-21.
- M03 Exam server in a utilityProcess — 2026-10-18 — Fastify loopback `/api/v1/health` with token check, supervised by main with backoff restart, status chip + restart banner; manual check passed 2026-10-21.
- M04 SQLite + migrations — 2026-10-18 — better-sqlite3 13, migration runner on `user_version`, `0001_init` (settings, teacher), opened by the server at start; manual check passed 2026-10-21.
- M05 Teacher password and login gate — 2026-10-19 — scrypt password, `/auth/status|setup|login|logout` with lockout, setup/login/shell screens behind a gate; manual check passed 2026-10-21.
- M06 Class list CSV import — 2026-10-19 — `0002_class_lists`, server-side papaparse import with dry-run preview and per-row errors, `/class-lists*` endpoints, Class lists page (TanStack Table); manual check passed 2026-10-21.
- M07 Exam CRUD and settings — 2026-10-19 — `0003_exams`, exam state machine, `/exams*` (create, edit, duplicate, delete), Exams page + settings form; manual check passed 2026-10-21.
- M08 Question editor — 2026-10-19 — `0004_questions`, question repo + routes, `/ready` and `/unready` with reasons, duplicate copies questions, Question editor UI with Monaco; manual check passed 2026-10-21.
- M09 Hosting: TLS, PIN, student listener — 2026-10-20 — self-signed ECDSA cert + 4-char code, `/exams/:id/host|stop-hosting|hosting`, student HTTPS `/info` on 47820 only while hosting, hosting panel, sleep blocker; manual check passed 2026-10-21.
- M10 Discovery + manual IP + cert pinning — 2026-10-20 — server advertises `_examguard._tcp` (TXT v/exam/fp) while hosting, student main browses it and pins the cert by fingerprint, Find exam screen with manual IP + 4-char code; manual check passed 2026-10-21.

- M11 Student join + monitoring notice — 2026-10-20 — `0005_exam_students` (+ events, teacher_actions), `/join` + `/join/confirm`, one session per student with duplicate-login rejection, student ID/PIN, name and notice screens; manual check passed 2026-10-21.
- M12 WebSocket session, lobby, student-sim v1 — 2026-10-20 — student `wss /ws` (hello/welcome, ping/pong, 15 s idle drop, connected flag), teacher `ws /ws?token=` roster + counts with 250 ms batching, `SessionHub`, pinned `SessionClient` in student main, lobby screen, live hosting panel, `tools/student-sim`; 200 sim students connect in about 1.4 s; manual check passed 2026-10-21.
- M13 Start + exam client shell — 2026-10-21 — `POST /exams/:id/start` (hosting→running), shared deadline for late joiners, `state` push + welcome with student-safe questions, fullscreen non-closable student window, question nav, written answer box (memory only), server-offset timer; manual check passed 2026-10-21.
- M14 Monaco + per-language code buffers — 2026-10-21 — Zustand `answers[questionId][language]`, language dropdown limited to allowed languages, "Will submit: X" badge, local-worker Monaco on the student exam screen; manual check pending.

**Update 2026-10-21:** the user ran the manual tests for M02–M13 and reports they pass. The "Done when" line below is therefore treated as met, and Phase 2 is accepted. The details of that run (which machines, which steps) were not recorded; the exceptions are listed under Known issues (M10 cert-mismatch by hand, M02 packaged-build checks).

## Phase 2 review (2026-10-20)
Checked against requirements.md §10 and the M06–M12 Accept lines. Nothing was fixed in this session and the suite was not re-run (285 tests were green at M12).

**"Done when": a student on another PC joins an exam and waits in the lobby — NOT yet demonstrated (when written; since met, see the update above).** The whole path is built (discover or manual IP → cert pin → PIN + ID → name → notice → WS lobby → teacher roster), but it has never been run on a second machine. Every milestone from M02 on is still "manual check pending".

| M | Accept line | Verdict |
|---|---|---|
| M06 | BOM, quotes, duplicate and blank IDs reported; list in use can't be deleted | Met by tests; page unverified by hand |
| M07 | Duplicate copies settings and questions; bad transitions rejected | Met by tests (`assertTransition` is used by hosting) |
| M08 | Marks = sum of criteria; Ready fails with reasons; reorder persists | Met by tests; Monaco never run in the app |
| M09 | `/info` works while hosting and is refused after; sleep blocked | Met by tests; `powercfg /requests` check pending |
| M10 | LAN discovery, manual IP, mismatched cert refused | Met by tests and a bonjour smoke run; the mismatch can't be triggered by hand (nothing regenerates the cert) |
| M11 | Wrong PIN or unlisted ID rejected; other device rejected + event; same device resumes | Met by tests; two-profile run pending |
| M12 | Roster within 1 s; disconnect shown; 200-sim stable | Met by the scripted 200-student run; Electron screens and laptop run pending |

**Reported bugs (confirmed in code, to fix before the Phase 2 manual run)**
1. Student retry timer is static. `JoinForm.tsx` bakes `(try again in N s)` into the error text once. The teacher `LoginScreen.tsx` already has a ticking `waitSec` and a disabled button; the student form has neither. Fix: tick `waitSec` down, show "Try again in N s", disable Join until 0, clear the message at 0.
2. Hosted exam is not obvious in the Exams list and can't be stopped there. `ExamsPage.tsx` shows the state as plain text, with no badge. Stop hosting exists only in the detail page. The row button "Questions" opens the exam detail page (Ready, Host, Stop, live roster), so the label is wrong. Fix: a "Hosting" badge on the row, a **Stop hosting** button on that row (with confirm, reuse `examApi.stopHosting`), and rename "Questions" to "Open".

**Other gaps found** (also listed under Known issues): no way to regenerate the cert from Settings; no teacher "reset session"; students are not told when hosting stops; a failed `resume()` leaves the panel on "Loading hosting details…".

## Decisions log
Newest at the bottom. Format: `date — decision — why (doc that owns the detail)`.

**From requirements.md §13 (confirmed)**
- 2026-10-16 — UI stack: React 18 + electron-vite + Tailwind + shadcn/ui + Zustand + TanStack.
- 2026-10-16 — AI grading behind a provider interface; Gemini first, OpenAI later. Small API budget, so tests use recorded responses.
- 2026-10-16 — No lab access until Stage 1 is built. Test with the dev PC, a second laptop and the student simulator (VMs dropped in v1.1).
- 2026-10-16 — Unsigned installer in Stage 1. The lab-IT README covers SmartScreen and antivirus warnings.
- 2026-10-16 — The teacher PC may be a laptop on Wi-Fi. Manual IP fallback, and a fixed IP during exams.
- 2026-10-16 — No internet blocking. Cheating is handled by monitoring, evidence and the teacher's judgment.
- 2026-10-16 — Phase-based plan with no fixed deadlines.

**Planning session answers (user)**
- 2026-10-17 — Install type is chosen in the installer (Teacher/Student, silent `/TYPE=`). Student = agent + locked to Student mode. Teacher = firewall rule, no agent. Resolves the §8.12 conflict. (milestones M45–M46)
- 2026-10-17 — The agent relays only through the student app. It buffers evidence on disk while the app is down and the helper relaunches the app. No direct agent → server link. (architecture §3)
- 2026-10-17 — Late join allowed. Everyone shares one end time (start + duration + extensions). (architecture §6)
- 2026-10-17 — Screenshots while outside ExamGuard: at the switch, on a title change, and every 20 s, at most 1 per 5 s. (architecture §3)
- 2026-10-17 — TLS trust: fingerprint in the mDNS TXT record, pinned. With manual IP, a 4-char visual code is compared with the teacher screen. (architecture §2)
- 2026-10-17 — Test hardware: dev PC + second laptop on the same LAN. No VMs (Windows 11 Home has no Hyper-V). Manual agent tests run on the laptop.
- 2026-10-17 — Half marks. Stored as integer half-units. (data-model)

**Planning session decisions (Claude, not in requirements)**
- 2026-10-17 — The Electron app captures thumbnails + WebRTC. The Rust helper captures event screenshots only. (architecture §3, §5)
- 2026-10-17 — The helper runs with a SYSTEM token in the user session (unkillable by the student). The service restarts it. (architecture §3)
- 2026-10-17 — Pipe peers verify each other by process image path. Length-prefixed JSON. (protocol §4)
- 2026-10-17 — Severity + risk score are computed on the server. Weights L1/M3/H8/C20 + 1 per minute outside. (architecture §1, M31)
- 2026-10-17 — Teacher UI uses a loopback-only API (127.0.0.1:47821). Students use 0.0.0.0:47820 TLS. (architecture §2)
- 2026-10-17 — Code runs through the Rust `eg-runner.exe` Job Object launcher. JS uses ELECTRON_RUN_AS_NODE, so the RunAsNode fuse stays on. (architecture §4)
- 2026-10-17 — better-sqlite3 with hand-written SQL migrations, no ORM. (data-model)
- 2026-10-17 — Student offline queue = safeStorage-encrypted JSONL. deviceId = hash of MachineGuid. (architecture §6)
- 2026-10-17 — Grace period trusts client timestamps from the server-synced clock (accepted risk).
- 2026-10-17 — Lock doesn't pause the timer. One hosted exam per teacher PC. English-only UI. No teacher password recovery in Stage 1.
- 2026-10-17 — Exam window is fullscreen but not always-on-top (keeps "monitor, don't block").
- 2026-10-17 — Re-evaluate-all skips Verified/Modified unless included.
- 2026-10-17 — Automatic DB backup at exam end and before finalize.
- 2026-10-17 — requirements.md updated to v1.1 to match the planning decisions: installer install type (§8.12), late join + shared end time + lock doesn't pause the timer (§8.4), screenshot policy (§8.5), TLS pinning + visual code and the RunAsNode exception (§9), no VMs (§9, §13), reboot-restore and Private network profile assumptions (§12).

**M01**
- 2026-10-17 — TypeScript pinned to `~6.0`. typescript-eslint 8.x supports `<6.1`, and TS 7 is now the npm latest. Revisit when typescript-eslint supports 7. (CLAUDE.md)
- 2026-10-17 — Tool versions at skeleton time: ESLint 10 (flat config, typescript-eslint `strict`), Vitest 5 (root `projects`), Zod 4, Prettier 3. Prettier ignores Markdown so the docs keep their hand formatting.
- 2026-10-17 — `packages/shared` builds to `dist/` with `tsc` (NodeNext ESM, `.js` import suffixes). Schemas live in `src/protocol/`, one file per schema group, named after what it exports.
- 2026-10-17 — Rust: `clippy::unwrap_used = deny` at workspace level, allowed in tests via `clippy.toml`. `rust-toolchain.toml` pins stable + `x86_64-pc-windows-msvc`.

**M02**
- 2026-10-18 — Tailwind v4 (`@tailwindcss/vite`, tokens in `@theme`, no tailwind.config). shadcn is initialised by hand (`components.json`, `cn()`, Button, Card); add components as needed.
- 2026-10-18 — Install type read with `reg query HKLMSoftwareExamGuard /v InstallType` (no native module). Missing key or bad value = `dev` (nothing locked). `EG_INSTALL_TYPE` overrides it only when the app is not packaged.
- 2026-10-18 — Chosen mode is stored in `<userData>/mode.json` (Zod-checked). Named profiles use `<default userData>/profiles/<name>`. One instance per profile (single-instance lock).
- 2026-10-18 — The sandboxed preload can only require `electron`, so electron-vite bundles `@examguard/shared` and `zod` into `out/preload/index.cjs`.
- 2026-10-18 — pnpm `onlyBuiltDependencies` (electron, esbuild) added to pnpm-workspace.yaml so the Electron binary downloads on install.
- 2026-10-18 — IPC payloads/results are validated with the Zod schemas in `packages/shared/src/app`. Channel names live in `apps/desktop/src/shared/ipc-channels.ts`.

**M03**
- 2026-10-18 — `apps/server` is built with `tsc` to `dist/` and forked by main via `import.meta.resolve('@examguard/server')` (workspace dep of desktop). It is not bundled into the Vite output, so native modules (better-sqlite3, M04) stay out of it. The dev scripts build the server first. Packaging belongs to M45. (architecture §1)
- 2026-10-18 — The token is `randomBytes(32)` hex, created in main per server process (a restart issues a new one) and sent over the parent port. The renderer gets `{baseUrl, token}` via `getServerConnection()`. It is never logged or stored.
- 2026-10-18 — The renderer CSP `connect-src` now allows `http://127.0.0.1:47821` and `ws://127.0.0.1:47821`, so later milestones can call the teacher API directly.
- 2026-10-18 — Ports, header name and the main↔server message schemas live in `packages/shared/src/server/`. Status (`stopped|starting|running|restarting`, `restartCount`) is pushed main → renderer on `server:status`. Server logs go to `<userData>/logs/server.log`.
- 2026-10-18 — Backoff: 1 s, 2 s, 5 s, then 10 s. It resets when the server stayed up 30 s or more.

**M04**
- 2026-10-18 — better-sqlite3 13 ships N-API prebuilds (win32-x64), so one binary works under system Node (Vitest) and Electron 44 (utilityProcess). No electron-rebuild step is needed. Allowed in `onlyBuiltDependencies`. (data-model)
- 2026-10-18 — The server gets the data folder in its config message (`dataDir` = profile userData) and creates `<dataDir>/db/examguard.sqlite` itself. Main passes `userData`. A DB or migration failure posts the `error` reply and exits, so main's backoff restarts it. (protocol/architecture unchanged)
- 2026-10-18 — Each migration runs in its own transaction and a DB newer than the app is refused. Numbers must be contiguous from 0001. `.sql` files are copied to `dist/db/migrations` by `apps/server/scripts/copy-migrations.mjs` as part of `build`.

**M05**
- 2026-10-19 — Login state is an in-memory flag in the server process (`AuthState`). A server restart forgets it, so the renderer re-checks `GET /auth/status` on every server start and falls back to the login screen. Routes that need a teacher must use `requireLogin` (returned by `buildTeacherApp`) as `preHandler`; `/health` and `/auth/*` stay token-only. (protocol §2)
- 2026-10-19 — Rate limit is global, not per IP (loopback, one teacher): 5 wrong passwords lock login for 30 s, doubling per lockout up to 5 min, reset on success. 429 `rate_limited` carries `details.retryAfterSec`. Lockout state is in memory (a server restart clears it).
- 2026-10-19 — Password: min 8, max 200 chars; scrypt N=2^15, r=8, p=1, stored as `scrypt$N$r$p$salt$hash` (base64). `buildTeacherApp` now takes `db` and returns `{ app, requireLogin }`.
- 2026-10-19 — Renderer uses a plain React hook (`useAuth`) and a small fetch client (`lib/teacherApi.ts`), not Zustand: no shared client state yet. Add Zustand/TanStack Query when M06 needs lists and caching.

**M06**
- 2026-10-19 — The renderer sends raw `csvText`; the server parses it (`class-lists/csv-parser.ts`, papaparse) so the renderer needs no parser and the preview and the saved rows can't differ. `dryRun: true` returns `{rows, errors}`, a real import also returns `list`. (protocol §2)
- 2026-10-19 — Row rules: column 1 = student ID, column 2 = name, extra columns ignored. A first row is a header only if it looks like one (`id|student id|student_code|code` + `name|student name|full name`). Errors `blank_id|blank_name|duplicate_id|too_few_columns` carry the 1-based line; for a repeated ID the first row wins. Rows with every cell empty are skipped silently. A file with no valid rows is 400 `no_valid_rows` (with `details.errors`); max 5 000 rows, 1 MB.
- 2026-10-19 — "In use" is enforced by the `exams.class_list_id ON DELETE RESTRICT` foreign key (M07 migration must keep it). `DELETE` maps a SQLite constraint error to 409 `list_in_use`. The test stands in a scratch `exams` table with the same FK.
- 2026-10-19 — `@tanstack/react-table` is pinned to v8 (`^8`): v9 is a different API. Plain `useClassLists` hook, no TanStack Query yet. IDs are UUIDv7 from `db/ids.ts`. `call()` in `teacherApi.ts` is exported and takes an optional method (used for `DELETE`).

**M07**
- 2026-10-19 — The API speaks minutes (`durationMin`, 1–600); the DB keeps `duration_sec`. Conversion is in `db/exam-repo.ts`. (protocol §2)
- 2026-10-19 — Settings can be edited and the exam deleted only in `draft` or `ready` (`exams/exam-state.ts` `isEditable`), else 409 `invalid_state`. Transitions: draft→ready, ready→draft|hosting, hosting→ready|running, running→ended, ended→grading, grading→in_review, in_review→grading|finalized. Nothing calls `assertTransition` yet; M08 (`/ready`) and M09+ will.
- 2026-10-19 — Duplicate makes a draft titled `"<title> (copy)"` with the same duration, class list and monitoring, and no pin, timestamps or extension. It works from any state.
- 2026-10-19 — `MonitoringSettings` (screenshot on switch / title change, interval 20 s, min gap 5 s, high-severity apps, grace 60 s) and `DEFAULT_MONITORING` live in `packages/shared` so the form and server share defaults. The high-severity list is free text, comma separated.
- 2026-10-19 — `class_list_id` stays `ON DELETE RESTRICT`; the M06 "in use" test now uses a real exam.

**M08**
- 2026-10-19 — The API speaks marks (numbers in 0.5 steps, `MarksSchema`); the repo converts to integer half-units at the edge. `questions.marks` is recomputed from the criteria on every write. Criterion names must differ (case-insensitive).
- 2026-10-19 — A question body is a full replacement (`PATCH` resends everything, criteria included). Drafts may be saved unfinished (empty sample answer, no criteria, no languages); completeness is checked only by `/ready` (`exams/ready-check.ts`), which returns every problem at once as 422 `not_ready`.
- 2026-10-19 — Added `POST /exams/:id/unready` (ready→draft) so a ready exam can be reworked; questions stay editable in `ready` (via `isEditable`) and M09 must re-run `readyProblems` when hosting starts. Allowed languages are `c`, `cpp`, `js` (`QUESTION_LANGUAGES`); add more there when the runner config grows.
- 2026-10-19 — Reorder is move up/down buttons (no drag library). The repo shifts positions by +100000 then assigns, to respect `UNIQUE(exam_id, position)`. Delete re-packs positions.
- 2026-10-19 — Monaco (`monaco-editor` 0.57 + `@monaco-editor/react`) is bundled and loaded lazily (`MonacoField` via `React.lazy`), with `loader.config({ monaco })` and Vite `?worker` imports (`lib/monaco.ts`). CSP gained `worker-src 'self' blob:` and `font-src 'self' data:`. `TeacherApiError` now carries `details`.

**M09**
- 2026-10-20 — `HostingManager` (`hosting/hosting-manager.ts`) owns the student listener and the ready↔hosting change; routes only translate `HostingError` to HTTP. `buildTeacherApp` takes an optional `hosting` options object (data dir, port, host, callbacks); without it the hosting routes are not registered, which keeps older tests unchanged.
- 2026-10-20 — Cert: ECDSA P-256 via `selfsigned` 5 (async), 10 years, in `<dataDir>/certs/server.key|crt`, created on first host and reused. The fingerprint is SHA-256 of the DER, base64url. The code is the first 20 bits in Crockford base32 (`tls/fingerprint.ts`). "Regenerate cert" (Settings) is not wired yet; `loadOrCreateCert(dir, true)` exists.
- 2026-10-20 — PIN: 6 digits from `crypto.randomInt`, stored in `exams.pin` while hosting and cleared on stop. Hosting start re-runs `readyProblems` (422 `not_ready`). Only one exam can be hosted (409 `already_hosting`).
- 2026-10-20 — Server → main reply `{type:'hosting', active}` drives `powerSaveBlocker.start('prevent-display-sleep')` in `ServerHost`. It is released on stop, on server exit and when the listener closes. On boot the server calls `resume()`: an exam still in `hosting` gets its listener back with the same PIN and cert (a failure is logged, the teacher API stays up). This is the minimal slice of the crash recovery in architecture.md; the rest stays in the recovery milestone.
- 2026-10-20 — `/info` returns 503 `not_hosting` when nothing is hosted (the listener is normally closed then). Its state is always `hosting` for now; `running` arrives with start (M10+).

**M10**
- 2026-10-20 — Pinning (`desktop/src/main/tls-pin.ts`) opens `tls.connect` with `rejectUnauthorized:false`, compares SHA-256 of the peer cert DER with the expected fp, and only then reuses that socket for `https.request` (`createConnection`). Node skips `checkServerIdentity` for self-signed certs, so a custom check would not have run; this way no HTTP byte (later: PIN) is sent to a wrong cert. M11/M12 reuse `pinnedGet`/`connectPinned` and store the fp with the session.
- 2026-10-20 — mDNS service name is `ExamGuard-<first 8 chars of fp>`; TXT `v` is `major.minor`. Advertising is best effort: if it throws, hosting still works (manual IP). Advertiser is injected into `HostingManager` (`advertise` dep) so tests use a fake.
- 2026-10-20 — Discovery and probing run in student main only (IPC refuses outside Student mode); the renderer never touches the network. `fpCodeOf` moved to `packages/shared` (server re-exports it). Hosts without IPv4 or with another protocol major are ignored.
- 2026-10-20 — The old placeholder `ModeHome` was replaced by `FindExamScreen`. Selecting a host only probes and shows the code; the Continue button is disabled until M11 (join).

**M11**
- 2026-10-20 — `JoinService` (`server/src/join/`) holds the join rules; `HostingManager.open` builds one per listener with the PIN and cert fingerprint, so the PIN never leaves the hosting manager. Check order: protocol major → hosting → rate limit → PIN (`timingSafeEqual`) → class list → session rule.
- 2026-10-20 — The rate limit counts failed tries per IP (5/min), not every attempt, so a lab behind one address and the 200-student sim (M12) are not throttled. architecture §2 updated.
- 2026-10-20 — The `exam_students` row is created at `/join` (state `not_joined`) and `/join/confirm` moves it to `lobby`. Same device joining again re-issues the token and keeps the state. A different device is rejected with 409 and a critical `duplicate_login` event (server source, no dedupe key) while the row still has a token.
- 2026-10-20 — `pinned_fp` stores the server's own cert fingerprint at join (the student's pin check passed before any byte was sent). Only the SHA-256 of the token is stored.
- 2026-10-20 — The session token stays in student main (`JoinClient`); the renderer gets only name and exam title. `pinnedGet` is now a wrapper over `pinnedRequest` (method, headers, JSON body), still pin-before-first-byte.
- 2026-10-20 — `deviceId = SHA-256(MachineGuid + "examguard")` via `reg query` in `main/device-id.ts`. In dev (not packaged) `EG_DEVICE_ID=<text>` replaces the machine value so two profiles on one PC act as two computers.
- 2026-10-20 — The `agent` block is sent as `{ok:true,...}` and accepted without checks; enforcement is M21. After joining, the student sees a placeholder "waiting" screen (real lobby is M12).

**M12**
- 2026-10-20 — `SessionHub` (`server/src/ws/`) is the one place that knows live sockets and teacher subscribers. Roster changes are coalesced per student and pushed at most every 250 ms (`roster` carries only changed students, then a `hosting` counts message). One hub per teacher app; `HostingManager` closes student sockets (code 4503) on stop and resets `connected` flags on open and close, so a crash cannot leave a student shown as connected.
- 2026-10-20 — Student WS lives on the student HTTPS app at `/ws` (not under `/api/v1`, as in protocol §3) via `@fastify/websocket`; routes are registered inside a plugin so they load after it. Student frames are `safeParse`d; only `hello` and `ping` exist so far. Idle limit 15 s (sweep checks about every 1 s); hello must arrive within 5 s. Close codes are in protocol.md.
- 2026-10-20 — Teacher WS token is `?token=` and is checked inside the socket handler, not by the global token hook, which skips `/ws`. A bad token or a logged-out teacher gets close code 4401 after the upgrade. An HTTP-level 401 on an upgrade request left the connection half open and stalled `app.close()`. The teacher Fastify also uses `forceCloseConnections: true`.
- 2026-10-20 — `joined` in the counts means the student accepted the notice (state is not `not_joined`). Students who joined but have not accepted are hidden from the roster. `agentOk` is always true until M21.
- 2026-10-20 — `SessionClient` (student main) reuses `connectPinned` and hands the pinned socket to `ws` (`createConnection`), so hello (and the token) goes out only after the pin matched. The token never reaches the renderer. Reconnect: 0.5 s doubling to 5 s with jitter. No retry after 4401, 4426 or 4409 (reason shown on the lobby screen). Clock offset = server time minus (clientSent + RTT/2), keeping the lowest-RTT sample; nothing uses it until timers (M16+).
- 2026-10-20 — `ws` is a desktop devDependency (electron-vite bundles it into main) and a dependency of student-sim; the server has it as a devDependency for tests only (`@fastify/websocket` brings the runtime copy).
- 2026-10-20 — `tools/student-sim` is a pnpm workspace package built with `tsc`: `pnpm build` then `pnpm sim -- --host <ip[:port]> --pin <6 digits> [--students N] [--csv file] [--ramp-ms 20]`. Without `--csv` it uses the codes 1..N, so the teacher's class list must contain them. One shared keep-alive agent (20 sockets) for the joins; each fake student has its own deviceId. `tools/*` was added to the root vitest projects.

**M13**
- 2026-10-21 — `deadline = exam.started_at + duration + global_extension + student extension_sec` (`exams/deadline.ts`, pure). A late joiner uses the exam's `started_at`, so everyone shares one end. No migration: the columns existed in 0003/0005.
- 2026-10-21 — `HostingManager.startExam` does hosting→running (keeps the PIN), activates every `lobby` student, and broadcasts `{t:'state', state}` (the full session state for now) to connected students. The listener stays open so students can still join late. `sessionState(studentId)` builds the welcome/state; a student who connects to a running exam while still in `lobby` is activated there. Exams in `running` also resume after a server restart (`resume()`), and `/info` reports `running`.
- 2026-10-21 — Questions reach students as `StudentQuestion` (`toStudentQuestion`: no sample answer, criteria or AI notes). Sent in welcome/state only while `running`.
- 2026-10-21 — `SessionState.examState` is now the `ExamState` enum, not a string; `questions` is optional. `SessionClient` has an `onExam` callback; main forwards the state to the renderer on `session:exam`. The lobby subscription moved into `SessionScreen`, which shows `LobbyScreen` (now presentational) or `ExamScreen`.
- 2026-10-21 — `ExamLock` (main): while the exam state is `running` the window is fullscreen, `close` and `before-quit` are cancelled, and leaving fullscreen is undone. It is not always-on-top. Dev escape hatch: `EG_ALLOW_CLOSE=1` (ignored in a packaged app).
- 2026-10-21 — Timer = `deadline - (Date.now() + clockOffsetMs)` ticking every 250 ms (`lib/examClock.ts`). The offset comes from the M12 ping/pong estimate.

**M14**
- 2026-10-21 — Answers live in a Zustand store (`lib/answerStore.ts`): `answers[questionId][language]` for code, `answers[questionId].text` for written. The chosen language is kept per question; `pickLanguage` falls back to the first allowed one. Only the selected language's buffer counts as "answered" in the nav, since that is what will be submitted.
- 2026-10-21 — Student editor is its own `CodeEditor` (full height, `path = questionId.language` so Monaco keeps a model and undo history per buffer); the teacher `MonacoField` is unchanged apart from sharing `lib/languages.ts`. A single allowed language hides the dropdown but keeps the badge. A code question with no allowed languages falls back to the text box with a notice.

## Known issues / open questions
- Confirm with lab IT (before a real exam): admin install rights, antivirus/EDR tolerance of the agent and screen capture, reboot-restore software (e.g. Deep Freeze wipes the local queue on reboot), group policies, and whether students are on one subnet.
- Check Gemini's current data-use terms and use a paid tier for real student data.
- Teacher on Wi-Fi: the Windows network profile must be Private for mDNS and inbound rules. The README must cover this.
- M02: the packaged-build checks (DevTools off, real HKLM key) need the installer from M45–M46 and are not testable yet. CSP and DevTools-off are implemented but only the dev path was run.
- M02: only a headless smoke run was done (window starts, preload exposes `window.examguard`, no console errors). Clicking through the UI is the manual test.
- M03: the "server restarted" banner comes from main's process status. The WS `notice` message from protocol §3 needs the teacher WS endpoint, which is a later milestone.
- M03: `server.log` is append-only with no rotation yet.
- M03: the server entry path comes from `import.meta.resolve`; check it again when packaging (M45, asar unpack).
- M03: a headless smoke run (Electron, teacher profile) confirmed 127.0.0.1:47821 listens and that killing the process brings it back in about 1.2 s. The 401 and 200 cases are covered by `app.inject` tests only. The UI chip and banner have not been clicked through.
- M04: only an isolated Electron probe was run (server in a utilityProcess, temp data dir): DB, -wal and -shm created. The full `pnpm dev:teacher` run was blocked because older teacher/student dev instances were still running (single-instance lock, port 47821).
- M04: asar-unpack of the better-sqlite3 `.node` file is for packaging (M45). Dropping the `tsc` + copy build for a bundler is also an M45 choice.
- M04: the data folder is not movable yet (Settings, later). The `teacher` repo is left to M05.
- M05: `POST /auth/change` (in protocol §2) is not built; no password recovery in Stage 1. Add change-password with Settings.
- M05: no UI/component tests (vitest is node-only here); the screens were only type-checked and built. The gate logic is covered through server `app.inject` tests and the `teacherApi` client tests. The click-through is the manual test.
- M05: after a server restart the teacher lands on the login screen and the "server restarted" banner is not shown there.
- M05: the teacher nav (Class lists, Exams, Settings) is disabled placeholders; no router yet.

- M06: no UI/component tests (node-only vitest), as in M05. Server parser, routes and repo, shared schemas and the client api are tested; the page click-through is the manual test.
- M06: not built (not needed yet): rename a list, add/remove single students, re-import into an existing list. A duplicate list name is allowed. The students view is not paginated (scrolls; max 5 000 rows).
- M06: the "in use" delete refusal is only proven against a stand-in table until M07 adds `exams`; re-check it with a real exam in M07.

- M07: no UI/component tests (node-only vitest). State machine, repo/routes, shared schemas and the client api are tested; the Exams page click-through is the manual test.
- M07: duplicate does not copy questions yet. Add it in `ExamRepo.duplicate` when M08 adds `questions`/`marking_criteria`.
- M07: an exam cannot yet leave `draft` (no `/ready`), so the 409 `invalid_state` paths are tested by setting state in SQL.
- M07: the exam list is not paginated or filtered.

- M08: no UI/component tests (node-only vitest). Server repo/routes/ready-check, shared schemas, the client api and the draft helper are tested; the editor click-through is the manual test.
- M08: the Monaco bundle was only type-checked and built, not run: confirm in the dev app that the sample answer editor loads (workers, CSP, icon font) with no console errors. `import * as monaco` bundles every language (about 7 MB of chunks, loaded only when a question form opens); trim to `editor.api` plus c/cpp/js when packaging (M45).
- M08: the question form has no markdown preview and no "unsaved changes" prompt. The class list is chosen in the exam Settings form, not on the detail page.
- M08: nothing yet re-checks readiness when hosting starts; M09 must call `readyProblems`.

- M09: no UI/component tests (node-only vitest). Cert, fingerprint code, PIN, LAN address filter, hosting manager/routes (real loopback HTTPS: /info works, refused after stop, resume) and the client api are tested; the panel and the sleep blocker were not run. Use `powercfg /requests` to check the blocker.
- M09: first LAN listen may trigger the Windows Firewall prompt on the teacher PC (allow Private). The installer's firewall rule is M46.
- M09: `stopHosting` returns the exam to `ready`, so students who already joined are not told yet; join counts on the panel are static 0 until M10. Hosting stays "on" if the teacher closes the app: on next launch `resume()` reopens it.
- M09: `GET /exams/:id/hosting` only answers while the listener is open. If a resume fails (port busy) the exam stays in `hosting` without a listener and the panel keeps showing "Loading hosting details" until the teacher clicks Stop hosting (which works from the stored state).

- M10: no UI/component tests (node-only vitest). Tested: shared schemas, server advertise/stop/resume with a fake, desktop `tls-pin`/`probe-host` against a real local HTTPS server (match, TOFU, mismatch refused before any request, unreachable, 503, bad body, protocol major), `toDiscoveredHost`, `parseHostAddress`. A node smoke script confirmed real bonjour advertise → browse on the dev PC. The Electron screen and the two-machine run are the manual test.
- M10: mDNS needs UDP 5353 allowed (Private network profile). With a firewall in the way, use manual IP. A stale entry can linger up to the mDNS TTL after the teacher stops hosting.
- M10: the pinned fp is not stored anywhere yet (M11 stores it with the session). Regenerating the cert is still not wired to Settings.

- M11: no UI/component tests (node-only vitest). Tested: shared join schemas, server `JoinService`/limiter/routes against a real student app and SQLite, desktop `JoinClient` and `pinnedRequest` against a real local HTTPS server, `device-id`. The screens and the two-machine run are the manual test.
- M11: join counts on the hosting panel are still static (M12 adds the roster over WS). `confirm` does not check that the exam is still hosting.
- M11: a teacher "reset session" (clears `token_hash` and `device_id`) is not built; until then a student stuck on a dead machine cannot re-join from another one. Stopping and re-hosting keeps the sessions (the PIN changes).
- M11: the rate limiter is in memory (cleared on server restart) and keyed by the socket IP.
- M11: `anon_id` exists on `exam_students` but nothing uses it until the grading pipeline.

- M12: no UI/component tests (node-only vitest). Tested: shared ws schemas, `SessionHub` (batching, replace, subscribers), real loopback student and teacher sockets plus roster HTTP against SQLite (hello, bad token, protocol mismatch, no hello, ping before hello, idle drop, replace, hosting stop, roster within 1 s), desktop `SessionClient` against a local WSS server (pin, clock offset, reconnect, no retry on 4401/4409, stop), roster reducer, student-sim args/CSV and a 26-student run against a fake teacher. A scripted run of the built server plus the real sim CLI with 200 students: all connected in 1.4 s, no churn over 12 s, all disconnected after Ctrl+C. The two Electron screens and the two-machine run are the manual test.
- M12: no `network_lost` event yet (needs the events classifier): the disconnect only flips `connected` and shows on the roster. The 10 s grace belongs to the monitoring milestone.
- M12: the teacher roster list is a plain scrolling list (about 200 rows is fine); the monitor grid, pagination and sorting come with M26 onward. A server restart drops the teacher WS; the hook retries every 1 s and re-subscribes.
- M12: students whose socket drops because the teacher stopped hosting are not told why (the lobby shows "reconnecting" and retries until hosting is back). A "hosting stopped" screen belongs with the start/end milestone.
- M12: the clock offset is estimated but not exposed beyond the status object. `resume.lastServerSeq` is always 0 until server commands exist.
- M12: still no teacher "reset session" (M11 issue) and no WS rate limit per token yet (the 512 KB frame limit and 15 s idle drop are in).

- Phase 2 review: two bugs FIXED 2026-10-20, only type-checked, linted and formatted (no UI tests, not clicked through). `JoinForm.tsx` now counts the retry wait down each second, shows "Try again in N s" and disables Join until 0. `ExamsPage.tsx` shows a green "Hosting now" badge, a **Stop hosting** button (with confirm) on the hosted row, and "Questions" is now "Open". Check both in the manual run.
- Phase 2 review: the M10 manual test "cert regenerated mid-session is refused" can't be done by hand until Settings can regenerate the cert (M43). Until then it is covered only by the `tls-pin` unit tests.
- Phase 2 review: the gate "no M13 until the two bugs are fixed and the M02–M12 manual run passed" is cleared as of 2026-10-21 (M13 itself was started a day earlier at the user's request).

- M13: no UI/component tests (node-only vitest). Tested: deadline module, repo/route/socket flow against SQLite and a real loopback student socket (push on start, late joiner with the same deadline, no answer fields leaked, `/info` running, second start 409, resume of a running exam), `SessionClient` state merge, `ExamLock` with a fake window, `examClock`, `examApi.start`, shared schemas. The fullscreen window, Alt+F4 and the timer on screen are the manual test.
- M13: the window stays locked until the exam leaves `running`. `/end` and submit (M18) are what unlock it. Until then a student whose session fails (replaced, unauthorized) is stuck in the locked window; kill the app from Task Manager, or run dev with `EG_ALLOW_CLOSE=1`. M18 (or an earlier milestone) should add a safe exit for a failed session.
- M13: answers typed in the box are lost on restart (autosave is M16); code questions show the same plain textarea until M14 adds Monaco. Question text is plain, no markdown rendering.
- M13: the teacher panel has no countdown or "end exam" yet; the teacher UI shows "Exam running" with the live roster. `Stop hosting` is not offered once running. Extensions (`extension_sec`, `global_extension_sec`) are read in the deadline but nothing sets them yet (M19+).
- M13: if hosting stops or the teacher server dies while the exam runs, the student's socket reconnects with backoff and the lock stays on, as intended.
- M13: Windows shutdown/log-off fires `before-quit`, which is cancelled while locked; Windows may still force it. Not handled.

- M14: no UI/component tests (node-only vitest). Tested: answer store (C++→JS→C++ restore, isolation, answered detection) and languages helper. Monaco in the student window, the dropdown and workers are the manual test. The store is not cleared between exams in one app run (question ids are unique, so harmless); autosave/restore after restart is M16.
- M14: the Monaco bundle is still the full build (see M08 note); trim in M45.

## Manual recovery checklist (filled in during M48)
_Empty._

## Session log
Format: `date — milestone — what was done — tests run — next`.
- 2026-10-17 — Planning — wrote CLAUDE.md and docs/* from requirements.md + clarifying answers — none — start M01.
- 2026-10-17 — Planning — applied the agreed changes to requirements.md (v1.1) — none — start M01.
- 2026-10-17 — M01 — pnpm workspace, strict tsconfig.base, ESLint/Prettier/Vitest, `packages/shared` (`PROTOCOL_VERSION`, `ProtocolVersionSchema`, `isProtocolCompatible` + tests), Cargo workspace with empty `eg-agent`/`eg-runner`, .gitignore, CLAUDE.md commands — `pnpm install/build/test/lint/typecheck/format:check` pass, a file with `any` fails lint; cargo not run (no toolchain) — install Rust, run `cargo build`, close M01.
- 2026-10-18 — M01 — verified the Rust toolchain (rustc/cargo 1.99.1, stable-x86_64-pc-windows-msvc, VS 2026 C++ workload); closed M01 — `cargo build`, `cargo test` (2 pass), `cargo clippy --all-targets -D warnings`, `cargo fmt --check`, both binaries run, a test `unwrap()` fails clippy; JS install/build/test (4 pass)/lint/typecheck re-run green — start M02.
- 2026-10-18 — M02 — `apps/desktop` (electron-vite, React, Tailwind v4, shadcn Button/Card), secure window + CSP, typed preload bridge, profile/install-type/mode-store modules, shared app schemas, root dev scripts — desktop (11) + shared (8) tests, lint, typecheck, build pass; dev app launched with no renderer errors — manual test, then M03.
- 2026-10-18 — M03 — `apps/server` (Fastify teacher app with token hook, utilityProcess entry), shared server schemas, desktop `ServerHost` + backoff + IPC/preload + chip/banner, CSP for loopback — server (4), shared (13), desktop (13) tests, lint, format, typecheck, build pass; headless Electron run: server listens, kill → restart in ~1.2 s — manual test, then M04.
- 2026-10-18 — M04 — `apps/server/src/db/` (connection, migrations loader, migrate, database, settings-repo, 0001_init.sql), `dataDir` in the server config message, copy-migrations build step — server (12), shared (14), desktop (13) tests, typecheck, lint, format pass; Electron probe confirms the DB is created in the utilityProcess — manual test, then M05.
- 2026-10-19 — M05 — shared auth schemas, server `auth/` (scrypt, login limiter, auth state), `db/teacher-repo`, `/auth/*` routes, `http/errors`, renderer teacherApi/useAuth, Setup/Login/TeacherShell/TeacherGate — shared (17), server (27), desktop (17) tests, full `pnpm test` (61), lint, format, typecheck, build pass — manual test, then M06.
- 2026-10-19 — M06 — migration 0002, shared class-list schemas, server `class-lists/csv-parser`, `db/class-list-repo` + `db/ids`, `/class-lists*` routes, desktop `classListApi`, `useClassLists`, `DataTable`, `ImportPreview`, `ClassListsPage`, nav switching — server (45), shared (21), desktop (21) tests, typecheck, lint, format, desktop build pass; app not clicked through — manual test, then M07.
- 2026-10-19 — M07 — migration 0003, shared exam schemas + DEFAULT_MONITORING, server `exams/exam-state`, `db/exam-repo`, `/exams*` routes, desktop `examApi`, `useExams`, `ExamsPage`, `ExamSettingsForm`, Exams nav enabled — shared (25), server (57), desktop (26) tests, typecheck, lint, format, desktop build pass; app not clicked through — manual test, then M08.
- 2026-10-19 — M08 — migration 0004, shared question schemas, server `db/question-repo`, `exams/ready-check`, `http/question-routes`, `/ready` + `/unready`, duplicate copies questions; desktop `questionApi`, `questionDraft`, `useQuestions`, Monaco setup, `ExamDetailPage` + QuestionList/QuestionEditor/CriteriaEditor/ReadyPanel, CSP for Monaco — shared (29), server (73), desktop (36) tests, full `pnpm test` (138), typecheck, lint, format, desktop build pass; app not clicked through — manual test, then M09.
- 2026-10-20 — M09 — shared hosting schemas + `hosting` server reply, server `tls/` (cert, fingerprint, lan-addresses), `hosting/` (pin, manager), `http/student-app` + `hosting-routes`, `ExamRepo` hosting methods, resume on boot; desktop `examApi` host/stop/hosting, `HostingPanel`, Start hosting button, power-save blocker in `ServerHost` — shared (33), server (87+), desktop tests, full `pnpm test` (159), typecheck, lint, format, build pass; app not clicked through — manual test, then M10.
- 2026-10-20 — M10 — shared `discovery` schemas + `fpCodeOf`, server `mdns-advertiser` + `HostingManager` advertise/stop, desktop `discovery`, `tls-pin`, `probe-host`, IPC/preload, `FindExamScreen`/`HostList`/`ManualIpForm`, `hostAddress` — shared (39), server (88), desktop (55) tests, typecheck, lint, format, desktop build pass; real bonjour smoke OK; app not clicked through — manual test, then M11.
- 2026-10-20 — M11 — shared `join` schemas, migration 0005, server `exam-student-repo`/`event-repo`, `join/` (service, limiter), `http/join-routes`, student app + hosting manager wiring; desktop `device-id`, `join-client`, `pinnedRequest`, IPC/preload, `StudentFlow` with `JoinForm`/`ConfirmName`/`MonitoringNotice`/`WaitingScreen` — full `pnpm test` (228), typecheck, lint, format, build pass; app not clicked through — manual test, then M12.
- 2026-10-20 — M12 — shared `ws` schemas, server `ws/` (session-hub, student-socket, teacher-socket), roster repo queries + `GET /exams/:id/roster`, hosting manager wiring, `JoinService.onChange`; desktop `session-client`, IPC/preload `startSession`/`onSessionStatus`, `LobbyScreen` (replaces `WaitingScreen`), `useRoster`/`rosterState`/`RosterList`, live `HostingPanel`; `tools/student-sim` v1 + root `sim` script — full `pnpm test` (285), typecheck, lint, format, build pass; scripted 200-student run OK; app not clicked through — manual test, then M13.
- 2026-10-20 — Phase 2 review — checked M06–M12 and the Phase 2 "Done when" line against the code and docs, confirmed the 2 reported bugs, logged gaps; only `docs/progress.md` changed — no tests run — fix the 2 bugs, run the manual tests, then M13.
- 2026-10-20 — Phase 2 fixes — student join retry countdown (`JoinForm`), Exams list "Hosting now" badge + Stop hosting + "Open" label (`ExamsPage`) — desktop typecheck, eslint, prettier pass; not clicked through — manual tests, then M13.
- 2026-10-21 — M13 — shared `StudentQuestion`, `StateUpdate`, `StartResult`; server `exams/deadline`, `ExamRepo.startRunning/runningExam/timing`, `ExamStudentRepo.activate*`, `HostingManager.startExam/sessionState`, `SessionHub.broadcast/sendTo`, `POST /exams/:id/start`; desktop `ExamLock`, `SessionClient.onExam`, `session:exam` IPC, `SessionScreen`/`ExamScreen`/`ExamTimer`/`QuestionNav`, `examClock`, Start exam button in `HostingPanel` — full `pnpm test` (310), typecheck, lint, prettier, build pass; app not clicked through — manual test, then M14.
- 2026-10-21 — Manual tests — user ran the M02–M13 manual tests and reported them passing; docs updated (completed list, status, Phase 2 accepted) — no code or tests run — start M14 when the user approves its plan.
- 2026-10-21 — M14 — `zustand`, desktop `lib/answerStore`, `lib/languages`, student `CodeAnswer`/`CodeEditor`/`WrittenAnswer`, `ExamScreen` uses the store, `MonacoField` shares language maps — desktop tests (107), typecheck, lint, prettier, build pass; app not clicked through — manual test, then M15.
- 2026-10-21 — Bugfix (end exam) — nothing on the server ever ended an exam: no `running → ended` transition, no `/end` route, no deadline check. "Time is up" was only the student's local countdown, so the teacher stayed on "Exam running" and students stayed locked. Added `HostingManager.endExam(id, 'manual'|'time_up')`, `POST /exams/:id/end`, a 1 s deadline watcher (latest deadline incl. extensions; restarted by `resume()`), `ExamRepo.endRunning`, `ExamStudentRepo.endAllWorking/maxExtensionSec`; on end students get the `ended` state (window unlocks), the listener closes, manual end marks working students `ended_by_teacher`. Teacher UI: **End exam now** (confirm) in the hosting panel, **End exam** on the running row, 3 s refresh so the auto-end shows; student `ExamEndedScreen`. Tests added in `ws/sockets.test.ts` (manual end, refuse when not running, auto end at deadline) — server (136) and desktop (107) tests, typecheck, lint pass; not clicked through — manual test: end a running exam from both places and let a 1-minute exam run out.
- 2026-10-21 — Bugfix ("api.end is not a function") — `useExams` stored the `ExamApi` object in `useState`, so after a hot reload of `examApi.ts` an open page kept the old object without `end`. The api is now derived from the stored connection with `useMemo` (Fast Refresh re-runs it). Added an `examApi.end` client test — desktop tests (108), typecheck, lint, prettier pass; not clicked through.
