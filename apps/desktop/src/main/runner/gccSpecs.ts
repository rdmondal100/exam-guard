/**
 * gcc's stock `endfile` spec links `%:if-exists(default-manifest.o%s)`, and gcc passes that path
 * to the linker unquoted. With MinGW in a folder with spaces (the dev repo, `C:\Program Files`)
 * the link fails. This override is the stock spec of the pinned WinLibs gcc 16.2 with the plain
 * `default-manifest.o%s`, which is quoted like `crtend.o%s`. Written next to the source as
 * `eg.specs` and passed with `-specs=eg.specs`. Re-check it when the toolchain version changes
 * (`gcc -dumpspecs`); the runner e2e test fails if it breaks.
 */
export const GCC_SPECS_FILE = 'eg.specs';

export const GCC_SPECS = `*endfile:
%{mdaz-ftz:crtfastmath.o%s;Ofast|ffast-math|funsafe-math-optimizations:%{!shared:%{!mno-daz-ftz:crtfastmath.o%s}}}    %{!shared:default-manifest.o%s}   %{fvtable-verify=none:%s;     fvtable-verify=preinit:vtv_end.o%s;     fvtable-verify=std:vtv_end.o%s}   crtend.o%s

`;
