// Builds the Windows installers (M45-M46, M52): pnpm package [--app teacher|student] [--dir] [--skip-build]
//   --app         one app only (default: both, Teacher then Student)
//   --dir         stop at release/<app>/win-unpacked (no NSIS step), for a quick check of the packed app
//   --skip-build  reuse the existing builds of the shared packages (each app is still built)
// Steps per app: build it (`electron-vite --mode <app>`; the student build also compiles
// SiteReader.exe), copy the desktop app with its production dependencies into release/stage
// (`pnpm deploy`, hoisted, so electron-builder sees a plain node_modules), prune what the app does
// not use (FLAVORS.dropDependencies), then run electron-builder on that copy. The student app needs
// `pnpm fetch-toolchains` first.
/* global console, process */
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const desktop = join(repo, 'apps/desktop');
const release = join(repo, 'release');
const stage = join(release, 'stage');
const argv = process.argv.slice(2);
const args = new Set(argv);
const dirOnly = args.has('--dir');
const appArg = argv[argv.indexOf('--app') + 1];
const apps = args.has('--app') ? [appArg] : ['teacher', 'student'];
if (apps.some((a) => a !== 'teacher' && a !== 'student')) {
  throw new Error(`Unknown --app ${appArg}: use teacher or student.`);
}

function run(command) {
  console.log(`\n> ${command}`);
  const result = spawnSync(command, { cwd: repo, stdio: 'inherit', shell: true });
  if (result.status !== 0) throw new Error(`Failed (exit ${result.status}): ${command}`);
}

function sizeOf(path) {
  const stat = statSync(path);
  if (!stat.isDirectory()) return stat.size;
  let total = 0;
  for (const entry of readdirSync(path)) total += sizeOf(join(path, entry));
  return total;
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(0)} MB`;

const { builderConfig, keepClosure, FLAVORS } = await import(
  pathToFileURL(join(desktop, 'electron-builder.config.ts')).href
);

/** Deletes the stage's top-level packages that the app's dependency closure does not reach. */
function pruneStage(drop) {
  const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
  const depsOf = (dir) => {
    const pj = readJson(join(dir, 'package.json'));
    return Object.keys({ ...pj.dependencies, ...pj.optionalDependencies, ...pj.peerDependencies });
  };
  const resolveFrom = (fromDir, name) => {
    for (let dir = fromDir; ; dir = dirname(dir)) {
      const candidate = join(dir, 'node_modules', name);
      if (existsSync(join(candidate, 'package.json'))) return candidate;
      if (dir === stage || dirname(dir) === dir) return null;
    }
  };
  const roots = depsOf(stage).filter((name) => !drop.includes(name));
  const keep = keepClosure(stage, roots, depsOf, resolveFrom);
  const modules = join(stage, 'node_modules');
  let removed = 0;
  for (const entry of readdirSync(modules)) {
    if (entry.startsWith('.')) continue;
    const dirs = entry.startsWith('@')
      ? readdirSync(join(modules, entry)).map((n) => join(modules, entry, n))
      : [join(modules, entry)];
    for (const dir of dirs) {
      if (keep.has(dir)) continue;
      rmSync(dir, { recursive: true, force: true });
      removed += 1;
    }
  }
  // electron-builder checks every listed production dependency is installed, so the dropped ones
  // leave the stage's package.json too.
  const stagePkgFile = join(stage, 'package.json');
  const stagePkg = readJson(stagePkgFile);
  for (const name of drop) delete stagePkg.dependencies?.[name];
  writeFileSync(stagePkgFile, `${JSON.stringify(stagePkg, null, 2)}\n`);
  console.log(`Pruned ${removed} packages the app does not use (${drop.join(', ')} and theirs).`);
}

// electron-builder and Electron come from the desktop package's own dev dependencies.
const requireFromDesktop = createRequire(join(desktop, 'package.json'));
const { build, Platform, Arch } = requireFromDesktop('electron-builder');
const electronPkg = requireFromDesktop.resolve('electron/package.json');
const electronVersion = JSON.parse(readFileSync(electronPkg, 'utf8')).version;

if (!args.has('--skip-build')) run('pnpm turbo run build --filter=@examguard/desktop^...');

for (const app of apps) {
  console.log(`\n=== ExamGuard ${app} ===`);
  if (app === 'student') {
    const toolchains = join(desktop, 'resources/toolchains');
    const missing = ['mingw64', 'msys64', 'npm', 'python'].filter(
      (p) => !existsSync(join(toolchains, p)),
    );
    if (missing.length > 0) {
      throw new Error(
        `Toolchains missing (${missing.join(', ')}): run "pnpm fetch-toolchains" first.`,
      );
    }
  }
  run(`pnpm --filter @examguard/desktop build:${app}`);
  if (app === 'student' && !existsSync(join(desktop, 'resources/SiteReader.exe'))) {
    throw new Error('apps/desktop/resources/SiteReader.exe is missing after the build.');
  }

  rmSync(stage, { recursive: true, force: true });
  run(
    `pnpm --filter @examguard/desktop deploy --prod --legacy --ignore-scripts --config.node-linker=hoisted "${stage}"`,
  );
  pruneStage(FLAVORS[app].dropDependencies);

  // get-windows downloads its Windows binary in an install script, which the deploy skips; the
  // copy from the workspace install goes in when the stage has none (student app only).
  const binding = 'node_modules/get-windows/lib/binding/napi-9-win32-unknown-x64';
  if (app === 'student' && !existsSync(join(stage, binding))) {
    const installed = join(desktop, binding);
    if (!existsSync(installed)) throw new Error(`${installed} is missing: run pnpm install.`);
    cpSync(installed, join(stage, binding), { recursive: true });
  }

  const output = join(release, app);
  await build({
    projectDir: stage,
    targets: Platform.WINDOWS.createTarget(dirOnly ? 'dir' : 'nsis', Arch.x64),
    publish: 'never',
    config: builderConfig(
      {
        repo,
        desktop,
        output,
        electronVersion,
        electronDist: join(dirname(electronPkg), 'dist'),
      },
      app,
    ),
  });

  console.log(
    `\n${app}: installed size (win-unpacked) ${mb(sizeOf(join(output, 'win-unpacked')))}`,
  );
  if (!dirOnly) {
    for (const file of readdirSync(output).filter((f) => /^ExamGuard-.*-Setup-.*\.exe$/.test(f))) {
      console.log(`${app}: installer ${file} ${mb(statSync(join(output, file)).size)}`);
    }
  }
}
rmSync(stage, { recursive: true, force: true });
