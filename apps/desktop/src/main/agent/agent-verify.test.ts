import { describe, expect, it } from 'vitest';
import {
  installedAgentPath,
  parseBinaryPath,
  parseServicePid,
  verifyAgentService,
} from './agent-verify.js';
import type { RunCommand } from './run-command.js';

const QUERYEX = (pid: number) => `
SERVICE_NAME: ExamGuardAgent
        TYPE               : 10  WIN32_OWN_PROCESS
        STATE              : 4  RUNNING
                                (STOPPABLE, NOT_PAUSABLE, ACCEPTS_SHUTDOWN)
        WIN32_EXIT_CODE    : 0  (0x0)
        PID                : ${pid}
        FLAGS              :
`;
const QC = (path: string) => `
[SC] QueryServiceConfig SUCCESS

SERVICE_NAME: ExamGuardAgent
        TYPE               : 10  WIN32_OWN_PROCESS
        START_TYPE         : 2   AUTO_START
        BINARY_PATH_NAME   : ${path}
        SERVICE_START_NAME : LocalSystem
`;
const INSTALLED = 'C:\\Program Files\\ExamGuard\\agent\\eg-agent.exe';

describe('parsing sc output', () => {
  it('reads the pid, and none for a stopped service', () => {
    expect(parseServicePid(QUERYEX(4120))).toBe(4120);
    expect(parseServicePid(QUERYEX(0))).toBeNull();
    expect(parseServicePid('')).toBeNull();
  });

  it('reads the program file with or without quotes and arguments', () => {
    expect(parseBinaryPath(QC(`"${INSTALLED}" --service`))).toBe(INSTALLED);
    expect(parseBinaryPath(QC(`${INSTALLED} --service`))).toBe(INSTALLED);
    expect(parseBinaryPath('nothing here')).toBeNull();
  });

  it('names the installed agent under Program Files', () => {
    expect(installedAgentPath({ ProgramFiles: 'D:\\PF' })).toBe(
      'D:\\PF\\ExamGuard\\agent\\eg-agent.exe',
    );
  });
});

describe('verifyAgentService', () => {
  const fake =
    (pid: number, path: string): RunCommand =>
    async (_file, args) => ({
      stdout: args[0] === 'queryex' ? QUERYEX(pid) : QC(`"${path}" --service`),
      code: 0,
    });

  it('accepts the running service from the installed folder', async () => {
    expect(await verifyAgentService(4120, fake(4120, INSTALLED), INSTALLED)).toBe(true);
    expect(await verifyAgentService(4120, fake(4120, INSTALLED.toLowerCase()), INSTALLED)).toBe(
      true,
    );
  });

  it('refuses a pid that is not the service, and a service from another folder', async () => {
    expect(await verifyAgentService(999, fake(4120, INSTALLED), INSTALLED)).toBe(false);
    const elsewhere = 'C:\\Users\\student\\eg-agent.exe';
    expect(await verifyAgentService(4120, fake(4120, elsewhere), INSTALLED)).toBe(false);
  });

  it('refuses when the service does not exist', async () => {
    const missing: RunCommand = async () => ({ stdout: '', code: 1060 });
    expect(await verifyAgentService(4120, missing, INSTALLED)).toBe(false);
  });
});
