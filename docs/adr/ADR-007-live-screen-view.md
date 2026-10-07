# ADR-007: On-demand live screen view via JPEG frame relay

**Status:** Accepted · **Date:** 2026-10-07

## Context
The teacher wants to watch any student's screen from their PC, whenever they choose or when an alert appears. No continuous grid stream; live view not recorded (discovery 2.3).

## Options
| Option | Pros | Cons |
|---|---|---|
| A. **JPEG frames via server relay** (MJPEG-style over WSS) | Simple; works through any network; server controls access; adaptive by changing fps/quality | Higher bandwidth than video codecs; ~10 fps practical ceiling |
| B. WebRTC peer-to-peer video | Smooth 30 fps, efficient | NAT/ICE complexity, codec handling in Rust, harder access control and auditing |
| C. Always-on thumbnail grid | Overview of everyone | Constant bandwidth/CPU, privacy cost; not requested |

## Decision
Option A. Helper captures with Windows.Graphics.Capture (fallback DXGI Desktop Duplication), downsizes to ≤ 1280×720, JPEG-encodes at target 8–12 fps (~40–80 KB/frame → ~4–8 Mbps), sends binary frames through the Service's WSS; the server relays only to the requesting teacher, drops frames under backpressure and asks the agent to adapt. ≤ 4 concurrent views per teacher. Frames are never persisted. The student sees an indicator while viewed. The same capture path produces violation screenshots.

## Consequences
+ Small implementation surface, LAN-friendly, auditable (who watched whom, when).
− Not video-smooth; sufficient for proctoring (reading code, spotting chat windows).
− DRM-protected or secure-desktop content captures black; `SCREEN_CAPTURE_FAILED` raised.
