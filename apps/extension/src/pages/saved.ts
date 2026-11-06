/** The one-line reason on the "Saved by Copey!" screen, from what the user just refused. Pure (unit-tested). */
import type { Classification } from '@copeybara/guard';

export const CONNECT = new Set(['eth_requestAccounts', 'wallet_requestPermissions']);

export function savedReason(c: Pick<Classification, 'verdict' | 'method' | 'reasons'>): string {
  const r = c.reasons.join(' ');
  if (CONNECT.has(c.method)) {
    const who = /imitates (\S+)/.exec(r)?.[1];
    return who ? `You didn’t connect your wallet to a fake ${who} site.` : 'You didn’t connect your wallet to a look-alike site.';
  }
  if (/Permit2/.test(r)) return 'You refused a Permit2 signature that would let a drainer spend your tokens.';
  if (/ALL of this token/.test(r)) return c.method === 'eth_sendTransaction' || c.method === 'wallet_sendCalls'
    ? 'You stopped a drainer from taking ALL of this token from your wallet.'
    : 'You refused a signature that would let a drainer take ALL of this token.';
  if (/spend your tokens|spend part/.test(r)) return 'You stopped a drainer from spending your tokens.';
  if (/sends your tokens/.test(r)) return 'You stopped your tokens from being sent to an unknown address.';
  if (c.method === 'eth_sign' || /32-byte hash/.test(r)) return 'You refused a blind signature that could authorize almost anything.';
  if (c.verdict === 'dangerous') return 'You stopped a request that could have emptied your wallet.';
  return 'You cancelled a risky request before your wallet ever saw it.';
}

/** The warning page's line: a page Copeybara blocked before it could ask for anything. */
export function blockedReason(reason: string | null, name: string): string {
  if (reason === 'blocklist') return `Copey kept you off a known fake ${name} site.`;
  if (reason === 'compromised') return `Copey kept you off ${name}’s compromised website.`;
  return `Copey pulled you off a hijacked ${name} page before it could touch your wallet.`;
}
