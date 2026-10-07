# ADR-003: Agent has its own authenticated channel to the server

**Status:** Accepted · **Date:** 2026-10-07

## Context
v1 routed events Agent → Electron → Server and HMAC-signed them with a key handed over by Electron. Both components sit on the student's machine; the key is available to anyone who can tamper with Electron, and a tampered Electron can silently drop events. The signature therefore proves nothing against the actual adversary.

## Options
1. Relay through Electron (v1).
2. **Agent connects directly** to the server over TLS WebSocket with a per-session agent token; Desktop has its own connection.

## Decision
Option 2. At session join the server issues a short-lived **agent ticket** to the Desktop; the Desktop passes it over the local pipe; the agent Service exchanges it for a session-bound agent token on `/ws/agent`. Every message carries a sequence number; heartbeats every 5 s. The server treats **silence, sequence gaps and ticket misuse as violations**.

## Consequences
+ Two independent witnesses (Desktop and Agent); suppressing one is visible on the server.
+ Monitoring continues if the Desktop crashes or is closed.
− The ticket hand-off goes through the Desktop; a tampered Desktop could withhold it — but then no agent connects and the session cannot pass pre-check.
− Integrity of the agent binary on an unmanaged device remains a residual risk (reported hash, not a guarantee).
