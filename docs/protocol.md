# Protocol

Each shape here has a Zod schema in `packages/shared/src/protocol/` with the same name, and the TS type is `z.infer` of it. These shapes are the intent. The schemas are the contract. Marks on the wire are numbers in 0.5 steps (converted to half-units at the DB edge). Times are Unix ms in server time.

## 1. Versioning
- `PROTOCOL_VERSION = { major: 1, minor: 0 }`, exported from `packages/shared`.
- Sent in the mDNS TXT (`v=1.0`), in `POST /api/v1/join`, and in the WS `hello`.
- Different **major** → the server refuses with `426 protocol_mismatch`, and the student app shows "Update ExamGuard to match the teacher's version". Different **minor** is accepted, and unknown optional fields are ignored (schemas are `.passthrough()` only on the receive side of optional blocks).
- URL prefix `/api/v1`. A breaking change bumps major and adds `/api/v2` routes.
- The agent pipe has its own `PIPE_VERSION` (integer) in `hello` (§4).

## 2. HTTP endpoints

### Student API: `https://<teacher-ip>:47820/api/v1` (only while hosting)
| Method & path | Auth | Body → Response |
|---|---|---|
| GET `/info` | none | → `{ examTitle, protocol, state: 'hosting'|'running', fpCode }` (used after manual IP to show the 4-char code) |
| POST `/join` | none (rate-limited) | `{ studentCode, pin, deviceId, protocol, agent: AgentStatus }` → `{ token, examStudentId, name, examTitle, state }` or error `bad_pin` (401), `not_on_list` (403), `already_active_elsewhere` (409, also writes a critical `duplicate_login` event), `not_hosting` (503), `agent_required`, `protocol_mismatch` (426), `rate_limited` (429, `details.retryAfterSec`), `invalid_body` (400). The row is created at join (state `not_joined`); the same device joining again gets a new token (the old one stops working). `agent` must be healthy (`agentProblem` in `packages/shared`: helper present, test capture not black, at least one monitor, `ok`) or the join is refused with 403 `agent_required` before the row is created (M21) |
| POST `/join/confirm` | Bearer token | `{ noticeAccepted: true }` → `{ ok, state }` (`not_joined` → `lobby`, idempotent; 401 `unauthorized` for an unknown token, 400 `invalid_body` if the notice was not accepted) |
| GET `/answers/latest` (M17) | Bearer token | → `{ buffers: [{questionId, language, content, flags|null, clientSeq}], selected: [{questionId, language, clientSeq}] }`: the newest stored version of each buffer and, per question, the language of the newest version saved with `selected: true`. A restarted student app uses it to refill the editors. It is HTTP and not part of `welcome` because the client caps a WS frame at 512 KB and one buffer can be 128 K characters. 401 `unauthorized` for an unknown token |

Everything else for students goes over WS.

