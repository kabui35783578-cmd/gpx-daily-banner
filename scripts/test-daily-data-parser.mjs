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
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
