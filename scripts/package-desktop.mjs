// Builds the one Windows installer (M45-M46): pnpm package [--dir] [--skip-build]
//   --dir         stop at release/win-unpacked (no NSIS step), for a quick check of the packed app
//   --skip-build  reuse the existing JS build and SiteReader.exe
// Steps: build the JS packages (the desktop build also compiles SiteReader.exe), copy the desktop app with its
// production dependencies into release/stage (`pnpm deploy`, hoisted, so electron-builder sees a
// plain node_modules), then run electron-builder on that copy. Needs `pnpm fetch-toolchains` first.
/* global console, process */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const desktop = join(repo, 'apps/desktop');
const release = join(repo, 'release');
const stage = join(release, 'stage');
const args = new Set(process.argv.slice(2));
const dirOnly = args.has('--dir');

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

const toolchains = join(desktop, 'resources/toolchains');
const missing = ['mingw64', 'msys64', 'npm', 'python'].filter(
  (p) => !existsSync(join(toolchains, p)),
);
if (missing.length > 0) {
  throw new Error(`Toolchains missing (${missing.join(', ')}): run "pnpm fetch-toolchains" first.`);
}

if (!args.has('--skip-build')) {
  run('pnpm turbo run build --filter=@examguard/desktop...');
}
if (!existsSync(join(desktop, 'resources/SiteReader.exe'))) {
  throw new Error('apps/desktop/resources/SiteReader.exe is missing: run without --skip-build.');
}

rmSync(stage, { recursive: true, force: true });
run(
  `pnpm --filter @examguard/desktop deploy --prod --legacy --ignore-scripts --config.node-linker=hoisted "${stage}"`,
);

// get-windows downloads its Windows binary in an install script, which the deploy skips; the copy
// from the workspace install goes in when the stage has none.
const binding = 'node_modules/get-windows/lib/binding/napi-9-win32-unknown-x64';
if (!existsSync(join(stage, binding))) {
  const installed = join(desktop, binding);
  if (!existsSync(installed)) throw new Error(`${installed} is missing: run pnpm install.`);
  cpSync(installed, join(stage, binding), { recursive: true });
}

// electron-builder and Electron come from the desktop package's own dev dependencies.
const requireFromDesktop = createRequire(join(desktop, 'package.json'));
const { build, Platform, Arch } = requireFromDesktop('electron-builder');
const electronPkg = requireFromDesktop.resolve('electron/package.json');
const electronVersion = JSON.parse(readFileSync(electronPkg, 'utf8')).version;
const { builderConfig } = await import(
  pathToFileURL(join(desktop, 'electron-builder.config.ts')).href
);

await build({
  projectDir: stage,
  targets: Platform.WINDOWS.createTarget(dirOnly ? 'dir' : 'nsis', Arch.x64),
  publish: 'never',
  config: builderConfig({
    repo,
    desktop,
    output: release,
    electronVersion,
    electronDist: join(dirname(electronPkg), 'dist'),
  }),
});

const unpacked = join(release, 'win-unpacked');
console.log(`\nInstalled size (win-unpacked): ${mb(sizeOf(unpacked))}`);
if (!dirOnly) {
  for (const file of readdirSync(release).filter((f) => /^ExamGuard-Setup-.*\.exe$/.test(f))) {
    console.log(`Installer ${file}: ${mb(statSync(join(release, file)).size)}`);
  }
}
