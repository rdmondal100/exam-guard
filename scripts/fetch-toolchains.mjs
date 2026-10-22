// Fetches the pinned student toolchains into apps/desktop/resources/toolchains (gitignored):
// WinLibs MinGW-w64 (trimmed to C/C++), MSYS2 for pacman, and npm. docs/architecture.md §4.
// Run: pnpm fetch-toolchains. Each part has a version marker, so a re-run only fetches what changed.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchMingw } from './toolchains/mingw.mjs';
import { fetchMsys2 } from './toolchains/msys2.mjs';
import { fetchNpm } from './toolchains/npm.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'apps/desktop/resources/toolchains');

await fetchMingw(target);
await fetchMsys2(target);
await fetchNpm(target);
