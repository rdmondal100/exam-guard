# Architecture

Scope: how the pieces fit together. Tables are in `data-model.md`, message shapes in `protocol.md`, build order in `milestones.md`. Behaviour rules (what counts as an event, severities, limits) come from `requirements.md`. This doc only says *how* they're implemented.

## 1. Processes

### Teacher PC (install type = Teacher; no agent)
| Process | Role |
|---|---|
| Electron main (`apps/desktop/src/main`) | Window, teacher login gate, `safeStorage` (API key, secrets), power-save blocker while hosting, starts/restarts the server |
| Renderer (teacher UI) | React app. Talks to the server over **loopback HTTP/WS** (`127.0.0.1:47821`) with a teacher token handed over by preload |
| Server (`apps/server`, Electron `utilityProcess`) | Fastify. Two listeners: student HTTPS/WSS `0.0.0.0:47820` (on only while hosting) and teacher loopback `127.0.0.1:47821` (always on). Owns SQLite, mDNS advertising, the exam timer, event classification, risk score, thumbnail fan-out, WebRTC signaling and the grading pipeline |

Main restarts the server on exit with backoff (1 s, 2 s, 5 s, then every 10 s). Each restart is logged and shown as a banner. If main itself crashes, students reconnect after the teacher relaunches the app (§6).

### Student PC (install type = Student; locked to Student mode)
| Process | Runs as | Role |
|---|---|---|
| `eg-agent` service | LocalSystem, session 0 | Owns the app pipe, process watcher, helper lifecycle, encrypted evidence buffer, heartbeat |
| `eg-agent --helper` | SYSTEM token in the active console session | Foreground/title hooks, screenshots, monitor count, secure-desktop detection, relaunching the app |
| Electron main | Student user | Exam window, pipe client, code runner, offline queue, screen capture for thumbnails and WebRTC, clipboard control |
| Renderer (student UI) | Student user | Exam UI and Monaco. No Node access |
| `eg-runner.exe` + student program | Student user | Job Object sandbox for one code run |

## 2. Networking
- **Student → server:** HTTPS for join and bootstrap, then one WSS connection per student (`/ws`). It carries JSON frames, plus binary frames for thumbnails and screenshots. Port 47820 by default, configurable in Settings.
- **Discovery:** the server advertises `_examguard._tcp` over mDNS (bonjour-service) while hosting. TXT record: `v` (protocol), `exam` (title), `fp` (SHA-256 cert fingerprint, base64url). The student app lists every host it finds. Manual entry of `IP[:port]` is always available (teacher on Wi-Fi, different subnets).
- **TLS:** the teacher app generates one ECDSA P-256 self-signed cert per installation (`certs/`) and regenerates it on request. The student app pins the fingerprint:
  - via mDNS: the `fp` from TXT must match the presented cert
  - via manual IP: trust on first use for this exam. The student screen shows a **4-character code** (first 20 bits of the fingerprint, Crockford base32) next to the PIN field, and the teacher's hosting screen shows the same code. Invigilators compare them by eye.
  - the pinned fingerprint is stored with the student's session, so a reconnect to a different cert is refused.
- **Teacher UI → server:** loopback only, plain HTTP. The token is random per app launch, passed from main to the utilityProcess and to preload. Never bound to the LAN. HTTP calls send it in the `X-Teacher-Token` header; the WebSocket (`/ws`) takes it as `?token=` because a browser WebSocket cannot set headers.
- **WebRTC:** peer-to-peer on the LAN using host candidates only (no STUN/TURN, no internet). Signaling is relayed over the existing WS connections.
- **Firewall:** the installer adds program-based inbound rules (TCP + UDP) for `ExamGuard.exe` on Teacher installs only. Student PCs make outbound connections only. ICE checks from the student side open the stateful path.
- **Limits:** WS max frame 512 KB (screenshots are chunked if larger). Per-token rate limits on saves/events, and a per-IP limit on `/join` that counts failed tries only (5 wrong PINs or unknown IDs per minute, then 429 `rate_limited` with `retryAfterSec`), so a lab behind one address is not throttled. Every inbound frame passes `safeParse` against `packages/shared`.

