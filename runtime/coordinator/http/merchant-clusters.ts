import { requestObject, type HttpRequest, type HttpResponse } from "./contracts.ts";
import {
  createMerchantClusters,
  type ClusterState,
  type ClusterPorts,
} from "../merchant/clusters.ts";

export function createMerchantClusterRoutes(state: ClusterState, ports: ClusterPorts) {
  const clusters = createMerchantClusters(state, ports);
  function leader(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      job = state.merchantCurrent;
    if (!job || body.jobId !== job.id || !job.expandLeaderCluster)
      return res.status(409).json({ error: "leader cluster job is no longer current" });
    if (job.clusterExpanded) return res.json({ ok: true, queued: job.clusterMembers || [] });
    const anchor = state.statuses[String(job.target)],
      radius = Number(job.radius) || 200;
    if (!anchor || anchor.seenAt < ports.now() - 10000)
      return res.status(409).json({ error: "party leader stopped reporting online" });
    return res.json({
      ok: true,
      leader: job.target,
      radius,
      queued: clusters.leader(job, anchor, radius),
    });
  }
  function marked(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      job = state.merchantCurrent;
    if (!job || body.jobId !== job.id || job.reason !== "marked items")
      return res.status(409).json({ error: "marked-items job is no longer current" });
    if (job.clusterExpanded) return res.json({ ok: true, queued: job.clusterMembers || [] });
    const anchor = state.statuses[String(job.target)];
    if (!anchor) return res.status(409).json({ error: "collection target stopped reporting" });
    return res.json({ ok: true, queued: clusters.marked(job, anchor) });
  }
  function luck(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      job = state.merchantCurrent;
    if (!job || body.jobId !== job.id || job.reason !== "merchant luck")
      return res.status(409).json({ error: "merchant luck job is no longer current" });
    const radius = Number(job.radius) || 200;
    if (job.clusterExpanded)
      return res.json({
        ok: true,
        center: job.target,
        radius,
        recipients: job.clusterMembers || [],
      });
    const center = state.statuses[String(job.target)];
    if (!center || center.seenAt < ports.now() - 10000)
      return res.status(409).json({ error: "luck target stopped reporting online" });
    return res.json({
      ok: true,
      center: job.target,
      radius,
      recipients: clusters.luck(job, center, radius),
    });
  }
  return { leader, marked, luck };
}
