'use client';

import { Home } from '@/features/party/party-console';
import { useEffect } from 'react';
import { clearRecoveryHistory } from '@/lib/dashboard-recovery';

export default function Page() {
  useEffect(() => {
    // Only clear the loop guard after the real dashboard has stayed mounted.
    // An immediate repeat render error unmounts this component and cancels it.
    const timer = window.setTimeout(() => {
      try { clearRecoveryHistory(sessionStorage); } catch { /* Storage may be disabled. */ }
    }, 10000);
    return () => window.clearTimeout(timer);
  }, []);
  return <Home />;
}
