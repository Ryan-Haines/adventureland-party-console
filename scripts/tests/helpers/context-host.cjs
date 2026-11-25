// The game host a movement part reads in a sliced test's vm context. Each name in `game` reads the
// context's own global, and every other name reads and writes the context's `root` as it stands at
// each read, which is the global in production, so a test that sets `root` after creation (often
// `c.root=c`) reaches the part. `own` names answer before both, such as the walk client's `eval`.
function contextHost(context, game, own = {}) {
  const root = () => context.root && typeof context.root === 'object' ? context.root : context;
  return new Proxy({}, {
    get: (target, name) => name in own ? own[name] : game.has(name) ? context[name] : root()[name],
    set: (target, name, value) => { root()[name] = value; return true; } });
}
module.exports = { contextHost };
