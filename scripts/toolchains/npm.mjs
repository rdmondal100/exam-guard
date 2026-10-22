// npm for the exam terminal. It runs on ExamGuard's own Electron through the `node.cmd` shim,
// so no separate Node is bundled (architecture §4).
/* global console */
import { existsSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { download, extract, folderSize, markerPath, mb, readMarker } from './util.mjs';

const VERSION = '11.21.1';
// The registry's `dist.integrity` for this version.
const SHA512 =
  'YTzL6QBEJXyHcTu0JiUc7RKMp+mzlJtl7rGLmERaXUQeFHIMc9atdr6G9M9C8vDWbv40epoTQAzNL2/PtZVDhQ==';
const URL = `https://registry.npmjs.org/npm/-/npm-${VERSION}.tgz`;

export async function fetchNpm(target) {
  const npm = join(target, 'npm');
  if (readMarker(npm) === VERSION) {
    console.log(`npm ${VERSION} is already in ${npm}`);
    return;
  }
  const archive = join(target, `npm-${VERSION}.tgz`);
  await download({
    url: URL,
    file: archive,
    algorithm: 'sha512',
    encoding: 'base64',
    expected: SHA512,
    label: `npm ${VERSION} (about 3 MB)`,
  });
  const tmp = mkdtempSync(join(target, 'npm-'));
  extract(archive, tmp); // the tarball's top folder is package/
  if (!existsSync(join(tmp, 'package', 'bin', 'npm-cli.js')))
    throw new Error('npm-cli.js not found');
  rmSync(npm, { recursive: true, force: true });
  renameSync(join(tmp, 'package'), npm);
  rmSync(tmp, { recursive: true, force: true });
  writeFileSync(markerPath(npm), VERSION);
  rmSync(archive);
  console.log(`npm ${VERSION} ready in ${npm} (${mb(folderSize(npm))})`);
}
