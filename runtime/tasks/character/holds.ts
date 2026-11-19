// The character's own hold:
// Manual for a character the player plays
// in a game client, Pause for a headless one, and Follows me, where the party follows the
// character on Manual. The heartbeat reply carries the group's hold (`handControl`) and the
// Follows me anchor (`followMe`); characters/shared.js stores both and installs this module with
// `installCharacterHolds`.

import { currentQueue } from '../../protocol/reports.ts';

interface Point { map: string; x: number; y: number }
// `user` is the console Pause, which the heartbeat's hold field carries to every character.
export interface HandHold { by: 'manual' | 'pause' | 'user'; usePotions?: boolean; combat?: boolean }
export interface CharacterHoldPorts {
  name(): string;
  // The party's own escape walks a character on Manual too: Escape is the player's command. It asks
  // `survival.escaping`.
  escaping(): boolean;
  // The reply's Follows me anchor: the character on Manual the party follows, and where it stands.
  followMe(): { name: string; location: Point } | null;
  partyLocation(): Point | null;
  // The rest of the follow rule, read at the call: a navigation the player cancelled, a live
  // combat event, a left-out member, a live event return, grouped farming and its group record,
  // the group walk's follower answer, the console's leader and Follow, and on a live A/B testing
  // map whether the leader is on this character's team.
  cancelled(): boolean;
  combatEvent(): boolean;
  apart(): boolean;
  eventReturn(): boolean;
  groupedFarming(): boolean;
  groupedCombat(): { protocol?: number } | null;
  walkFollower(): boolean;
  leader(): string | null;
  followLeader(): boolean;
  abtesting(): boolean;
  // The party's reported positions and this character's event team, for the A/B testing map.
  partyPositions(): readonly { name?: string; team?: unknown }[];
  team(): unknown;
}

export function installCharacterHolds(ports: CharacterHoldPorts) {
  // The reply's hold field for this character, which table P reads from the next row on.
  let hand: { by?: string } | null = null;
  function handControl(): HandHold | null {
    return hand && (hand.by === 'manual' || hand.by === 'pause' || hand.by === 'user') ? hand as HandHold : null;
  }
  // The console Pause (`user`) and Pause on this headless character (`pause`) hold every console act
  // through the lifecycle owner's run scope, which reads this hold field.
  // A pause means pause all code.
  // On Manual the console never moves the character; only its own escape, the player's command,
  // walks it.
  function manualHolds() { return handControl()?.by === 'manual' && !ports.escaping(); }
  // Another character on Manual leads the party (Follows me).
  function followsManual() { const f = ports.followMe(); return !!f && f.name !== ports.name(); }
  // Under Follows me the party fights what is around the character on Manual, so new pulls come
  // from around it, not from the saved farm area it led the party away from.
  function targetScope() { return ports.followMe()?.location ?? ports.partyLocation(); }
  // Whether this character follows its leader now. Follows me is the player's own walk, so a
  // navigation the player cancelled, such as a party Town, does not stop it.
  function shouldFollowLeader() {
    const f = ports.followMe();
    if (f) return f.name !== ports.name();
    if (ports.cancelled() && !ports.combatEvent()) return false;
    if (ports.apart()) return false;
    if (ports.eventReturn() && !ports.combatEvent()) return false;
    // Under grouped farming on the current queue protocol the group walk's follower answer decides.
    if (ports.groupedFarming() && currentQueue(ports.groupedCombat())) return !!ports.walkFollower();
    const leader = ports.leader();
    if (!(ports.followLeader() && leader && leader !== ports.name())) return false;
    if (!ports.abtesting()) return true;
    const status = ports.partyPositions().find(member => member && member.name === leader);
    return !!status && status.team === ports.team();
  }
  return { handControl, manualHolds, followsManual, targetScope, shouldFollowLeader,
    /** Table A's `hand` row. */
    handReply: (state: { handControl?: { by?: string } | null }) => { hand = state.handControl || null; },
    /** Who holds the character, as the reply named it (the lifecycle owner's table P). */
    handBy: () => hand?.by };
}

Object.assign(globalThis, { installCharacterHolds });
// The holds door targeting's ports read.
export type CharacterHolds = ReturnType<typeof installCharacterHolds>;
