import { join } from 'node:path';
import type { QuestionLanguage } from '@examguard/shared';
import { GCC_SPECS, GCC_SPECS_FILE } from './gcc-specs.js';

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
  compile?: (tools: ToolPaths) => string[];
  run: (tools: ToolPaths, dir: string) => string[];
  env?: Record<string, string>;
}

const gcc = (tool: 'gcc' | 'g++', std: string, source: string) => (tools: ToolPaths) => [
  join(tools.mingwBin ?? '', `${tool}.exe`),
  `-specs=${GCC_SPECS_FILE}`,
  `-std=${std}`,
  '-O2',
  '-Wall',
  source,
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
    run: (tools) => [tools.nodeExe, 'main.js'],
    env: { ELECTRON_RUN_AS_NODE: '1' },
  },
};
