import { createWorker } from "tesseract.js";
import { resolve } from "node:path";
import { extractFields } from "../ocr-fields.mjs";
import { refineFields } from "../ocr-refine.mjs";

const file = process.argv[2];
if (!file) throw new Error("Usage: node scripts/inspect-ocr.mjs <image>");

const worker = await createWorker("chi_sim", 1, {
  langPath: resolve("public/ocr"),
  gzip: false
});
try {
  const result = await worker.recognize(resolve(file), {}, { blocks: true });
  for (const block of result.data.blocks || []) {
    for (const paragraph of block.paragraphs || []) {
      for (const line of paragraph.lines || []) {
        const words = (line.words || []).map(word => `${word.text}@${word.bbox.x0}-${word.bbox.x1}`);
        console.log(`${line.confidence.toFixed(0)} y=${line.bbox.y0}-${line.bbox.y1} ${line.text.trim()} | ${words.join(" ")}`);
      }
    }
  }
  const width = Number(process.argv[3]) || 1440;
  const fields = extractFields(result.data.blocks, width);
  if (process.argv.includes("--refine")) await refineFields(worker, resolve(file), fields, width, 3200);
  console.log(`\nFIELDS ${fields.length}`);
  for (const field of fields) {
    console.log(`${field.needsReview ? "?" : " "} ${field.label}: ${field.value || "[待补充]"} @ ${Math.round(field.bbox.x0)},${Math.round(field.bbox.y0)}-${Math.round(field.bbox.x1)},${Math.round(field.bbox.y1)}`);
  }
} finally {
  await worker.terminate();
}
