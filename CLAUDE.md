# ExamGuard — project brief for Claude

Secure Windows desktop platform for invigilated university lab exams (CSE final-year project, solo dev, ~25 weeks).
Teacher authors exams → students take them on lab PCs / own laptops on a LAN → Rust agent enforces per-exam policy and reports events → teacher sees alerts, screenshots, on-demand live screen → hybrid grading (sandbox tests + AI marking points + similarity + teacher review).

## How to use the docs (token budget matters)
- **Do not read whole docs.** Look things up by ID or heading:
  - Requirement: `grep -n "AUTH-03" docs/SRS.md` (one requirement per table row; IDs: AUTH ADM DEV EXM DLV LIV SEC EVL SBX AI RPT AUD PERF REL SECN PRIV UX QA DEP)
  - Phase scope: `grep -n -A 12 "## Phase 4" docs/ROADMAP.md`
  - Decision rationale: read only the one relevant file in `docs/adr/`
  - Security event defaults: `grep -n "EVENT_NAME" docs/SRS.md` (catalogue in SRS §6)
- Docs are the source of truth. If implementation must deviate, update the single affected line/ADR in the same commit — never rewrite whole docs.

## Key decisions (do not re-litigate without the owner)
- Roles: ADMIN, TEACHER, STUDENT. **All authorization server-side**; desktop mode switch is cosmetic.
- Desktop: Electron + React + TS + Vite; renderer sandboxed (contextIsolation, no nodeIntegration); tokens only in main process (refresh token via `safeStorage`). Never localStorage.
- Server: Fastify modular monolith (`apps/server/src/modules/*`: routes → service → repo), Prisma + PostgreSQL, Redis + BullMQ, Zod everywhere (schemas in `packages/shared`).
- Pure, I/O-free logic in `packages/policy` (policy engine) and `packages/grading-core` (scoring, comparison, routing, similarity). Unit-test these heavily.
- Agent (Rust, `agent/`): **Service** (Session 0: processes, firewall network lock, files/USB, VM/RDP, snapshots, server WSS) + **Helper** (user session: foreground window, clipboard, screen capture, IDE launch). Agent talks to server directly with its own token, sequence numbers, 5 s heartbeats.
- Coding happens in **external IDEs only** (VS Code with clean exam profile, Code::Blocks, Dev-C++). No built-in editor. Workspace folders watched + snapshotted.
- Policy decisions: ALLOW / WARN / FLAG / BLOCK / REVIEW — rule-based, never AI.
- Live view: on demand, JPEG frames relayed by server, ≤4 per teacher, never stored. Screenshots stored only for policy decisions.
- Grading: reference solution generates expected outputs (visible/hidden/randomized tests per part); AI evaluates marking points with quotes + confidence; confidence routing to teacher review; injection defense; MOSS-style similarity.
- Code runs for grading **only** in the Docker sandbox (`sandbox/runner` is the only thing with Docker socket).
- AI: gateway with Ollama (default), Gemini, OpenAI, Mock. External AI off unless admin + exam opt-in; redact identities.
- LAN deployment: Docker Compose + host launcher (mDNS, firewall rule, TLS CA); clients pin cert fingerprint.
- Honest security: never claim what Windows can't guarantee (see `docs/THREAT_MODEL.md` §6).

## Repo layout
```
apps/desktop  apps/server  packages/{shared,policy,grading-core,ui}
agent/{core,service,helper,installer}  sandbox/{runner,images}  infra/  docs/
```

## Commands (fill in / correct during Phase 1)
- Install: `pnpm install`
- Dev infra: `docker compose -f infra/docker-compose.yml up -d`
- Server dev: `pnpm --filter server dev` · Desktop dev: `pnpm --filter desktop dev`
- Tests: `pnpm test` (all) · `pnpm --filter <pkg> test -- <pattern>` (targeted — prefer this)
- Typecheck/lint: `pnpm typecheck` · `pnpm lint`
- DB: `pnpm --filter server prisma migrate dev`
- Agent: `cargo build -p examguard-service` · `cargo test` (Windows only for OS features)

## Working rules
- Work in small, vertical slices tied to requirement IDs; reference IDs in commit messages and test names (e.g. `it("AUTH-05 locks after 5 failures")`).
- Every slice: code + tests + passing typecheck → commit. Conventional commits (`feat(server): …`).
- Run **targeted** tests, show only failures; don't paste long logs.
- Edit files in place; don't regenerate whole files.
- Validate input with shared Zod schemas; errors as problem+json; log with pino (requestId/sessionId).
- Never send hidden tests, reference solutions or other students' data to student clients.
- Ask the owner before changing a key decision above; record significant new decisions as a short ADR in `docs/adr/`.
- At phase end: tick the phase in `docs/ROADMAP.md`, add a ≤15-line note in `docs/phase-notes/phase-N.md`.

## Compact instructions
When compacting, keep: current task + requirement IDs, files changed, test status, open decisions. Drop: doc excerpts, long tool outputs.
