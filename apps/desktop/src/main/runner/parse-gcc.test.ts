import { describe, expect, it } from 'vitest';
import { parseGcc } from './parse-gcc.js';

const OUTPUT = [
  "main.c: In function 'main':",
  "main.c:3:5: error: expected ';' before 'return'",
  '    3 |     return 0',
  '      |     ^~~~~~',
  "main.c:2:9: warning: unused variable 'x' [-Wunused-variable]",
  './main.c:7:1: fatal error: no.h: No such file or directory',
  'C:/mingw/include/stdio.h:10:2: note: declared here',
  "main.c:1:1: note: include '<stdlib.h>'",
  "C:/x/ld.exe: main.o:main.c:(.text+0x5): undefined reference to `foo'",
].join('\r\n');

describe('parseGcc', () => {
  it('keeps errors, warnings and notes for the student file only', () => {
    expect(parseGcc(OUTPUT, 'main.c')).toEqual([
      { line: 3, col: 5, severity: 'error', message: "expected ';' before 'return'" },
      {
        line: 2,
        col: 9,
        severity: 'warning',
        message: "unused variable 'x' [-Wunused-variable]",
      },
      { line: 7, col: 1, severity: 'error', message: 'no.h: No such file or directory' },
      { line: 1, col: 1, severity: 'note', message: "include '<stdlib.h>'" },
    ]);
  });

  it('returns nothing for clean output or another file name', () => {
    expect(parseGcc('', 'main.c')).toEqual([]);
    expect(parseGcc(OUTPUT, 'main.cpp')).toEqual([]);
  });
});
