import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const sourceRoot = path.join(projectRoot, "tools", "impeccable-audit-report");
const tempRoot = path.join(os.tmpdir(), "tech-stack-dashboard-impeccable-audit");

fs.mkdirSync(tempRoot, { recursive: true });

copyFile("index.html");
copyFile("report.css");
copyFile("app.js");
copyProjectGlobals();
writeServerTemplate();

const child = spawn(process.execPath, ["server.mjs"], {
  cwd: tempRoot,
  detached: false,
  stdio: "inherit",
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});

function copyFile(fileName) {
  fs.copyFileSync(path.join(sourceRoot, fileName), path.join(tempRoot, fileName));
}

function copyProjectGlobals() {
  const globalsSource = path.join(projectRoot, "app", "globals.css");
  fs.copyFileSync(globalsSource, path.join(tempRoot, "project-globals.css"));
}

function writeServerTemplate() {
  const template = fs.readFileSync(path.join(sourceRoot, "server-template.mjs"), "utf8");
  const hydrated = template.replace("__PROJECT_ROOT__", slashPath(projectRoot));
  fs.writeFileSync(path.join(tempRoot, "server.mjs"), hydrated, "utf8");
}

function slashPath(input) {
  return input.replaceAll("\\", "\\\\");
}
