import { useInbox } from './mail-query';
export function MailCount() {
  const count = useInbox(10000).data?.count || 0;
  return count > 0 ? <> ({count})</> : null;
}
