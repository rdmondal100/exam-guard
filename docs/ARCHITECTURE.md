# ExamGuard — System Architecture

| | |
|---|---|
| **Version** | 2.0 |
| **Date** | 2026-10-07 |
| **Related** | [SRS](SRS.md) · [Threat Model](THREAT_MODEL.md) · [ADRs](adr/) |

---

## 1. Architectural drivers

| Driver | Source | Architectural consequence |
|---|---|---|
| On-site LAN exams, server on lab PC **or** teacher laptop | Discovery 2.1 | Portable Docker Compose stack, host launcher, mDNS discovery, no internet dependency (ADR-012) |
| Coding in **external IDEs** | Discovery 2.3 | No screen lockdown; security = process allowlist + network lock + workspace watching + live view (ADR-005) |
| Real OS-level monitoring incl. screen | Requirement | Rust agent split into Service + user-session Helper (ADR-002) |
| Don't trust the student machine | Threat model | Agent's own channel to server, liveness checks, server-side policy and grading (ADR-003, ADR-004) |
| Fair, explainable grading with partial credit | Discovery 2.2 | Reference-driven tests + AI marking points + confidence routing (ADR-009) |
| Catch copying with renamed variables | Discovery 2.2 | Normalized-token winnowing similarity (ADR-011) |
| Privacy, replaceable AI | Requirement | AI gateway, local-first, redaction (ADR-010) |
| Solo developer, 25 weeks | Discovery 2.1 | Modular monolith (not microservices), one language (TS) everywhere except the agent |

## 2. Context view

```
                ┌───────────────┐        ┌───────────────┐
                │    Admin      │        │   Teacher     │
                └──────┬────────┘        └──────┬────────┘
                       │  ExamGuard Desktop (Admin / Teacher mode)
                       ▼                        ▼
┌──────────────────────────────────────────────────────────────────────┐
│                         ExamGuard Server (LAN)                        │
│  REST + WebSocket API · Policy engine · Grading · Similarity · Audit  │
└──────────▲───────────────────────────▲──────────────────▲────────────┘
           │ HTTPS / WSS (client)      │ WSS (agent)       │ HTTP (local)
┌──────────┴───────────────┐  ┌────────┴───────────────┐  ┌┴───────────────┐
│ ExamGuard Desktop         │  │ ExamGuard Agent (Rust)  │  │ Ollama (opt.)  │
│ (Student mode)            │◀▶│ Service + Helper        │  └────────────────┘
└──────────────────────────┘  └─────────────────────────┘   Gemini/OpenAI
        Student PC (lab PC or laptop)                         (opt-in, internet)
```

## 3. Container view

```
┌───────────────────────────── Student machine (Windows) ─────────────────────────────┐
│                                                                                      │
│  ┌──────────────────────────────┐   named pipe (UI only)   ┌──────────────────────┐  │
│  │ ExamGuard Desktop (Electron) │◀────────────────────────▶│ Agent Helper (Rust)   │  │
│  │  main: auth, WS client,      │                          │ user session:         │  │
│  │        token vault, IPC      │                          │ screen capture, fore- │  │
│  │  renderer: React UI          │                          │ ground win, clipboard,│  │
│  └──────────────┬───────────────┘                          │ IDE launch, live view │  │
│                 │                                          └──────────┬───────────┘  │
│                 │                                     local RPC (pipe, │ SYSTEM ACL)  │
│                 │                                          ┌──────────▼───────────┐  │
│                 │                                          │ Agent Service (Rust)  │  │
│                 │                                          │ Session 0 / SYSTEM:   │  │
│                 │                                          │ process monitor+kill, │  │
│                 │                                          │ firewall lock, file & │  │
│                 │                                          │ device watch, VM/RDP, │  │
│                 │                                          │ workspace snapshots,  │  │
│                 │                                          │ helper supervision,   │  │
│                 │                                          │ server WSS channel    │  │
│                 │                                          └──────────┬───────────┘  │
└─────────────────┼─────────────────────────────────────────────────────┼──────────────┘
                  │ HTTPS + WSS /ws/client                    WSS /ws/agent │
┌─────────────────▼─────────────────────────────────────────────────────▼──────────────┐
│ Server host — docker compose                                                          │
│  ┌───────────────────────────────┐   ┌─────────────────────┐   ┌───────────────────┐  │
│  │ api (Fastify, Node 20)         │   │ worker (BullMQ)      │   │ sandbox-runner     │  │
│  │ REST /api/v1, WS gateway,      │◀─▶│ grading pipeline,   │──▶│ (narrow HTTP API,  │  │
│  │ policy engine, live relay,     │   │ AI gateway calls,   │   │ owns Docker socket)│  │
│  │ schedulers (timers, heartbeats)│   │ similarity, reports │   │ lang images: c/cpp/│  │
│  └──────┬───────────────┬────────┘   └─────────┬───────────┘   │ py/java/node       │  │
│         │               │                      │               └───────────────────┘  │
│  ┌──────▼─────┐  ┌──────▼──────┐  ┌────────────▼──┐  ┌──────────────────┐            │
│  │ PostgreSQL │  │ Redis        │  │ blob volume    │  │ ollama (profile) │            │
│  │ (Prisma)   │  │ queues, pub/ │  │ images, snaps, │  └──────────────────┘            │
│  └────────────┘  │ sub, presence│  │ screenshots    │                                  │
│                  └─────────────┘  └───────────────┘                                  │
└──────────────────────────────────────────────────────────────────────────────────────┘
          ▲  host launcher (teacher's Desktop "Host server" or CLI): compose up,
          │  mDNS advertisement on host NIC, Windows Firewall inbound rule, TLS CA
```

