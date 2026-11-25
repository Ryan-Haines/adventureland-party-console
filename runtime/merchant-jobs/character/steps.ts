// The step loop on the merchant: the runner's take of an
// `addon-steps` command. It runs the job's steps one at a time. Each action step goes to the
// dispatcher in the `job` band with the job as holder, and a walk step goes to movement at the job's
// tier. Between steps the add-on's `merchant.step` answer names the next steps, and the
// coordinator's checkpoint applies the interrupts and saves the steps run, so a paused job resumes
// at its next step. Nothing answering ends the job as done.
import type { ActionOutcome, MerchantStep, MerchantStepAnswer, MerchantStepView } from '../../hooks/registry.ts';
import { addonStepRefusal, stepRetry } from '../rules.ts';

export interface AddonStepsCommand {
  id: number; jobId: string; addon: string | null; kind: string; target: string;
  fields: Record<string, unknown>; steps: readonly MerchantStep[]; done: readonly ActionOutcome[]; spends: boolean;
  realm?: string;
}
export interface StepPorts {
  // The add-on's `merchant.step` answer (rows/08-merchant.ts `merchantJobs.step`).
  next(addon: string, view: MerchantStepView): MerchantStepAnswer;
  // The dispatcher with band `job` and the job as holder, or the movement owner's walk at the job's tier. Each
  // settles to the step's outcome.
  act(step: MerchantStep, holder: string): Promise<ActionOutcome>;
  // `retry.policy` with core's answer.
  retry(ask: { owner: string; subject: string; failure: string; attempt: number }, core: { wait: number; giveUp: boolean; counts: boolean }):
    { wait: number; giveUp: boolean; counts: boolean };
  // The call budget's window; a held step waits at least this long before it runs again.
  window(): number;
  wait(ms: number): Promise<void>;
  // The coordinator's checkpoint (routes.ts `checkpoint`): it saves the steps run and answers
  // whether the job yields to an interrupt.
  checkpoint(command: AddonStepsCommand, done: readonly ActionOutcome[]): Promise<{ yield: boolean }>;
  // Whether this command's job still holds the merchant (runner.ts `job()`).
  holds(command: AddonStepsCommand): boolean;
  complete(command: AddonStepsCommand, success: boolean, error?: string): Promise<void>;
}

// A step the kind's bounds refuse settles as `refused` without reaching the dispatcher.
const refused = (command: AddonStepsCommand, step: MerchantStep, reason: string, at: number): ActionOutcome =>
  ({ id: `${command.jobId}:${at}`, action: (step as { action?: ActionOutcome['action'] }).action ?? ('walk' as ActionOutcome['action']),
    character: command.target, addon: String(command.addon), outcome: 'refused', by: '08', reason });

export async function runAddonSteps(command: AddonStepsCommand, p: StepPorts): Promise<'done' | 'failed' | 'yielded' | 'released'> {
  const done: ActionOutcome[] = [...command.done], holder = 'job:' + command.jobId, view = () =>
    ({ job: { id: command.jobId, kind: command.kind, target: command.target, fields: command.fields }, done: [...done] });
  // A resumed job skips the first steps it ran. Past them, the add-on answers again from `done`.
  let steps: readonly MerchantStep[] = command.steps.slice(done.length);
  for (;;) {
    if (!steps.length) {
      const answer = command.addon ? p.next(command.addon, view()) : undefined;
      if (!answer) { await p.complete(command, true); return 'done'; }
      if ('end' in answer) { await p.complete(command, answer.end === 'done', answer.reason); return answer.end; }
      if (!answer.steps.length) { await p.complete(command, true); return 'done'; }
      steps = answer.steps;
    }
    const [step, ...rest] = steps;
    let attempt = 0;
    for (;;) {
      if (!p.holds(command)) return 'released';
      const bound = addonStepRefusal(step, { spends: command.spends });
      const outcome = bound ? refused(command, step, bound, done.length) : await p.act(step, holder);
      if (outcome.outcome === 'sent') { done.push(outcome); break; }
      attempt++;
      const failure = outcome.outcome === 'refused' ? `${outcome.by}: ${outcome.reason}` : outcome.error;
      const policy = p.retry({ owner: '08', subject: holder, failure, attempt }, stepRetry(outcome));
      if (policy.giveUp) { done.push(outcome); await p.complete(command, false, failure); return 'failed'; }
      await p.wait(Math.max(policy.wait, p.window()));
    }
    steps = rest;
    if ((await p.checkpoint(command, done)).yield) return 'yielded';
  }
}
