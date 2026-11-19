import { installSteamBridge } from "./bridge.ts";
installSteamBridge(globalThis as unknown as Parameters<typeof installSteamBridge>[0]);
