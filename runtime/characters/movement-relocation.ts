import { distance, point, type GameData, type Point } from "../navigation/contracts.ts";
export interface Relocation {
  method: "town" | "door";
  origin: Point;
  destination: Point;
}
/** Only catalogued ordinary exits are candidates; the resulting route still needs full validation. */
export function movementRelocation(
  game: GameData,
  origin: Point,
  townAllowed: boolean,
): Relocation | undefined {
  const map = game.maps[origin.map];
  if (!map || restrictedMap(map, origin)) return;
  const spawn = map.spawns[0];
  if (townAllowed && spawn && distance(origin, { map: origin.map, x: spawn[0], y: spawn[1] }) > 55)
    return {
      method: "town",
      origin: point(origin),
      destination: { map: origin.map, x: spawn[0], y: spawn[1] },
    };
  const doors = (map.doors || [])
    .filter((d) => ordinaryDoor(game, d))
    .sort(
      (a, b) =>
        Math.hypot(Number(a[0]) - origin.x, Number(a[1]) - origin.y) -
        Math.hypot(Number(b[0]) - origin.x, Number(b[1]) - origin.y),
    );
  const door = doors[0];
  if (!door) return;
  const target = game.maps[String(door[4])].spawns[Number(door[5])];
  return {
    method: "door",
    origin: point(origin),
    destination: { map: String(door[4]), x: target[0], y: target[1] },
  };
}
function ordinaryDoor(game: GameData, door: unknown[]): boolean {
  const map = game.maps[String(door[4])],
    spawn = map?.spawns[Number(door[5])];
  return (
    !!map &&
    !map.instance &&
    !map.event &&
    !!spawn &&
    door[7] !== "key" &&
    door[8] !== "complicated" &&
    spawn.every(Number.isFinite)
  );
}

function restrictedMap(map: GameData["maps"][string], origin: Point): boolean {
  return !!map.instance || !!map.event || String(origin.in ?? origin.map) !== origin.map;
}
