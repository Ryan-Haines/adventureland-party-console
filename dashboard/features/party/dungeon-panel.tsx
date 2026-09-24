'use client';
import { useState } from 'react';
import { useClock } from '@/hooks/use-clock';
import { dungeonCountdown, useDungeons } from './dungeon-query';
import { dungeonButton } from './dungeon-settings';

export function DungeonPanel() {
  const query = useDungeons(),
    now = useClock(),
    view = query.data;
  const [vote, setVote] = useState<{
    choice: string;
    option: string;
    cost: number;
    amber: number;
  } | null>(null);
  const [purchase, setPurchase] = useState<string | null>(null);
  if (!view || ['idle', 'held'].includes(view.state.phase)) return null;
  const cave = view.members.find((m) => m.fresh && m.observation?.cave)
      ?.observation?.cave,
    choice = cave?.choice;
  const action = (body: Record<string, unknown>) =>
    query.action({ run: cave?.run, ...body });
  return (
    <section
      aria-label="Cave of Many Dreams controls"
      className="rounded border border-slate-500 bg-[#101c1a] p-3 text-emerald-50 lg:col-span-2 xl:col-span-4"
    >
      {view.state.error && (
        <button
          className={dungeonButton}
          disabled={query.busy}
          onClick={() => void action({ action: 'retry' })}
        >
          Retry failed preparation
        </button>
      )}
      {view.members.some(
        (m) => m.fresh && !m.observation?.cave && m.observation?.visit?.resume,
      ) && (
        <button
          className={dungeonButton}
          disabled={query.busy}
          onClick={() => void action({ action: 'recover' })}
        >
          Return missing participants
        </button>
      )}
      <h2 className="font-semibold">Cave of Many Dreams</h2>
      <p>
        {cave
          ? `Floor ${cave.floor + 1} · ${dungeonCountdown(cave.paused ? now + cave.remainingMs : cave.expires, now)} remaining${cave.paused ? ' (paused)' : ''} · ${cave.gold} gold · ${cave.amber} Amber`
          : view.state.phase}
      </p>
      <p className="text-sm text-slate-300">
        {view.members
          .map((m) => m.name + (m.fresh ? '' : ' — awaiting connection'))
          .join(' · ')}
      </p>
      {view.members.some((m) => m.observation?.alive === false) && (
        <button
          className={dungeonButton}
          disabled={
            query.busy ||
            view.state.phase !== 'active' ||
            (!!choice && !choice.resolved)
          }
          onClick={() => void action({ action: 'revival' })}
        >
          Call Nera — revival choices
        </button>
      )}
      <div className="mt-3 grid grid-cols-2 gap-2">
        {cave?.points.map((p) => (
          <button
            className={dungeonButton}
            key={p.id}
            disabled={
              query.busy ||
              cave.paused ||
              p.locked ||
              p.done ||
              view.state.phase !== 'active'
            }
            onClick={() => void action({ action: 'move', target: p.id })}
          >
            {p.label}
            {p.locked ? ' — locked' : p.done ? ' — complete' : ''}
          </button>
        ))}
      </div>
      {choice && (
        <div className="mt-3">
          <h3>{choice.title}</h3>
          <p>{choice.text}</p>
          {!choice.resolved && (
            <p>Vote closes in {dungeonCountdown(choice.deadline, now)}</p>
          )}
          <div className="grid grid-cols-2 gap-2">
            {choice.options.map((o) => (
              <button
                className={dungeonButton}
                key={o.id}
                disabled={
                  query.busy ||
                  choice.resolved ||
                  now >= choice.deadline ||
                  !!o.unavailable
                }
                onClick={() => {
                  if (o.cost || o.amber)
                    setVote({
                      choice: choice.id,
                      option: o.id,
                      cost: o.cost || 0,
                      amber: o.amber || 0,
                    });
                  else
                    void action({
                      action: 'vote',
                      choice: choice.id,
                      option: o.id,
                    });
                }}
              >
                {o.label}
                {o.cost ? ` — ${o.cost} shared gold` : ''}
                {o.amber ? ` — ${o.amber} Amber` : ''}
                {o.unavailable ? ` — ${o.unavailable}` : ''}
                <span className="block text-xs">
                  {Object.entries(choice.votes)
                    .filter(([, id]) => id === o.id)
                    .map(([name]) => name)
                    .join(', ')}
                </span>
              </button>
            ))}
          </div>
          {vote?.choice === choice.id && !choice.resolved && (
            <div role="group" aria-label="Confirm paid dungeon choice">
              <p>
                Spend {vote.cost} shared gold and {vote.amber} Amber if this
                choice wins?
              </p>
              <button
                className={dungeonButton}
                disabled={query.busy}
                onClick={() => {
                  void action({
                    action: 'vote',
                    choice: vote.choice,
                    option: vote.option,
                    cost: vote.cost,
                    amber: vote.amber,
                    confirmed: true,
                  });
                  setVote(null);
                }}
              >
                Confirm vote
              </button>
              <button className={dungeonButton} onClick={() => setVote(null)}>
                Cancel
              </button>
            </div>
          )}
          {choice.shop && (
            <div className="mt-2">
              <p>
                {choice.shop.name} — {choice.shop.price} shared gold
                {choice.shop.sold ? ' — sold' : ''}
              </p>
              <button
                className={dungeonButton}
                disabled={
                  query.busy ||
                  choice.shop.sold ||
                  !choice.resolved ||
                  !choice.shop.nearby ||
                  cave!.gold < choice.shop.price
                }
                onClick={() => setPurchase(choice.id)}
              >
                Buy…
              </button>
              {purchase === choice.id && (
                <div role="group" aria-label="Confirm dungeon purchase">
                  <p>
                    Spend {choice.shop.price} shared gold on {choice.shop.name}?
                  </p>
                  <button
                    className={dungeonButton}
                    onClick={() => {
                      setPurchase(null);
                      void action({
                        action: 'buy',
                        choice: choice.id,
                        cost: choice.shop!.price,
                        confirmed: true,
                      });
                    }}
                  >
                    Confirm purchase
                  </button>
                  <button
                    className={dungeonButton}
                    onClick={() => setPurchase(null)}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {(query.actionError || view.state.error) && (
        <p role="alert" className="text-rose-200">
          {query.actionError || view.state.error}
        </p>
      )}
    </section>
  );
}
