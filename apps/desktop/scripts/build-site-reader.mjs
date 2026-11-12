// Compiles resources/SiteReader.cs with the C# compiler that ships with Windows (.NET Framework 4),
// so no toolchain is needed. Skipped when the .exe is up to date. tracking/site.ts runs it.
/* global console, process */
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const resources = join(import.meta.dirname, '..', 'resources');
const source = join(resources, 'SiteReader.cs');
const output = join(resources, 'SiteReader.exe');

if (process.platform !== 'win32') {
  console.log('SiteReader is Windows only, skipping');
  process.exit(0);
}
if (existsSync(output) && statSync(output).mtimeMs >= statSync(source).mtimeMs) process.exit(0);

const dotnet = join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET');
const references = ['UIAutomationClient', 'UIAutomationTypes', 'WindowsBase'].map(
  (name) =>
    `/r:${join(dotnet, 'assembly', 'GAC_MSIL', name, 'v4.0_4.0.0.0__31bf3856ad364e35', `${name}.dll`)}`,
);

try {
  execFileSync(
    join(dotnet, 'Framework64', 'v4.0.30319', 'csc.exe'),
    ['/nologo', '/optimize', '/target:exe', `/out:${output}`, ...references, source],
    { encoding: 'utf8' },
  );
  console.log('Built resources/SiteReader.exe');
} catch (error) {
  console.error('Could not build SiteReader:', error.stdout || error.message);
  process.exit(1);
}