### Teacher API: `http://127.0.0.1:47821/api/v1` (loopback; header `X-Teacher-Token`)
| Area | Endpoints |
|---|---|
| Auth | `GET /auth/status → {setupRequired, loggedIn}`, `POST /auth/setup {password}` (min 8 chars; 409 `already_setup`; logs in), `POST /auth/login {password} → {ok}` (401 `bad_password`, 409 `setup_required`, 429 `rate_limited` with `details.retryAfterSec`), `POST /auth/logout`, `POST /auth/change` (not built yet). Every other route except `/health` answers 401 `login_required` until login. Login state lives in the server process |
| Class lists | `GET /class-lists → [{id, name, studentCount, createdAt}]`, `POST /class-lists/import {name, csvText, dryRun?}` → `{list?, rows[{studentCode,name}], errors[{line,code,message,raw}]}` (`list` absent on `dryRun`, which writes nothing; error codes `blank_id, blank_name, duplicate_id, too_few_columns`; 400 `no_valid_rows` with `details.errors`, 400 `too_many_rows`), `GET /class-lists/:id/students → [{studentCode,name}]` (404 `not_found`), `DELETE /class-lists/:id → {ok}` (404 `not_found`, 409 `list_in_use`) |
| Exams | `GET /exams → [ExamSummary]`, `POST /exams {title, durationMin 1–600, classListId?, monitoring?, filesEnabled? (default true, M15e)}` → 201 `ExamSummary` (400 `invalid_body`, 400 `class_list_not_found`), `GET /exams/:id` (404 `not_found`), `PATCH /exams/:id` (any create field; 409 `invalid_state` unless draft/ready), `DELETE /exams/:id → {ok}` (409 `invalid_state` unless draft/ready), `POST /exams/:id/duplicate` → 201 draft copy titled `"… (copy)"`, no runtime data, `POST /exams/:id/ready` (draft→ready; 422 `not_ready` with `details.problems[{code,message,questionId?}]`, codes `no_class_list, no_questions, missing_sample_answer, no_criteria, no_languages`; 409 `invalid_state`), `POST /exams/:id/unready` (ready→draft). `ExamSummary = {id, title, state, durationMin, classListId, classListName, monitoring, createdAt, updatedAt}`; `monitoring = {screenshotOnSwitch, screenshotOnTitleChange, screenshotIntervalSec, minScreenshotGapSec, highSeverityApps[], graceSec}` |
| Questions | `GET /exams/:id/questions → [Question]`, `POST /exams/:id/questions` → 201, `PATCH/DELETE /questions/:qid`, `POST /exams/:id/questions/reorder {ids[]}` (ids must be exactly the exam's questions, else 400; returns the list). Body = `{type code|written, body, allowedLanguages[c|cpp|js] (empty for written), studentNote, sampleAnswer, sampleLanguage, aiNotes, criteria[{name, maxMarks}]}`; marks are plain numbers in 0.5 steps (stored as half-units), `Question.marks` = sum of criteria. Writes are 409 `invalid_state` unless the exam is draft/ready |
| Exam files (M15f) | Teacher: `GET /exams/:id/files → [ExamFile {id, name, size, sha256}]`; `POST /exams/:id/files?name=<url-encoded>` with the raw bytes as `application/octet-stream` → 201 `ExamFile` (a file with the same name in any letter case is replaced); `DELETE /exams/:id/files/:fileId` → `{ok}`. Errors: 404 `not_found`, 409 `invalid_state` (writes only in draft or ready), 400 `invalid_name` (`checkFileName`), 413 `file_too_large` (25 MB), 413 `exam_files_full` (50 MB or 50 files per exam), 401 without the login. Student (HTTPS, `Authorization: Bearer <session token>`): `GET /api/v1/exam-files/:fileId` streams the bytes with `content-length` and `x-sha256`; 401 unknown token, 404 `not_found` (also another exam's file) or `file_missing`, 409 `invalid_state` unless the exam is hosting or running, 403 `files_off` when the Files switch is off |
| Hosting | `POST /exams/:id/host` (ready→hosting) → `HostingInfo = {pin, addresses[], port, fpCode, terminal:{enabled, until}, terminalPendingMinutes}`; errors 404 `not_found`, 409 `invalid_state` / `already_hosting` / `port_in_use`, 422 `not_ready` (readiness is re-checked). `POST /exams/:id/stop-hosting` (hosting→ready, PIN cleared) → `{ok}`. `GET /exams/:id/hosting` → `HostingInfo`, or 404 `not_hosting`. `POST /exams/:id/start` (hosting→running, M13) → `{ok, startedAt, deadline}` (ms; 404 `not_found`, 409 `invalid_state`); `POST /exams/:id/end` comes later. Student `GET /info` answers 503 `not_hosting` if no exam is hosted |
| Live | `GET /exams/:id/roster → {students: RosterEntry[], counts}` (404 `not_found`; joined students only, by student code), `GET /exams/:id/events?studentId&severity&after`, `GET /screenshots/:eventId` (JPEG), `POST /exams/:id/students/:sid/actions {type, ...}`, `POST /exams/:id/actions {type, ...}`. Built (M15b): `POST /exams/:id/actions {type:'terminal', enabled, minutes? 1–600}` → `{ok, terminal:{enabled, until}, pendingMinutes}` (hosting or running only, else 409 `invalid_state`; 400 `invalid_body`, also for `minutes` with `enabled:false`; 404 `not_found`; written to `teacher_actions`). `minutes` set while hosting counts from Start (`pendingMinutes` until then), while running from now. `GET /exams/:id/students/:sid/terminal → {events[{id,type,serverTs,clientTs,details}], transcript, truncated}` (the four terminal event types; any exam state; 404 `not_found` if the student is not in that exam) |
| Grading | `POST /exams/:id/grading {questionIds?}`, `GET /exams/:id/grading`, `POST /grading/reevaluate {questionId, examStudentIds[]|'all', includeEdited, instruction}`, `POST /grading/cancel/:jobId` |
| Review | `GET /exams/:id/review/:qid` (table), `GET /answers/:sid/:qid` (answer + sample + history + timeline), `POST /answers/:sid/:qid/accept`, `POST /answers/:sid/:qid/edit {criteria, feedback}` |
| Results | `POST /exams/:id/finalize`, `GET /exams/:id/export.csv` |
| Settings | `GET/PATCH /settings`, `POST /settings/backup`, `POST /settings/regenerate-cert` |

Errors everywhere: `{ error: { code: string, message: string, details?: unknown } }` with the right HTTP status.

## 3. WebSocket messages
Envelope for every JSON frame: `{ t: string; id?: string /* for acks */; ...payload }`. Binary frames: `[u8 kind][u16 headerLen][header JSON][payload]`, where kind 1 = thumbnail and kind 2 = screenshot chunk.

### Student ⇄ server: `wss://<ip>:47820/ws`
```ts
// student → server
type Hello        = { t:'hello'; token:string; protocol:{major:number;minor:number}; resume:{lastServerSeq:number} }
type Ping         = { t:'ping'; clientSent:number }
type AnswerSave   = { t:'answer.save'; id:string; clientSeq:number; clientTs:number; questionId:string;
                      language:string; content:string; selected:boolean; reason:SaveReason; flags?:string }   // M16; there is no separate answer.select: a language switch is a save with reason switch_language and selected:true
type EventReport  = { t:'event'; id:string; dedupeKey:string; clientTs:number; type:EventType;
                      details:Record<string,unknown>; screenshotRef?:string }   // ref matches a binary kind-2 upload
type Transcript   = { t:'transcript'; key:string; clientTs:number; text:string }   // terminal output, ≤16 KB per chunk (M15b)
type Submit       = { t:'submit'; id:string; clientTs:number }
type AgentStatus  = { t:'agent.status'; ok:boolean; helper:boolean; captureOk:boolean; monitors:number }   // M21: sent after every welcome and whenever the app's agent link changes; the server keeps the latest verdict in memory and shows it as the roster's agentOk
type RtcSignal    = { t:'rtc.signal'; sessionId:string; data:RTCSessionDescriptionInit|RTCIceCandidateInit }
type Ack          = { t:'ack'; id:string }   // ack of a server command

// server → student
type Welcome      = { t:'welcome'; serverTime:number; state:SessionState }
type SessionState = { examState:ExamState; studentState:StudentState; deadline:number|null;
                      questions?:QuestionForStudent[]; saved:{questionId:string;language:string;clientSeq:number;selected:boolean}[];
                      locked:boolean; monitoring:boolean;
                      terminal:{ enabled:boolean; until:number|null };   // until = server time the terminal turns off (M15b)
                      filesEnabled:boolean;                             // the teacher's Files panel switch, per exam (M15e)
                      examFiles:{id:string;name:string;size:number;sha256:string}[];   // the teacher's attached files; [] when filesEnabled is false (M15f)
                      receipt?:Receipt|null }   // set once the answers are final (M18); a reconnecting student shows the receipt screen from it
type StateUpdate  = { t:'state'; state:Partial<SessionState> }   // start, extend, lock, end...
type Pong         = { t:'pong'; clientSent:number; serverTime:number }
type SaveAck      = { t:'answer.ack'; id:string; clientSeq:number }
type EventAck     = { t:'event.ack'; id:string }
type TranscriptAck = { t:'transcript.ack'; key:string }
type SubmitResult = { t:'submit.result'; id:string; receipt:Receipt }   // Receipt = { hash, submittedAt, answers:{questionId,language,sha256}[] } (M18)
type SubmitRefused = { t:'submit.refused'; id:string; reason:'not_running'|'not_working' }   // M18
type TeacherMsg   = { t:'message'; id:string; kind:'info'|'warning'; text:string }
type ThumbStart   = { t:'thumb.start'; intervalMs:number; width:number }
type ThumbStop    = { t:'thumb.stop' }
type LiveRequest  = { t:'live.request'; sessionId:string; maxWidth:number; fps:number }
type LiveStop     = { t:'live.stop'; sessionId:string }
type RtcSignalOut = { t:'rtc.signal'; sessionId:string; data:unknown }
type ErrorMsg     = { t:'error'; code:string; message:string }
```
`QuestionForStudent` = `{ id, position, type, body, marks, allowedLanguages, studentNote }`. It **never** contains the sample answer, the marking guide or AI notes.

### Teacher UI ⇄ server: `ws://127.0.0.1:47821/ws?token=…`
```ts
// teacher → server
type Subscribe     = { t:'subscribe'; examId:string }
type ThumbsSub     = { t:'thumbs.subscribe'; examStudentIds:string[] }   // visible page; replaces previous
type LiveOpen      = { t:'live.open'; examStudentId:string }
type LiveClose     = { t:'live.close'; sessionId:string }
type RtcSignalT    = { t:'rtc.signal'; sessionId:string; data:unknown }

// server → teacher
type RosterUpdate  = { t:'roster'; students:{ id:string; studentCode:string; name:string; state:StudentState; connected:boolean;
                       riskScore:number; outsideMs:number; lastSeen:number|null; agentOk:boolean }[] }   // full on subscribe, then only changed students, batched at most every 250 ms
type Alert         = { t:'alert'; event:{ id:number; examStudentId:string; type:EventType; severity:Severity;
                       serverTs:number; details:object; hasScreenshot:boolean } }
type HostingStatus = { t:'hosting'; joined:number; inLobby:number; active:number; submitted:number; connected:number }   // joined = accepted the notice; sent with every roster push
type Timer         = { t:'timer'; startedAt:number|null; durationSec:number; globalExtensionSec:number }
type ThumbFrame    = binary kind 1, header { examStudentId, ts }
type LiveSession   = { t:'live.session'; sessionId:string; examStudentId:string; status:'connecting'|'live'|'ended'|'failed' }
type GradingProg   = { t:'grading.progress'; jobId:string; questionId:string; done:number; failed:number; total:number; state:string }
type ServerNotice  = { t:'notice'; level:'info'|'warn'|'error'; text:string }   // e.g. "server restarted"
```
Teacher actions go over HTTP so they're easy to retry and audit. Their effects arrive as `roster`/`alert` updates.

### Auth, limits and close codes (built in M12)
- Student `hello` must be the first frame, within 5 s. `ping` or `event` before `hello`, a non-JSON frame or an unknown `t` closes the socket. Max frame 512 KB. Built so far: `hello`, `ping`, `event` (M15); the rest of the student messages above arrive with their milestones.
- `transcript` (M15b): stored once per `key` (namespaced by student on the server), up to 1 MB per student, then one "truncated" marker; every chunk is answered with `transcript.ack`, also a duplicate or a dropped one. The client re-sends unacked chunks after each `welcome`.
- Terminal switch (M15b): every change (teacher action, Start of a pending window, auto-off at `until`) is pushed to all connected students as `{t:'state', state:{terminal}}`; late joiners get it in `welcome`. The server turns the terminal off itself at `until`.
- `event` (M15): `type` is limited to the app's own types (`APP_EVENT_TYPES`: `run_executed {questionId, language, flags, status, exitCode, timeMs}` (`flags` ≤500 chars since M15c), and from M15b `terminal_opened`, `terminal_closed {reason, exitCode}`, `terminal_command {line, truncated?}` (≤2000 chars), `package_installed {manager: npm|pip|pacman, packages[], line}`); agent evidence types join with monitoring. The server stores it with source `app`, severity `low` until the classifier exists, and dedupe key `app:<dedupeKey>` (the client uses the event id). A repeated key is not stored again but is still answered with `event.ack`. The client keeps unacked events in memory and re-sends them after each `welcome` (the disk queue is M17).
- `answer.save` (M16): `clientSeq` is one counter per student (≥ 1), kept across reconnects, and after a welcome the client continues past the largest `saved.clientSeq`. The server keeps each number once (a resend is acked again and changes nothing). `reason` is `interval | run | switch_question | switch_language | submit` (`final` is the server's). `content` ≤ 128 K characters, `flags` ≤ 500. Saves are batched (250 ms or 200 rows) and **`answer.ack` is sent after the commit**. **A save is stored only while** the exam is `running`, the student is `active` or `locked`, `clientTs ≤` the student's deadline, and the server's clock is at most `deadline + graceSec` (the exam's `monitoring.graceSec`, M18). A save for an unknown question or a language the question does not allow (written and language-less code questions use `text`) is dropped as well. Every dropped save is acked, so the client stops re-sending it. "Selected" for a question = the language of its newest version saved with `selected: true`.
- `submit` (M18): the student presses Submit, or the client re-sends the frame after each `welcome` until it gets an answer (after the unacked saves, on the same ordered socket). The server writes the batch of saves it already holds, makes the answers final (`final_answers`, state `submitted`) and answers `submit.result` with the receipt; a repeat gets the same receipt. `submit.refused` says why not (`not_running`: the exam is not running; `not_working`: the student is not `active`/`locked` and has no receipt). The server also pushes `{t:'state', state:{studentState, receipt}}` to the student whenever the answers become final without a `submit` (auto-submit at deadline + grace, or the teacher ending the exam: `studentState` is then `ended_by_teacher`). Receipt: `hash` = SHA-256 of the canonical JSON of `answers` sorted by `questionId`, each `{questionId, language, sha256}`; `sha256` = SHA-256 of the UTF-8 content (`packages/shared/src/protocol/submission.ts`).
- Student close codes: `4400` bad or missing hello, `4401` unknown token or wrong exam, `4426` protocol major mismatch, `4409` replaced by a newer socket of the same student, `4503` not hosting (hosting stopped). The student client does not retry after 4401, 4426 or 4409; it retries everything else with backoff.
- `welcome.state` (M13): `examState` is the real exam state. While `hosting`: `deadline` null, no `questions`. While `running`: `deadline` is the shared end time, `questions` is the `QuestionForStudent` list, and a student still in `lobby` (late joiner) becomes `active`. `saved` is the newest stored version of each buffer (M16: `clientSeq` and whether it is the selected language); `monitoring` is false until its milestone.
- On `POST /start` the server sends every connected student `{t:'state', state}` with the same fields (full state for now). Students not connected get the same data in their next `welcome`.
- Teacher WS takes the token as `?token=` (a browser WebSocket cannot set headers). A wrong token or a teacher who is not logged in gets the socket closed with `4401` right after the upgrade. `subscribe` replaces the previous subscription.

### Flow rules
- The server pushes events and state through a per-student `serverSeq`. `hello.resume.lastServerSeq` lets the server resend missed commands (messages, lock).
- The student sends `answer.save` and `event` only after `welcome`. Queued items are flushed in `clientSeq` order.
- The server drops a student WS with no frame for 15 s and marks them `connected=false`. A student who stays disconnected for 10 s while the exam is `running` gets a server `network_lost` event (`details.since` = when the socket closed); the next connection gets `network_restored` (`details.since`, `details.downMs`). Whether an outage is open is read from the `events` table, so a server restart in the middle of one still ends it. Hosting stop and the end of the exam raise nothing. (M17)
- The client also drops a socket that has received nothing for 3 ping periods (15 s) and reconnects, so a pulled cable is noticed without waiting for TCP. (M17)
- `hello.resume.lastServerSeq` is sent as 0: the server has no per-student `serverSeq` commands yet (lock and messages, later milestones).

## 4. Agent ⇄ student app (named pipe `\\.\pipe\examguard-agent`)
Framing: `u32 LE length + UTF-8 JSON`. Each message has `{ t, seq }`. Both sides check the peer's process image path before sending anything (architecture §3).
```ts
// app → agent
type AHello        = { t:'hello'; seq:number; pipeVersion:1; appVersion:string }
type ASystemCheck  = { t:'system.check'; seq:number }
type AMonitorStart = { t:'monitor.start'; seq:number; examId:string; examStudentId:string; serverTimeOffsetMs:number;
                       policy:{ screenshotOnSwitch:boolean; titleChangeShots:boolean; periodicOutsideSec:number;
                                minShotGapSec:number; maxWidth:number; jpegQuality:number } }
type AMonitorStop  = { t:'monitor.stop'; seq:number; examId:string }
type AHeartbeatAck = { t:'heartbeat.ack'; seq:number; hbSeq:number }
type AEvidenceAck  = { t:'evidence.ack'; seq:number; upTo:number }   // server has acked these → agent may delete (the SYSTEM buffer outlives a wiped app queue)
type AExamWindow   = { t:'exam.window'; seq:number; hwnd:number; pid:number }  // tells the helper which window is "inside"

// agent → app
type GHello        = { t:'hello'; seq:number; pipeVersion:1; agentVersion:string; pid:number; helper:boolean }   // pid = the service's process id; the app compares it with the SCM's (architecture §3)
type GSystemCheck  = { t:'system.check.result'; seq:number; reqSeq:number /* seq of the system.check */; ok:boolean; helper:boolean; captureOk:boolean;
                       monitors:number; problems:string[] }
type GHeartbeat    = { t:'heartbeat'; seq:number; hbSeq:number; helper:boolean; monitoring:boolean }
type GEvidence     = { t:'evidence'; seq:number; evidenceSeq:number; ts:number;
                       kind:'focus_lost'|'focus_returned'|'title_changed'|'app_launched'|'processes_at_start'|
                            'monitor_changed'|'secure_desktop'|'taskmgr_opened'|'helper_restarted'|'app_relaunched';
                       data:{ exe?:string; path?:string; pid?:number; title?:string; durationMs?:number;
                              monitors?:number; processes?:{exe:string;pid:number}[] };
                       screenshot?:{ jpegBase64:string; width:number; height:number } }
type GError        = { t:'error'; seq:number; code:string; message:string }
```
- **M21 behaviour.** The agent sends `hello` as soon as it has verified the peer (architecture §3); the app answers with its own `hello`. Until then the agent accepts nothing: a first message other than `hello` gets `error no_hello`, another `pipeVersion` gets `error pipe_version` and the connection is closed, text that is not a known message gets `error bad_message`. A connected app that sends no `hello` for 5 s is dropped. After `hello` the agent sends `heartbeat` every 2 s (`HEARTBEAT_MS`) and drops the connection when no `heartbeat.ack` came for 6 s (`HEARTBEAT_LOST_MS`); the app treats 6 s without a heartbeat as a lost link, closes the pipe and reconnects. `system.check` asks the helper (below) for a fresh test capture and takes up to about 2.5 s. `monitoring` in `heartbeat` is false until M22. Schemas: `packages/shared/src/protocol/agent-pipe.ts`; the Rust side is `agent/eg-agent/src/pipe_msg.rs`.
- **Helper pipe `\\.\pipe\examguard-helper`** (internal to `eg-agent`, same framing): the helper connects to the service; the service sends `{t:"check",seq}` and the helper answers `{t:"check.result",seq,captureOk,monitors}` (a small test capture checked for black, and the number of monitors Windows reports).
- The agent replays all un-acked evidence (in `evidenceSeq` order) after every `hello` while monitoring is active. The app turns each item into an `event` WS message with `dedupeKey = deviceId:evidenceSeq`.

### Planned additions (2026-10-21; schemas are written in their milestones)
- **M21b internet (built 2026-10-24):** `SessionState.internet = 'allowed'|'blocked'` (also in `GET /exams/:id/hosting`); teacher `POST /exams/:id/actions {type:'internet', enabled}` (`enabled:true` = allowed) → `{ok:true, internet}`, 409 `invalid_state` outside hosting/running; student → server WS `{ t:'internet.status'; blocked:boolean; error:string|null }` after every welcome and on change (roster `RosterEntry.internetBlocked`); pipe app → agent `{ t:'net.set'; seq; blocked:boolean; allow:string[] }` (IPv4 literals, at most 8; repeated with every heartbeat while blocked, which is the lease) and agent → app `{ t:'net.status'; seq; reqSeq; blocked:boolean; error:string|null }`; app events `internet_blocked`, `internet_allowed`, `internet_block_failed`.
- Severity isn't decided by the agent. The server classifies `kind` + `exe`/`title` against the exam's monitoring settings.
- Heartbeat timing and the lock rule: architecture §3.
