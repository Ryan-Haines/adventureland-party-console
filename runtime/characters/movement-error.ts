export function movementError(value: unknown): Error & {partyRequest?: unknown} {
  if (value instanceof Error) return value;
  const object = value && typeof value === 'object' ? value as {message?: unknown; reason?: unknown; partyRequest?: unknown} : {};
  const message = [object.message, object.reason, value].find(item => typeof item === 'string' && item.length);
  return Object.assign(new Error(typeof message === 'string' ? message : 'Movement cancelled'),
    object.partyRequest ? {partyRequest: object.partyRequest} : {});
}
export function retryableMovementRequest(value: unknown): boolean {
  const r = movementError(value).partyRequest as {kind?: string; status?: number} | undefined;
  return !!r && (r.kind === 'network' || r.kind === 'timeout' || r.status === 408 || r.status === 429 || Number(r.status) >= 500);
}

export function movementFailureCause(failure: unknown, cause?: Record<string, unknown>): Record<string, unknown> | undefined {
  const request = movementError(failure).partyRequest;
  if (!request) return cause;
  return {...cause, partyRequest: request, ...(retryableMovementRequest(failure) ? {code: 'convoy-communication-hold'} : {})};
}
