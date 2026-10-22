import { createWorker, PSM } from "tesseract.js";
import { resolve } from "node:path";

const [file, left, top, width, height] = process.argv.slice(2);
if (!file) throw new Error("Usage: node scripts/inspect-crop.mjs <image> <left> <top> <width> <height>");
const worker = await createWorker("chi_sim", 1, { langPath: resolve("public/ocr"), gzip: false });
try {
  const rectangle = { left: +left, top: +top, width: +width, height: +height };
  for (const mode of [PSM.SINGLE_LINE, PSM.SINGLE_WORD]) {
    await worker.setParameters({ tessedit_pageseg_mode: mode });
    const result = await worker.recognize(resolve(file), { rectangle }, { blocks: true });
    const boxes = (result.data.blocks || []).flatMap(block => (block.paragraphs || []).flatMap(paragraph =>
      (paragraph.lines || []).map(line => line.bbox)));
    console.log(mode, result.data.confidence, JSON.stringify(result.data.text.trim()), boxes);
  }
} finally {
  await worker.terminate();
}
