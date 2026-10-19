# Progress

Read this first every session. Update it at the end of every session.

## Current status
- **Stage:** 1
- **Phase:** 2 — Exam setup & joining
- **Current milestone:** M07 done (manual check pending). M08 Question editor is next
- **Next step:** do the M02–M07 manual tests (close old dev instances first), then start M08 (see `milestones.md`).

## Completed milestones
Format: `- M01 Monorepo skeleton — <date> — <one-line note>`
- M01 Monorepo skeleton — 2026-10-18 — pnpm + Cargo workspaces; build/test/lint/typecheck/clippy all pass; `any` and `unwrap()` are rejected.
- M02 Electron shell + mode selection — 2026-10-18 — secure window, per-profile mode.json, student install lock; manual check pending.
- M03 Exam server in a utilityProcess — 2026-10-18 — Fastify loopback `/api/v1/health` with token check, supervised by main with backoff restart, status chip + restart banner; manual UI check pending.
- M04 SQLite + migrations — 2026-10-18 — better-sqlite3 13, migration runner on `user_version`, `0001_init` (settings, teacher), opened by the server at start; manual check pending.
- M05 Teacher password and login gate — 2026-10-19 — scrypt password, `/auth/status|setup|login|logout` with lockout, setup/login/shell screens behind a gate; manual check pending.
- M06 Class list CSV import — 2026-10-19 — `0002_class_lists`, server-side papaparse import with dry-run preview and per-row errors, `/class-lists*` endpoints, Class lists page (TanStack Table); manual check pending.
- M07 Exam CRUD and settings — 2026-10-19 — `0003_exams`, exam state machine, `/exams*` (create, edit, duplicate, delete), Exams page + settings form; manual check pending.

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
