import type { HeartbeatStatus } from '../status/response-types.ts';
import type { MerchantCommand } from './work.ts';

interface VisibilityState {
  merchantCharacter: string | null;
  merchantCurrent: { id: string; target: string | null } | null;
  commands: Record<string, MerchantCommand | undefined>;
  statuses: Record<string, HeartbeatStatus | undefined>;
}

function fresh(status: HeartbeatStatus | undefined, now: number): status is HeartbeatStatus {
  return !!status && !!status.seenAt && now - status.seenAt <= 5000 && !status.rip;
}

function nearby(recipient: HeartbeatStatus, visitor: HeartbeatStatus): boolean {
  if (!recipient.server || recipient.server !== visitor.server || !recipient.map || recipient.map !== visitor.map || recipient.in !== visitor.in) return false;
  return Math.hypot(Number(recipient.x) - Number(visitor.x), Number(recipient.y) - Number(visitor.y)) <= 180;
}

function participant(state: VisibilityState, name: string, command: MerchantCommand | undefined): boolean {
  if (!state.merchantCurrent || command?.jobId !== state.merchantCurrent.id) return false;
  if (state.merchantCurrent.target === name) return true;
  // Commerce visits collect materials from source characters before delivery.
  const order = command.order;
  if (!order || typeof order !== 'object' || !('sources' in order)) return false;
  return !!order.sources && typeof order.sources === 'object' && Object.hasOwn(order.sources, name);
}

/** A short heartbeat lease for any active merchant visit, independent of its reason. */
export function merchantVisibility(state: VisibilityState, name: string, now: number): string | null {
  const merchant = state.merchantCharacter;
  if (!merchant || merchant === name || !participant(state, name, state.commands[merchant])) return null;
  const recipient = state.statuses[name], visitor = state.statuses[merchant];
  if (!fresh(recipient, now) || !fresh(visitor, now)) return null;
  return nearby(recipient, visitor) ? merchant : null;
}
