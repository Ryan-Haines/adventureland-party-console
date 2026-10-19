import { useInbox } from './mail-query';
export function MailCount() {
  const inbox=useInbox(10000).data,count=inbox?.count||0;
  return <>{count>0?<> ({count})</>:null}{(inbox?.newCount||0)>0&&<span aria-label="New mail" className="ml-1 inline-block h-2 w-2 rounded-full bg-amber-300" />}</>;
}
