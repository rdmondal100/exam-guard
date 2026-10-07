# ADR-012: LAN deployment — Docker Compose, host launcher, mDNS, pinned TLS

**Status:** Accepted · **Date:** 2026-10-07

## Context
The server runs on a lab PC or the teacher's laptop (teacher's choice); exams must not depend on internet; clients must find the server without typing IPs; traffic must be encrypted although there is no public CA on a LAN.

## Decision
- **Docker Compose** stack (ARCHITECTURE §10) started by a **host launcher** — a "Host server" screen in the Desktop app (teacher/admin) and an equivalent CLI.
- The launcher runs on the host because Docker Desktop's WSL2 NAT does not pass multicast: it advertises `_examguard._tcp` via **mDNS** on the host NIC, creates the inbound Windows Firewall rule (admin once), and generates a **local CA + server certificate**.
- Clients discover via mDNS, fall back to manual address/connection code, and **pin the certificate fingerprint** (TOFU, or pre-provisioned by Admin in the installer).
- Single API instance (no horizontal scaling) — sufficient for one lab exam at a time.

## Consequences
+ One-click server on any Windows machine with Docker Desktop; fully offline.
− Docker Desktop + WSL2 is a prerequisite on Windows hosts (documented; checked by launcher).
− TOFU pinning trusts the first connection; pre-provisioning recommended for lab PCs.
