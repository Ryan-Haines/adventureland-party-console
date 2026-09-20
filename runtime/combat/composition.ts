import type { Member } from './grouped.ts';

function available(member: Member, now: number): boolean {
  const s = member.status;
  if (!s || member.cancelled || s.rip || s.hp <= 0) return false;
  if (s.activeEvent || s.joinedEvent || s.mapEvent) return false;
  return now - s.seenAt <= 3000 && now >= s.seenAt - 500 && Number(s.range) > 0;
}
export function healingAnchor(members: Member[], now: number, previous?: string | null): Member | undefined {
  return members.filter(m => m.ctype === 'priest' && available(m, now))
    .sort((a, b) => Number(b.name === previous) - Number(a.name === previous) || a.name.localeCompare(b.name))[0];
}
