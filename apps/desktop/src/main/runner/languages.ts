import { join } from 'node:path';
import type { QuestionLanguage } from '@examguard/shared';
import { GCC_SPECS, GCC_SPECS_FILE } from './gcc-specs.js';
import { JS_STDIN, JS_STDIN_FILE } from './js-stdin.js';

/** Where the tools live for one run (see `toolchains.ts`). */
export interface ToolPaths {
  /** MinGW `bin` folder, or `null` if the C/C++ toolchain is missing. */
  mingwBin: string | null;
  /** The Electron executable, run as Node for JavaScript. */
  nodeExe: string;
  /** The bundled CPython (`python.exe`), or `null` if it was not found. */
  pythonExe: string | null;
}

/**
 * One runnable language (architecture §4). Adding Java or Python later means adding an entry.
 * The compiler runs with the work dir as cwd, so its messages name the bare file; the program
 * runs in the workspace, so `run` names the source by its full path.
 */
export interface LanguageConfig {
  id: QuestionLanguage;
  label: string;
  fileName: string;
  /** Helper files written next to the source before compiling. */
  files?: Record<string, string>;
  /** `flags` are the student's own, already split: extra compiler flags. */
  compile?: (tools: ToolPaths, flags: string[]) => string[];
  /** `flags` are the student's own, already split: Node flags for JavaScript. */
  run: (tools: ToolPaths, dir: string, flags: string[]) => string[];
  env?: Record<string, string>;
  /** Why this language cannot run on this computer, or `null` if it can. */
  unavailable?: (tools: ToolPaths) => string | null;
}

// The student's flags come after the source, so `-l` libraries link and a `-std=` of theirs wins.
// Our `-o` is last, so the run always finds main.exe.
const gcc =
  (tool: 'gcc' | 'g++', std: string, source: string) => (tools: ToolPaths, flags: string[]) => [
    join(tools.mingwBin ?? '', `${tool}.exe`),
    `-specs=${GCC_SPECS_FILE}`,
    `-std=${std}`,
    '-O2',
    '-Wall',
    source,
    ...flags,
    '-o',
    'main.exe',
  ];

export const LANGUAGES: Record<QuestionLanguage, LanguageConfig> = {
  c: {
    id: 'c',
    label: 'C',
    fileName: 'main.c',
    files: { [GCC_SPECS_FILE]: GCC_SPECS },
    compile: gcc('gcc', 'c11', 'main.c'),
    run: (_tools, dir) => [join(dir, 'main.exe')],
  },
  cpp: {
    id: 'cpp',
    label: 'C++',
    fileName: 'main.cpp',
    files: { [GCC_SPECS_FILE]: GCC_SPECS },
    compile: gcc('g++', 'c++17', 'main.cpp'),
    run: (_tools, dir) => [join(dir, 'main.exe')],
  },
  js: {
    id: 'js',
    label: 'JavaScript',
    fileName: 'main.js',
    files: { [JS_STDIN_FILE]: JS_STDIN },
    run: (tools, dir, flags) => [
      tools.nodeExe,
      '-r',
      join(dir, JS_STDIN_FILE),
      ...flags,
      join(dir, 'main.js'),
    ],
    env: { ELECTRON_RUN_AS_NODE: '1' },
  },
  py: {
    id: 'py',
    label: 'Python',
    fileName: 'main.py',
    unavailable: (tools) => (tools.pythonExe ? null : 'Python is not installed on this computer.'),
    run: (tools, dir, flags) => [tools.pythonExe ?? '', ...flags, join(dir, 'main.py')],
    // UTF-8 for input() and print() in the console; no .pyc files in the run folder. NumPy's
    // OpenBLAS reserves a buffer per CPU core at import, which on a 20-core PC alone passes the
    // 256 MB job limit ("OpenBLAS error: Memory allocation still failed"), so it gets one thread.
    env: {
      PYTHONUTF8: '1',
      PYTHONDONTWRITEBYTECODE: '1',
      OPENBLAS_NUM_THREADS: '1',
      OMP_NUM_THREADS: '1',
      MKL_NUM_THREADS: '1',
    },
  },
};
