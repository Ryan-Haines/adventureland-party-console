'use client';
import { useDashboardRecovery } from '@/hooks/use-dashboard-recovery';
import { PROBE_TIMEOUT_MS } from '@/lib/dashboard-recovery';

export default function GlobalError({
  error,
}: {
  error: Error;
  reset: () => void;
}) {
  const recovery = useDashboardRecovery();
  if (process.env.NODE_ENV === 'development')
    console.error('Party Console render failed', error);
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          background: '#07100f',
          color: '#e9f3e8',
          fontFamily: 'sans-serif',
        }}
      >
        <main style={{ padding: '3rem' }}>
          <h1>The dashboard couldn’t render</h1>
          <p>
            Your characters are managed separately. The dashboard will reconnect automatically when it is ready.
          </p>
          {recovery.timedOut && <p>The last check timed out after {PROBE_TIMEOUT_MS / 1000}s.</p>}
          {recovery.blocked && <p>The server is ready, but automatic reload is paused to prevent a repeated error loop. You can reload now.</p>}
          <p role="status">{recovery.checking ? 'Checking dashboard…' : `Checking again in ${recovery.seconds}s…`}</p>
          <button
            type="button"
            onClick={recovery.retry}
            disabled={recovery.checking}
            style={{
              background: '#102a23',
              color: '#e9f3e8',
              border: '1px solid #6ee7b7',
              padding: '0.75rem 1rem',
              cursor: 'pointer',
            }}
          >
            Retry now
          </button>
          <button type="button" onClick={recovery.reload} style={{
            marginLeft: '0.75rem', background: '#102a23', color: '#e9f3e8',
            border: '1px solid #6ee7b7', padding: '0.75rem 1rem', cursor: 'pointer',
          }}>Reload now</button>
          {/* The error text stays on the page: a crash on a remote or phone screen has no console to read. */}
          <pre style={{ marginTop: '2rem', whiteSpace: 'pre-wrap', fontSize: '0.8rem', color: '#fca5a5' }}>
            {String(error?.message || error)}{'\n'}{String(error?.stack || '').split('\n').slice(0, 12).join('\n')}
          </pre>
        </main>
      </body>
    </html>
  );
}
