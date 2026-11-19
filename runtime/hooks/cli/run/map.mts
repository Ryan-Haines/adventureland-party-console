// npm run addon:map: the owner map QUESTIONS.md Part 2 asks for, read from the registry, so it
// shows what is installed now: every hook, the tiers in rank order with their movers, the
// slots and the registrations.
import { loadRegistry } from './load.mts';

const map = (await loadRegistry(process.argv.slice(2))).map();
console.log('Hooks:');
for (const hook of map.hooks) console.log(`  ${hook.name} (${hook.kind}, ${hook.part}): receives ${hook.receives}; returns ${hook.returns}; ` +
  (hook.answeredBy.length ? `answered by ${hook.answeredBy.join(', ')}` : 'answered by nothing yet'));
console.log('Tiers, highest first (an add-on moves only below manual):');
for (const tier of map.tiers) console.log(`  ${tier.rank} ${tier.tier}${tier.movers.length ? ': ' + tier.movers.join(', ') : ''}`);
console.log('Slots:');
for (const slot of map.slots) console.log(`  ${slot.slot} ${slot.mode}: ${slot.name} (${slot.fills})`);
console.log('Registrations:');
for (const r of map.registrations) console.log(`  ${r.name} [${r.folder}] by ${r.author}: ${r.summary}`);
