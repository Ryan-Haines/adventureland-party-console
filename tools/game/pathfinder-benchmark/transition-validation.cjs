function doorAt(native, previous, step) {
  const G = native.game;
  return G.maps[previous.map]?.doors?.find(
    (d) =>
      d[4] === step.map &&
      Math.hypot(
        step.x - G.maps[d[4]].spawns[d[5] || 0][0],
        step.y - G.maps[d[4]].spawns[d[5] || 0][1],
      ) < 1 &&
      native.context.is_door_close(previous.map, d, previous.x, previous.y) &&
      native.context.can_use_door(previous.map, d, previous.x, previous.y),
  );
}
function transporterAt(native, previous, step) {
  const G = native.game,
    spawn = G.maps[step.map]?.spawns[G.npcs.transporter.places[step.map]];
  const nearby = G.maps[previous.map]?.npcs?.some(
    (n) =>
      n.id === "transporter" &&
      n.position &&
      Math.hypot(previous.x - n.position[0], previous.y - n.position[1]) < 75,
  );
  return !!(nearby && spawn && Math.hypot(step.x - spawn[0], step.y - spawn[1]) < 1);
}
function walking(native, previous, step, result) {
  if (!native.canWalk(previous, step)) {
    result.collisions++;
    result.issues.push({ from: previous, to: step, reason: "collision" });
  }
  if (previous.map === step.map)
    result.distance += Math.hypot(step.x - previous.x, step.y - previous.y);
}
function town(native, route, previous, step, result) {
  const spawn = native.game.maps[previous.map]?.spawns[0];
  if (
    !route.town ||
    step.map !== previous.map ||
    !spawn ||
    Math.hypot(step.x - spawn[0], step.y - spawn[1]) > 1
  )
    result.invalidTransitions++;
}
function transport(native, previous, step, result) {
  const door = doorAt(native, previous, step);
  if (!door && !transporterAt(native, previous, step)) result.invalidTransitions++;
  if (door && (door[7] === "key" || door[8] === "complicated")) result.unverified = true;
}
function stepValidation(native, route, previous, step, result) {
  const method = step.method || "move",
    map = native.game.maps[step.map];
  result.methods[method] = (result.methods[method] || 0) + 1;
  if (map?.instance || map?.event) result.unverified = true;
  if (method === "move") walking(native, previous, step, result);
  else if (method === "town") town(native, route, previous, step, result);
  else if (["transport", "door", "enter"].includes(method))
    transport(native, previous, step, result);
  else {
    result.invalidTransitions++;
    result.issues.push({ from: previous, to: step, reason: "unsupported-transition" });
  }
}
module.exports = { stepValidation };
