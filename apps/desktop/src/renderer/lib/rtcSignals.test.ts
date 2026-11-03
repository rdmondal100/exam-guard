import { describe, expect, it } from 'vitest';
import { signalApplier, type SignalPeer } from './rtcSignals.js';

function fakePeer() {
  const steps: string[] = [];
  const peer: SignalPeer = {
    setRemoteDescription: async (d) => {
      steps.push(`remote:${d.type}`);
    },
    addIceCandidate: async (c) => {
      steps.push(`candidate:${c.candidate}`);
    },
  };
  return { peer, steps };
}

describe('signalApplier', () => {
  it('holds candidates that come before the description', async () => {
    const { peer, steps } = fakePeer();
    const apply = signalApplier(
      peer,
      async () => {
        steps.push('answered');
      },
      () => undefined,
    );
    void apply({ candidate: 'a' });
    void apply({ type: 'offer', sdp: 'v=0' });
    await apply({ candidate: 'b' });
    expect(steps).toEqual(['remote:offer', 'answered', 'candidate:a', 'candidate:b']);
  });

  it('skips the empty end-of-candidates marker and keeps going after an error', async () => {
    const { peer, steps } = fakePeer();
    const errors: unknown[] = [];
    let first = true;
    const apply = signalApplier(
      {
        ...peer,
        setRemoteDescription: async (d) => {
          if (first) {
            first = false;
            throw new Error('bad sdp');
          }
          await peer.setRemoteDescription(d);
        },
      },
      async () => undefined,
      (e) => errors.push(e),
    );
    await apply({ type: 'answer', sdp: 'x' });
    await apply({ type: 'answer', sdp: 'v=0' });
    await apply({ candidate: '' });
    await apply({ candidate: 'c' });
    expect(errors).toHaveLength(1);
    expect(steps).toEqual(['remote:answer', 'candidate:c']);
  });
});
