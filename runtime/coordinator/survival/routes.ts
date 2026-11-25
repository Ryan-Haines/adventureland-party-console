// The party escape's Escape and Resume presses and its state read.
// Each press names the button state it saw, and the tasks owner's
// holds refuse one that no longer matches, and Resume inside the lockout, with the reason.
// A press inside the Cave asks the Cave's exit or release first (the hunting owner's).
import { requestObject, type HttpRequest, type HttpResponse } from '../../lifecycle/api.ts';

export interface SurvivalRoutePorts {
  members(): string[];
  escape(names: string[], by: string): unknown;
  release(): void;
  // The tasks owner's holds (holds.ts): the button state, the lockout end when Resume unlocks, and the two presses.
  escapeButton(): string | null;
  escapeResumeAt(): number | null;
  pressEscape(shown: unknown): string | null;
  pressResume(shown: unknown): string | null;
  // The Cave's exit, which answers the press itself, and its release, which answers a refusal.
  exitDungeon(res: HttpResponse): boolean | undefined;
  releaseDungeon(res: HttpResponse): boolean;
}
export function createSurvivalRoutes(state: { escape: unknown }, ports: SurvivalRoutePorts) {
  function escapeState(_req: HttpRequest, res: HttpResponse): unknown {
    return res.json({ escape: state.escape, button: ports.escapeButton(), resumeAt: ports.escapeResumeAt() });
  }
  function escape(req: HttpRequest, res: HttpResponse): unknown {
    const refused = ports.pressEscape(requestObject(req.body).shown);
    if (refused) return res.status(409).json({ error: refused, escape: state.escape, button: ports.escapeButton() });
    if (ports.exitDungeon(res)) return;
    return res.json({ escape: ports.escape(ports.members(), 'player'), button: ports.escapeButton(), resumeAt: ports.escapeResumeAt() });
  }
  function resume(req: HttpRequest, res: HttpResponse): unknown {
    const refused = ports.pressResume(requestObject(req.body).shown);
    if (refused) return res.status(409).json({ error: refused, escape: state.escape, button: ports.escapeButton() });
    if (!ports.releaseDungeon(res)) return;
    ports.release();
    return res.json({ escape: state.escape, button: ports.escapeButton(), resumeAt: null });
  }
  return { escapeState, escape, resume };
}
