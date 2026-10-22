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
}

/**
 * One runnable language (architecture §4). Adding Java or Python later means adding an entry.
 * Commands run with the work dir as cwd, so compiler messages name the bare file.
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
    run: (tools, _dir, flags) => [tools.nodeExe, '-r', `./${JS_STDIN_FILE}`, ...flags, 'main.js'],
    env: { ELECTRON_RUN_AS_NODE: '1' },
  },
};
