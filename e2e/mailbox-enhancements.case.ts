import {test,expect} from './fixtures';

test.describe('Mailbox enhancements',()=>{
 test.use({mailbox:true,merchantDialogs:true,merchantConnected:true});
 test('mailbox settings persist independently and delete only confirmed collected attachments',async({page,app},info)=>{
  await page.goto('/');
  await expect(page.getByLabel('New mail')).toBeVisible();
  await page.getByRole('button',{name:/^Mail/}).click();
  const dialog=page.getByRole('dialog',{name:'Mail',exact:true});
  await expect(page.getByLabel('New mail')).toHaveCount(0);
  const collect=dialog.getByLabel('Automatically collect mail attachments',{exact:true});
  const remove=dialog.getByLabel('Automatically delete messages after attachments are collected',{exact:true});
  await expect(collect).not.toBeChecked();await expect(remove).not.toBeChecked();
  await remove.click();await expect(remove).toBeChecked();
  await expect(dialog.getByRole('button',{name:/Collected attachment fixture/})).toHaveCount(0);
  await expect(dialog.getByRole('button',{name:/Unclaimed attachment fixture/})).toBeVisible();
  await expect(dialog.getByRole('button',{name:/Pending attachment fixture/})).toBeVisible();
  await expect(dialog.getByRole('button',{name:/Text message fixture/})).toBeVisible();
  await expect(collect).not.toBeChecked();
  await collect.click();await expect(collect).toBeChecked();
  await expect.poll(async()=>{const s=await app.state();return [s.merchantCurrent,...s.merchantQueue].filter(j=>j?.reason==='collect mail').map(j=>j.mail.id);}).toEqual(['mail-unclaimed']);
  await app.restartCoordinator();
  const response=await page.request.get(app.url+'/party-api/mail'),mailbox=await response.json();
  expect(mailbox.settings).toEqual({autoCollect:true,autoDelete:true});expect(mailbox.newCount).toBe(0);
  await info.attach('mailbox-automation-and-native-observations',{body:JSON.stringify(mailbox),contentType:'application/json'});
 });
 test('outbox shows durable sent records and deletion does not remove another sent message',async({page,app},info)=>{
  await page.goto('/');await page.getByRole('button',{name:/^Mail/}).click();
  const dialog=page.getByRole('dialog',{name:'Mail',exact:true});await dialog.getByRole('button',{name:'Outbox',exact:true}).click();
  await expect(dialog.getByText('Sent fixture one',{exact:true})).toBeVisible();await expect(dialog.getByText('Sent fixture two',{exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'Delete sent record Sent fixture one',exact:true}).click();
  await expect(dialog.getByText('Sent fixture one',{exact:true})).toHaveCount(0);await expect(dialog.getByText('Sent fixture two',{exact:true})).toBeVisible();
  await app.restartCoordinator();const mailbox=await (await page.request.get(app.url+'/party-api/mail')).json();
  expect(mailbox.outbox.map((m:any)=>m.id)).toEqual(['sent-fixture-2']);
  await info.attach('mailbox-outbox-after-restart',{body:JSON.stringify(mailbox),contentType:'application/json'});
 });
});
