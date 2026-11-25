// Tank Hold (README.md here): each card's Farming settings line names a tank, an off tank and a
// puller, and switches Pull on or off, for the farming scope the character plays in. The tank holds
// the monsters, the off tank takes the tank's attackers while the tank is in danger, and in pull
// mode the party waits outside the pack while the puller brings one monster at a time. It answers
// only questions the console asks; every game call stays the console's.
import { type AddonContext, type AggroParty, type AnchorMember, type CandidatesView, type MoverView, type Registration, type ViewEntity } from '../../hooks/addon-api.ts';
import { aroundTank, holder, packRefusal, picksOf, preferred, pullCandidates, pullMove, role, type Picks, type Sight } from './tank.ts';

const NAME = 'tank-hold';
type FormationAsk = Parameters<NonNullable<Registration['hooks']['formation.routine']>>[0];

// The picks of the scope the call is for: the card line's scope store and the scope's danger share.
const picks = (ctx: AddonContext): Picks => picksOf(key => ctx.store.scope.get(key), ctx.settings);
// The coordinator's grouped queue asks targeting with no entities; the rules need them, so it gets
// no answer there.
const sighted = (view: CandidatesView): Sight | undefined =>
  Object.keys(view.entities).length ? { character: view.character as Sight['character'], entities: view.entities as Sight['entities'], party: view.party } : undefined;

export const registration: Registration = {
  name: NAME, folder: 'addons', author: 'Icelocked',
  summary: 'Names a tank that holds the monsters, an off tank that takes them while the tank is in danger, and a pull mode where the party waits outside the pack while one member brings one monster at a time.',
  settings: {
    dangerHp: { label: 'The tank is in danger below this share of its HP (%)', kind: 'number', min: 1, max: 99, default: 50, scope: 'scope' },
  },
  slots: [{ slot: 'formation', mode: 'around-tank', fills: 'choice',
    button: { label: 'Around the tank', description: 'Stand at the safest formation point nearest the tank Tank Hold names', color: 'emerald' } }],
  hooks: {
    'group.anchor'(members: readonly AnchorMember[], _settings, ctx) {
      const p = picks(ctx), ready = (who: string | null) => members.find(m => m.name === who && m.available !== false)?.name;
      return ready(p.tank) ?? ready(p.offTank);
    },
    'targeting.aggroOwner'(party: AggroParty, _settings, ctx) { return holder(picks(ctx), party.members); },
    'targeting.candidates'(view, _settings, ctx) {
      const v = view as CandidatesView<ViewEntity>, sight = sighted(v);
      return sight && pullCandidates(picks(ctx), sight, v.candidates);
    },
    'targeting.prefers'(view, _settings, ctx) {
      const v = view as CandidatesView<ViewEntity>, sight = sighted(v);
      return sight && preferred(picks(ctx), sight, v.candidates);
    },
    'step.safety'(view, to, _settings, ctx) { return packRefusal(picks(ctx), view as MoverView, to); },
    // `farming` (56): above the formation and the approach, below every task, the escape and the
    // death recovery, so survival always moves first.
    'movement.request': [{ name: 'pull', tier: 'farming', answer(view, _settings, ctx) {
      const { answer, line } = pullMove(picks(ctx), view as MoverView);
      // Each write raises the key's revision and rides the next report, so only a new line goes up.
      if (ctx.store.character.get('line') !== line) ctx.store.character.set('line', line);
      return answer;
    } }],
    'formation.routine'(formation: FormationAsk, _settings, ctx) { return aroundTank(picks(ctx), formation); },
    'status.report'(view, _settings, ctx) {
      const p = picks(ctx), me = (view as Partial<MoverView>).character?.name ?? ctx.character;
      if (!p.tank || !me) return undefined;
      return { role: role(p, me), line: String(ctx.store.character.get('line') ?? '') };
    },
    // The coordinator draws the character's own report under its card line.
    'status.line'({ character }, _settings, ctx) {
      const reports = ctx.read('status.lastReport', character)?.report.addonReports as Record<string, { line?: unknown }> | undefined;
      const line = reports?.[NAME]?.line;
      return typeof line === 'string' && line ? { label: line } : undefined;
    },
  },
};
