import { stepIssue, type ValidationPorts } from "./validation.ts";
import { distance, isTransition, type Point, type Step } from "./contracts.ts";

function approaches(ports: ValidationPorts, from: Point, to: Step): Point[] {
  const doors = (ports.game.maps[from.map]?.doors || [])
    .filter((d) => d[4] === to.map && Number(d[5] || 0) === to.s)
    .flatMap((d) => {
      const x = Number(d[0]),
        y = Number(d[1]),
        w = Number(d[2]),
        h = Number(d[3]);
      const spawn = ports.game.maps[from.map].spawns[Number(d[6])];
      return [
        [x, y],
        [x - w / 2, y],
        [x + w / 2, y],
        [x, y - h],
        [x - w / 2, y - h],
        [x + w / 2, y - h],
        ...(spawn ? [spawn] : []),
      ].map((p) => ({ map: from.map, x: p[0], y: p[1] }));
    });
  return doors.concat(transporterPoints(ports, from, to));
}
function transporterPoints(ports: ValidationPorts, from: Point, to: Step): Point[] {
  if (ports.game.npcs.transporter?.places[to.map] !== to.s) return [];
  const npc = ports.game.maps[from.map]?.npcs?.find((n) => n.id === "transporter")?.position;
  if (!npc) return [];
  return [60, 40].flatMap((radius) =>
    Array.from({ length: 32 }, (_, i) => ({
      map: from.map,
      x: npc[0] + radius * Math.cos((i * Math.PI) / 16),
      y: npc[1] + radius * Math.sin((i * Math.PI) / 16),
    })),
  );
}
function connector(ports: ValidationPorts, from: Point, to: Step): Point | undefined {
  return approaches(ports, from, to)
    .sort((a, b) => distance(from, a) - distance(from, b))
    .find((p) => ports.walk(from, p) && !stepIssue(ports, p, to, true));
}
/** Repair only direct, native-validated connectors; inaccessible doors retain fallback. */
export function repairDoorApproaches(ports: ValidationPorts, from: Point, plot: Step[]): Step[] {
  const result: Step[] = [];
  let previous = from;
  for (const [index, step] of plot.entries()) {
    const next = plot[index + 1];
    if (!isTransition(step) && next?.transport && !ports.walk(previous, step)) {
      const repaired = connector(ports, previous, next);
      if (repaired) {
        result.push(repaired);
        previous = repaired;
        continue;
      }
    }
    if (
      step.transport &&
      stepIssue(ports, previous, step, true) === "door/transporter approach or access invalid"
    ) {
      const repaired = connector(ports, previous, step);
      if (repaired) result.push(repaired);
    }
    result.push(step);
    previous = step;
  }
  return result;
}
