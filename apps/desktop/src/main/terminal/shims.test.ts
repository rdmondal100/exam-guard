import { describe, expect, it } from 'vitest';
import { shimFiles, toMsysPath } from './shims.js';
import { terminalPaths } from './terminal-env.js';

const paths = terminalPaths('C:\\Users\\Ann Lee\\run\\es1');
const tools = {
  paths,
  nodeExe: 'C:\\Program Files\\ExamGuard\\ExamGuard.exe',
  npmCli: 'C:\\Program Files\\ExamGuard\\resources\\toolchains\\npm\\bin\\npm-cli.js',
  msysRoot: 'C:\\Program Files\\ExamGuard\\resources\\toolchains\\msys64',
};

describe('toMsysPath', () => {
  it('turns a drive path into the MSYS2 mount', () => {
    expect(toMsysPath('C:\\Users\\Ann Lee\\x')).toBe('/c/Users/Ann Lee/x');
    expect(toMsysPath('E:\\a')).toBe('/e/a');
  });
});

describe('shimFiles', () => {
  const files = shimFiles(tools);

  it('runs node on ExamGuard itself as Node', () => {
    expect(files['node.cmd']).toBe(
      '@echo off\r\nsetlocal\r\nset "ELECTRON_RUN_AS_NODE=1"\r\n"C:\\Program Files\\ExamGuard\\ExamGuard.exe" %*\r\n',
    );
  });

  it('runs npm and npx through the node shim', () => {
    expect(files['npm.cmd']).toBe(
      '@echo off\r\n"%~dp0node.cmd" "C:\\Program Files\\ExamGuard\\resources\\toolchains\\npm\\bin\\npm-cli.js" %*\r\n',
    );
    expect(files['npx.cmd']).toContain('npm\\bin\\npx-cli.js" %*');
  });

  it('points pacman at the workspace with POSIX paths and syncs on first use', () => {
    const pacman = files['pacman.cmd'] ?? '';
    const root = '/c/Users/Ann Lee/run/es1/workspace/.msys';
    expect(pacman).toContain(`--root "${root}" --dbpath "${root}/var/lib/pacman"`);
    expect(pacman).toContain('--gpgdir "/c/Users/Ann Lee/run/es1/.examguard/gnupg"');
    expect(pacman).toContain('--config "/c/Users/Ann Lee/run/es1/.examguard/pacman.conf"');
    expect(pacman).toContain('--noscriptlet');
    const lines = pacman.split('\r\n');
    expect(lines[2]).toMatch(
      /^if not exist "C:\\Users\\Ann Lee\\run\\es1\\workspace\\\.msys\\var\\lib\\pacman\\sync\\ucrt64\.db" ".*pacman\.exe" .* -Sy \|\| exit \/b 1$/,
    );
    expect(lines[3]).toMatch(/pacman\.exe" .* %\*$/);
  });

  it('escapes % in paths and leaves out tools that are missing', () => {
    const only = shimFiles({ ...tools, nodeExe: 'C:\\100%\\e.exe', npmCli: null, msysRoot: null });
    expect(Object.keys(only)).toEqual(['node.cmd']);
    expect(only['node.cmd']).toContain('"C:\\100%%\\e.exe" %*');
  });
});
