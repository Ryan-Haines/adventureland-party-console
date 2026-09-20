const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const csvValue = (value) => '"' + String(value ?? "").replaceAll('"', '""') + '"';
function median(values) {
  if (!values.length) return null;
  const a = [...values].sort((x, y) => x - y),
    middle = Math.floor(a.length / 2);
  return a.length % 2 ? a[middle] : (a[middle - 1] + a[middle]) / 2;
}
function quantile(values, p) {
  if (!values.length) return null;
  const a = [...values].sort((x, y) => x - y);
  return a[Math.max(0, Math.ceil(a.length * p) - 1)];
}
function summarize(rows) {
  const times = rows.map((r) => r.ms);
  return {
    count: rows.length,
    valid: rows.filter((r) => r.quality.valid && !r.error).length,
    errors: rows.filter((r) => r.error).length,
    timeouts: rows.filter((r) => r.error === "timeout").length,
    collisions: rows.filter((r) => r.quality.collisions).length,
    transitions: rows.filter((r) => r.quality.invalidTransitions).length,
    unverified: rows.filter((r) => r.quality.unverified).length,
    medianMs: median(times),
    p95Ms: quantile(times, 0.95),
    maxMs: Math.max(...times),
  };
}
function paired(rows, baseline = "native-visible") {
  const ratios = [];
  for (const a of rows.filter((r) => r.engine === "alclient" && r.quality.valid && !r.error)) {
    const n = rows.find(
      (r) =>
        r.engine === baseline &&
        r.route === a.route &&
        r.pass === a.pass &&
        r.quality.valid &&
        !r.error,
    );
    if (n && a.ms > 0)
      ratios.push({
        route: a.route,
        ratio: n.ms / a.ms,
        saved: n.ms - a.ms,
        distance: n.quality.distance - a.quality.distance,
      });
  }
  // Resample route clusters, not repeated timings as if they were independent routes.
  const groups = [...new Set(ratios.map((r) => r.route))].map((route) =>
    ratios.filter((r) => r.route === route),
  );
  if (!groups.length) return { pairs: 0 };
  const geometric = (a) => Math.exp(a.reduce((s, x) => s + Math.log(x.ratio), 0) / a.length);
  const routeRatios = groups.map((group) => ({ ratio: geometric(group) }));
  let seed = 9182;
  const boot = Array.from({ length: 2000 }, () =>
    geometric(
      routeRatios.map(
        () =>
          routeRatios[
            (((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296) *
              routeRatios.length) |
              0
          ],
      ),
    ),
  );
  return {
    pairs: ratios.length,
    routes: groups.length,
    speedup: geometric(routeRatios),
    ci95: [quantile(boot, 0.025), quantile(boot, 0.975)],
    medianSavedMs: median(ratios.map((x) => x.saved)),
    medianDistanceSaved: median(ratios.map((x) => x.distance)),
  };
}
const fmt = (x) => (x === null || x === undefined ? "—" : Number(x).toFixed(2));
function report(data, output, name = "report") {
  const { metadata, cold, results } = data,
    engines = ["native-visible", "native-hidden", "alclient"];
  const summaries = Object.fromEntries(
    engines.map((e) => [e, summarize(results.filter((r) => r.engine === e))]),
  );
  const comparisons = Object.fromEntries(
    ["native-visible", "native-hidden"].map((e) => [e, paired(results, e)]),
  );
  const lines = [
    `# Offline ALClient pathfinder comparison`,
    "",
    `Game **${metadata.version}** · [ALClient ${metadata.provenance.revision}](https://github.com/earthiverse/ALClient/blob/${metadata.provenance.revision}/source/Pathfinder.ts) · alpathfinder **0.6.0**`,
    "",
    `${metadata.routes.length} routes; ${metadata.bounded ? "30 measured passes plus 5 warm-ups for pilot queries below 2 seconds; 3 measured passes for slower routes/timeouts, with no additional warm-ups" : `${metadata.passes} measured passes and ${metadata.warmups} warm-up passes per engine`}; ${metadata.coldRuns} isolated-process cold starts per engine. Seed 42. ${metadata.node}; ${metadata.cpu}.`,
    "",
    "[Raw measurements and provenance](results.json) · [CSV](report.csv) · [Reproduction instructions](../../../tools/game/pathfinder-benchmark/README.md)",
    "",
    "## Planning latency and validity",
    "",
    "| Engine | Valid / total | Median ms | p95 ms | Worst ms | Errors | Collision failures | Transition failures | Access unverified |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
  ];
  for (const e of engines) {
    const s = summaries[e];
    lines.push(
      `| ${e} | ${s.valid}/${s.count} | ${fmt(s.medianMs)} | ${fmt(s.p95Ms)} | ${fmt(s.maxMs)} | ${s.errors} | ${s.collisions} | ${s.transitions} | ${s.unverified} |`,
    );
  }
  const regular = results.filter((r) => !["failure", "access"].includes(r.category));
  lines.push("", "Ordinary-route compatibility (deliberate failure/access probes excluded):");
  for (const e of engines) {
    const s = summarize(regular.filter((r) => r.engine === e));
    lines.push(
      `- ${e}: ${s.valid}/${s.count} attempts fully validated (${fmt((100 * s.valid) / s.count)}%).`,
    );
  }
  lines.push(
    "",
    summaries.alclient.collisions
      ? "**Recommendation:** planning speed warrants further work, but do not replace live smart_move with unchecked ALClient routes. Resolve native collision mismatches first, verify transport reach, and retain a native fallback before controlled live trials."
      : "**Recommendation:** evaluate the measured planning benefit alongside transition/access failures before any controlled live trial. Offline success is not proof of executor reliability.",
  );
  lines.push(
    "",
    "All attempts, including failures, are included above; errors do not count as fast successful routes. Categories include deliberate failure and access probes.",
    "The chosen route mix and repetition counts are not production traffic frequencies. Validity percentages describe these fixtures, not estimated live reliability.",
    "Medians average the two middle observations when necessary; p95 uses the nearest-rank definition. Three-sample slow-route estimates are descriptive, not precise tail-latency estimates.",
    "",
    "## Mutually valid routes",
    "",
  );
  appendComparisons(lines, comparisons);
  lines.push(
    "",
    "Aggregate speedups give each mutually valid route equal weight; the bootstrap resamples routes rather than treating repeated timings as independent routes.",
    "",
    "## Cold preparation and memory",
    "",
    "| Engine | Game/adapter load ms | Planner preparation ms | Preparation RSS MiB | Total load RSS MiB |",
    "|---|---:|---:|---:|---:|",
  );
  for (const e of engines) {
    const c = cold.filter((c) => c.engine === e);
    lines.push(
      `| ${e} | ${fmt(median(c.map((c) => c.nativeLoadMs)))} | ${fmt(median(c.map((c) => c.preparationMs)))} | ${fmt(median(c.map((c) => c.preparationRssBytes)) / 1048576)} | ${fmt(median(c.map((c) => c.totalRssBytes)) / 1048576)} |`,
    );
  }
  const prep = median(cold.filter((c) => c.engine === "alclient").map((c) => c.preparationMs));
  const saved = comparisons["native-visible"].medianSavedMs;
  lines.push(
    "",
    `Preparation amortization: ${saved > 0 ? Math.ceil(prep / saved) + " mutually valid queries at the observed median saving" : "not established"}. RSS is process-level and includes allocator/JIT effects; raw cold runs are retained. ALClient import/WASM loading is included in preparation.`,
    "",
    "## Per-route results",
    "",
    "| Route | Category | Native visible ms | Native hidden ms | ALClient ms | Native valid | ALClient valid | Native walk units | ALClient walk units |",
    "|---|---|---:|---:|---:|---:|---:|---:|---:|",
  );
  appendRoutes(lines, metadata, results);
  if (metadata.standCorrection)
    lines.push(
      "",
      "The three stand fixtures were remeasured using the configured stand at main (-63, 100). Their earlier town-spawn measurements are excluded; the correction and source datasets are recorded in results.json.",
    );
  lines.push(
    "",
    "## Interpretation and limits",
    "",
    "- This is route planning, not measured arrival time. Walking estimates in CSV divide validated distance by 60 units/second; transporter delays, combat, server latency, and retries are excluded.",
    "- Native visible/hidden slices preserve the game’s 40/500 ms budgets but run back-to-back. Scheduler waiting is not simulated. Slice counts and longest slices are recorded separately.",
    "- Both engines run under Node on this machine. Visible/hidden refers to native search budgets, not a measured browser/Steam session. Native functions run in a VM, as in headless execution; these ratios must not be assumed identical in a browser. Existing game services remained running during the benchmark.",
    "- Native smoothing/search and collision/door checks come from the installed game files. ALClient uses its unmodified pinned source and default WASM collision model; its accepted `base` option is not forwarded to WASM. The native validator applies h=8,v=7,vn=2 independently.",
    "- ALClient implements avoidTownWarps by passing speed=100000. Native use_town is disabled for the same fixtures. Any returned forbidden town warp is rejected, and transport route selection can still differ.",
    "- Transport checks use the native planner’s 75-unit transporter approach. This tests compatibility with our current movement contract, not a claim that every rejected approach would be rejected by the server.",
    "- Restricted doors and instances require live session access; returned routes are marked unverified, not successful. A blocked target may expose native smart_move’s unchecked final exact-position segment.",
    "- No movement executor was loaded or replaced. No login, network requests, live movement, or deployment occurs in this harness.",
    "- Migration would still need an executor adapter preserving cancellation, instance identity, convoy ownership, replanning, combat/loot gates, and native collision validation. Treat this report as evidence for a later controlled trial, not proof of live reliability.",
    "- The tested package uses a Node filesystem loader for its WASM binary. Browser/Steam adoption needs a compatible loader or coordinator-side planning; this benchmark does not implement either integration.",
    "",
    "## Route plots",
    "",
    "See [route-plots.svg](route-plots.svg). Native routes are blue; ALClient routes are orange. Disconnected segments indicate map transitions, not walking.",
  );
  appendCollisions(lines, metadata, results);
  const categorySummary = appendCategories(lines, metadata, results, engines);
  fs.writeFileSync(path.join(output, `${name}.md`), lines.join("\n") + "\n");
  fs.writeFileSync(
    path.join(output, `${name}-summary.json`),
    JSON.stringify(
      {
        summaries,
        comparisons,
        categorySummary,
        rendererSha256: crypto
          .createHash("sha256")
          .update(fs.readFileSync(__filename))
          .digest("hex"),
      },
      null,
      2,
    ),
  );
  const columns = [
    "engine",
    "route",
    "category",
    "pass",
    "ms",
    "error",
    "slices",
    "maxSliceMs",
    "nodeCount",
    "valid",
    "distance",
    "estimatedWalkingSeconds",
    "endpointError",
    "collisions",
    "invalidTransitions",
    "unverified",
    "methods",
  ];
  const csv = results.map((r) => {
    const row = {
      ...r,
      ...r.quality,
      nodeCount: r.path.length,
      estimatedWalkingSeconds: r.quality.valid ? r.quality.distance / 60 : null,
      methods: JSON.stringify(r.quality.methods),
    };
    return columns.map((k) => csvValue(row[k])).join(",");
  });
  fs.writeFileSync(path.join(output, `${name}.csv`), [columns.join(","), ...csv].join("\n"));
  plot(data, output);
  console.log(JSON.stringify({ summaries, comparisons }, null, 2));
}
function plot({ metadata, results }, output) {
  const { createNative } = require("./native.cjs");
  const native = createNative(
    path.resolve(__dirname, "../../../.caracal/game_files", metadata.version),
  );
  const routes = metadata.routes.filter((r) =>
    [
      "stand-bank",
      "scrolls-upgrade",
      "upgrade-craftsman",
      "configured-party-farm",
      "main-halloween",
      "cave-bridge",
      "fence-detour",
    ].includes(r.id),
  );
  const panels = [];
  let index = 0;
  for (const route of routes) {
    const samples = ["native-visible", "alclient"].map((e) =>
      results.find((r) => r.route === route.id && r.engine === e && r.path.length),
    );
    for (const map of new Set(samples.flatMap((s) => s?.path.map((p) => p.map) || []))) {
      const points = samples.flatMap((s) => s?.path.filter((p) => p.map === map) || []);
      if (!points.length) continue;
      const minX = Math.min(...points.map((p) => p.x)) - 30,
        maxX = Math.max(...points.map((p) => p.x)) + 30,
        minY = Math.min(...points.map((p) => p.y)) - 30,
        maxY = Math.max(...points.map((p) => p.y)) + 30;
      const scale = Math.min(450 / (maxX - minX), 230 / (maxY - minY));
      const x = (p) => (p.x - minX) * scale + 15,
        y = (p) => (p.y - minY) * scale + 40;
      const shapes = samples.flatMap((s, i) => {
        let prior;
        const lines = [];
        for (const p of s?.path || []) {
          if (p.map === map && prior?.map === map && p.method === "move")
            lines.push(
              `<line x1="${x(prior)}" y1="${y(prior)}" x2="${x(p)}" y2="${y(p)}" stroke="${i ? "#d55e00" : "#0072b2"}" stroke-width="2" opacity="0.8"/>`,
            );
          prior = p;
        }
        return lines;
      });
      const geometry = native.game.geometry[map];
      const walls = [
        ...(geometry?.x_lines || [])
          .filter((l) => l[0] >= minX && l[0] <= maxX && l[2] >= minY && l[1] <= maxY)
          .map((l) => [
            { x: l[0], y: Math.max(minY, l[1]) },
            { x: l[0], y: Math.min(maxY, l[2]) },
          ]),
        ...(geometry?.y_lines || [])
          .filter((l) => l[0] >= minY && l[0] <= maxY && l[2] >= minX && l[1] <= maxX)
          .map((l) => [
            { x: Math.max(minX, l[1]), y: l[0] },
            { x: Math.min(maxX, l[2]), y: l[0] },
          ]),
      ].map(
        ([a, b]) =>
          `<line x1="${x(a)}" y1="${y(a)}" x2="${x(b)}" y2="${y(b)}" stroke="#aaa" stroke-width="1"/>`,
      );
      panels.push(
        `<g transform="translate(${(index % 2) * 500},${60 + Math.floor(index / 2) * 300})"><rect width="495" height="295" fill="white" stroke="#bbb"/><text x="12" y="20" font-size="13">${route.id} · ${map}</text>${walls.join("")}${shapes.join("")}${shapes.length ? "" : '<text x="15" y="60" font-size="12" fill="#666">Transition point; no walking segment</text>'}</g>`,
      );
      index++;
    }
  }
  fs.writeFileSync(
    path.join(output, "route-plots.svg"),
    `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="${60 + Math.ceil(index / 2) * 300}" font-family="sans-serif"><rect width="100%" height="100%" fill="white"/><text x="12" y="23" font-size="18">Native and ALClient planned routes · game ${metadata.version}</text><text x="12" y="44" font-size="13"><tspan fill="#0072b2">Blue: native</tspan><tspan dx="25" fill="#d55e00">Orange: ALClient</tspan><tspan dx="25" fill="#777">Gray: collision geometry · map transitions are not connected</tspan></text>${panels.join("")}</svg>`,
  );
}
if (require.main === module) {
  const input = path.resolve(process.argv[2]);
  report(JSON.parse(fs.readFileSync(input, "utf8")), path.dirname(input));
}
module.exports = { report, median, quantile, paired, summarize, csvValue };

function appendRoutes(lines, metadata, results) {
  for (const route of metadata.routes) {
    const r = results.filter((r) => r.route === route.id);
    const a = r.filter((r) => r.engine === "alclient"),
      n = r.filter((r) => r.engine === "native-visible");
    lines.push(
      `| ${route.id} | ${route.category} | ${fmt(median(n.map((r) => r.ms)))} | ${fmt(median(r.filter((r) => r.engine === "native-hidden").map((r) => r.ms)))} | ${fmt(median(a.map((r) => r.ms)))} | ${n.filter((r) => r.quality.valid).length}/${n.length} | ${a.filter((r) => r.quality.valid).length}/${a.length} | ${fmt(median(n.filter((r) => r.quality.valid).map((r) => r.quality.distance)))} | ${fmt(median(a.filter((r) => r.quality.valid).map((r) => r.quality.distance)))} |`,
    );
  }
}
function appendCollisions(lines, metadata, results) {
  lines.push("", "## Collision examples", "");
  const failures = metadata.routes
    .map((route) =>
      results.find((r) => r.route === route.id && r.engine === "alclient" && r.quality.collisions),
    )
    .filter(Boolean);
  for (const r of failures) {
    const issue = r.quality.issues.find((i) => i.reason === "collision");
    lines.push(
      `- ${r.route}: ${issue.from.map} (${issue.from.x}, ${issue.from.y}) → (${issue.to.x}, ${issue.to.y}) fails the native character collision check.`,
    );
  }
}
function appendCategories(lines, metadata, results, engines) {
  const categorySummary = {};
  for (const category of new Set(metadata.routes.map((r) => r.category)))
    categorySummary[category] = Object.fromEntries(
      engines.map((e) => [
        e,
        summarize(results.filter((r) => r.category === category && r.engine === e)),
      ]),
    );
  lines.push(
    "",
    "## Category breakdown",
    "",
    "| Category | Engine | Valid / attempts | Median ms | p95 ms |",
    "|---|---|---:|---:|---:|",
  );
  for (const [category, engines] of Object.entries(categorySummary))
    for (const [engine, s] of Object.entries(engines))
      lines.push(
        `| ${category} | ${engine} | ${s.valid}/${s.count} | ${fmt(s.medianMs)} | ${fmt(s.p95Ms)} |`,
      );
  return categorySummary;
}
function appendComparisons(lines, comparisons) {
  for (const [e, p] of Object.entries(comparisons)) {
    if (!p.pairs) {
      lines.push(`- Versus ${e}: no mutually validated pairs; no speedup is reported.`);
      continue;
    }
    lines.push(
      `- Versus ${e}: ${p.pairs} pairs across ${p.routes || 0} routes; geometric mean speedup **${fmt(p.speedup)}×**, or ${fmt(100 * (1 - 1 / p.speedup))}% less planning time (route-cluster bootstrap 95% interval ${fmt(p.ci95?.[0])}–${fmt(p.ci95?.[1])}×). Median planning time saved ${fmt(p.medianSavedMs)} ms; median walking distance saved ${fmt(p.medianDistanceSaved)} units.`,
    );
  }
}
