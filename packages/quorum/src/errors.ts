export type QuorumErrorKind = 'TOO_FEW' | 'DISAGREE' | 'CHAIN_MISMATCH';

export class QuorumError extends Error {
  override name = 'QuorumError';
  readonly kind: QuorumErrorKind;
  constructor(kind: QuorumErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

/** All answering paths agree that the eth_call reverted. */
export class CallRevertedError extends Error {
  override name = 'CallRevertedError';
  readonly data?: string;
  constructor(message: string, data?: string) {
    super(message);
    this.data = data;
  }
}
