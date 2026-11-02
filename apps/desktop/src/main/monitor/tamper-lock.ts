import type { AgentLinkStatus } from '@examguard/shared';
import type { AgentLink } from '../agent/agent-link.js';
import type { SessionClient } from '../session-client.js';
import { TamperWatch } from './tamper-watch.js';

/**
 * The tamper lock (M24): an agent link that stays down while the exam runs sends `agent_lost`
 * (the server locks the student and alerts the teacher) and shows the lock at once. Feed the
 * returned watch whether the student is working (`setWorking`).
 */
export function createTamperLock(
  link: Pick<AgentLink, 'status' | 'onChange'>,
  session: Pick<SessionClient, 'sendEvent' | 'lockLocally'>,
): TamperWatch {
  const watch = new TamperWatch({
    onLost: (loss) => {
      session.sendEvent('agent_lost', { reason: loss.reason, downMs: loss.downMs });
      session.lockLocally();
    },
  });
  const follow = (status: AgentLinkStatus) =>
    watch.setLinked(status.verified, status.problems[0] ?? '');
  follow(link.status());
  link.onChange(follow);
  return watch;
}
