# ExamGuard — Risk Register

| | |
|---|---|
| **Version** | 2.0 |
| **Date** | 2026-10-07 |
| **Review** | End of every phase |

Scale: Likelihood (L) and Impact (I) 1–5; Score = L × I. ≥ 12 = high.

| ID | Risk | L | I | Score | Mitigation | Trigger / owner action |
|---|---|---|---|---|---|---|
| R-01 | **Scope too large for one developer in 25 weeks** | 4 | 5 | **20** | Phase-complete delivery; cut-line defined (ROADMAP); pure domain packages to reduce rework; weekly progress check | Phase overruns > 30 % → apply cut-line |
| R-02 | **Rust Windows internals harder than planned** (service/session spawning, capture, firewall COM) | 4 | 4 | **16** | Spike the riskiest APIs at the start of Phase 5 (CreateProcessAsUser, Windows.Graphics.Capture, INetFwPolicy2); keep agent features small and testable; fallbacks (DXGI capture, polling process monitor) | Spike fails in 3 days → simplify design, raise ADR |
| R-03 | Docker Desktop/WSL2 unavailable or unstable on the teacher's laptop / lab PC | 3 | 4 | **12** | Launcher prerequisite check; Linux host option; offline image bundles; documented setup; test on actual department hardware early (by Phase 8) | — |
| R-04 | Lab IT does not allow installing the agent service / antivirus quarantines it | 3 | 4 | **12** | Engage department early (before Phase 5 demo); code-sign binaries (self-signed + documentation); provide AV exclusion guide; unmanaged mode as fallback | Ask department in W8 |
| R-05 | Local AI model too slow/weak on available hardware | 3 | 3 | 9 | Async grading; small-model defaults; confidence routing; optional cloud with consent; Mock for demo determinism | Benchmark in Phase 9 |
| R-06 | AI grading inconsistent / disagrees with teachers | 3 | 3 | 9 | Marking-point decomposition, quotes, schema validation, temperature 0, routing thresholds tuned on a labelled sample | Accuracy < G4 target → raise threshold |
| R-07 | False positives annoy students/teachers (e.g. legit processes flagged) | 3 | 3 | 9 | Allowlist curated on lab image; WARN before FLAG; teacher acknowledge; profile tuning per exam | Pilot run feedback |
| R-08 | Network lock leaves a PC offline | 2 | 4 | 8 | Stale-rule cleanup at service start/boot; fail-open after session; tested in Phase 6 | — |
| R-09 | Live view bandwidth on Wi-Fi laptops | 2 | 3 | 6 | Adaptive fps/quality; ≤ 4 streams; on-demand only | — |
| R-10 | Sandbox escape / host damage from student code | 2 | 4 | 8 | Strict container limits, runner isolation, abuse test suite, no Docker socket in api/worker | — |
| R-11 | Data loss during exam (crash, power) | 2 | 5 | 10 | Autosave ≤ 10 s, offline queue, Postgres durability, restart-safe sessions, laptop sleep inhibitor while hosting | — |
| R-12 | Similarity false positives on short/standard solutions | 3 | 2 | 6 | Boilerplate & reference exclusion, minimum length, review not auto-penalty | — |
| R-13 | Privacy concerns from students/faculty (screen viewing) | 2 | 3 | 6 | Consent, indicator, no recording, retention policy, local AI default; documented in user guide | — |
| R-14 | Dependency vulnerabilities | 3 | 2 | 6 | `pnpm audit`, `cargo audit` in CI; minimal deps | — |
| R-15 | Demo-day failure (network, hardware) | 3 | 4 | **12** | Rehearsed demo script; standalone demo on one laptop + 2 clients; Mock AI; recorded backup video | Rehearse twice in Phase 12 |
| R-16 | Working environment: development machine cannot run all components (Windows-only agent vs Linux CI) | 2 | 3 | 6 | Agent CI on windows-latest; server/desktop cross-platform for development | — |

## Accepted residual risks
Documented in THREAT_MODEL §6: Ctrl+Alt+Del, phones/physical notes, admin-level tampering on unmanaged laptops, hardened VMs, unknown offline AI tools. Mitigated operationally by invigilation and the per-exam device policy (`LAB_ONLY` for high-stakes exams).
