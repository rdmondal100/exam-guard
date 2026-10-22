import { describe, expect, it } from 'vitest';
import { parseInstalls } from './parse-install.js';

describe('parseInstalls', () => {
  it.each([
    ['npm i lodash', [{ manager: 'npm', packages: ['lodash'] }]],
    ['npm install --save-dev jest ts-jest', [{ manager: 'npm', packages: ['jest', 'ts-jest'] }]],
    ['npm.cmd add express', [{ manager: 'npm', packages: ['express'] }]],
    ['npm install', [{ manager: 'npm', packages: [] }]],
    [
      'pip install numpy==2.1 "pandas>=2"',
      [{ manager: 'pip', packages: ['numpy==2.1', 'pandas>=2'] }],
    ],
    ['pip3 install -r req.txt flask', [{ manager: 'pip', packages: ['flask'] }]],
    ['python -m pip install matplotlib', [{ manager: 'pip', packages: ['matplotlib'] }]],
    [
      'pacman -S mingw-w64-ucrt-x86_64-freeglut',
      [{ manager: 'pacman', packages: ['mingw-w64-ucrt-x86_64-freeglut'] }],
    ],
    ['pacman -Sy --noconfirm glew', [{ manager: 'pacman', packages: ['glew'] }]],
    [
      "& 'C:\\x\\npm.cmd' i a; pip install b",
      [
        { manager: 'npm', packages: ['a'] },
        { manager: 'pip', packages: ['b'] },
      ],
    ],
  ])('%s', (line, expected) => {
    expect(parseInstalls(line)).toEqual(expected);
  });

  it.each([
    'npm run build',
    'npm -v',
    'pip list',
    'pip show numpy',
    'pacman -Ss glut',
    'pacman -Si glut',
    'pacman -Q',
    'python main.py install',
    'echo npm i lodash',
    'dir',
    '',
  ])('ignores %j', (line) => {
    expect(parseInstalls(line)).toEqual([]);
  });
});
