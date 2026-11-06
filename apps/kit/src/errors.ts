/**
 * Raw wallet / RPC / ENS errors → one plain sentence and at most one fix the UI can offer as a button.
 * Unknown messages (including every Exit Guard reason, already plain) pass through unchanged.
 */
export type Fix = 'faucet' | 'retry' | 'open-wallet' | 'switch-chain' | 'install-wallet' | 'serve-localhost' | 'add-rpc' | 'check-name';

export interface Humanized {
  text: string;
  fix?: Fix;
}

const SEPOLIA = 11155111;

export function humanize(raw: string, env: { protocol?: string; chainId?: number } = {}): Humanized {
  if (/insufficient funds/i.test(raw)) {
    return env.chainId === SEPOLIA
      ? { text: "Your wallet doesn't have enough ETH to pay the network fee. Sepolia test ETH is free from a faucet.", fix: 'faucet' }
      : { text: "Your wallet doesn't have enough ETH to pay the network fee. Add a little ETH to this address, then try again." };
  }
  if (/already pending|-32002/i.test(raw)) {
    return { text: 'Your wallet already has a request waiting. Click the wallet’s toolbar icon and approve or reject it, then try again.', fix: 'open-wallet' };
  }
  if (/user rejected|user denied|you rejected|rejected the request/i.test(raw)) {
    return { text: 'You declined in your wallet, so nothing was sent. Nothing happened to your funds.', fix: 'retry' };
  }
  if (/^Switch your wallet to /.test(raw)) return { text: raw, fix: 'switch-chain' };
  if (/No browser wallet found/i.test(raw)) {
    return env.protocol === 'file:'
      ? { text: 'Browsers don’t let wallets into a page opened from disk. Serve this file on localhost (one command, below) or open the hosted copy.', fix: 'serve-localhost' }
      : { text: 'No browser wallet found. Install MetaMask or Rabby, then reload this page.', fix: 'install-wallet' };
  }
  const few = raw.match(/Only (\d+) of (\d+) RPC paths answered/);
  if (few) {
    return {
      text: `Only ${few[1]} of ${few[2]} RPC providers answered; the kit needs 2 that agree. Your network may be blocking them: add your own RPC endpoint, or try again.`,
      fix: 'add-rpc',
    };
  }
  if (/Not enough paths reported/i.test(raw)) {
    return { text: 'Not enough RPC providers answered; the kit needs 2 that agree. Add your own RPC endpoint, or try again.', fix: 'add-rpc' };
  }
  if (/disagree|too far apart/i.test(raw)) {
    return {
      text: 'The RPC providers gave different answers, so the kit stopped rather than guess. A provider may be lagging, or lying. Try again in a minute, or add an RPC you trust.',
      fix: 'add-rpc',
    };
  }
  if (/not a (valid|full) ENS name|not set up on ENS|has no release record|has no exit manifest record/i.test(raw)) {
    return { text: `${raw} Check the name against the protocol’s official docs.`, fix: 'check-name' };
  }
  return { text: raw };
}
