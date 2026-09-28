import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const bundled = await build({ entryPoints: ["scripts/live-holded-smoke.ts"], bundle: true, platform: "node", format: "esm", packages: "external", write: false });
const run = spawnSync("docker", ["compose", "exec", "-T", "api", "node", "--input-type=module"], { input: bundled.outputFiles[0].text, stdio: ["pipe", "inherit", "inherit"] });
if (run.error) throw run.error;
if (run.status !== 0) process.exit(run.status ?? 1);
mkdirSync("test-results", { recursive: true });
const copy = spawnSync("docker", ["compose", "cp", "api:/tmp/holded-live-estimate.pdf", "test-results/holded-live-estimate.pdf"], { stdio: "inherit" });
if (copy.error) throw copy.error;
process.exit(copy.status ?? 1);
