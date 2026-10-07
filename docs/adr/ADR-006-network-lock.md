# ADR-006: Network lock via a dedicated Windows Firewall rule group

**Status:** Accepted · **Date:** 2026-10-07

## Context
Blocking internet access is the single most effective control against ChatGPT and cloud IDE assistants. The teacher enables it per exam. A failure mode that leaves a lab PC permanently offline is unacceptable.

## Options
1. Process/URL blocking only — browsers are easily substituted; doesn't stop IDE extensions.
2. **Windows Firewall rules** (via `INetFwPolicy2` COM) in a dedicated group: default-deny outbound/inbound for the exam profile, allow exam server IP:port, DHCP, and LAN DNS.
3. Windows Filtering Platform (WFP) dynamic sessions — filters auto-removed when the owning handle closes; more powerful, considerably more complex.

## Decision
Option 2 for the product, Option 3 recorded as stretch goal. The Service saves the prior firewall default policy, applies the group at session start, restores at session end, and **on every service start removes any stale ExamGuard rules and restores defaults** (REL-03). A watchdog verifies reachability of a known external probe is blocked and the server is reachable; failure → `NETWORK_LOCK_FAILED` (REVIEW).

## Consequences
+ Kills cloud AI, browsers and chat apps at the network level, regardless of process name.
+ Fail-safe cleanup on restart.
− A student with admin rights on an unmanaged laptop can modify the firewall — detected via periodic rule verification and adapter-change events, not prevented.
− Mobile hotspots via a second adapter: detected (`NETWORK_ADAPTER_CHANGED`) and blocked by default-deny on all profiles.
