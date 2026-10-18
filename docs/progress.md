# Progress

Read this first every session. Update it at the end of every session.

## Current status
- **Stage:** 1
- **Phase:** 1 — Foundation
- **Current milestone:** M04 SQLite + migrations (not started)
- **Next step:** do the M02 and M03 manual tests if not done yet, then start M04 (see `milestones.md`).

## Completed milestones
Format: `- M01 Monorepo skeleton — <date> — <one-line note>`
- M01 Monorepo skeleton — 2026-10-18 — pnpm + Cargo workspaces; build/test/lint/typecheck/clippy all pass; `any` and `unwrap()` are rejected.
- M02 Electron shell + mode selection — 2026-10-18 — secure window, per-profile mode.json, student install lock; manual check pending.
- M03 Exam server in a utilityProcess — 2026-10-18 — Fastify loopback `/api/v1/health` with token check, supervised by main with backoff restart, status chip + restart banner; manual UI check pending.

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
