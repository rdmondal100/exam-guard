// electron-builder settings for the one Windows installer (M45-M46). scripts/package-desktop.mjs
// packs a `pnpm deploy` copy of this app, so every outside path is passed in as an absolute path.
// Node runs this file with its built-in type stripping, so it uses type-only imports and no enums.
// Install type, firewall and uninstall steps: resources/installer.nsh.
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { AfterPackContext, Configuration } from 'electron-builder';

export interface BuilderPaths {
  repo: string;
  desktop: string;
  output: string;
  electronVersion: string;
  electronDist: string;
}

/** Files the app expects next to its resources (main/utils/paths.ts, main/runner/toolchains.ts). */
export const PACKED_RESOURCES = {
  siteReader: 'SiteReader.exe',
  toolchains: 'toolchains',
} as const;

export function builderConfig(p: BuilderPaths): Configuration {
  // Drawn by scripts/make-icon.mjs: the exe, the window, the shortcuts and the installer.
  const icon = join(p.desktop, 'resources/icon.ico');
  return {
    appId: 'ai.examguard.desktop',
    productName: 'ExamGuard',
    // Electron names userData after productName: %APPDATA%\ExamGuard (data-model.md).
    extraMetadata: { productName: 'ExamGuard' },
    copyright: 'ExamGuard AI',
    electronVersion: p.electronVersion,
    electronDist: p.electronDist,
    // better-sqlite3, node-pty and get-windows ship N-API binaries that load in Electron as they are.
    npmRebuild: false,
    nodeGypRebuild: false,
    buildDependenciesFromSource: false,
    directories: { output: p.output, buildResources: join(p.desktop, 'resources') },
    files: [
      'out/**/*',
      'package.json',
      '!**/*.map',
      '!**/*.pdb',
      '!**/node_modules/{node-pty,better-sqlite3}/{src,deps,third_party,scripts,typings,binding.gyp}',
      '!**/node_modules/{node-pty,better-sqlite3}/{src,deps,third_party,scripts,typings}/**',
      '!**/node_modules/get-windows/{Sources,binding.gyp}',
      '!**/node_modules/get-windows/Sources/**',
      '!**/node_modules/get-windows/lib/binding/*darwin*/**',
      '!**/node_modules/**/prebuilds/{darwin,linux,linuxmusl,android,win32-arm64,win32-ia32}*',
      '!**/node_modules/**/prebuilds/{darwin,linux,linuxmusl,android,win32-arm64,win32-ia32}*/**',
    ],
    asar: true,
    // Native code: node-pty's conpty.dll and OpenConsole.exe are started from disk (architecture §4),
    // and get-windows' binary is found by path (node-pre-gyp).
    asarUnpack: [
      '**/node_modules/node-pty/**',
      '**/node_modules/better-sqlite3/**',
      '**/node_modules/get-windows/**',
    ],
    extraResources: [
      // Reads the address bar of Chrome and Edge (main/tracking/site.ts); built by
      // scripts/build-site-reader.mjs with the C# compiler that ships with Windows.
      { from: join(p.desktop, 'resources/SiteReader.exe'), to: PACKED_RESOURCES.siteReader },
      {
        from: join(p.desktop, 'resources/toolchains'),
        to: PACKED_RESOURCES.toolchains,
        // MSYS2 is only there for pacman: its translations and manuals are not needed.
        filter: ['**/*', '!msys64/usr/share/{locale,man,doc,info,gtk-doc}/**', '!**/*.pdb'],
      },
    ],
    electronFuses: {
      // Student JavaScript runs on the app's own Electron as Node (decisions.md, 2026-10-17).
      runAsNode: true,
      enableCookieEncryption: true,
      enableNodeOptionsEnvironmentVariable: false,
      enableNodeCliInspectArguments: false,
      enableEmbeddedAsarIntegrityValidation: true,
      onlyLoadAppFromAsar: true,
    },
    // Copied with the local Electron (electronDist); the app never loads it.
    afterPack: async (context: AfterPackContext) => {
      await rm(join(context.appOutDir, 'resources/default_app.asar'), { force: true });
    },
    win: {
      target: [{ target: 'nsis', arch: ['x64'] }],
      executableName: 'ExamGuard',
      icon,
      requestedExecutionLevel: 'asInvoker',
    },
    nsis: {
      oneClick: false,
      perMachine: true,
      allowElevation: true,
      allowToChangeInstallationDirectory: true,
      include: join(p.desktop, 'resources/installer.nsh'),
      installerIcon: icon,
      uninstallerIcon: icon,
      installerHeaderIcon: icon,
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
      shortcutName: 'ExamGuard',
      uninstallDisplayName: 'ExamGuard',
      runAfterFinish: false,
      deleteAppDataOnUninstall: false,
      differentialPackage: false,
      artifactName: 'ExamGuard-Setup-${version}.${ext}',
    },
  };
}
