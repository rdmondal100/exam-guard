import { describe, expect, it } from 'vitest';
import { LivePageMessageSchema, MAX_SDP_LENGTH, RtcSignalSchema } from './live.js';
import {
  ServerToStudentSchema,
  ServerToTeacherSchema,
  StudentMessageSchema,
  TeacherMessageSchema,
} from './ws.js';

const offer = { type: 'offer', sdp: 'v=0\r\n' };
const candidate = {
  candidate: 'candidate:1 1 udp 2122260223 192.168.1.20 54321 typ host',
  sdpMid: '0',
  sdpMLineIndex: 0,
  usernameFragment: 'abcd',
};

describe('live view messages', () => {
  it('relays an offer, an answer and a candidate in every direction', () => {
    for (const data of [offer, { type: 'answer', sdp: 'v=0' }, candidate, { candidate: '' }]) {
      const signal = { t: 'rtc.signal', sessionId: 'l1', data };
      expect(StudentMessageSchema.safeParse(signal).success).toBe(true);
      expect(ServerToStudentSchema.safeParse(signal).success).toBe(true);
      expect(TeacherMessageSchema.safeParse(signal).success).toBe(true);
      expect(ServerToTeacherSchema.safeParse(signal).success).toBe(true);
    }
  });

  it('refuses an oversized SDP, a wrong type and a missing session', () => {
    const big = { type: 'offer', sdp: 'x'.repeat(MAX_SDP_LENGTH + 1) };
    expect(RtcSignalSchema.safeParse({ t: 'rtc.signal', sessionId: 'l1', data: big }).success).toBe(
      false,
    );
    const pranswer = { type: 'pranswer', sdp: 'v=0' };
    expect(
      RtcSignalSchema.safeParse({ t: 'rtc.signal', sessionId: 'l1', data: pranswer }).success,
    ).toBe(false);
    expect(RtcSignalSchema.safeParse({ t: 'rtc.signal', data: offer }).success).toBe(false);
  });

  it('parses the session messages in their unions', () => {
    expect(
      ServerToStudentSchema.safeParse({
        t: 'live.request',
        sessionId: 'l1',
        maxWidth: 1280,
        fps: 8,
      }).success,
    ).toBe(true);
    expect(ServerToStudentSchema.safeParse({ t: 'live.stop', sessionId: 'l1' }).success).toBe(true);
    expect(
      StudentMessageSchema.safeParse({ t: 'live.state', sessionId: 'l1', status: 'failed' })
        .success,
    ).toBe(true);
    expect(TeacherMessageSchema.safeParse({ t: 'live.open', examStudentId: 's1' }).success).toBe(
      true,
    );
    expect(TeacherMessageSchema.safeParse({ t: 'live.close', sessionId: 'l1' }).success).toBe(true);
    expect(
      ServerToTeacherSchema.safeParse({
        t: 'live.session',
        sessionId: 'l1',
        examStudentId: 's1',
        status: 'failed',
        reason: 'too_many',
      }).success,
    ).toBe(true);
  });

  it('parses the live page IPC messages', () => {
    expect(
      LivePageMessageSchema.safeParse({ kind: 'signal', sessionId: 'l1', data: candidate }).success,
    ).toBe(true);
    expect(
      LivePageMessageSchema.safeParse({ kind: 'state', sessionId: 'l1', status: 'ended' }).success,
    ).toBe(true);
    expect(LivePageMessageSchema.safeParse({ kind: 'other', sessionId: 'l1' }).success).toBe(false);
  });
});
