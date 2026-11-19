// electron-builder settings for the two Windows installers (M52: Teacher and Student, one codebase).
// scripts/package-desktop.mjs packs a `pnpm deploy` copy of this app per flavour, so every outside
// path is passed in as an absolute path. Node runs this file with its built-in type stripping, so
// it uses type-only imports and no enums. Firewall and uninstall steps: resources/{teacher,student}.nsh.
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { AfterPackContext, Configuration } from 'electron-builder';

export type AppFlavor = 'teacher' | 'student';

export interface BuilderPaths {
  repo: string;
  desktop: string;
  output: string;
  electronVersion: string;
  electronDist: string;
}

/** Files the student app expects next to its resources (main/utils/paths.ts, runner/toolchains.ts). */
export const PACKED_RESOURCES = {
  siteReader: 'SiteReader.exe',
  toolchains: 'toolchains',
} as const;

interface FlavorSpec {
  appId: string;
  /** Names %APPDATA%\<productName> (userData). The teacher keeps the pre-M52 "ExamGuard". */
  productName: string;
  /** Shortcut, uninstall entry and window title. */
  displayName: string;
  executableName: string;
  /** Dependencies of apps/desktop this app does not ship (pruned with what only they use). */
  dropDependencies: readonly string[];
  /** Native modules that must live outside the asar. */
  asarUnpack: readonly string[];
  /** Student JavaScript runs on the app's own Electron as Node; the teacher never needs it. */
  runAsNode: boolean;
}

/** What makes each app different (M52). Everything else is shared. */
export const FLAVORS: Record<AppFlavor, FlavorSpec> = {
  teacher: {
    appId: 'ai.examguard.teacher',
    productName: 'ExamGuard',
    displayName: 'ExamGuard Teacher',
    executableName: 'ExamGuardTeacher',
    dropDependencies: ['node-pty', 'get-windows'],
    asarUnpack: ['**/node_modules/better-sqlite3/**'],
    runAsNode: false,
  },
  student: {
    appId: 'ai.examguard.student',
    productName: 'ExamGuard Student',
    displayName: 'ExamGuard Student',
    executableName: 'ExamGuardStudent',
    dropDependencies: ['@examguard/server'],
    // node-pty's conpty.dll and OpenConsole.exe are started from disk (architecture §4), and
    // get-windows' binary is found by path (node-pre-gyp).
    asarUnpack: ['**/node_modules/node-pty/**', '**/node_modules/get-windows/**'],
    runAsNode: true,
  },
};

/**
 * The package folders an app needs: the closure of `roots` over each package's dependencies,
 * resolved Node-style (a nested node_modules first, then the parents'). Used to prune the
 * `pnpm deploy` copy so the student app carries no server and the teacher app no node-pty.
 */
export function keepClosure(
  rootDir: string,
  roots: readonly string[],
  depsOf: (packageDir: string) => string[],
  resolveFrom: (fromDir: string, name: string) => string | null,
): Set<string> {
  const keep = new Set<string>();
  const queue: { from: string; name: string }[] = roots.map((name) => ({ from: rootDir, name }));
  while (queue.length > 0) {
    const next = queue.pop();
    if (!next) break;
    const dir = resolveFrom(next.from, next.name);
    if (!dir || keep.has(dir)) continue;
    keep.add(dir);
    for (const dep of depsOf(dir)) queue.push({ from: dir, name: dep });
  }
  return keep;
}

export function builderConfig(p: BuilderPaths, flavor: AppFlavor): Configuration {
  const spec = FLAVORS[flavor];
  const student = flavor === 'student';
  // Drawn by scripts/make-icon.mjs: the exe, the window, the shortcuts and the installer.
  const icon = join(p.desktop, 'resources/icon.ico');
  return {
    appId: spec.appId,
    productName: spec.productName,
    // Electron names userData after productName: %APPDATA%\<productName> (data-model.md).
    extraMetadata: { productName: spec.productName },
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
    asarUnpack: [...spec.asarUnpack],
    extraResources: student
      ? [
          // Reads the address bar of Chrome and Edge (main/tracking/site.ts); built by
          // scripts/build-site-reader.mjs with the C# compiler that ships with Windows.
          { from: join(p.desktop, 'resources/SiteReader.exe'), to: PACKED_RESOURCES.siteReader },
          {
            from: join(p.desktop, 'resources/toolchains'),
            to: PACKED_RESOURCES.toolchains,
            // MSYS2 is only there for pacman: its translations, manuals, time zones and bash
            // completions are not needed (the exam terminal is PowerShell; M55).
            filter: [
              '**/*',
              '!msys64/usr/share/{locale,man,doc,info,gtk-doc,zoneinfo,bash-completion}/**',
              '!**/*.pdb',
            ],
          },
        ]
      : [],
    electronFuses: {
      runAsNode: spec.runAsNode,
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
      executableName: spec.executableName,
      icon,
      requestedExecutionLevel: 'asInvoker',
    },
    nsis: {
      oneClick: false,
      perMachine: true,
      allowElevation: true,
      allowToChangeInstallationDirectory: true,
      include: join(p.desktop, `resources/${flavor}.nsh`),
      installerIcon: icon,
      uninstallerIcon: icon,
      installerHeaderIcon: icon,
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
      shortcutName: spec.displayName,
      uninstallDisplayName: spec.displayName,
      runAfterFinish: false,
      deleteAppDataOnUninstall: false,
      differentialPackage: false,
      artifactName: `ExamGuard-${student ? 'Student' : 'Teacher'}-Setup-\${version}.\${ext}`,
    },
  };
}
