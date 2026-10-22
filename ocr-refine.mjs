import { PSM } from "tesseract.js";
import { valueNeedsReview } from "./ocr-fields.mjs";

function cleanCropText(text) {
  let value = String(text).replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  let previous;
  do {
    previous = value;
    value = value.replace(/([\u3400-\u9fff])\s+([\u3400-\u9fff])/g, "$1$2");
  } while (value !== previous);
  return value;
}

export async function refineFields(worker, imageSrc, fields, imageWidth, imageHeight, onProgress = () => {}) {
  const candidates = fields.filter(field =>
    !field.original ||
    (["是否法定节假日", "是否联系家长"].includes(field.label) &&
      valueNeedsReview(field.label, field.original, 100))
  ).slice(0, 12);
  if (!candidates.length) return;
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE });
  try {
    for (const [index, field] of candidates.entries()) {
      onProgress(index + 1, candidates.length);
      const { x0, y0, x1, y1 } = field.bbox;
      const margin = Math.max(16, Math.round((y1 - y0) * .6));
      const left = Math.max(0, Math.floor(field.original ? x0 - margin : Math.max(field.labelEnd + 12, imageWidth * .65)));
      const right = Math.min(imageWidth, Math.ceil(field.original ? x1 + margin : imageWidth * .98));
      const top = Math.max(0, Math.floor(y0 - margin));
      const bottom = Math.min(imageHeight, Math.ceil(y1 + margin));
      if (right - left < 20 || bottom - top < 16) continue;
      const result = await worker.recognize(imageSrc, {
        rectangle: { left, top, width: right - left, height: bottom - top }
      }, { blocks: true });
      const value = cleanCropText(result.data.text);
      const confidence = result.data.confidence || 0;
      const originalInvalid = ["是否法定节假日", "是否联系家长"].includes(field.label) &&
        valueNeedsReview(field.label, field.original, 100);
      const recognizedValid = !valueNeedsReview(field.label, value, confidence);
      const improved = value && confidence >= 40 && (
        !field.original ||
        (originalInvalid && recognizedValid)
      );
      if (!improved) continue;
      field.original = value;
      field.value = value;
      field.confidence = confidence;
      field.needsReview = valueNeedsReview(field.label, value, confidence);
      const lineBoxes = (result.data.blocks || []).flatMap(block => (block.paragraphs || [])
        .flatMap(paragraph => (paragraph.lines || []).map(line => line.bbox)));
      if (lineBoxes.length === 1) field.bbox = lineBoxes[0];
    }
  } finally {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
  }
}
