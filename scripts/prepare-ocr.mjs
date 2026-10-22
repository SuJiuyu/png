import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const destination = join(process.cwd(), "public", "ocr");
const coreDestination = join(destination, "core");
mkdirSync(coreDestination, { recursive: true });

const model = join(destination, "chi_sim.traineddata");
if (!existsSync(model)) {
  throw new Error("缺少 public/ocr/chi_sim.traineddata，中文 OCR 无法离线运行。");
}

copyFileSync(
  join(process.cwd(), "node_modules", "tesseract.js", "dist", "worker.min.js"),
  join(destination, "worker.min.js")
);

for (const variant of ["", "-simd", "-relaxedsimd"]) {
  for (const extension of [".wasm.js", ".wasm"]) {
    const name = `tesseract-core${variant}-lstm${extension}`;
    copyFileSync(
      join(process.cwd(), "node_modules", "tesseract.js-core", name),
      join(coreDestination, name)
    );
  }
}
console.log("本地 OCR 资源已准备好。");
