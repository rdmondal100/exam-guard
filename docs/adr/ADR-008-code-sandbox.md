# ADR-008: Custom Docker-based code sandbox runner

**Status:** Accepted · **Date:** 2026-10-07

## Context
Student code (C, C++, Python, Java, JavaScript) and teacher reference/generator code must run safely on the server host, which may be the teacher's laptop.

## Options
1. Run on host processes with OS limits — unsafe.
2. **Judge0** (open-source judge) — mature, but heavy (several services), relies on `isolate`/cgroup specifics that are awkward under Docker Desktop/WSL2, and is less of the project's own engineering.
3. **Custom runner using Docker** — one container per run with strict limits.
4. gVisor/Firecracker — stronger isolation, not available on Docker Desktop for Windows.

## Decision
Option 3. A separate `sandbox-runner` service is the **only** component with access to the Docker socket and exposes a narrow internal API (`compile`, `runTests`). Containers: no network, non-root, read-only rootfs + tmpfs, `cap-drop ALL`, `no-new-privileges`, pids/memory/CPU limits, wall-clock timeouts, output caps (SRS SBX-02). Per-language images are pre-built and exportable for offline use.

## Consequences
+ Works identically on Windows (Docker Desktop) and Linux hosts; fully under our control and testable with an abuse suite.
− Container start overhead (~0.3–1 s); mitigated by compiling once per part and running all tests in one container.
− Docker isolation is not a VM boundary; acceptable for the threat (students in a university lab), documented in THREAT_MODEL.
