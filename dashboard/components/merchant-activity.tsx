'use client';
import { Component, createRef } from 'react';

type Entry = { at: number; message: string; level: string; details?: unknown };
type Snapshot = { key: string; offset: number; top: number } | null;

export class MerchantActivityLog extends Component<
  { entries: Entry[] },
  Record<string, never>,
  Snapshot
> {
  private container = createRef<HTMLDivElement>();

  getSnapshotBeforeUpdate(): Snapshot {
    const box = this.container.current;
    if (!box || box.scrollTop < 2) return null;
    const top = box.getBoundingClientRect().top;
    const anchor = Array.from(box.children).find(
      (child) => child.getBoundingClientRect().bottom > top,
    );
    return anchor
      ? {
          key: anchor.getAttribute('data-log-key') || '',
          offset: anchor.getBoundingClientRect().top - top,
          top: box.scrollTop,
        }
      : null;
  }

  componentDidUpdate(
    _props: { entries: Entry[] },
    _state: Record<string, never>,
    snapshot: Snapshot,
  ) {
    const box = this.container.current;
    if (!box) return;
    if (!snapshot) {
      box.scrollTop = 0;
      return;
    }
    const anchor = Array.from(box.children).find(
      (child) => child.getAttribute('data-log-key') === snapshot.key,
    );
    box.scrollTop = anchor
      ? box.scrollTop +
        anchor.getBoundingClientRect().top -
        box.getBoundingClientRect().top -
        snapshot.offset
      : snapshot.top;
  }

  render() {
    const occurrences = new Map<string, number>();
    const entries = this.props.entries
      .map((entry) => {
        const identity = JSON.stringify([
          entry.at,
          entry.level,
          entry.message,
          entry.details,
        ]);
        const occurrence = occurrences.get(identity) || 0;
        occurrences.set(identity, occurrence + 1);
        return { entry, key: `${identity}:${occurrence}` };
      })
      .reverse();
    return (
      <div
        ref={this.container}
        style={{ overflowAnchor: 'none' }}
        className="mt-2 max-h-28 space-y-1 overflow-y-auto font-mono text-[10px] text-emerald-100/60"
      >
        {entries.map(({ entry, key }) => (
          <p
            key={key}
            data-log-key={key}
            className={
              entry.level === 'error'
                ? 'text-rose-300'
                : entry.level === 'success'
                  ? 'text-emerald-300'
                  : undefined
            }
          >
            <time
              className="mr-2 text-slate-400"
              dateTime={new Date(entry.at).toISOString()}
              title={new Date(entry.at).toLocaleString()}
            >
              {new Date(entry.at).toLocaleTimeString()}
            </time>
            {entry.message}
            {entry.details != null ? (
              <span className="ml-1 text-current/75">
                —{' '}
                {typeof entry.details === 'string'
                  ? entry.details
                  : JSON.stringify(entry.details)}
              </span>
            ) : null}
          </p>
        ))}
      </div>
    );
  }
}
