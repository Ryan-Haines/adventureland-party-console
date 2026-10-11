import type { InventoryEntry } from '../contracts/item.ts';
import {requestObject} from '../http/contracts.ts';
import {availableCraftStock,craftProtection} from '../merchant/craft-reservations.ts';

/** Internal dictionaries and public dashboard worker arrays share this boundary. */
interface StorageStockEntry extends InventoryEntry {craftLocation:string;storageQuantity:number}
export function protectedMerchantStorageStock(value:unknown): StorageStockEntry[] {
  const state=requestObject(value),merchant=String(state.merchantCharacter);
  const report=requestObject(requestObject(state.statuses)[merchant]);
  const packs=requestObject(requestObject(state.bankSnapshot).packs);
  const workers=Array.isArray(state.bankbois)?state.bankbois:Object.values(requestObject(state.bankbois));
  const entries=[...stockEntries(report.items,'inventory:'+merchant),
    ...Object.entries(packs).flatMap(([pack,items])=>stockEntries(items,pack)),
    ...workers.flatMap(raw=>{const worker=requestObject(raw);return stockEntries(worker.items,'bankboi:'+worker.name);})];
  const protection=craftProtection({merchantCharacter:merchant,
    merchantQueue:Array.isArray(state.merchantQueue)?state.merchantQueue:[],merchantCurrent:requestObject(state.merchantCurrent),
    merchantDeliveries:Object.fromEntries(Object.entries(requestObject(state.merchantDeliveries)).map(([key,items])=>[key,Array.isArray(items)?items:[]])),
    merchantCatalog:requestObject(state.merchantCatalog)});
  return availableCraftStock(entries,protection).filter((entry):entry is StorageStockEntry=>!!entry &&
    (!String(entry.craftLocation).startsWith('bankboi:') || (Number(entry.item?.q)||1)===entry.storageQuantity));
}
function stockEntries(value:unknown,craftLocation:string):StorageStockEntry[] {
  if(!Array.isArray(value)) return [];
  return value.flatMap((raw,index)=>raw?[{...requestObject(raw),slot:Number.isSafeInteger(requestObject(raw).slot)?Number(requestObject(raw).slot):index,
    storageQuantity:Number(requestObject(requestObject(raw).item).q)||1,craftLocation}]:[]);
}
