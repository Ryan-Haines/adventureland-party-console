import { createHuntLifecycle } from "./lifecycle.ts";
import { createHuntConvoy } from "./convoy.ts";
import { createHuntQuests } from "./quests.ts";
import { createHuntTick } from "./tick.ts";
import type { HuntCycle, HuntStatus } from "./contracts.ts";
import type { ReturnLocation } from "../events/return-types.ts";

type HuntState = Parameters<typeof createHuntLifecycle>[0];
interface CoordinatorHuntState extends HuntState {
  nextCommandId: number;
}

interface HuntCompositionPorts {
  now: () => number;
  participants: () => string[];
  fighting: () => boolean;
  rareEncounter: () => unknown;
  cancelHuntConvoy: () => void;
  cancelConvoy: () => void;
  clear: () => void;
  persist: () => void;
  selectedDestination: (name: string) => { location: ReturnLocation } | null;
  monsterDestination: (type: string) => ReturnLocation | null | undefined;
  missionDestination: (hunt: HuntCycle) => ReturnLocation | null | undefined;
  start: (location: ReturnLocation, label: string, names: string[], purpose?: string) => boolean;
  navigation: {
    authorize: (names: string[], location: ReturnLocation, force: boolean) => void;
    intent: (name: string) => { cancelled?: boolean; revision?: number };
  };
  ownsTravel: (hunt: HuntCycle) => boolean;
  recordDeaths: (hunt: HuntCycle) => string[];
  contains: (
    location: ReturnLocation,
    status: HuntStatus,
    margin: number,
    radius: number,
  ) => boolean;
  arrivalProtected: (
    hunt: HuntCycle,
    status: HuntStatus,
    location: ReturnLocation | null | undefined,
  ) => boolean;
  partyFighting: (hunt: HuntCycle) => boolean;
}

/** Connect quest selection, convoy travel and recovery around the same live Hunt state. */
export function createCoordinatorHunt(state: CoordinatorHuntState, ports: HuntCompositionPorts) {
  const nextCommand = () => state.nextCommandId++;
  const authorize = (names: string[], location: ReturnLocation, force: boolean) =>
    ports.navigation.authorize(names, location, force);
  const intent = (name: string) => ports.navigation.intent(name);
  // These callbacks run after construction; each service calls the current companion directly.
  const lifecycle = createHuntLifecycle(state, {
    now: ports.now,
    nextCommand,
    participants: ports.participants,
    cancelConvoy: ports.cancelHuntConvoy,
    clear: ports.clear,
    prepare: (hunt) => quests.prepare(hunt),
    persist: ports.persist,
    selectedDestination: ports.selectedDestination,
    authorize,
    start: ports.start,
  });
  const convoy = createHuntConvoy(state, {
    fighting: ports.fighting,
    now: ports.now,
    intent,
    processDaisy: (hunt) => quests.process(hunt),
    authorize,
    start: ports.start,
  });
  const quests = createHuntQuests(state, {
    now: ports.now,
    nextCommand,
    fresh: (hunt) => lifecycle.fresh(hunt),
    endBlacklisted: (hunt) => lifecycle.endBlacklisted(hunt),
    start: (hunt, location, label, stage) => convoy.start(hunt, location, label, stage),
    missionDestination: ports.missionDestination,
    monsterDestination: ports.monsterDestination,
    cancelConvoy: ports.cancelHuntConvoy,
    persist: ports.persist,
    clear: ports.clear,
    selectedDestination: ports.selectedDestination,
    startNormal: ports.start,
  });
  const tick = createHuntTick(state, {
    backupDestination: lifecycle.backupDestination,
    now: ports.now,
    rareEncounter: ports.rareEncounter,
    begin: () => lifecycle.begin(),
    intent,
    finishFailed: (hunt) => lifecycle.finishFailed(hunt),
    ownsTravel: ports.ownsTravel,
    cancelHuntConvoy: ports.cancelHuntConvoy,
    cancelConvoy: ports.cancelConvoy,
    prepare: (hunt) => quests.prepare(hunt),
    persist: ports.persist,
    fresh: (hunt) => lifecycle.fresh(hunt),
    start: (hunt, location, label, stage) => convoy.start(hunt, location, label, stage),
    recordDeaths: ports.recordDeaths,
    buildMissions: (hunt) => quests.build(hunt),
    advance: (hunt) => quests.advance(hunt),
    participants: ports.participants,
    returnToDaisy: (hunt) => quests.returnToDaisy(hunt),
    destination: ports.missionDestination,
    processDaisy: (hunt) => quests.process(hunt),
    contains: ports.contains,
    arrivalProtected: ports.arrivalProtected,
    partyFighting: ports.partyFighting,
  });
  return { lifecycle, convoy, quests, tick };
}
