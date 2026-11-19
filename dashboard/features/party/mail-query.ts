import { useQuery, useQueryClient } from '@tanstack/react-query';
import { read, key, pollOf, useVisible } from './query-cache';
import type { MailInbox } from './mail-inbox';
// The mail inbox's poll (the status owner's `dashboardPolls` mail row); the mail count passes its own `mailCount` row.
export function useInbox(interval = pollOf('mail').interval) {
  const client = useQueryClient(),
    visible = useVisible();
  return useQuery({
    queryKey: key('mail'),
    // items/coordinator/mail.ts parses each attachment before it answers.
    queryFn: ({ signal }) => read<MailInbox>(client, '/mail', signal),
    enabled: visible,
    refetchInterval: interval,
    staleTime: pollOf('mail').staleTime,
    gcTime: pollOf('mail').gcTime,
  });
}
