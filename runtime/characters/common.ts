// The class bundles' composition: the owners, then shared.js, which reads them at its install.
import "./owners.ts";
import "../../characters/shared.js";
// The settings owner's answer in this realm.
import { partyHooks } from "../hooks/index.ts";
import { installCharacterSettings } from "../settings/character/api.ts";
installCharacterSettings(partyHooks());
