"use client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ShoppingCart, X } from "lucide-react";
import { useState } from "react";
import { ItemSprite } from "./item-sprite";
import { MerchantCatalogItem } from "./merchant-catalog-item";
import { PlayerStandListing } from "./player-stand-listing";
import { StandSearchState } from "./stand-search-state";

export function PlayerStandMarketDialog({
  open,
  onClose,
  catalog,
  searchState,
  onSearch,
  onBuy,
}: {
  open: boolean;
  onClose: () => void;
  catalog: MerchantCatalogItem[];
  searchState: StandSearchState;
  onSearch: (itemId: string) => Promise<void>;
  onBuy: (listings: (PlayerStandListing & { buyQuantity: number })[]) => Promise<void>;
}) {
  const [filter, setFilter] = useState("");
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const [cart, setCart] = useState<Record<string, PlayerStandListing & { buyQuantity: number }>>(
    {},
  );
  const [submitting, setSubmitting] = useState(false);
  const filtered = catalog.filter((item) =>
    `${item.name} ${item.id}`.toLowerCase().includes(filter.toLowerCase()),
  );
  const keyFor = (listing: PlayerStandListing) =>
    `${listing.seller}:${listing.slot}:${listing.rid}`;
  const selectedDefinition = catalog.find((item) => item.id === selectedItem);
  const cartRows = Object.values(cart);
  const total = cartRows.reduce((sum, row) => sum + row.price * row.buyQuantity, 0);
  const addListing = (listing: PlayerStandListing) =>
    setCart((old) => ({
      ...old,
      [keyFor(listing)]: {
        ...listing,
        buyQuantity: old[keyFor(listing)]?.buyQuantity || 1,
      },
    }));
  const setQuantity = (listing: PlayerStandListing, amount: number) =>
    setCart((old) => {
      const next = { ...old },
        key = keyFor(listing);
      if (amount < 1) delete next[key];
      else
        next[key] = {
          ...listing,
          buyQuantity: Math.min(listing.quantity, amount),
        };
      return next;
    });
  const submit = async () => {
    setSubmitting(true);
    try {
      await onBuy(cartRows);
      setCart({});
      onClose();
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <DialogContent
        className="flex max-h-[92vh] flex-col border-amber-800 bg-[#0b1916] text-emerald-50"
        style={{ width: "calc(100vw - 2rem)", maxWidth: "1500px" }}
      >
        <DialogHeader>
          <DialogTitle>Buy from player stands</DialogTitle>
          <DialogDescription>
            Choose any game item, send GoldMajesty to the US II merchant market to scan visible open
            stands, then select a live listing.
          </DialogDescription>
        </DialogHeader>
        <Input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter every item in the game…"
          className="border-emerald-800 bg-black/30"
        />
        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
          <div className="min-h-0 overflow-y-auto pr-2">
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
              {filtered.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setSelectedItem(item.id)}
                  className={`grid min-h-24 place-items-center rounded border p-2 text-center ${selectedItem === item.id ? "border-amber-300 bg-amber-400/10" : "border-emerald-900 bg-black/20 hover:border-emerald-500"}`}
                >
                  <div className="relative h-10 w-10">
                    {item.sprite && <ItemSprite sprite={item.sprite} />}
                  </div>
                  <span className="mt-1 w-full break-words text-[10px] leading-tight">
                    {item.name}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <aside className="min-h-0 overflow-y-auto rounded border border-emerald-900 bg-black/20 p-3">
            <Button
              disabled={!selectedItem || searchState.status === "searching"}
              onClick={() => selectedItem && void onSearch(selectedItem)}
              className="w-full bg-amber-400 text-amber-950 hover:bg-amber-300"
            >
              <ShoppingCart className="mr-2 h-4 w-4" />
              {searchState.status === "searching"
                ? "Searching stands…"
                : `Search listings${selectedDefinition ? ` · ${selectedDefinition.name}` : ""}`}
            </Button>
            <div className="mt-3 space-y-2">
              {searchState.status === "complete" && !searchState.listings.length && (
                <p className="text-xs text-emerald-100/45">No visible market listings found.</p>
              )}
              {searchState.error && <p className="text-xs text-rose-300">{searchState.error}</p>}
              {searchState.listings.map((listing) => (
                <button
                  key={keyFor(listing)}
                  onClick={() => addListing(listing)}
                  className="flex w-full items-center gap-2 rounded border border-emerald-900 p-2 text-left hover:border-amber-500"
                >
                  <div className="relative h-9 w-9 shrink-0">
                    {catalog.find((item) => item.id === listing.item.name)?.sprite && (
                      <ItemSprite
                        sprite={catalog.find((item) => item.id === listing.item.name)!.sprite!}
                      />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs">{listing.seller}</p>
                    <p className="font-mono text-[10px] text-emerald-100/50">
                      {listing.quantity} available
                    </p>
                  </div>
                  <span className="font-mono text-xs text-amber-300">
                    {listing.price.toLocaleString()}g ea.
                  </span>
                </button>
              ))}
            </div>
            <div className="mt-4 border-t border-emerald-900 pt-3">
              <p className="mb-2 font-mono text-xs uppercase text-emerald-300">Cart</p>
              {!cartRows.length && (
                <p className="text-xs text-emerald-100/40">No listings selected.</p>
              )}
              {cartRows.map((listing) => (
                <div key={keyFor(listing)} className="mb-2 flex items-center gap-2 text-xs">
                  <span className="min-w-0 flex-1 truncate">
                    {listing.item.name} · {listing.seller}
                  </span>
                  <Input
                    inputMode="numeric"
                    value={listing.buyQuantity}
                    onChange={(event) => setQuantity(listing, Number(event.target.value))}
                    className="h-7 w-16 border-emerald-800 bg-black/30 px-2 font-mono"
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setQuantity(listing, 0)}
                    className="h-7 w-7 text-rose-300"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              <p className="mt-2 font-mono text-sm text-amber-300">
                Total: {total.toLocaleString()}g
              </p>
            </div>
          </aside>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button
            disabled={!cartRows.length || submitting}
            onClick={() => void submit()}
            className="bg-amber-400 text-amber-950"
          >
            {submitting ? "Queuing…" : "Buy"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
