const { stepValidation } = require("./transition-validation.cjs");
function validate(native, route, steps) {
  const result = {
    valid: false,
    distance: 0,
    collisions: 0,
    invalidTransitions: 0,
    unverified: false,
    endpointError: null,
    methods: {},
  };
  if (!steps.length) return result;
  result.issues = [];
  let previous = route.from;
  for (const step of steps) {
    stepValidation(native, route, previous, step, result);
    previous = step;
  }
  result.endpointError =
    previous.map === route.to.map
      ? Math.hypot(previous.x - route.to.x, previous.y - route.to.y)
      : null;
  result.valid =
    !result.collisions &&
    !result.invalidTransitions &&
    !result.unverified &&
    result.endpointError !== null &&
    result.endpointError <= 1;
  return result;
}
module.exports = { validate };
