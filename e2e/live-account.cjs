// The disposable account the live coordinator loads in place of caracAL's account_info.js.
// It keeps caracAL's contract: Info.build answers once, then refreshes every 6 s on its own and
// tells each listener. The roster's offline read (runtime/lifecycle/roster/ownership.ts
// `confirmOffline`) waits for that next refresh, so an account that only answers when asked
// holds every Steam login until steamHandoffExpiryMs.
const REFRESH_MS = 6e3;

function createLiveAccount(api, refreshMs = REFRESH_MS) {
  const account = {
    response: null, listeners: [], task: null,
    async updateInfo() {
      const raw = await api('servers_and_characters');
      const info = Array.isArray(raw) ? raw[0] : raw.servers ? raw : raw.infs?.find(value => value.type === 'servers_and_characters');
      if (!Array.isArray(info?.characters) || !Array.isArray(info?.servers)) throw Error('Local account API returned no roster');
      this.response = info;
      // A listener may remove itself while it runs, so each update tells a copy of the list.
      for (const listener of [...this.listeners]) listener(info);
      return info;
    },
    resolve_char(name) { return this.response.characters.find(character => character.name === name); },
    add_listener(listener) { this.listeners.push(listener); },
    remove_listener(listener) {
      const index = this.listeners.indexOf(listener);
      if (index > -1) this.listeners.splice(index, 1);
    },
    // caracAL's Info.build: the first answer, then the refresh interval.
    async build() {
      await this.updateInfo();
      this.task ??= setInterval(() => this.updateInfo().catch(error => console.warn('failed to update account info: %s', error)), refreshMs);
      return this;
    },
    destroy() { clearInterval(this.task); this.task = null; },
  };
  return account;
}

module.exports = { createLiveAccount, REFRESH_MS };
