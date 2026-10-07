# ADR-002: Rust agent split into Windows Service + user-session Helper

**Status:** Accepted · **Date:** 2026-10-07 · **Supersedes:** v1 ADR-002 (single Rust service)

## Context
The agent must (a) survive a student closing apps, kill processes and change firewall rules — which needs a privileged, long-lived process — and (b) see the screen, foreground window and clipboard. Since Windows Vista, **services run in Session 0**, isolated from the interactive desktop: a service cannot capture the user's screen, receive clipboard notifications or observe the foreground window.

Language: Rust was chosen by the product owner (small static binary, memory safety, `windows` crate covers Win32/WinRT). C#/.NET 8 was the main alternative (faster to write, native service support) but was declined.

## Options
1. Single service (v1 design) — cannot do screen/clipboard/window → **not viable**.
2. Single user-mode process — easy for the student to kill; no privilege to manage firewall or kill elevated processes.
3. **Service + Helper** — service (LocalSystem) supervises a helper spawned into the active user session (`WTSQueryUserToken` + `CreateProcessAsUserW`).

## Decision
Option 3. Responsibilities per ARCHITECTURE §6. Service owns the server connection; Helper reports to Service over a pipe ACL'd to SYSTEM + session user. Service restarts Helper on exit and raises `HELPER_RESTARTED`.

## Consequences
+ Correct by Windows' session model; privileged work isolated from UI work.
+ If a student kills the Helper, the Service notices within seconds.
− Two binaries and an internal protocol; installer must register the service (admin once on laptops).
− On unmanaged laptops a student with admin rights can still stop the service — detected via server heartbeats, not preventable (THREAT_MODEL T-05).
