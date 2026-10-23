#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { USAGE, parseArgs, type SimOptions } from './args.js';
import { numberedCodes, parseStudentCodes } from './csv.js';
import { runSim } from './run-sim.js';

function main(): void {
  if (process.argv.includes('--help')) {
    console.log(USAGE);
    return;
  }
  let options: SimOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`${e instanceof Error ? e.message : String(e)}\n\n${USAGE}`);
    process.exitCode = 2;
    return;
  }
  const all = options.csv
    ? parseStudentCodes(readFileSync(options.csv, 'utf8'))
    : numberedCodes(options.students);
  const codes = all.slice(0, options.students);
  if (codes.length === 0) {
    console.error('No student IDs found');
    process.exitCode = 2;
    return;
  }
  console.log(`Starting ${codes.length} students against ${options.host}:${options.port}`);
  const run = runSim(options, codes);
  const report = () => {
    const c = run.counts();
    const s = run.saves();
    const saves = options.autosaveMs
      ? ` · saves sent ${s.sent} acked ${s.acked} waiting ${s.pending}`
      : '';
    const u = run.submits();
    const submits =
      options.submitAfterMs || options.disconnectEveryMs || u.receipts > 0
        ? ` · receipts ${u.receipts} (own ${u.selfSubmitted}, auto ${u.receipts - u.selfSubmitted}) · drops ${u.disconnects} · bad receipts ${u.problems.length}`
        : '';
    console.log(
      `connected ${c.connected}/${c.total} · joining ${c.joining} · reconnecting ${c.connecting} · failed ${c.failed}${saves}${submits}`,
    );
  };
  const timer = setInterval(report, 5000);
  void run.settled().then(() => {
    report();
    for (const [code, why] of [...run.failures()].slice(0, 5)) console.log(`  ${code}: ${why}`);
    for (const { code, problem } of run.submits().problems.slice(0, 5)) {
      console.log(`  ${code}: ${problem}`);
    }
  });
  const quit = () => {
    clearInterval(timer);
    report();
    for (const { code, problem } of run.submits().problems.slice(0, 5)) {
      console.log(`  ${code}: ${problem}`);
    }
    run.stop();
    console.log('Stopped.');
    process.exit(0);
  };
  process.on('SIGINT', quit);
  process.on('SIGTERM', quit);
}

main();
