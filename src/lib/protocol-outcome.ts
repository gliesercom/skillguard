// 浏览器与 CLI 共享的 GenLayer 协议交易生命周期与共识结果判定函数

export interface ProtocolTransactionLike {
  status?: number | string;
  statusName?: string;
  resultName?: string;
  result?: number | string | bigint | null;
  txExecutionResult?: number | string;
  txExecutionResultName?: string;
  lifecycle?: {
    state?: string;
    outcome?: string;
  };
  data?: {
    contract_address?: string;
  };
}

export function isFinalized(transaction?: ProtocolTransactionLike | null): boolean {
  return (
    transaction?.statusName === 'FINALIZED' ||
    transaction?.lifecycle?.state === 'finalized' ||
    transaction?.status === 7 ||
    transaction?.status === '7'
  );
}

export function consensusAccepted(transaction?: ProtocolTransactionLike | null): boolean {
  if (transaction?.lifecycle?.outcome !== 'accepted') return false;
  const hasName = typeof transaction.resultName === 'string';
  const hasNumber = transaction.result !== undefined && transaction.result !== null;
  if (hasName && transaction.resultName !== 'MAJORITY_AGREE') return false;
  if (hasNumber && transaction.result !== 1 && transaction.result !== '1' && transaction.result !== 1n) {
    return false;
  }
  return hasName || hasNumber;
}

export function executionSucceeded(transaction?: ProtocolTransactionLike | null): boolean {
  return (
    isFinalized(transaction) &&
    consensusAccepted(transaction) &&
    (transaction?.txExecutionResultName === 'FINISHED_WITH_RETURN' ||
      transaction?.txExecutionResult === 1)
  );
}

export function executionReverted(transaction?: ProtocolTransactionLike | null): boolean {
  return (
    isFinalized(transaction) &&
    consensusAccepted(transaction) &&
    (transaction?.txExecutionResultName === 'FINISHED_WITH_ERROR' ||
      transaction?.txExecutionResult === 2)
  );
}

export function finalizedUndetermined(transaction?: ProtocolTransactionLike | null): boolean {
  if (transaction?.statusName !== 'FINALIZED' || transaction.lifecycle?.outcome !== 'undetermined') {
    return false;
  }
  const hasName = typeof transaction.resultName === 'string';
  const hasNumber = transaction.result !== undefined && transaction.result !== null;
  const byName =
    transaction.resultName === 'NO_MAJORITY'
      ? 5
      : transaction.resultName === 'MAJORITY_DISAGREE'
      ? 2
      : null;
  const byNumber = [5, '5', 5n].includes(transaction.result as number)
    ? 5
    : [2, '2', 2n].includes(transaction.result as number)
    ? 2
    : null;
  if ((hasName && byName === null) || (hasNumber && byNumber === null)) return false;
  return (hasName || hasNumber) && (!hasName || !hasNumber || byName === byNumber);
}
