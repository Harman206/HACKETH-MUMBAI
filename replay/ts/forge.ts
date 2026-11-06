import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

const REPLAY = join(__dirname, '..');

/** Runs the Foundry replay for one scenario and pulls the labelled numbers out of its logs. */
export function runForgeReplay(id: string, archiveRpc: string): { lossWithout: bigint; lossWith: bigint; logs: string[] } {
  const out = execFileSync(`${homedir()}/.foundry/bin/forge`, ['test', '--match-contract', `${id}Test`, '--json', '-vv'], {
    cwd: REPLAY,
    env: { ...process.env, ARCHIVE_RPC: archiveRpc },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const json = JSON.parse(out) as Record<string, { test_results: Record<string, { status: string; decoded_logs: string[] }> }>;
  const logs: string[] = [];
  for (const suite of Object.values(json)) {
    for (const [name, r] of Object.entries(suite.test_results)) {
      if (r.status !== 'Success') throw new Error(`forge ${name} failed`);
      logs.push(...r.decoded_logs);
    }
  }
  const num = (re: RegExp) => {
    const line = logs.find((l) => re.test(l));
    if (!line) throw new Error(`no log matching ${re}`);
    return BigInt(line.trim().split(/\s+/).pop()!);
  };
  return { lossWithout: num(/as it happened: victim lost/), lossWith: num(/\[counterfactual\] victim lost/), logs };
}
