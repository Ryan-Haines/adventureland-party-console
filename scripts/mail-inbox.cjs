// Account-level inbox access. Listing never marks messages read or claims items.
module.exports = function createMailInbox({ api, names, jobs, enqueue }) {
  let state = { messages: [], count: 0, updatedAt: null, error: null }, flight = null;
  const outcomes = new Map(), deleting = new Set();
  const normalize = value => String(value || '').toLowerCase().replace(/\s/g, '');
  function snapshot() {
    const active = jobs();
    return { ...state, messages: state.messages.map(mail => {
      const job = active.find(job => job && job.reason === 'collect mail' && job.mail && job.mail.id === mail.id);
      return { ...mail, collection: mail.taken === true ? 'collected' : job ?
        (job.startedAt ? 'collecting' : 'queued') : outcomes.get(mail.id)?.status || null,
      collectionError: outcomes.get(mail.id)?.error || null };
    }) };
  }
  async function refresh() {
    if (flight) return flight;
    flight = (async () => {
      try {
        const owned = new Set(names().map(normalize)), found = new Map(), cursors = new Set();
        let cursor = null;
        do {
          const response = await api('pull_mail', cursor ? { cursor } : {});
          const page = response.find(entry => entry && entry.type === 'mail');
          if (!page || !Array.isArray(page.mail)) throw new Error('Invalid inbox response');
          for (const mail of page.mail) {
            if (!mail.id || !owned.has(normalize(mail.to))) continue;
            let item = mail.item || null;
            if (typeof item === 'string') {
              try { item = JSON.parse(item); }
              catch (_) { throw new Error('Invalid mail attachment data'); }
            }
            if (mail.item && (!item || typeof item !== 'object' || typeof item.name !== 'string' || !item.name))
              throw new Error('Invalid mail attachment data');
            found.set(mail.id, { id: mail.id, from: String(mail.fro || ''), to: String(mail.to || ''),
              subject: String(mail.subject || ''), message: String(mail.message || ''), sent: mail.sent,
              item, taken: mail.taken === true ? true : mail.taken ? 'pending' : false });
          }
          cursor = page.more ? page.cursor : null;
          if (page.more && (!cursor || cursors.has(cursor))) throw new Error('Incomplete inbox pagination');
          if (cursor) cursors.add(cursor);
        } while (cursor);
        state = { messages: [...found.values()].sort((a, b) => Date.parse(b.sent) - Date.parse(a.sent)),
          count: found.size, updatedAt: Date.now(), error: null };
      } catch (error) { state = { ...state, error: error.message }; throw error; }
      return snapshot();
    })();
    try { return await flight; } finally { flight = null; }
  }
  async function collect(id) {
    await refresh();
    const mail = state.messages.find(mail => mail.id === id);
    if (!mail || !mail.item) throw new Error('Attachment unavailable');
    if (mail.taken === true) return snapshot();
    if (mail.taken) throw new Error('The game is still processing this attachment');
    if (deleting.has(id)) throw new Error('Message deletion is in progress');
    if (!jobs().some(job => job && job.reason === 'collect mail' && job.mail?.id === id)) {
      enqueue(mail); outcomes.delete(id);
    }
    return snapshot();
  }
  async function remove(id) {
    if (deleting.has(id)) throw new Error('Message deletion is in progress');
    deleting.add(id);
    try {
      await refresh();
      const mail = state.messages.find(mail => mail.id === id);
      if (!mail) throw new Error('Message no longer exists');
      if (mail.item && mail.taken !== true) throw new Error('Collect the attachment before deleting this message');
      if (jobs().some(job => job && job.reason === 'collect mail' && job.mail?.id === id))
        throw new Error('Wait for attachment collection to finish');
      await api('delete_mail', { mid: id });
      state.messages = state.messages.filter(mail => mail.id !== id); state.count = state.messages.length;
      outcomes.delete(id);
      await refresh();
      return snapshot();
    } finally { deleting.delete(id); }
  }
  function complete(id, success, error) {
    outcomes.set(id, { status: success ? 'collected' : 'failed', error: success ? null : String(error || 'Collection failed') });
    void refresh().catch(() => {});
  }
  return { snapshot, refresh, collect, remove, complete };
};
