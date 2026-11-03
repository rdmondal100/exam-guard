// electron-builder settings for the one Windows installer (M45-M46). scripts/package-desktop.mjs
// packs a `pnpm deploy` copy of this app, so every outside path is passed in as an absolute path.
// Node runs this file with its built-in type stripping, so it uses type-only imports and no enums.
// Install type, agent service, firewall and uninstall steps: build/installer.nsh.
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

/** Files the app expects next to its resources (main/agent/agent-exe.ts, runner/toolchains.ts). */
export const PACKED_RESOURCES = {
  agent: 'eg-agent.exe',
  runner: 'eg-runner.exe',
  toolchains: 'toolchains',
} as const;

export function builderConfig(p: BuilderPaths): Configuration {
  return {
    appId: 'ai.examguard.desktop',
    productName: 'ExamGuard',
    // Electron names userData after productName: %APPDATA%\ExamGuard (data-model.md).
    extraMetadata: { productName: 'ExamGuard' },
    copyright: 'ExamGuard AI',
    electronVersion: p.electronVersion,
    electronDist: p.electronDist,
    // better-sqlite3 and node-pty ship N-API prebuilds that load in Electron as they are.
    npmRebuild: false,
    nodeGypRebuild: false,
    buildDependenciesFromSource: false,
    directories: { output: p.output, buildResources: join(p.desktop, 'build') },
    files: [
      'out/**/*',
      'package.json',
      '!**/*.map',
      '!**/*.pdb',
      '!**/node_modules/{node-pty,better-sqlite3}/{src,deps,third_party,scripts,typings,binding.gyp}',
      '!**/node_modules/{node-pty,better-sqlite3}/{src,deps,third_party,scripts,typings}/**',
      '!**/node_modules/**/prebuilds/{darwin,linux,linuxmusl,android,win32-arm64,win32-ia32}*',
      '!**/node_modules/**/prebuilds/{darwin,linux,linuxmusl,android,win32-arm64,win32-ia32}*/**',
    ],
    asar: true,
    // Native code: node-pty's conpty.dll and OpenConsole.exe are started from disk (architecture §4).
    asarUnpack: ['**/node_modules/node-pty/**', '**/node_modules/better-sqlite3/**'],
    extraResources: [
      { from: join(p.repo, 'target/release/eg-agent.exe'), to: PACKED_RESOURCES.agent },
      { from: join(p.repo, 'target/release/eg-runner.exe'), to: PACKED_RESOURCES.runner },
      {
        from: join(p.desktop, 'resources/toolchains'),
        to: PACKED_RESOURCES.toolchains,
        // MSYS2 is only there for pacman: its translations and manuals are not needed.
        filter: ['**/*', '!msys64/usr/share/{locale,man,doc,info,gtk-doc}/**', '!**/*.pdb'],
      },
    ],
    electronFuses: {
      // eg-runner runs student JavaScript with ELECTRON_RUN_AS_NODE (decisions.md, 2026-10-17).
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
      requestedExecutionLevel: 'asInvoker',
    },
    nsis: {
      oneClick: false,
      perMachine: true,
      allowElevation: true,
      allowToChangeInstallationDirectory: true,
      include: join(p.desktop, 'build/installer.nsh'),
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
