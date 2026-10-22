// MSYS2 base, used only for `pacman` in the exam terminal (architecture §4). Students install
// into their own workspace with --root, so this tree is never written after setup.
/* global console, process */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { download, extract, folderSize, markerPath, mb, readMarker } from './util.mjs';

const VERSION = '20260927';
const FILE = `msys2-base-x86_64-${VERSION}.tar.zst`;
const SHA256 = '8a2095647afbf799d113d0cae35f7544589d059819042635504e75bd2179bd02';
const URL = `https://repo.msys2.org/distrib/x86_64/${FILE}`;

export async function fetchMsys2(target) {
  const msys = join(target, 'msys64');
  if (readMarker(msys) === VERSION) {
    console.log(`MSYS2 ${VERSION} is already in ${msys} (${mb(folderSize(msys))})`);
    return;
  }
  mkdirSync(target, { recursive: true });
  const archive = join(target, FILE);
  await download({ url: URL, file: archive, expected: SHA256, label: `${FILE} (about 45 MB)` });
  console.log('Extracting MSYS2…');
  rmSync(msys, { recursive: true, force: true });
  extract(archive, target); // the archive's top folder is msys64/
  // The first login shell runs MSYS2's one-time setup, which creates and fills the pacman
  // keyring (/etc/pacman.d/gnupg). PATH is reset so Git's MSYS tools cannot get in the way.
  const system32 = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
  execFileSync(join(msys, 'usr', 'bin', 'bash.exe'), ['-lc', 'exit'], {
    stdio: 'inherit',
    env: { ...process.env, MSYSTEM: 'MSYS', CHERE_INVOKING: '1', PATH: system32 },
  });
  if (!existsSync(join(msys, 'etc', 'pacman.d', 'gnupg', 'pubring.gpg'))) {
    throw new Error('MSYS2 setup did not create the pacman keyring');
  }
  writeFileSync(markerPath(msys), VERSION);
  rmSync(archive);
  console.log(`MSYS2 ${VERSION} ready in ${msys} (${mb(folderSize(msys))})`);
}