## 3. Monitoring agent (Rust)

**Crates:** `windows` (Win32), `windows-service`, `tokio`, `serde`/`serde_json`, `tracing`, `jpeg-encoder`, `aes-gcm` (buffer encryption).

**Service (session 0)**
- Starts at boot (auto-start, recovery = restart). It can't be stopped by a standard user, because the default service ACL only lets admins stop or change it.
- Watches `WTS` session notifications. When a user logs on it launches the helper in that session: `DuplicateTokenEx(own token)` → `SetTokenInformation(TokenSessionId)` → `CreateProcessAsUserW` on `winsta0\default`. The helper runs as SYSTEM, so the student can't kill it. If it exits, the service restarts it within 1 s and logs `helper_restarted`.
- **Process watcher:** polls a ToolHelp snapshot every 1 s, diffs it, and reports new processes owned by the interactive user (exe name, path, PID, parent). Also reports the full list at exam start.
- **Pipe server:** `\\.\pipe\examguard-agent` (created with `FILE_FLAG_FIRST_PIPE_INSTANCE`, DACL = SYSTEM + interactive user). On connect it calls `GetNamedPipeClientProcessId` and checks that the image path equals the installed `ExamGuard.exe`, otherwise it disconnects. The app checks `GetNamedPipeServerProcessId` the same way against `eg-agent.exe`. Frames are a 4-byte little-endian length followed by UTF-8 JSON (shapes in `protocol.md` §4).
- **Helper link:** a second pipe `\\.\pipe\examguard-helper`, SYSTEM-only.
- **Evidence buffer:** while monitoring is active, every event and screenshot is appended to `%ProgramData%\ExamGuard\buffer\<examId>\`, encrypted with AES-GCM using a key that only SYSTEM can read. Entries are removed only after the app confirms the server stored them (`evidence.ack`). This is how evidence survives an app kill or reboot (decision: relay through the app only, no direct agent → server link).

**Helper (user session, SYSTEM token)**
- `SetWinEventHook(EVENT_SYSTEM_FOREGROUND)` for focus changes, and `EVENT_OBJECT_NAMECHANGE` filtered to the foreground hwnd for title changes. It resolves exe name, PID and window title.
- **Outside time:** "outside" = the foreground window doesn't belong to `ExamGuard.exe`. It tracks the start and end of each outside interval and reports them with durations. Totals are computed on the server.
- **Screenshot policy** (while outside): capture at the switch, on a title change, and every 20 s. Throttled to 1 per 5 s. Full virtual screen (all monitors), downscaled to ≤1600 px wide, JPEG quality 60. Capture uses GDI `BitBlt` from the screen DC, with DXGI Desktop Duplication as a later optimisation if BitBlt turns out slow or black (the M19 spike decides).
- **Monitors:** `EnumDisplayMonitors` at join, at start, and on `WM_DISPLAYCHANGE`.
- **Secure desktop / Ctrl+Alt+Del:** polls `OpenInputDesktop` + `GetUserObjectInformation(UOI_NAME)` every 500 ms. A name other than `Default` means the secure desktop is up. Task Manager is caught by the process watcher (`taskmgr.exe`).
- **App relaunch:** if monitoring is active and no `ExamGuard.exe` is connected to the pipe for 3 s, it launches the app in the session with the *user's* token (`WTSQueryUserToken`) and logs `app_relaunched`.

**Heartbeat and tamper lock**
- The service sends `heartbeat` every 2 s and the app replies. If the app misses 3 heartbeats (6 s), or the pipe breaks or fails verification, the app locks its own UI, sends `agent_lost` (critical) to the server, and the server marks the student Locked. Only the teacher can unlock.
- Join is refused unless the pipe is verified and `systemCheck` passes (helper alive and a test capture is non-black).
- Monitoring starts on `monitor.start` (sent by the app when the server says the student is Active) and stops on `monitor.stop` (submitted or ended).

**What the agent never does:** close or block apps, change the firewall, network, hosts file or proxy, or install drivers.

**Dev:** `eg-agent --console` runs the service logic and the helper in one process in the current user session, without SCM, with the same pipe name. The student app also has a fake agent (`EG_FAKE_AGENT=1`) that sends scripted events.

## 4. Local code runner (student PC)
- Lives in Electron main (`apps/desktop/src/main/runner/`). Language definitions are config entries: `{ id, label, fileName(code), compile?: argv[], run: argv[], monacoLanguage }`. Adding Java/Python later means adding a config entry.
- Toolchains: MinGW-w64 (WinLibs portable, UCRT) under `resources/toolchains/mingw64`, fetched in dev by `scripts/fetch-toolchains`. JS runs `ExamGuard.exe` with `ELECTRON_RUN_AS_NODE=1` (the RunAsNode fuse stays enabled, see progress.md).
- Work dir: `%LOCALAPPDATA%\ExamGuard\run\<examId>\<questionId>\<lang>\`, wiped before each run. The source is written there.
- Every compile and run goes through `eg-runner.exe --mem <MB> --time <ms> -- <argv>`. eg-runner creates a Job Object (`JOB_OBJECT_LIMIT_PROCESS_MEMORY`, `ACTIVE_PROCESS` = 8, `KILL_ON_JOB_CLOSE`), starts the child suspended, assigns it to the job, resumes it, forwards stdio and enforces wall time. Its exit code encodes the reason (OK / TLE / MLE / killed). Node enforces the 64 KB output cap and Stop (kills eg-runner, and the job dies with it).
- One run at a time, with a 2 s cooldown. gcc output is parsed (`file:line:col: error|warning: msg`) into Monaco markers. Each run produces a `run_executed` event.

## 5. Screens: thumbnails and live view
- **Capture** happens in student Electron main with `desktopCapturer` (`types: ['screen']`) for the whole screen. The helper's screenshots are only for events.
- **Thumbnails:** the teacher UI tells the server which students are on the visible page (`thumbs.subscribe`, about 25–30 IDs). The server sends `thumb.start {intervalMs: 4000}` to those students and `thumb.stop` to the rest. A student encodes a 320 px JPEG (`nativeImage.toJPEG`, q≈50, about 10–20 KB) and sends it as a binary frame. The server keeps only the latest frame per student in memory and forwards it to the teacher socket. Budget: 30 × 15 KB / 4 s ≈ 110 KB/s, well under the 1 MB/s target. With 200 on one page it would still be ~750 KB/s. Nothing is stored.
- **Live view (one student at a time, max 2 open):** teacher clicks → `live.request` → the student creates an `RTCPeerConnection`, adds a `getUserMedia` desktop track (chromeMediaSource, max 1280 px, 8 fps) and sends an offer. Offer, answer and ICE travel as `rtc.signal` through the server. The teacher renderer plays it. Closing it (or 60 s without the panel visible) sends `live.stop`. The deferrable fallback if WebRTC slips is a "fast thumbnail" mode: 960 px every 1 s over WS for the selected student.

## 6. Autosave, offline, resume, recovery
- **Answer key:** `(questionId, language)`. Written answers use language `text`. The client keeps a buffer per key and a monotonically increasing `clientSeq` per session.
- **Autosave triggers:** every 10 s if the content changed, plus Run, question switch, language switch and submit. Each save becomes an `answer_versions` row. The server dedupes on `(exam_student_id, question_id, language, client_seq)` and acks the `clientSeq`.
- **Offline queue:** saves and events go first to an append-only JSONL file in userData (`queue/<examId>.jsonl`). Each line is encrypted with `safeStorage` (DPAPI, user-scoped). Lines are removed when acked. On reconnect the queue is flushed in order before new traffic.
- **Reconnect:** WS reconnect with backoff (0.5 s → 5 s, jitter). The token is reused. The server replays the state snapshot (`session.state`).
- **Clock:** the client estimates the server offset from `ping/pong` RTT. Client timestamps (`clientTs`) are in server time.
- **Deadline:** `deadline = exam.started_at + duration + exam_student.extension_sec + exam.global_extension_sec`, the same for late joiners. At the deadline the server marks the student `ending` and accepts queued saves with `clientTs ≤ deadline` for the grace period (60 s). Then it finalizes the latest version per question (the selected language at that moment), hashes it, and marks the student Submitted. Trusting the client stamp is an accepted risk (see progress.md).
- **Same-PC resume:** `deviceId = SHA-256(HKLM MachineGuid + "examguard")`. Join with the same student ID and the same device while a session exists means the token is re-issued and the session resumes. A different device is rejected and logged (critical `duplicate_login`) until the teacher resets the session. The local queue, the selected language and the code buffers are restored from userData and the server snapshot.
- **Server crash or restart:** all state is in SQLite (WAL, `synchronous=NORMAL`). On boot the server finds exams in Hosting/Running, restarts listeners with the same cert, port and PIN, recomputes deadlines from stored timestamps (the timer kept running while it was down) and re-advertises mDNS. Students reconnect automatically. Deadlines that passed during downtime are processed straight away with the grace rule.
- **Batching:** events and autosaves are buffered in memory and written in one transaction every 250 ms or every 200 items. Acks are sent after commit.

## 7. AI grading pipeline (teacher server)
```
GradingProvider { id; gradeAnswer(input: GradingInput, opts): Promise<ProviderResult /* raw text + usage */> }
```
- `apps/server/src/grading/`: `providers/gemini.ts` (`@google/genai`, JSON response schema, temperature 0.1), `providers/fake.ts` (replays fixtures from `fixtures/grading/*.json`, used by all tests), `prompt.ts` (versioned template, `PROMPT_VERSION`), `validate.ts` (Zod + rules: each `awarded ≤ max`, half-unit steps, criteria names match the guide, total = sum), `pipeline.ts`.
- **Flow:** "Evaluate with AI" → one `grading_jobs` row per question → for each question, every final answer goes through a p-limit queue (concurrency 4, configurable) → retries with exponential backoff on 429/5xx (3×) → invalid output gets 2 retries with a repair hint → after that the answer is `needs_manual`. Each attempt stores an `evaluations` row (provider, model, prompt version, raw response).
- **Input** has only an anonymous ID (`exam_student.anon_id`), never name or student ID.
- The API key is decrypted in main and sent to the server over the utilityProcess message port at grading time. It's never written to the DB or logs.
- Progress goes out through WS `grading.progress`. The pipeline is resumable: on restart, unfinished answers in a job are picked up again.
- **Re-evaluate with an instruction:** same pipeline plus the teacher instruction in the prompt. Scope: one answer, or all answers on that question except Verified/Modified unless included.

## 8. Key libraries
| Library | Why |
|---|---|
| electron-vite | Fast dev/build for main + preload + renderer |
| React 18, Tailwind, shadcn/ui | Required UI stack. Accessible primitives without a heavy component lib |
| Zustand | Small local UI state (student exam state, dashboard selections) |
| TanStack Query / Table | Server data caching and big sortable tables (200-row rosters, review) |
| @monaco-editor/react | Monaco embedding with local workers (no CDN) |
| Fastify + @fastify/websocket | Fast HTTP with schema hooks. WS on the same TLS server |
| zod | Single source of truth for message validation and types |
| better-sqlite3 | Sync, fast, WAL. The server is the single writer |
| bonjour-service | Pure-JS mDNS advertise/browse |
| selfsigned (node-forge) | Generate the teacher's self-signed cert without OpenSSL |
| p-limit | Concurrency cap for grading |
| @google/genai | Official Gemini SDK with JSON-schema output |
| papaparse | Robust CSV import (quotes, BOM, Excel exports) |
| vitest | Unit/integration tests across packages |
| electron-builder (NSIS) | Windows installer with custom pages, service and firewall steps |
| Rust: windows, windows-service, tokio, jpeg-encoder, aes-gcm, tracing | Win32 access, SCM integration, async pipes, light JPEG encoding, buffer encryption, logs |
