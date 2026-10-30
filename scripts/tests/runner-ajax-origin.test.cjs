const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { JSDOM } = require('../../.caracal/node_modules/jsdom');
const jquery = require('../../.caracal/node_modules/jquery');
const { installNativeAjax } = require('../../runtime/lifecycle/native-ajax.ts');

// Failure inventory: docs/efficiency.md, Character threads follow-ups, CT9.
function codeWindow(url = 'https://adventure.land/') {
  const window = new JSDOM('', { url }).window;
  window.globalThis = window;
  window.$ = jquery(window);
  vm.createContext(window);
  return window;
}
// The prefilter sees jQuery's settings after its crossDomain decision and
// aborts, so no request leaves the test.
function decisions(window, calls) {
  const seen = [];
  window.$.ajaxPrefilter((settings, _original, xhr) => { seen.push(settings.crossDomain); xhr.abort(); });
  for (const call of calls) call(window.$);
  return seen;
}
const urls = [
  'http://127.0.0.1:8090/party-api/status', 'http://localhost:8090/x', 'http://[::1]:8090/x',
  'https://adventure.land/api', 'https://adventure.land:443/api', 'https://ADVENTURE.land/x',
  'http://adventure.land/x', 'https://adventure.land:8443/x', 'https://user:pw@adventure.land/x',
  'HTTP://127.0.0.1/x', 'http://127.0.0.1:80/x', ' http://127.0.0.1:8090/x ', 'http://127.0.0.1:80x/',
  '//127.0.0.1:8090/x', '/party-api/status', 'party-api/status', '', 'ftp://127.0.0.1/x',
];
const forms = url => [
  $ => $.ajax({ url, method: 'POST', data: '{}' }),
  $ => $.ajax(url, { method: 'GET' }),
  $ => $.ajax(url),
  $ => $.get(url),
  $ => $.post(url, '{}'),
  $ => $.ajax({ url, crossDomain: false }),
  $ => $.ajax({ url, crossDomain: true }),
  $ => $.ajax({ url, crossDomain: null }),
];

test('crossDomain matches jQuery for every URL form and call shape', () => {
  for (const origin of ['https://adventure.land/', 'http://127.0.0.1:8090/']) {
    const calls = urls.flatMap(forms);
    const expected = decisions(codeWindow(origin), calls);
    const window = codeWindow(origin);
    installNativeAjax(window.$);
    assert.deepEqual(decisions(window, calls), expected, origin);
  }
});

test('an ajaxSetup crossDomain and the caller options are left as given', () => {
  const window = codeWindow();
  installNativeAjax(window.$);
  window.$.ajaxSetup({ crossDomain: false });
  assert.deepEqual(decisions(window, [$ => $.ajax({ url: 'http://127.0.0.1:8090/x' })]), [false]);
  const options = { url: 'http://127.0.0.1:8090/x', method: 'POST' };
  const before = JSON.stringify(options);
  decisions(window, [$ => $.ajax(options)]);
  assert.equal(JSON.stringify(options), before);
  assert.equal('crossDomain' in options, false);
});

test('the jqXHR and its outcome are the ones jQuery returns', async () => {
  const window = codeWindow();
  installNativeAjax(window.$);
  const xhr = window.$.ajax({ url: 'http://127.0.0.1:1/unreachable', timeout: 2000 });
  assert.equal(typeof xhr.abort, 'function');
  assert.equal(typeof xhr.always, 'function');
  const status = await new Promise(resolve => xhr.fail((_xhr, text) => resolve(text)));
  assert.equal(status, 'error');
});

test('absolute request URLs are not resolved through a jsdom anchor element', () => {
  const window = codeWindow();
  installNativeAjax(window.$);
  const create = window.document.createElement.bind(window.document);
  let anchors = 0;
  window.document.createElement = (name, ...rest) => { if (String(name).toLowerCase() === 'a') anchors++; return create(name, ...rest); };
  decisions(window, Array.from({ length: 20 }, () => $ => $.ajax({ url: 'http://127.0.0.1:8090/party-api/status', method: 'POST', data: '{}' })));
  assert.equal(anchors, 0);
});
