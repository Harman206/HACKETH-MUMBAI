import { expect, test } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..');
/** Everything a protocol team runs or ships from the SDK. */
const SDK_DIRS = ['packages/protocol-cli/src', 'packages/fingerprint/src', 'packages/build-plugins/src', 'packages/widget/src'];

const files = (d: string): string[] => {
  const abs = join(ROOT, d);
  try {
    statSync(abs);
  } catch {
    return [];
  }
  return readdirSync(abs, { recursive: true }).map(String).filter((f) => /\.(ts|js|mjs)$/.test(f)).map((f) => join(abs, f));
};

test('nothing in the SDK holds or asks for a private key, mnemonic or signer', () => {
  const banned = [/privateKeyToAccount/, /mnemonicToAccount/, /hdKeyToAccount/, /PRIVATE_KEY/, /DEPLOYER_KEY/, /OWNER_KEY/, /\bsignTransaction\b/, /\bsignTypedData\b/, /\bsignMessage\b/, /eth_sign/, /personal_sign/];
  const hits: string[] = [];
  for (const d of SDK_DIRS) for (const f of files(d)) {
    const src = readFileSync(f, 'utf8');
    for (const re of banned) if (re.test(src)) hits.push(`${f.slice(ROOT.length + 1)}: ${re}`);
  }
  expect(hits).toEqual([]);
  expect(files('packages/protocol-cli/src').length).toBeGreaterThan(5);
});

// drill.ts sends only to its own anvil fork (impersonation); scaffold.ts is the text of a generated fork test.
test('the only resolver writes the CLI builds are Safe batch calls (setText / grantSetterRoles via propose)', () => {
  const src = files('packages/protocol-cli/src').filter((f) => !/(drill|scaffold)\.ts$/.test(f)).map((f) => readFileSync(f, 'utf8')).join('\n');
  expect(src).not.toMatch(/writeContract|sendTransaction|eth_sendTransaction/);
});