### Why a host launcher?
Docker Desktop on Windows runs containers inside a WSL2 VM behind NAT. **Multicast (mDNS) from a container does not reach the LAN**, but published TCP ports do. So mDNS advertising, the inbound firewall rule and certificate generation run on the host, in the Desktop app's *Host server* screen (or `examguard-server` CLI). On Linux hosts the same launcher works natively. (ADR-012)

## 4. Repository layout (monorepo)

```
exam-guard/
├── apps/
│   ├── desktop/                 Electron + React (Admin/Teacher/Student modes)
│   │   ├── src/main/            main process: window mgmt, token vault, API/WS client,
│   │   │                        agent pipe client, host launcher, auto-update (later)
│   │   ├── src/preload/         narrow, typed contextBridge API
│   │   └── src/renderer/        React app: routes per role, design system, features/*
│   └── server/                  Fastify modular monolith
│       ├── src/modules/         auth, admin, devices, exams, papers, sessions, answers,
│       │                        workspace, monitoring (policy engine), live, grading,
│       │                        ai, similarity, results, reports, audit, health
│       ├── src/platform/        db (Prisma), redis, queue, blob store, ws gateway,
│       │                        config (Zod env), logger (pino), errors, rbac
│       ├── src/worker.ts        worker entry (same codebase, different process)
│       └── prisma/              schema.prisma, migrations, seed
├── packages/
│   ├── shared/                  Zod schemas, DTO types, enums, event catalogue, WS protocol
│   ├── policy/                  pure policy-engine library (rules → decisions), heavily unit-tested
│   ├── grading-core/            pure scoring, output comparison, confidence routing,
│   │                            hard-code heuristics, similarity (tokenize/normalize/winnow)
│   └── ui/                      design-system components (shared by all desktop modes)
├── agent/                       Cargo workspace
│   ├── core/                    protocol types, config, event model, sequence/heartbeat
│   ├── service/                 Windows Service binary
│   ├── helper/                  user-session binary (capture, window, clipboard, IDE)
│   └── installer/               WiX/NSIS scripts
├── sandbox/
│   ├── runner/                  sandbox-runner service (TS) — only component with Docker socket
│   └── images/                  Dockerfiles: c, cpp, python, java, node
├── infra/
│   ├── docker-compose.yml       api, worker, sandbox-runner, postgres, redis, ollama(profile)
│   └── scripts/                 backup/restore, cert generation, image export/import
├── docs/                        PRD, SRS, architecture, ADRs, threat model, roadmap, test plan
└── .github/workflows/           ci.yml (TS + Rust), release.yml
```

Tooling: pnpm workspaces, TypeScript project references, ESLint + Prettier, Vitest, Playwright (Electron E2E), Cargo + clippy.

## 5. Server design (modular monolith)

Each module follows the same shape — `routes.ts` (HTTP/WS + Zod validation + role guard) → `service.ts` (use cases, transactions, audit) → `repo.ts` (Prisma) — and talks to other modules only through their service interfaces. Pure domain logic lives in `packages/policy` and `packages/grading-core` so it can be tested without I/O.

