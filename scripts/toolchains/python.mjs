// CPython for Run and the exam terminal: python-build-standalone's `install_only` build, which
// includes tkinter (turtle, matplotlib windows) and pip (architecture §4). Students install
// packages into their workspace with `pip --target` (PIP_TARGET), so this tree is never written.
/* global console */
import { existsSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { download, extract, folderSize, markerPath, mb, readMarker } from './util.mjs';

const RELEASE = '20261021';
const PYTHON = '3.13.17';
const VERSION = `${PYTHON}+${RELEASE}`;
const FILE = `cpython-${VERSION}-x86_64-pc-windows-msvc-install_only.tar.gz`;
// The `digest` GitHub lists for this release asset.
const SHA256 = 'e10b46d9b03a3a494297f336770f55f86474d683061137b1cf595e12e47bcef5';
const URL = `https://github.com/astral-sh/python-build-standalone/releases/download/${RELEASE}/${FILE.replace('+', '%2B')}`;

// Not needed in an exam: the test suite, IDLE and the turtle demos. tkinter, turtle and pip stay.
const TRIM = ['Lib/test', 'Lib/idlelib', 'Lib/turtledemo'];

/** Debug symbols are about 85 MB of the 145 MB build. */
function removePdb(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) removePdb(path);
    else if (entry.name.endsWith('.pdb')) rmSync(path);
  }
}

export async function fetchPython(target) {
  const python = join(target, 'python');
  if (readMarker(python) === VERSION) {
    console.log(`Python ${VERSION} is already in ${python}`);
    return;
  }
  const archive = join(target, FILE);
  await download({ url: URL, file: archive, expected: SHA256, label: `${FILE} (about 48 MB)` });
  const tmp = mkdtempSync(join(target, 'python-'));
  extract(archive, tmp); // the archive's top folder is python/
  const extracted = join(tmp, 'python');
  if (!existsSync(join(extracted, 'python.exe'))) throw new Error('python.exe not found');
  for (const dir of TRIM) rmSync(join(extracted, dir), { recursive: true, force: true });
  removePdb(extracted);
  rmSync(python, { recursive: true, force: true });
  renameSync(extracted, python);
  rmSync(tmp, { recursive: true, force: true });
  writeFileSync(markerPath(python), VERSION);
  rmSync(archive);
  console.log(`Python ${VERSION} ready in ${python} (${mb(folderSize(python))})`);
}
