"use client";
import { useState } from "react";
import { PartyItemDetails } from "./party-item-details";
import { SendMailDialog } from "./send-mail-dialog";
import type { PartyConsoleModel } from "./use-party-console";

import { usePanelModel } from "./use-panel-model";
export function PartySendMailDialog({ model }: { model: PartyConsoleModel }) {
  return model.mailOpen ? <PartySendMailDialogConnected base={model} /> : null;
}
function PartySendMailDialogConnected({ base }: { base: PartyConsoleModel }) {
  const [inspection, setInspection] = useState<PartyConsoleModel["selected"]>(null);
  const model = usePanelModel(base, { inventory: true, bank: true });
  const { state, post, mailOpen, setMailOpen, setMailCount } = model;
  return (
    <SendMailDialog
      key={model.mailDraft ? "aldata-auth" : "mail"}
      open={mailOpen}
      onOpenChange={(open) => { setMailOpen(open); if (!open) model.setMailDraft(null); }}
      draft={model.mailDraft}
      onCount={setMailCount}
      onInspect={(entry) => setInspection({ character: "Mail attachment", entry })}
      inspectionPanel={<PartyItemDetails model={{...model, selected: inspection, setSelected: setInspection}} />}
      catalog={state.merchantCatalog?.allItems || []}
      merchant={state.merchantCharacter ? state.characters[state.merchantCharacter] : undefined}
      bank={state.bank || null}
      bankbois={state.bankbois || []}
      onSend={async (mail) => {
        await post("/merchant/send-mail", mail);
        if (mail.recipient === "earthiverse" && mail.subject === "aldata_auth") model.setALDataAuthPending(true);
      }}
    />
  );
}
