import { createServer } from "node:http";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, relative, sep } from "node:path";
const evidenceRoot = fileURLToPath(
  new URL("../evidence/directus/", import.meta.url)
);
async function collectReports(directory = evidenceRoot) {
  const reports = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      reports.push(...await collectReports(path));
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      const document = JSON.parse(await readFile(path, "utf8"));
      if (document.kind === "directus-repeat-summary") continue;
      if (
        document.application?.name !== "directus" ||
        !["PASS", "FAIL", "INCONCLUSIVE"].includes(document.report?.verdict) ||
        !Array.isArray(document.report.results) ||
        !Array.isArray(document.report.samples)
      ) {
        throw new Error("INVALID_EVIDENCE_REPORT");
      }
      reports.push({
        file: relative(evidenceRoot, path).split(sep).join("/"),
        createdAt: document.createdAt,
        version: document.application.version,
        report: document.report
      });
    }
  }
  return reports.sort((a, b) =>
    String(b.createdAt).localeCompare(String(a.createdAt))
  );
}
const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>REVOKX — Evidence dashboard</title>
<style>
:root{color-scheme:dark;font-family:system-ui,sans-serif;background:#0b1019;color:#e9eef8}
*{box-sizing:border-box}
body{margin:0}
header,main{max-width:1200px;margin:auto;padding:28px}
header{border-bottom:1px solid #263247}
.brand{color:#9aafff;font-weight:800;letter-spacing:4px}
h1{font-size:32px;margin:12px 0}
h2{font-size:20px}
p{color:#aebbd0;line-height:1.6}
.toolbar{display:flex;gap:12px;flex-wrap:wrap;align-items:center}
button,select{background:#172238;color:#e9eef8;border:1px solid #40516d;border-radius:8px;padding:11px;font:inherit}
button{cursor:pointer}
button:hover{border-color:#a7b7ff}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin:24px 0}
.card,.panel{background:#111b2b;border:1px solid #263247;border-radius:12px;padding:20px}
.card strong{font-size:24px;display:block;margin-bottom:10px}
.layout{display:grid;grid-template-columns:340px 1fr;gap:20px}
#runs{display:flex;flex-direction:column;gap:10px;max-height:760px;overflow:auto}
.run{text-align:left;overflow-wrap:anywhere}
.run[aria-pressed="true"]{border-color:#a7b7ff;background:#243252}
.badge{display:inline-block;padding:5px 10px;border-radius:6px;font-weight:bold}
.PASS{background:#103c32;color:#8ff0c4}
.FAIL{background:#4b242e;color:#ffacb8}
.INCONCLUSIVE{background:#483c1a;color:#ffe192}
.scroll{overflow:auto}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{text-align:left;padding:11px 8px;border-bottom:1px solid #28364b;white-space:nowrap}
th{color:#aebbd0}
#message{color:#ffe192}
.small{font-size:13px}
@media(max-width:800px){.layout{grid-template-columns:1fr}header,main{padding:18px}#runs{max-height:300px}}
</style>
</head>
<body>
<header>
<div class="brand">REVOKX</div>
<h1>Access revocation evidence</h1>
<p>Recorded Directus experiments. Select a run to inspect its outcome and sampled observations.</p>
</header>
<main>
<div class="toolbar">
<label for="scope">Evidence set</label>
<select id="scope">
<option value="repeats">Sequential repeat runs</option>
<option value="all">All saved Directus runs</option>
</select>
<button id="refresh">Reload evidence</button>
</div>
<p id="message" role="status"></p>
<div id="cards" class="cards"></div>
<div class="layout">
<section class="panel"><h2>Recorded runs</h2><div id="runs"></div></section>
<section class="panel" id="detail"><p>Select a run.</p></section>
</div>
<p class="small">PASS applies to the sampled access paths and configured observation window. Request timings do not establish exact revocation latency. This dashboard reads saved evidence; it does not run experiments.</p>
</main>
<script src="/app.js" defer></script>
</body>
</html>`;
const script = `
const $ = (id) => document.getElementById(id);
let reports = [];
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}
function table(headers, rows) {
  const wrapper = element("div", undefined, "scroll");
  const grid = element("table");
  const head = element("thead");
  const header = element("tr");
  headers.forEach((value) => header.append(element("th", value)));
  head.append(header);
  const body = element("tbody");
  rows.forEach((values) => {
    const row = element("tr");
    values.forEach((value) => row.append(element("td", value)));
    body.append(row);
  });
  grid.append(head, body);
  wrapper.append(grid);
  return wrapper;
}
function verified(value) {
  return value === true ? "Verified" : "Not verified";
}
function milliseconds(value) {
  return Number.isFinite(value) ? value.toFixed(1) : "—";
}
function showReport(item) {
  const report = item.report;
  const detail = $("detail");
  detail.replaceChildren();
  detail.append(
    element("span", report.verdict, "badge " + report.verdict),
    element("h2", "Directus " + item.version),
    element("p", item.file, "small"),
    element("p", "Recorded: " + item.createdAt),
    element("p", "Reason: " + report.reason)
  );
  detail.append(table(["Check", "Result"], [
    ["Baseline", verified(report.baselineVerified)],
    ["Suspension", verified(report.suspensionVerified)],
    ["Target restoration", verified(report.cleanup?.restored)],
    ["Revocation window", report.timing?.revocationWindowMs + " ms"],
    ["Observation period", report.timing?.observationMs + " ms"],
    ["Timing reference", report.timingReference]
  ]));
  detail.append(element("h2", "Access paths"));
  detail.append(table(["Path", "Expected", "Eligible samples", "Verdict"],
    report.results.map((result) => [
      result.pathId, result.expected, result.eligibleSamples, result.verdict
    ])
  ));
  detail.append(element("h2", "Observation timeline"));
  detail.append(element("p", "Milliseconds relative to the validated suspension response.", "small"));
  detail.append(table(["Path", "Start ms", "End ms", "Observed"],
    report.samples.map((sample) => [
      sample.pathId,
      milliseconds(sample.startMs),
      milliseconds(sample.endMs),
      sample.outcome
    ])
  ));
}
function render() {
  const selected = reports.filter((item) =>
    $("scope").value === "all" || item.file.startsWith("repeats/")
  );
  $("cards").replaceChildren();
  $("runs").replaceChildren();
  $("detail").replaceChildren(element("p", "Select a run."));
  const versions = [...new Set(selected.map((item) => item.version))].sort();
  for (const version of versions) {
    const items = selected.filter((item) => item.version === version);
    const counts = { PASS: 0, FAIL: 0, INCONCLUSIVE: 0 };
    items.forEach((item) => counts[item.report.verdict]++);
    const card = element("section", undefined, "card");
    card.append(
      element("strong", "Directus " + version),
      element("p", items.length + " recorded runs"),
      element("p", counts.PASS + " PASS · " + counts.FAIL + " FAIL · " +
        counts.INCONCLUSIVE + " INCONCLUSIVE")
    );
    $("cards").append(card);
  }
  for (const item of selected) {
    const button = element("button", undefined, "run");
    button.setAttribute("aria-pressed", "false");
    button.append(
      element("span", item.report.verdict, "badge " + item.report.verdict),
      element("p", "Directus " + item.version),
      element("div", item.createdAt, "small")
    );
    button.addEventListener("click", () => {
      for (const other of $("runs").children) other.setAttribute("aria-pressed", "false");
      button.setAttribute("aria-pressed", "true");
      showReport(item);
    });
    $("runs").append(button);
  }
  $("message").textContent = selected.length + " saved runs loaded.";
  $("runs").firstElementChild?.click();
}
async function load() {
  $("refresh").disabled = true;
  $("message").textContent = "Loading evidence…";
  try {
    const response = await fetch("/api/reports", { cache: "no-store" });
    if (!response.ok) throw new Error("LOAD_FAILED");
    reports = await response.json();
    render();
  } catch {
    reports = [];
    $("cards").replaceChildren();
    $("runs").replaceChildren();
    $("detail").replaceChildren();
    $("message").textContent = "Could not load evidence. Check the dashboard terminal.";
  } finally {
    $("refresh").disabled = false;
  }
}
$("scope").addEventListener("change", render);
$("refresh").addEventListener("click", load);
load();
`;
const server = createServer(async (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"
  );
  function send(status, type, body) {
    response.writeHead(status, { "Content-Type": type });
    response.end(body);
  }
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return send(405, "text/plain; charset=utf-8", "Method not allowed");
  }
  try {
    if (request.url === "/") {
      return send(200, "text/html; charset=utf-8", page);
    }
    if (request.url === "/app.js") {
      return send(200, "text/javascript; charset=utf-8", script);
    }
    if (request.url === "/api/reports") {
      return send(200, "application/json; charset=utf-8",
        JSON.stringify(await collectReports()));
    }
    return send(404, "text/plain; charset=utf-8", "Not found");
  } catch {
    console.error("Evidence loading failed. Check evidence/directus JSON files.");
    return send(500, "application/json; charset=utf-8",
      JSON.stringify({ error: "EVIDENCE_LOAD_FAILED" }));
  }
});
server.listen(3001, "127.0.0.1", () => {
  console.log("REVOKX dashboard: http://127.0.0.1:3001");
});
server.on("error", (error) => {
  console.error("Dashboard could not start: " + error.message);
  process.exitCode = 1;
});