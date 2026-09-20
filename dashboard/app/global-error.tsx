'use client';
import { useDashboardRecovery } from '@/hooks/use-dashboard-recovery';

export default function GlobalError({
  error,
}: {
  error: Error;
  reset: () => void;
}) {
  const recovery = useDashboardRecovery(true);
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
        </main>
      </body>
    </html>
  );
}
