# Progress

Read this first every session. Update it at the end of every session.

## Current status
- **Stage:** 1
- **Phase:** 1 — Foundation
- **Current milestone:** M02 Electron shell + mode selection (not started)
- **Next step:** start M02 (see `milestones.md`).

## Completed milestones
Format: `- M01 Monorepo skeleton — <date> — <one-line note>`
- M01 Monorepo skeleton — 2026-10-18 — pnpm + Cargo workspaces; build/test/lint/typecheck/clippy all pass; `any` and `unwrap()` are rejected.

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

## Known issues / open questions
- Confirm with lab IT (before a real exam): admin install rights, antivirus/EDR tolerance of the agent and screen capture, reboot-restore software (e.g. Deep Freeze wipes the local queue on reboot), group policies, and whether students are on one subnet.
- Check Gemini's current data-use terms and use a paid tier for real student data.
- Teacher on Wi-Fi: the Windows network profile must be Private for mDNS and inbound rules. The README must cover this.

## Manual recovery checklist (filled in during M48)
_Empty._

## Session log
Format: `date — milestone — what was done — tests run — next`.
- 2026-10-17 — Planning — wrote CLAUDE.md and docs/* from requirements.md + clarifying answers — none — start M01.
- 2026-10-17 — Planning — applied the agreed changes to requirements.md (v1.1) — none — start M01.
- 2026-10-17 — M01 — pnpm workspace, strict tsconfig.base, ESLint/Prettier/Vitest, `packages/shared` (`PROTOCOL_VERSION`, `ProtocolVersionSchema`, `isProtocolCompatible` + tests), Cargo workspace with empty `eg-agent`/`eg-runner`, .gitignore, CLAUDE.md commands — `pnpm install/build/test/lint/typecheck/format:check` pass, a file with `any` fails lint; cargo not run (no toolchain) — install Rust, run `cargo build`, close M01.
- 2026-10-18 — M01 — verified the Rust toolchain (rustc/cargo 1.99.1, stable-x86_64-pc-windows-msvc, VS 2026 C++ workload); closed M01 — `cargo build`, `cargo test` (2 pass), `cargo clippy --all-targets -D warnings`, `cargo fmt --check`, both binaries run, a test `unwrap()` fails clippy; JS install/build/test (4 pass)/lint/typecheck re-run green — start M02.
