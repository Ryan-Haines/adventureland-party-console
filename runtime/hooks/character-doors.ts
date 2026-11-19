// The character's add-on action doors:
// each owner's door file export under the name its ACTIONS rows give, which the character's install
// publishes to the dispatcher. 07's Cave entry runs on the coordinator, so the coordinator publishes
// its door (coordinator/application.ts); 14's door for the ownerless events takes the socket and the
// call budget as ports.
import * as movement from '../movement/api/character.ts';
import * as turns from '../characters/turns/api.ts';
import * as events from '../events/api.ts';
import * as hunting from '../hunting/api.ts';
import * as merchant from '../merchant-jobs/api.ts';
import * as items from '../items/api.ts';
import { gameEvent, type GameEventPorts } from './actions/door.ts';
import type { Door } from './registry.ts';

export function characterDoors(ports: GameEventPorts): Record<string, Door> {
  return {
    walk: movement.walk, step: movement.step, spend: turns.spend, emote: turns.emote,
    chatSay: events.chatSay, eventJoin: events.eventJoin, huntTake: hunting.huntTake,
    standOpen: merchant.standOpen, standClose: merchant.standClose, joinGiveaway: merchant.joinGiveaway,
    bankDeposit: items.bankDeposit, bankRetrieve: items.bankRetrieve, bankStore: items.bankStore,
    bankSwap: items.bankSwap, bankWithdraw: items.bankWithdraw, boost: items.boost, buy: items.buy,
    buyLostAndFound: items.buyLostAndFound, buySecondhand: items.buySecondhand, compound: items.compound, consume: items.consume, craft: items.craft,
    destat: items.destat, destroy: items.destroy, dismantle: items.dismantle, donate: items.donate,
    equip: items.equip, exchange: items.exchange, exchangeBuy: items.exchangeBuy, list: items.list,
    locksmith: items.locksmith, lostAndFound: items.lostAndFound, lostAndFoundInfo: items.lostAndFoundInfo,
    move: items.move, openChest: items.openChest, sell: items.sell, sendGold: items.sendGold,
    sendItem: items.sendItem, sendMail: items.sendMail, split: items.split, takeMail: items.takeMail,
    tradeBuy: items.tradeBuy, tradeHistory: items.tradeHistory, tradeSell: items.tradeSell,
    tradeSwap: items.tradeSwap, unequip: items.unequip, upgrade: items.upgrade, wearLook: items.wearLook,
    wishlist: items.wishlist,
    gameEvent: gameEvent(ports),
  };
}
