import { requestObject } from '../http/contracts.ts';
export function communicationReason(text: string): boolean {
  const reason = text.replace(/^(?:[A-Za-z0-9_]+: )?(?:Error: )*/, '');
  return reason === 'Shared route coordinator signal expired' ||
    /^POST \/(?:movement-barrier|movement-plan) · (?:network|timeout)(?:$|:)/.test(reason);
}
/** Migrate only captured failures of this exact convoy whose entire retry history is communication-only. */
export function capturedCommunicationFailure(c: {id: string; epoch?: unknown; phase: string; communicationLegacyRecovered?: boolean; failureDetails?: unknown; failure?: string; recoveryAttempts?: number}): boolean {
  if (c.phase !== 'failed' || c.communicationLegacyRecovered) return false;
  const context = requestObject(requestObject(c.failureDetails).failureContext);
  if (context.convoyId !== c.id || context.epoch !== c.epoch) return false;
  const reason = c.failure || '';
  const pair = /^Return route held after two planning cycles; first: (.+); latest: (.+)$/.exec(reason);
  if (pair) return communicationReason(pair[1]!) && communicationReason(pair[2]!);
  return !c.recoveryAttempts && communicationReason(reason);
}
