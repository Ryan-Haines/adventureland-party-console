"use client";
import { lazy } from "react";
import { DeferredPanel } from "./deferred-panel";
const MerchantCommerceDialog = lazy(() =>
  import("./merchant-commerce-dialog").then((module) => ({
    default: module.MerchantCommerceDialog,
  })),
);
import type { PartyConsoleModel } from "./use-party-console";

import { usePanelModel } from "./use-panel-model";
export function PartyMerchantCommerceDialog({ model }: { model: PartyConsoleModel }) {
  return model.commerceMode ? <PartyMerchantCommerceDialogConnected base={model} /> : null;
}
function PartyMerchantCommerceDialogConnected({ base }: { base: PartyConsoleModel }) {
  const model = usePanelModel(base, { inventory: true, bank: true });
  const { state, chars, setCommerceMode, setSelected, commerceMode, submitMerchantOrder } = model;
  return (
    <DeferredPanel active={!!commerceMode}>
      <MerchantCommerceDialog
        mode={commerceMode}
        onClose={() => setCommerceMode(null)}
        catalog={
          state.merchantCatalog || {
            allItems: [],
            buyable: [],
            craftable: [],
            exchangeable: [],
          }
        }
        characters={chars}
        bank={state.bank || null}
        bankbois={state.bankbois || []}
        onInspect={(item, meta) =>
          setSelected({
            character:
              commerceMode === "craft"
                ? "Crafting catalog"
                : commerceMode === "exchange"
                  ? "Exchange catalog"
                  : "Merchant catalog",
            entry: { slot: -1, item: { name: item.id }, meta },
          })
        }
        onSubmit={submitMerchantOrder}
      />
    </DeferredPanel>
  );
}
