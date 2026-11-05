export type QuorumErrorKind = 'TOO_FEW' | 'DISAGREE' | 'CHAIN_MISMATCH';

export class QuorumError extends Error {
  override name = 'QuorumError';
  constructor(
    public readonly kind: QuorumErrorKind,
    message: string,
  ) {
    super(message);
  }
}

/** All answering paths agree that the eth_call reverted. */
export class CallRevertedError extends Error {
  override name = 'CallRevertedError';
  constructor(
    message: string,
    public readonly data?: string,
  ) {
    super(message);
  }
}
