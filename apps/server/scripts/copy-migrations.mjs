// tsc does not copy .sql files, so the build copies them next to the compiled runner.
import { cpSync } from 'node:fs';

cpSync('src/db/migrations', 'dist/db/migrations', { recursive: true });
