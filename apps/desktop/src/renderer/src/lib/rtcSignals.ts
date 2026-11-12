import type { RtcCandidate, RtcDescription, RtcSignalData } from '@examguard/shared';

export function isDescription(data: RtcSignalData): data is RtcDescription {
  return 'type' in data;
}

/** The parts of `RTCPeerConnection` the signal handling needs (tests pass a fake). */
export interface SignalPeer {
  setRemoteDescription(description: RtcDescription): Promise<void>;
  addIceCandidate(candidate: RtcCandidate): Promise<void>;
}

/**
 * Applies the far side's signals in the order they came (live view, M34). A candidate that
 * arrives before the description is held until the description is set, since a peer refuses it
 * before. `afterDescription` runs once the description is set (the teacher answers an offer there).
 * A failing step is reported and the chain goes on.
 */
export function signalApplier(
  peer: SignalPeer,
  afterDescription: (description: RtcDescription) => Promise<void>,
  onError: (error: unknown) => void,
): (data: RtcSignalData) => Promise<void> {
  let chain: Promise<void> = Promise.resolve();
  let described = false;
  const held: RtcCandidate[] = [];
  const apply = async (data: RtcSignalData) => {
    if (isDescription(data)) {
      await peer.setRemoteDescription(data);
      described = true;
      await afterDescription(data);
      for (const candidate of held.splice(0)) await peer.addIceCandidate(candidate);
      return;
    }
    if (!data.candidate) return;
    if (!described) held.push(data);
    else await peer.addIceCandidate(data);
  };
  return (data) => {
    chain = chain.then(() => apply(data)).catch(onError);
    return chain;
  };
}

/** A candidate as it goes over the wire (`RTCIceCandidate.toJSON()` keeps only these). */
export function candidateData(candidate: {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
  usernameFragment: string | null;
}): RtcCandidate {
  return {
    candidate: candidate.candidate,
    sdpMid: candidate.sdpMid,
    sdpMLineIndex: candidate.sdpMLineIndex,
    usernameFragment: candidate.usernameFragment,
  };
}
