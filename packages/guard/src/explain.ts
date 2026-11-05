import type { GuardResult } from './guard';

const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : 'an unknown address');

/** Plain-language sentences for the kit UI and the "Check a transaction" page. */
export function explain(r: GuardResult): string[] {
  if (r.ok) return ['This is a safe exit: it only withdraws to your own account and asks for no approvals.'];
  const out: string[] = [];
  for (const x of r.reasons) {
    switch (x.code) {
      case 'BANNED': {
        const name = x.detail.replace(/ is never part of an exit$/, '');
        out.push(
          /approve|permit|setApprovalForAll|increaseAllowance/i.test(name)
            ? `This asks you to approve (${name}) ${short(x.subject)} to spend your tokens. Exits never need approvals.`
            : `This would move your tokens to ${short(x.subject)} (${name}). Exits never transfer tokens away.`,
        );
        break;
      }
      case 'RECIPIENT':
        out.push(`This sends your funds to ${short(x.subject)}, which is not your connected account.`);
        break;
      case 'CALLER':
        out.push(`This pool pays whoever sends the transaction, and the sender ${short(x.subject)} is not you.`);
        break;
      case 'TARGET':
        out.push(`The contract ${short(x.subject)} is not one of this protocol's published exit contracts.`);
        break;
      case 'SELECTOR':
        out.push(`It calls a function that is not a published exit: ${x.detail}.`);
        break;
      case 'CHAIN':
        out.push(`Wrong network: ${x.detail}.`);
        break;
      case 'VALUE':
        out.push('It sends ETH. Exits never send ETH.');
        break;
      case 'DECODE':
        out.push(`This transaction could not be decoded, so it is blocked (${x.detail}).`);
        break;
    }
  }
  return [...new Set(out)];
}
