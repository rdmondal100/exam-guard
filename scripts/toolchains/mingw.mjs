// WinLibs MinGW-w64 (UCRT): download, trim to C/C++ and write gcc's `specs` file.
/* global console */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { download, extract, folderSize, markerPath, mb, readMarker } from './util.mjs';

const RELEASE = '16.2.0posix-23.1.3-14.0.0-ucrt-r3';
const FILE = 'winlibs-x86_64-posix-seh-gcc-16.2.0-mingw-w64ucrt-14.0.0-r3.zip';
const SHA256 = '3c69305081e4a647144339a936244fcf7d3d9e558319e1ad7be2cd2886d4b6a1';
const URL = `https://github.com/brechtsanders/winlibs_mingw/releases/download/${RELEASE}/${FILE}`;
const GCC_LIB = 'lib/gcc/x86_64-w64-mingw32/16.2.0';

/**
 * Everything that is not needed to build C and C++ (requirements §5): other front ends (Fortran,
 * Objective-C), debuggers, build systems, linters, assemblers, the WinLibs package tools, the
 * Python that only gdb uses, docs and translations. gcc, g++, binutils, mingw32-make and every
 * DLL they load stay.
 */
export const MINGW_TRIM = [
  ...[
    'ccache',
    'cmake',
    'cmcldeps',
    'cpack',
    'ctest',
    'cppcheck',
    'ctags',
    'readtags',
    'optscript',
    'doxygen',
    'gdb',
    'gdbserver',
    'gfortran',
    'x86_64-w64-mingw32-gfortran',
    'jwasm',
    'nasm',
    'ndisasm',
    'yasm',
    'vsyasm',
    'ytasm',
    'ninja',
    'premake5',
    'bomtool',
    'spdxtool',
    'pccritic',
    'dos2unix',
    'unix2dos',
    'mac2unix',
    'unix2mac',
    'sarif-replay',
    'lto-dump',
    'wl-build',
    'wl-checknewreleases',
    'wl-download',
    'wl-edit',
    'wl-find',
    'wl-info',
    'wl-install',
    'wl-listall',
    'wl-makepackage',
    'wl-showdeps',
    'wl-showstatus',
    'wl-uninstall',
    'wl-wait4deps',
  ].map((name) => `bin/${name}.exe`),
  'bin/gdb-add-index',
  'bin/gstack',
  'bin/libpython3.9.dll',
  'bin/libgfortran-5.dll',
  'libexec/gcc/x86_64-w64-mingw32/16.2.0/f951.exe',
  'libexec/gcc/x86_64-w64-mingw32/16.2.0/cc1obj.exe',
  'libexec/gcc/x86_64-w64-mingw32/16.2.0/cc1objplus.exe',
  'lib/python3.9',
  'lib/libpython3.9.a',
  'lib/libpython3.9.dll.a',
  'lib/libgfortran.a',
  'lib/libgfortran.dll.a',
  'lib/libgfortran.spec',
  'lib/libyasm.a',
  `${GCC_LIB}/finclude`,
  `${GCC_LIB}/libcaf_shmem.a`,
  `${GCC_LIB}/libcaf_single.a`,
  'share/man',
  'share/info',
  'share/doc',
  'share/locale',
  'share/cmake-4.4',
  'share/Cppcheck',
  'share/gdb',
];

/**
 * gcc's stock `endfile` spec passes `default-manifest.o` to ld unquoted, so linking fails when
 * MinGW lives in a folder with spaces (this repo, `C:\Program Files`). gcc reads a `specs` file
 * in its lib folder instead of the built-in specs, so a fixed copy there repairs plain `gcc` in
 * the exam terminal too. The runner still passes `-specs=eg.specs` (runner/gcc-specs.ts).
 */
export const fixSpecs = (specs) => {
  const fixed = specs.replace('%:if-exists(default-manifest.o%s)', 'default-manifest.o%s');
  if (fixed === specs) throw new Error('gcc specs: the default-manifest rule was not found');
  return fixed;
};

export async function fetchMingw(target) {
  const mingw = join(target, 'mingw64');
  if (readMarker(mingw) !== RELEASE) {
    mkdirSync(target, { recursive: true });
    const zip = join(target, FILE);
    await download({ url: URL, file: zip, expected: SHA256, label: `${FILE} (about 280 MB)` });
    console.log('Extracting MinGW…');
    rmSync(mingw, { recursive: true, force: true });
    extract(zip, target); // the archive's top folder is mingw64/
    if (!existsSync(join(mingw, 'bin/gcc.exe'))) throw new Error(`gcc.exe not found in ${mingw}`);
    writeFileSync(markerPath(mingw), RELEASE);
    rmSync(zip);
  }
  // Trim and specs are cheap and idempotent, so they also apply to an older, untrimmed fetch.
  const before = folderSize(mingw);
  for (const path of MINGW_TRIM) rmSync(join(mingw, path), { recursive: true, force: true });
  const gcc = join(mingw, 'bin', 'gcc.exe');
  const specsFile = join(mingw, GCC_LIB, 'specs');
  rmSync(specsFile, { force: true }); // dump the built-in specs, not a previous copy
  writeFileSync(specsFile, fixSpecs(execFileSync(gcc, ['-dumpspecs'], { encoding: 'utf8' })));
  console.log(
    `MinGW ${RELEASE} ready in ${mingw} (${mb(before)} before trim, ${mb(folderSize(mingw))} now)`,
  );
}
