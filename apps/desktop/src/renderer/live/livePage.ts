// The hidden live view capture page of the student app (M34; docs/architecture.md §5). It
// captures the primary screen, sends the offer and plays no part in the exam UI. Main destroys the
// whole page when the session ends, which closes the peer connection and stops the capture.
import type { LiveStart } from '@examguard/shared';
import type { ExamGuardLiveApi } from '../../preload/live-api.js';
import { candidateData, signalApplier } from '../lib/rtcSignals.js';

declare global {
  interface Window {
    examguardLive: ExamGuardLiveApi;
  }
}

/** Upper bound for the video bit rate: text on a 1280 px screen stays readable at 8 fps. */
const MAX_BITRATE = 2_500_000;

/** Chromium's desktop capture constraints, which the DOM typings do not describe. */
function desktopConstraints(start: LiveStart & { sourceId: string }): MediaStreamConstraints {
  const mandatory = {
    chromeMediaSource: 'desktop',
    chromeMediaSourceId: start.sourceId,
    maxWidth: start.maxWidth,
    // Width is the limit: a landscape screen never reaches this height first.
    maxHeight: start.maxWidth,
    maxFrameRate: start.fps,
  };
  return { audio: false, video: { mandatory } as MediaTrackConstraints };
}

async function run(start: LiveStart & { sourceId: string }): Promise<void> {
  const live = window.examguardLive;
  const { sessionId } = start;
  const end = (status: 'failed' | 'ended', reason: string) =>
    live.send({ kind: 'state', sessionId, status, reason: reason.slice(0, 200) });

  const stream = await navigator.mediaDevices.getUserMedia(desktopConstraints(start));
  const peer = new RTCPeerConnection({ iceServers: [] });
  for (const track of stream.getVideoTracks()) {
    track.contentHint = 'detail';
    track.addEventListener('ended', () => end('ended', 'capture ended'));
    peer.addTrack(track, stream);
  }
  for (const sender of peer.getSenders()) {
    const parameters = sender.getParameters();
    for (const encoding of parameters.encodings) {
      encoding.maxFramerate = start.fps;
      encoding.maxBitrate = MAX_BITRATE;
    }
    parameters.degradationPreference = 'maintain-resolution';
    await sender.setParameters(parameters).catch(() => undefined);
  }
  peer.addEventListener('icecandidate', (event) => {
    if (!event.candidate || !event.candidate.candidate) return;
    live.send({ kind: 'signal', sessionId, data: candidateData(event.candidate) });
  });
  peer.addEventListener('connectionstatechange', () => {
    if (peer.connectionState === 'failed') end('failed', 'peer connection failed');
  });
  const apply = signalApplier(
    peer,
    async () => undefined,
    (error) => end('failed', `signal: ${error instanceof Error ? error.message : String(error)}`),
  );
  live.onSignal((data) => void apply(data));

  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);
  live.send({ kind: 'signal', sessionId, data: { type: 'offer', sdp: offer.sdp ?? '' } });
}

let started = false;
window.examguardLive.onStart((start) => {
  if (started) return;
  started = true;
  run(start).catch((error: unknown) => {
    window.examguardLive.send({
      kind: 'state',
      sessionId: start.sessionId,
      status: 'failed',
      reason: `capture: ${error instanceof Error ? error.message : String(error)}`.slice(0, 200),
    });
  });
});
