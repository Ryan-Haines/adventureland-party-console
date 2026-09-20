import { useQuery, useQueryClient } from '@tanstack/react-query';
import { read, key, useVisible } from './query-cache';
import { decodeMailInbox } from './decode-mail-inbox';
import type { MailInbox } from './mail-inbox';
export function useInbox(interval = 2000) {
  const client = useQueryClient(),
    visible = useVisible();
  return useQuery({
    queryKey: key('mail'),
    queryFn: async ({ signal }) =>
      decodeMailInbox(await read<MailInbox>(client, '/mail', signal)),
    enabled: visible,
    refetchInterval: interval,
    staleTime: 2000,
    gcTime: 300000,
  });
}
