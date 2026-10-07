# ADR-013: Electron hardening and token handling

**Status:** Accepted · **Date:** 2026-10-07

## Context
One desktop app serves Admin, Teacher and Student modes. Students may try to reach teacher features by manipulating the client, or read tokens. v1 stored the JWT in `localStorage`.

## Decision
- Mode switch is presentational only; **all authorization is server-side** (SRS AUTH-07) and teacher data is never sent to student tokens.
- Renderer: `contextIsolation`, `sandbox`, no `nodeIntegration`, strict CSP, no remote URLs, navigation and `window.open` blocked, devtools disabled in production builds.
- Preload exposes a narrow typed API; IPC handlers validate payloads with Zod.
- Access token in main-process memory; refresh token encrypted with `safeStorage` (DPAPI) on disk; rotation with reuse detection.
- Production builds are ASAR-packed with Electron fuses (`RunAsNode` off, `EnableNodeCliInspectArguments` off, ASAR integrity on).

## Consequences
+ A tampered client can at worst misrepresent its *own* UI; it cannot gain privileges or data.
− DPAPI protects against other users, not against the same user with malware — acceptable; tokens are short-lived and session-bound.
