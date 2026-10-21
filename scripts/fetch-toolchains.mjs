// Downloads the pinned WinLibs MinGW-w64 (UCRT) build into apps/desktop/resources/toolchains/mingw64.
// The student code runner compiles C and C++ with it (docs/architecture.md §4). Run: pnpm fetch-toolchains
/* global console, fetch, process */
import { createHash } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const RELEASE = '16.2.0posix-23.1.3-14.0.0-ucrt-r3';
const FILE = 'winlibs-x86_64-posix-seh-gcc-16.2.0-mingw-w64ucrt-14.0.0-r3.zip';
const SHA256 = '3c69305081e4a647144339a936244fcf7d3d9e558319e1ad7be2cd2886d4b6a1';
const URL = `https://github.com/brechtsanders/winlibs_mingw/releases/download/${RELEASE}/${FILE}`;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'apps/desktop/resources/toolchains');
const mingw = join(target, 'mingw64');
const marker = join(mingw, '.examguard-version');
const zip = join(target, FILE);

const sha256 = async (file) => {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
};

if (existsSync(marker) && readFileSync(marker, 'utf8').trim() === RELEASE) {
  console.log(`MinGW ${RELEASE} is already in ${mingw}`);
  process.exit(0);
}
mkdirSync(target, { recursive: true });

if (!existsSync(zip) || (await sha256(zip)) !== SHA256) {
  console.log(`Downloading ${FILE} (about 280 MB)…`);
  const res = await fetch(URL);
  if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(zip));
  const actual = await sha256(zip);
  if (actual !== SHA256) {
    rmSync(zip);
    throw new Error(`Checksum mismatch: expected ${SHA256}, got ${actual}`);
  }
}

console.log('Extracting…');
rmSync(mingw, { recursive: true, force: true });
// Windows 10+ ships bsdtar, which reads zip files. Use it by full path: Git's GNU tar may come
// first on PATH and reads "E:" as a remote host. The archive's top folder is mingw64/.
const tar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
execFileSync(tar, ['-xf', zip, '-C', target], { stdio: 'inherit' });
if (!existsSync(join(mingw, 'bin/gcc.exe'))) throw new Error(`gcc.exe not found in ${mingw}`);
writeFileSync(marker, RELEASE);
rmSync(zip);
console.log(`MinGW ${RELEASE} ready in ${mingw}`);
