import { describe, expect, it } from 'vitest';
import { readForeground, toFrontWindow } from './foreground.js';

const raw = {
  id: 131834,
  title: '  ChatGPT - Google Chrome ',
  owner: {
    name: 'Google Chrome',
    path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    processId: 15356,
  },
  bounds: { x: 0, y: 0, width: 800, height: 600 },
};

describe('toFrontWindow', () => {
  it('keeps the exe file name, the path, the process, the handle and the trimmed title', () => {
    expect(toFrontWindow(raw)).toEqual({
      exe: 'chrome.exe',
      path: raw.owner.path,
      pid: 15356,
      windowId: 131834,
      title: 'ChatGPT - Google Chrome',
      bounds: raw.bounds,
    });
  });

  it('is null without a path, a process or a handle', () => {
    expect(toFrontWindow(undefined)).toBeNull();
    expect(toFrontWindow({ ...raw, owner: { ...raw.owner, path: '' } })).toBeNull();
    expect(toFrontWindow({ ...raw, owner: { path: raw.owner.path } })).toBeNull();
    expect(toFrontWindow({ owner: raw.owner })).toBeNull();
  });
});

describe('readForeground', () => {
  it('never throws: a failed read is no window', async () => {
    expect(await readForeground(async () => raw)).toMatchObject({ exe: 'chrome.exe' });
    expect(await readForeground(async () => undefined)).toBeNull();
    expect(
      await readForeground(async () => {
        throw new Error('desktop locked');
      }),
    ).toBeNull();
  });
});
