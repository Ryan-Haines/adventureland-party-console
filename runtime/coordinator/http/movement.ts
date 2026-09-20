import { requestObject, type HttpRouter } from './contracts.ts';
import { isPoint, type PlanRequest } from '../../navigation/contracts.ts';
import type { createPlannerService } from '../navigation/planner-service.ts';
function validOptions(b: Record<string, unknown>): boolean {
  return typeof b.id === 'string' && b.id.length <= 200 && typeof b.fingerprint === 'string' && b.fingerprint.length <= 100 &&
    typeof b.town === 'boolean' && Number.isFinite(b.speed) && Number(b.speed) > 0 && Number.isInteger(b.version);
}
export function installMovementRoutes(router: HttpRouter, planner: ReturnType<typeof createPlannerService>, owned: (name: string) => unknown) {
  router.post('/party-api/movement-plan', async (req, res) => {
    const b = requestObject(req.body);
    if (!owned(String(b.character)) || !isPoint(b.from) || !isPoint(b.to)) return res.status(400).json({ error: 'Invalid movement request' });
    if (!validOptions(b) || (b.avoidLeave !== undefined && typeof b.avoidLeave !== "boolean"))
      return res.status(400).json({ error: 'Invalid movement identity or options' });
    try { return res.json({ ...(await planner.plan(b as unknown as PlanRequest)), mode: planner.mode }); }
    catch (error) { return res.status(503).json({ error: String(error) }); }
  });
}
