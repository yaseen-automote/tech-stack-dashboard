import fs from "node:fs";
import path from "node:path";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

const tempRoot = path.resolve(process.cwd());
const projectRoot = "__PROJECT_ROOT__";
const dataModuleUrl = pathToFileURL(
  path.join(projectRoot, "tools", "impeccable-audit-report", "report-data.js"),
).href;

const {
  buildApplyPrompt,
  dismissFixes,
  getReportSummary,
  getVisibleIssues,
  loadHiddenFixes,
  restoreFixes,
} = await import(dataModuleUrl);

const STATIC_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host}`);

  if (requestUrl.pathname === "/api/health") {
    return sendJson(response, 200, { ok: true });
  }

  if (requestUrl.pathname === "/api/report" && request.method === "GET") {
    return sendJson(response, 200, buildReportPayload());
  }

  if (requestUrl.pathname === "/api/prompt" && request.method === "POST") {
    const body = await readJsonBody(request);
    return sendJson(response, 200, {
      prompt: buildApplyPrompt(Array.isArray(body.ids) ? body.ids : []),
    });
  }

  if (requestUrl.pathname === "/api/dismiss" && request.method === "POST") {
    const body = await readJsonBody(request);
    dismissFixes(projectRoot, Array.isArray(body.ids) ? body.ids : []);
    return sendJson(response, 200, buildReportPayload());
  }

  if (requestUrl.pathname === "/api/restore" && request.method === "POST") {
    const body = await readJsonBody(request);
    restoreFixes(projectRoot, Array.isArray(body.ids) ? body.ids : []);
    return sendJson(response, 200, buildReportPayload());
  }

  if (requestUrl.pathname === "/api/reset-hidden" && request.method === "POST") {
    const hidden = loadHiddenFixes(projectRoot);
    restoreFixes(projectRoot, hidden.dismissedIds);
    return sendJson(response, 200, buildReportPayload());
  }

  return serveStaticAsset(requestUrl.pathname, response);
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const url = `http://127.0.0.1:${port}`;
  const launchFile = path.join(tempRoot, "launch.json");
  fs.writeFileSync(
    launchFile,
    `${JSON.stringify({ url, tempRoot, projectRoot, startedAt: new Date().toISOString() }, null, 2)}\n`,
    "utf8",
  );

  process.stdout.write(`${url}\n`);
});

function buildReportPayload() {
  const report = getVisibleIssues(projectRoot);
  const summary = getReportSummary();
  const issues = sortIssues(report.issues);

  return {
    summary,
    issues,
    hiddenState: report.hiddenState,
    filters: {
      categories: uniqueValues(issues.map((entry) => entry.category)),
      areas: uniqueValues(issues.map((entry) => entry.area)),
      commands: uniqueValues(issues.map((entry) => entry.command)),
      efforts: uniqueValues(issues.map((entry) => entry.effort)),
    },
  };
}

function sortIssues(issues) {
  const severityOrder = { P0: 0, P1: 1, P2: 2, P3: 3 };

  return [...issues].sort((left, right) => {
    const severityDelta = severityOrder[left.severity] - severityOrder[right.severity];
    if (severityDelta !== 0) {
      return severityDelta;
    }

    return left.title.localeCompare(right.title);
  });
}

function uniqueValues(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

async function readJsonBody(request) {
  const buffers = [];
  for await (const chunk of request) {
    buffers.push(chunk);
  }

  if (buffers.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(buffers).toString("utf8"));
}

function serveStaticAsset(requestPath, response) {
  const normalizedPath = requestPath === "/" ? "/index.html" : requestPath;
  const filePath = path.join(tempRoot, normalizedPath.replace(/^\/+/, ""));

  if (!filePath.startsWith(tempRoot) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  const extension = path.extname(filePath);
  response.writeHead(200, {
    "Content-Type": STATIC_TYPES[extension] ?? "application/octet-stream",
  });
  fs.createReadStream(filePath).pipe(response);
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(`${JSON.stringify(payload)}\n`);
}
