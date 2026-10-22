// Shared helpers for scripts/fetch-toolchains.mjs: download with a pinned checksum, extract,
// version markers and folder sizes.
/* global console, fetch, process */
import { createHash } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFileSync } from 'node:child_process';

/** `algorithm` is `sha256` (hex digest) or `sha512` (npm `integrity`, base64). */
export const digest = async (file, algorithm, encoding) => {
  const hash = createHash(algorithm);
  await pipeline(createReadStream(file), hash);
  return hash.digest(encoding);
};

/** Downloads `url` to `file` unless it is already there with the expected digest. */
export async function download({
  url,
  file,
  algorithm = 'sha256',
  encoding = 'hex',
  expected,
  label,
}) {
  if (existsSync(file) && (await digest(file, algorithm, encoding)) === expected) return;
  console.log(`Downloading ${label}…`);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status} for ${url}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(file));
  const actual = await digest(file, algorithm, encoding);
  if (actual !== expected) {
    rmSync(file);
    throw new Error(`Checksum mismatch for ${label}: expected ${expected}, got ${actual}`);
  }
}

/**
 * Windows 10+ ships bsdtar, which reads zip, tar.gz and tar.zst. Use it by full path: Git's GNU
 * tar may come first on PATH and reads "E:" as a remote host.
 */
export function extract(archive, into) {
  const tar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
  execFileSync(tar, ['-xf', archive, '-C', into], { stdio: 'inherit' });
}

export const readMarker = (dir) => {
  const marker = join(dir, '.examguard-version');
  return existsSync(marker) ? readFileSync(marker, 'utf8').trim() : null;
};

export const markerPath = (dir) => join(dir, '.examguard-version');

/** Total size of a folder in bytes (symlinks are not followed). */
export function folderSize(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) total += folderSize(path);
    else if (entry.isFile()) total += statSync(path).size;
  }
  return total;
}

export const mb = (bytes) => `${Math.round(bytes / (1024 * 1024))} MB`;