| Module | Responsibility |
|---|---|
| auth | login, token issue/rotation, lockout, password change |
| admin | users, courses, sections, CSV import, global settings |
| devices | device registration, trust level, agent tokens |
| exams | exam CRUD, settings, questions/parts/tests/marking points, validation, state machine |
| papers | per-student paper generation (seeded: shuffle, pools, manual sets) |
| sessions | session state machine, timers/deadlines, extensions, lock/resume/terminate, pre-check results |
| answers / workspace | autosave, snapshots, final submission, receipts |
| monitoring | event ingestion, sequence/heartbeat tracking, policy evaluation, actions, evidence |
| live | live-view session management and frame relay with backpressure |
| grading | job orchestration, deterministic evaluators, sandbox client, AI evaluation, routing, review, overrides |
| ai | provider gateway, redaction, prompt templates, call logging |
| similarity | pairwise analysis job and results |
| results / reports | publishing, visibility, analytics, CSV/PDF |
| audit | hash-chained append-only log, verifier, query |

### 5.1 Authorization
A route declares `roles` and, where needed, an ownership policy (e.g. *teacher teaches the exam's section*, *student owns the session*). Checks run server-side in a Fastify `preHandler`; the desktop's mode switch is purely presentational. An automated test enumerates every route × role (AUTH-07).

### 5.2 Real-time gateway
Three WebSocket endpoints share one gateway: `/ws/client`, `/ws/agent`, `/ws/teacher`. Messages use the typed protocol in `packages/shared/protocol` (`{type, seq, ts, payload}`), binary frames for images. Presence (who is connected) and heartbeat deadlines live in Redis with TTLs; a scheduler raises `AGENT_HEARTBEAT_MISSED` when a TTL expires.

## 6. Agent design

| Component | Runs as | Duties |
|---|---|---|
| **Service** | Windows Service, LocalSystem, Session 0 | Owns the server WSS connection and agent token; process monitoring (ETW / WMI `Win32_ProcessStartTrace`, fallback polling) and kill; Windows Firewall rule group for network lock; file-system and removable-media watching; VM / RDP / remote-tool detection; workspace snapshotting + burst detection; supervises Helper (spawns it into the active console session with `WTSQueryUserToken` + `CreateProcessAsUserW`, restarts on exit); stale-rule cleanup at boot |
| **Helper** | Normal process in the logged-in user session | Foreground window tracking (`SetWinEventHook`), clipboard listener (`AddClipboardFormatListener`), display count, screen capture (Windows.Graphics.Capture, fallback DXGI Desktop Duplication), JPEG encoding for screenshots and live view, IDE launch (VS Code exam profile, Code::Blocks, Dev-C++) and extension scan, named pipe for the Desktop app |

**Why split?** Since Windows Vista, services run in isolated Session 0 and cannot access the interactive desktop, clipboard or foreground window. Anything visual must run in the user's session (ADR-002).

**Trust boundaries:** Helper ↔ Service over a local pipe ACL'd to SYSTEM + the session user; Service ↔ Server over TLS with a per-session agent token. The Desktop ↔ Helper pipe is for UI convenience only; nothing the Desktop says is trusted as a security fact.

**Unmanaged devices:** the same binaries; on laptops the installer still installs the Service (requires admin once). The server marks such devices `UNMANAGED` (DEV-05) because the owner has admin rights and could tamper.

## 7. Key flows

### 7.1 Session start
```
Student Desktop          Server                         Agent Service/Helper
     │ POST /sessions/:exam/join ─▶│ check assignment, device policy
     │                             │ create Session(PRECHECK), paper, agent token
     │◀── session, agentTicket ────│
     │ pipe: attach(agentTicket) ─────────────────────────▶│ open WSS /ws/agent (ticket)
     │                             │◀─── hello{device, versions, integrity hash} ───│
     │                             │──── policy bundle (rules, allow/block lists, ───▶│
     │                             │      network lock cfg, workspace root)          │
     │                             │◀─── precheck results ───────────────────────────│
     │◀── precheck summary ────────│ evaluate → READY / BLOCKED_PRECHECK
     │ (teacher starts exam)       │ state LIVE → sessions IN_PROGRESS, deadlines set
     │◀── started{deadline} ───────│──── start{lock network, monitors on} ──────────▶│
```

### 7.2 Security event → decision → teacher
```
Helper/Service detects chrome.exe start
  ├─ fast path: matches pushed BLOCK rule → kill process, capture screenshot
  └─ send event{seq, type: PROCESS_BLOCKED_STARTED, attrs, actionTaken} ─▶ Server
Server.monitoring: verify seq → persist event → policy.evaluate(event, window state)
  → decision BLOCK, actions [ALERT_TEACHER, SCREENSHOT]
  → upload screenshot (already attached) → Evidence
  → publish alert on Redis → /ws/teacher subscribers (≤ 2 s)
  → notify student client ("Chrome is not allowed in this exam")
  → audit entry
```

### 7.3 On-demand live view
```
Teacher clicks "Watch live" ─▶ POST /live {sessionId} ─▶ live module: create stream, check ≤4 per teacher
Server ─▶ agent: stream.start{streamId, fps:10, maxW:1280, q:60}
Helper: capture → downscale → JPEG → binary frame ─▶ Service ─▶ Server
Server relay: forward to the teacher socket only; if teacher socket buffer > 2 frames, drop oldest
            and send agent stream.adjust{fps↓/q↓}; nothing persisted
Teacher closes ─▶ stream.stop ─▶ Helper stops capture (≤ 2 s); student indicator off
```

### 7.4 Grading pipeline
```
submission ─▶ queue grade-session ─▶ fan-out grade-part jobs
  MCQ/NUMERIC ─▶ grading-core deterministic ─▶ score, AUTO_ACCEPTED
  PROGRAMMING ─▶ sandbox-runner: compile → run tests (visible, hidden, randomized)
              ─▶ test-score per part ─▶ hard-code heuristics
              ─▶ AI review (partial credit / approach / special-casing) when needed
  THEORY      ─▶ injection detector ─▶ AI marking-point evaluation (JSON, quotes, confidence)
  every part  ─▶ confidence routing ─▶ AUTO_ACCEPTED | NEEDS_REVIEW
exam ENDED + all sessions graded ─▶ similarity job per part ─▶ SIMILARITY_HIGH → NEEDS_REVIEW
all parts FINAL/AUTO_ACCEPTED ─▶ exam IN_REVIEW ─▶ teacher publishes
```

Randomized tests: at paper validation time the generator is run with a fixed seed set; the reference solution produces expected outputs; those inputs/outputs are stored, so grading is reproducible.

## 8. Desktop design

- **Main process** owns everything privileged: API/WS clients, token vault (`safeStorage`), agent pipe, host launcher. Renderer calls a small typed preload API (`window.examguard.*`) — no Node in the renderer.
- **Renderer:** React 18 + Vite + TypeScript, TanStack Query (server state), Zustand (UI state), React Router (role-scoped route trees), Tailwind CSS + Radix-based components in `packages/ui`, Monaco *read-only* viewer for code in review screens, Recharts for analytics.
- **Student exam window:** large, always-on-top optional, not kiosk (IDEs must be usable). Shows timer, connection + agent status, "being viewed" indicator, lock overlay.
- **Offline queue:** answer edits buffered in an encrypted local file in main process; replayed in order with versions (server rejects stale versions).

## 9. Data and storage
- PostgreSQL via Prisma; JSON columns for type-specific configs validated by Zod on write.
- Blobs on a Docker volume, content-addressed (`sha256/ab/cd/...`). Screenshots and snapshots referenced from DB.
- Redis: BullMQ queues (`grade-session`, `grade-part`, `similarity`, `reports`), pub/sub for alerts, TTL keys for heartbeats/presence, rate-limit counters.
- Audit log hash chain in PostgreSQL (`prevHash`, `hash`), verifier command.

## 10. Deployment
- `infra/docker-compose.yml` with profiles: default (api, worker, sandbox-runner, postgres, redis), `ai` (ollama).
- First run: `examguard-server init` → generates CA + server cert (SAN = host IPs/hostname), DB migration, admin account.
- Clients: NSIS installer for Desktop; MSI/NSIS for Agent (installs service, firewall cleanup task, writes server fingerprint if pre-provisioned).
- Offline: sandbox and Ollama images exported to tar and loaded with `docker load`.

## 11. Cross-cutting concerns
| Concern | Approach |
|---|---|
| Validation | Zod schemas in `packages/shared`, used by desktop forms and server routes; OpenAPI generated |
| Errors | Typed domain errors → RFC 7807 problem+json responses |
| Logging | pino JSON logs with `requestId`, `sessionId`; agent logs via `tracing` to rotating files |
| Config | Zod-validated env (server), signed policy bundle (agent) |
| Time | Server time authoritative; clients compute offset from WS `time.sync` |
| Testing | Vitest unit/integration (Testcontainers for Postgres/Redis), Playwright Electron E2E, Rust unit + Windows integration tests, k6 load test with simulated agents |
| CI | GitHub Actions: TS lint/typecheck/test/build on ubuntu; Rust build/clippy/test on windows-latest |

## 12. Changes from the v1 architecture
See [DISCOVERY_NOTES §1](DISCOVERY_NOTES.md#1-review-of-the-first-draft-documents). Main changes: agent split (Service + Helper); agent's own server channel; no kiosk lockdown (external IDEs); network lock; on-demand live view; reference-driven grading; similarity; LAN deployment with host launcher; Admin role; tokens out of localStorage; right-sized scale targets.
