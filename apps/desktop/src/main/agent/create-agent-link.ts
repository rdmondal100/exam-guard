import net from 'node:net';
import { AGENT_PIPE_NAME } from '@examguard/shared';
import { AgentClient } from './agent-client.js';
import type { AgentLink } from './agent-link.js';
import { installedAgentPath, verifyAgentService } from './agent-verify.js';
import { FakeAgent, parseFakeFailure } from './fake-agent.js';
import type { RunCommand } from './run-command.js';

export interface AgentLinkEnv {
  isPackaged: boolean;
  env: NodeJS.ProcessEnv;
  appVersion: string;
}

/** Whether `EG_FAKE_AGENT=1` is in force (dev builds only). */
export function isFakeAgent({ isPackaged, env }: AgentLinkEnv): boolean {
  return !isPackaged && env['EG_FAKE_AGENT'] === '1';
}

/**
 * The student app's agent link: the dev fake, or the pipe client. `EG_AGENT_CONSOLE=1` (dev builds
 * only) is for `eg-agent --console`, which is not a service, so there is no service to check.
 */
export function createAgentLink(where: AgentLinkEnv, run: RunCommand): AgentLink {
  if (isFakeAgent(where)) return new FakeAgent(parseFakeFailure(where.env['EG_FAKE_AGENT_FAIL']));
  const withoutService = !where.isPackaged && where.env['EG_AGENT_CONSOLE'] === '1';
  return new AgentClient({
    connect: () => net.connect(AGENT_PIPE_NAME),
    verifyService: withoutService
      ? async () => true
      : (pid) => verifyAgentService(pid, run, installedAgentPath(where.env)),
    appVersion: where.appVersion,
  });
}
