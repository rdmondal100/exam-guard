import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FAST_THUMB_HIDDEN_CLOSE_MS,
  LIVE_CONNECT_TIMEOUT_MS,
  type LiveEndReason,
  type RosterEntry,
} from '@examguard/shared';
import { Button } from '@/components/ui/button';
import type { RosterView } from '@/hooks/useRoster';
import { usePageVisible } from '@/hooks/usePageVisible';
import { candidateData, signalApplier } from '@/lib/rtcSignals';
import { FastThumbView } from './FastThumbView';

interface Props {
  student: RosterEntry;
  roster: RosterView;
  onClose: () => void;
}

type Mode = { kind: 'connecting' } | { kind: 'live' } | { kind: 'fallback'; why: string };

const REASONS: Record<LiveEndReason, string> = {
  not_connected: 'the student is offline',
  too_many: 'two live views are already open',
  student_failed: "the student's PC could not capture its screen",
  student_left: 'the student reconnected',
  closed: 'the connection to the server dropped',
  hosting_stopped: 'hosting stopped',
};

/**
 * The WebRTC live view (M34; docs/architecture.md §5): the student's whole screen as video, peer
 * to peer on the LAN, while this panel is open and the window is shown. When no video arrives in
 * time or the connection fails, it falls back to the fast thumbnail (a picture every second).
 * Hidden for a minute, it closes itself.
 */
export function LiveView({ student: s, roster, onClose }: Props) {
  const { liveChannel } = roster;
  const visible = usePageVisible();
  const [mode, setMode] = useState<Mode>({ kind: 'connecting' });
  const [attempt, setAttempt] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fallback = useCallback((why: string) => setMode({ kind: 'fallback', why }), []);
  const webrtc = mode.kind !== 'fallback';

  useEffect(() => {
    if (!webrtc || !visible) return;
    setMode({ kind: 'connecting' });
    let done = false;
    const peer = new RTCPeerConnection({ iceServers: [] });
    const fail = (why: string) => {
      if (done) return;
      done = true;
      fallback(why);
    };
    const timer = setTimeout(() => fail('no video arrived in time'), LIVE_CONNECT_TIMEOUT_MS);
    peer.addEventListener('track', (event) => {
      const [stream] = event.streams;
      const video = videoRef.current;
      if (video) video.srcObject = stream ?? new MediaStream([event.track]);
      clearTimeout(timer);
      setMode({ kind: 'live' });
    });
    peer.addEventListener('connectionstatechange', () => {
      if (peer.connectionState === 'failed') fail('the peer connection failed');
    });
    const apply = signalApplier(
      peer,
      async (description) => {
        if (description.type !== 'offer') return;
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        handle.signal({ type: 'answer', sdp: answer.sdp ?? '' });
      },
      () => fail('the offer could not be used'),
    );
    const handle = liveChannel.open(s.id, (event) => {
      if (event.kind === 'signal') return void apply(event.data);
      const { status, reason } = event.session;
      if (status === 'failed' || status === 'ended') {
        fail(reason ? REASONS[reason] : 'the live view ended');
      }
    });
    peer.addEventListener('icecandidate', (event) => {
      if (event.candidate?.candidate) handle.signal(candidateData(event.candidate));
    });
    return () => {
      done = true;
      clearTimeout(timer);
      handle.close();
      peer.close();
      const video = videoRef.current;
      if (video) video.srcObject = null;
    };
  }, [webrtc, visible, attempt, s.id, liveChannel, fallback]);

  useEffect(() => {
    if (visible) return;
    const timer = setTimeout(onClose, FAST_THUMB_HIDDEN_CLOSE_MS);
    return () => clearTimeout(timer);
  }, [visible, onClose]);

  if (mode.kind === 'fallback') {
    return (
      <div className="flex flex-col gap-1">
        <FastThumbView student={s} roster={roster} onClose={onClose} />
        <p className="flex items-center gap-2 text-xs text-muted">
          Live video is not available ({mode.why}); showing a picture every second.
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            onClick={() => {
              setMode({ kind: 'connecting' });
              setAttempt((n) => n + 1);
            }}
          >
            Try live video again
          </Button>
        </p>
      </div>
    );
  }

  return (
    <section aria-label="Live screen" className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-sm">
        <h3 className="font-semibold">Live screen</h3>
        <span className="text-muted">{mode.kind === 'live' ? 'live video' : 'connecting…'}</span>
        <Button size="sm" variant="outline" className="ml-auto" onClick={onClose}>
          Close live screen
        </Button>
      </div>
      <div className="relative aspect-video w-full overflow-hidden rounded-md bg-black/80">
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          aria-label={`Live screen of ${s.name}`}
          className="h-full w-full object-contain"
        />
        {mode.kind === 'connecting' && (
          <span className="absolute inset-0 flex items-center justify-center text-sm text-white/70">
            Connecting to {s.name}'s screen…
          </span>
        )}
      </div>
    </section>
  );
}
