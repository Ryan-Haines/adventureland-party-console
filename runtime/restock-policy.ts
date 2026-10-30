/** Saved restock settings and client protocol, independent of native game objects. */
export interface SupplyPolicy { item: string; min: number; max: number }
export interface ElixirPolicy extends SupplyPolicy { autoConsume: boolean; autoAcquire: boolean }
export interface RestockPolicy { hp: SupplyPolicy; mp: SupplyPolicy; elixir?: ElixirPolicy }
