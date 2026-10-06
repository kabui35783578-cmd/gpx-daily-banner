import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const tempDir = await mkdtemp(join(tmpdir(), "gpx-daily-banner-test-"));
const outfile = join(tempDir, "daily-data-parser.test.mjs");

try {
  await build({
    entryPoints: [fileURLToPath(new URL("../tests/daily-data-parser.test.ts", import.meta.url))],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    outfile,
    logLevel: "silent"
  });
  await import(`${pathToFileURL(outfile).href}?run=${Date.now()}`);
  const workflowOutfile = join(tempDir, "banner-workflow.test.mjs");
  await build({
    entryPoints: [fileURLToPath(new URL("../tests/banner-workflow.test.ts", import.meta.url))],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    outfile: workflowOutfile,
    logLevel: "silent",
    plugins: [{
      name: "mock-obsidian-and-rendering",
      setup(build) {
        build.onResolve({ filter: /^obsidian$/ }, () => ({ path: fileURLToPath(new URL("../tests/obsidian-mock.ts", import.meta.url)) }));
        build.onResolve({ filter: /^\.\/(map-renderer|offline-renderer|gpx-parser)$/ }, () => ({ path: fileURLToPath(new URL("../tests/render-mock.ts", import.meta.url)) }));
      }
    }]
  });
  await import(`${pathToFileURL(workflowOutfile).href}?run=${Date.now()}`);
  const cleanupOutfile = join(tempDir, "daily-data-cleanup.test.mjs");
  await build({
    entryPoints: [fileURLToPath(new URL("../tests/daily-data-cleanup.test.ts", import.meta.url))],
    bundle: true, platform: "node", format: "esm", target: "node20", outfile: cleanupOutfile, logLevel: "silent",
    plugins: [{ name: "mock-obsidian", setup(build) {
      build.onResolve({ filter: /^obsidian$/ }, () => ({ path: fileURLToPath(new URL("../tests/obsidian-mock.ts", import.meta.url)) }));
    } }]
  });
  await import(`${pathToFileURL(cleanupOutfile).href}?run=${Date.now()}`);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
