import { cp, copyFile, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const here = import.meta.dirname;
const webRoot = resolve(here, "..");
const repoRoot = resolve(webRoot, "../..");
const dist = resolve(webRoot, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(resolve(dist, "vendor"), { recursive: true });

// イラスト素材（ComfyUI で生成した WebP）はまるごと dist へ
await cp(resolve(webRoot, "assets"), resolve(dist, "assets"), { recursive: true });

const assets = [
  [resolve(webRoot, "index.html"), resolve(dist, "index.html")],
  [resolve(webRoot, "styles.css"), resolve(dist, "styles.css")],
  [
    resolve(repoRoot, "node_modules/preact/dist/preact.module.js"),
    resolve(dist, "vendor/preact.module.js"),
  ],
  [
    resolve(repoRoot, "node_modules/preact/hooks/dist/hooks.module.js"),
    resolve(dist, "vendor/hooks.module.js"),
  ],
  [resolve(repoRoot, "node_modules/htm/dist/htm.module.js"), resolve(dist, "vendor/htm.module.js")],
];

for (const [from, to] of assets) {
  await copyFile(from, to);
}

console.log("web assets copied to dist/");
