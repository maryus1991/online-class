// کتابخانه‌های لازم مرورگر را از node_modules در client/vendor قرار می‌دهد:
//   - mediasoup-client (بسته‌بندی‌شده با Bun)
//   - pdf.js (برای نمایش PDF)
//   - فونت وزیرمتن (برای اینکه صفحه بدون اینترنت هم درست نمایش داده شود)
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dir, "../..");
const client = path.join(root, "client");
const vendor = path.join(client, "vendor");
const nm = path.join(root, "server/node_modules");

await rm(vendor, { recursive: true, force: true });
await mkdir(path.join(vendor, "pdfjs"), { recursive: true });
await mkdir(path.join(vendor, "fonts"), { recursive: true });

const result = await Bun.build({
  entrypoints: [path.join(import.meta.dir, "vendor-entry.js")],
  outdir: vendor,
  naming: "mediasoup-client.js",
  target: "browser",
  format: "iife",
  minify: true,
});
if (!result.success) {
  for (const l of result.logs) console.error(l);
  process.exit(1);
}

await cp(path.join(nm, "pdfjs-dist/build/pdf.min.mjs"), path.join(vendor, "pdfjs/pdf.min.mjs"));
await cp(path.join(nm, "pdfjs-dist/build/pdf.worker.min.mjs"), path.join(vendor, "pdfjs/pdf.worker.min.mjs"));
await cp(path.join(nm, "vazirmatn/fonts/webfonts/Vazirmatn[wght].woff2"), path.join(vendor, "fonts/vazirmatn.woff2"));
console.log("client vendor files ready:", vendor);
