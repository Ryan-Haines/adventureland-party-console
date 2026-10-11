import {test, expect} from '@playwright/test';
import {mkdir, writeFile} from 'node:fs/promises';
import {gateway} from '../tools/hosting/gateway';
import {Access} from '../tools/hosting/access';

test('console deployment gateway requires browser authorization and its own origin', async ({request}, info) => {
  // Failures: unpaired clients, cross-origin mutations and game bridge tokens
  // must never reach deployment; a paired same-origin request must reach it.
  const directory = info.outputPath('gateway');
  await mkdir(directory, {recursive: true});
  const access = new Access(directory + '/access.json');
  await access.load();
  const browser = await access.setRequired(true), steam = await access.steam();
  const calls: Array<{method?: string; pathname: string}> = [];
  const server = gateway({access, configured: () => true, dashboardPort: 1,
    builds: {async route(req, res, pathname) {
      calls.push({method: req.method, pathname});
      res.writeHead(202, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({accepted: true}));
    }},
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string' || !browser) throw new Error('Gateway setup failed');
  const url = `http://127.0.0.1:${address.port}`, path = '/console-build/deploy';
  const results: Record<string, number> = {};
  try {
    results.unpaired = (await request.post(url + path, {headers: {Origin: url}, data: {buildId: 'A'}})).status();
    results.crossOrigin = (await request.post(url + path, {headers: {Origin: 'https://example.com', Cookie: `party=${browser}`}, data: {buildId: 'A'}})).status();
    results.noOrigin = (await request.post(url + path, {headers: {Cookie: `party=${browser}`}, data: {buildId: 'A'}})).status();
    results.steam = (await request.post(`${url}/bridge/${steam}${path}`, {headers: {Origin: 'https://adventure.land'}, data: {buildId: 'A'}})).status();
    expect(calls).toEqual([]);
    results.authorized = (await request.post(url + path, {headers: {Origin: url, Cookie: `party=${browser}`}, data: {buildId: 'A'}})).status();
    expect(results).toEqual({unpaired: 401, crossOrigin: 403, noOrigin: 403, steam: 404, authorized: 202});
    expect(calls).toEqual([{method: 'POST', pathname: path}]);
    const ledger = JSON.stringify({results, calls}, null, 2);
    await writeFile(info.outputPath('gateway-authorization.json'), ledger);
    await info.attach('gateway-authorization', {body: ledger, contentType: 'application/json'});
  } finally {await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));}
});
