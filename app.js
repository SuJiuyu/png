import { createWorker } from "tesseract.js";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { BUILTIN_TOP_CROP, createOriginalFields, originalPresets } from "./original-presets.js";
import { canonicalLabel, extractFields, normalizeLabel } from "./ocr-fields.mjs";
import { refineFields } from "./ocr-refine.mjs";
import "./fonts.css";

const templates = [
  { id: "detail1", name: "请假详情 · 1 节课", fileName: "空白模板", src: "/assets/blank-detail1.png" },
  { id: "detail", name: "请假详情 · 2 节课", fileName: "空白模板", src: "/assets/blank-detail.png" },
  { id: "detail3", name: "请假详情 · 3 节课", fileName: "空白模板", src: "/assets/blank-detail3.png" },
  { id: "workflow", name: "流程跟踪", fileName: "空白模板", src: "/assets/blank-workflow.png" }
];

const studentLabels = new Set([
  "学号", "姓名", "性别", "身份证号", "年级", "学院", "专业", "班级", "政治面貌",
  "联系电话", "手机号", "民族", "籍贯", "出生日期", "电子邮箱", "联系地址",
  "住宿寝室", "寝室电话", "楼栋号", "寝室号", "宿舍楼", "宿舍号", "所在校区",
  "家长姓名", "家长联系方式"
]);

const fontChoices = [
  ["handwriting", "原图近似 · 手写混排"],
  ["cangshui", "苍水行楷 · 已内置"],
  ["wenkai", "霞鹜文楷 · 内置"],
  ["brush", "马善政毛笔 · 内置"],
  ["notoSans", "思源黑体 · 内置"],
  ["notoSerif", "思源宋体 · 内置"],
  ["xingkai", "华文行楷"],
  ["shuti", "方正舒体"],
  ["kaiti", "华文楷体"],
  ["sans", "微软雅黑"],
  ["songti", "宋体"],
  ["fangsong", "仿宋"]
];
let uploadedFontFace = null;
const imageSaver = registerPlugin("ImageSaver");
const attachmentBox = { x: 680, y: 2073 - BUILTIN_TOP_CROP, width: 259, height: 345 };

const state = {
  currentId: null,
  image: null,
  fields: [],
  cache: new Map(),
  overrides: new Map(),
  localOverrides: new Map(),
  workerPromise: null,
  ocrQueue: Promise.resolve(),
  imageToken: 0,
  zoom: 0.5,
  showGuides: true,
  manualMode: false,
  selection: null,
  sourceName: "未导入 TXT",
  sourceStatus: "支持「字段：新值」格式",
  attachmentImage: null,
  attachmentFileName: ""
};

const canvas = document.getElementById("previewCanvas");
const ctx = canvas.getContext("2d");
const sourceCanvas = document.createElement("canvas");
const sourceCtx = sourceCanvas.getContext("2d", { willReadFrequently: true });
const canvasStage = document.getElementById("canvasStage");
const fieldEditor = document.getElementById("fieldEditor");
const toast = document.getElementById("toast");
const ocrStatus = document.getElementById("ocrStatus");

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("visible"), 2400);
}

function setStatus(message) {
  ocrStatus.textContent = message;
}

function renderTemplateList() {
  const builtins = templates.filter(item => originalPresets[item.id]);
  const imports = templates.filter(item => !originalPresets[item.id]);
  document.getElementById("templateCount").textContent = builtins.length;
  document.getElementById("importCount").textContent = imports.length;
  document.getElementById("importSection").hidden = imports.length === 0;
  const renderCards = items => items.map(item => `
    <button class="template-card ${item.id === state.currentId ? "active" : ""}" data-template="${escapeHtml(item.id)}">
      <span class="template-thumb" style="background-image:url('${item.src}')"></span>
      <span class="template-info"><strong>${escapeHtml(item.name)}</strong><small title="${escapeHtml(item.fileName)}">${escapeHtml(item.fileName)}</small></span>
      <span class="template-check">✓</span>
    </button>
  `).join("");
  document.getElementById("templateList").innerHTML = renderCards(builtins);
  document.getElementById("importList").innerHTML = renderCards(imports);
  document.querySelectorAll(".template-card").forEach(card => {
    card.addEventListener("click", () => loadTemplate(card.dataset.template));
  });
}

function loadTemplate(id) {
  const item = templates.find(entry => entry.id === id);
  if (!item) return;
  const token = ++state.imageToken;
  if (originalPresets[id] && !state.cache.has(id)) {
    const fields = createOriginalFields(id);
    applyOverrides(fields, id);
    state.cache.set(id, fields);
    if (id === "workflow") syncWorkflowApplicant();
  }
  state.currentId = id;
  state.image = null;
  state.fields = state.cache.get(id) || [];
  state.selection = null;
  document.getElementById("pageTitle").innerHTML = `${escapeHtml(item.name)} <span>·</span> 视觉预览`;
  const scanButton = document.getElementById("scanButton");
  scanButton.disabled = Boolean(originalPresets[id]);
  scanButton.title = originalPresets[id] ? "原版使用已校准的字段位置" : "重新识别当前图片";
  renderTemplateList();
  renderEditor();
  setStatus("正在载入图片");
  const image = new Image();
  image.onload = () => {
    if (token !== state.imageToken) return;
    state.image = image;
    item.width = image.naturalWidth;
    item.height = image.naturalHeight;
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    sourceCanvas.width = canvas.width;
    sourceCanvas.height = canvas.height;
    sourceCtx.drawImage(image, 0, 0);
    document.getElementById("canvasInfo").textContent = `${canvas.width} × ${canvas.height} px`;
    fitZoom();
    renderCanvas();
    state.fields.forEach(ensureFieldFont);
    if (state.cache.has(id)) {
      setStatus(originalPresets[id]
        ? `已校准 ${state.fields.length} 个字段`
        : `已识别 ${state.fields.length} 个字段`);
    } else {
      scanImage(item);
    }
  };
  image.onerror = () => setStatus("图片载入失败");
  image.src = item.src;
}

function getWorker() {
  if (!state.workerPromise) {
    state.workerPromise = createWorker("chi_sim", 1, {
      workerPath: "/ocr/worker.min.js",
      corePath: "/ocr/core",
      langPath: "/ocr",
      gzip: false,
      logger: message => {
        if (message.status === "recognizing text") {
          setStatus(`文字识别 ${Math.round(message.progress * 100)}%`);
        } else if (!state.image || !state.cache.has(state.currentId)) {
          setStatus("正在加载本地识别模型");
        }
      }
    }).catch(error => {
      state.workerPromise = null;
      throw error;
    });
  }
  return state.workerPromise;
}

function applyOverrides(fields, imageId) {
  const local = state.localOverrides.get(imageId);
  for (const field of fields) {
    const key = canonicalLabel(field.label) || normalizeLabel(field.label);
    const value = studentLabels.has(field.label) ? state.overrides.get(field.label) : local?.get(key);
    if (value !== undefined) {
      field.value = value;
      field.dirty = Boolean(field.value !== field.original || field.styleDirty);
    }
  }
}

function syncWorkflowApplicant() {
  const fields = state.cache.get("workflow");
  if (!fields) return;
  const applicant = fields.find(field => field.label === "开始人员");
  const name = fields.find(field => field.label === "姓名");
  const number = fields.find(field => field.label === "学号");
  if (!applicant || !name || !number || applicant.customized) return;
  applicant.value = name.value && number.value ? `${name.value}(${number.value})` : "";
  applicant.dirty = Boolean(applicant.value !== applicant.original || applicant.styleDirty);
  if (state.currentId === "workflow") {
    const input = [...fieldEditor.querySelectorAll("textarea")].find(entry => entry.dataset.fieldId === applicant.id);
    if (input) {
      input.value = applicant.value;
      input.closest(".field-group").classList.toggle("changed", applicant.dirty);
    }
  }
}

function mergePreviousEdits(fields, oldFields) {
  for (const field of fields) {
    const match = oldFields.find(old =>
      !old.manual && (old.dirty || old.customLabel) &&
      Math.abs(old.bbox.y0 - field.bbox.y0) < 30 &&
      Math.abs(old.bbox.x0 - field.bbox.x0) < 90
    );
    if (match) {
      field.value = match.value;
      field.fontStyle = match.fontStyle;
      field.fontSize = match.fontSize;
      field.baseFontStyle = match.baseFontStyle;
      field.baseFontSize = match.baseFontSize;
      field.offsetX = match.offsetX;
      field.offsetY = match.offsetY;
      field.styleDirty = match.styleDirty;
      if (match.customLabel) {
        field.originalLabel = field.label;
        field.label = match.label;
        field.customLabel = true;
      }
      field.dirty = Boolean(field.value !== field.original || field.styleDirty);
    }
  }
  fields.push(...oldFields.filter(field => field.manual));
}

function scanImage(item, force = false) {
  const imageId = item.id;
  const oldFields = state.cache.get(imageId) || [];
  setStatus("正在识别文字位置");
  state.ocrQueue = state.ocrQueue.catch(() => {}).then(async () => {
    const worker = await getWorker();
    const result = await worker.recognize(item.src, {}, { blocks: true });
    const imageWidth = item.width || 1440;
    const fields = extractFields(result.data.blocks, imageWidth);
    await refineFields(worker, item.src, fields, imageWidth, item.height || 3200,
      (index, total) => {
        if (state.currentId === imageId && index % 2 === 1) setStatus(`正在复核疑难字段 ${index}/${total}`);
      });
    const latestFields = state.cache.get(imageId) || oldFields;
    if (force) mergePreviousEdits(fields, latestFields);
    else fields.push(...latestFields.filter(field => field.manual));
    applyOverrides(fields, imageId);
    state.cache.set(imageId, fields);
    if (state.currentId === imageId) {
      state.fields = fields;
      renderEditor();
      renderCanvas();
      fields.forEach(ensureFieldFont);
      setStatus(`已识别 ${fields.length} 个字段`);
      showToast(`找到 ${fields.length} 个可编辑字段`);
    }
  }).catch(error => {
    console.error("OCR failed:", error);
    if (state.currentId === imageId) {
      setStatus("识别失败，可重试或框选补充");
      showToast("识别失败，请点“重新识别”");
    }
  });
}

function imagePoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(canvas.width, (event.clientX - rect.left) * canvas.width / rect.width)),
    y: Math.max(0, Math.min(canvas.height, (event.clientY - rect.top) * canvas.height / rect.height))
  };
}

function sampleBackground(field) {
  const { x0, y0, x1, y1 } = field.bbox;
  const points = [
    [x0 - 10, y0 - 8], [x1 + 10, y0 - 8],
    [x0 - 10, y1 + 8], [x1 + 10, y1 + 8],
    [(x0 + x1) / 2, y0 - 8], [(x0 + x1) / 2, y1 + 8]
  ];
  const colors = points.map(([x, y]) => {
    const px = sourceCtx.getImageData(
      Math.max(0, Math.min(canvas.width - 1, Math.round(x))),
      Math.max(0, Math.min(canvas.height - 1, Math.round(y))), 1, 1
    ).data;
    return [px[0], px[1], px[2]];
  });
  const channel = index => Math.round(colors.map(color => color[index]).sort((a, b) => a - b)[Math.floor(colors.length / 2)]);
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
}

function fieldFont(field, fontSize, character = "") {
  const style = field.fontStyle || (field.preset ? "cangshui" : "sans");
  if (style === "handwriting") {
    return /[\u3000-\u303f\u3400-\u9fff\uff00-\uffef]/u.test(character)
      ? `${Math.round(fontSize * 1.07)}px "FZShuTi", "方正舒体", "Ma Shan Zheng", "LXGW WenKai", cursive`
      : `${Math.round(fontSize * .9)}px "Ink Free", "LXGW WenKai", "Segoe Print", cursive`;
  }
  if (style === "wenkai") return `500 ${fontSize}px "LXGW WenKai", "KaiTi", serif`;
  const families = {
    brush: '"Ma Shan Zheng", "KaiTi", cursive',
    cangshui: '"AaCangshuixingkai Web", "苍水行楷", "CangShuiXingKai", "STXingkai", cursive',
    uploaded: '"Uploaded Template Font", "KaiTi", cursive',
    notoSans: '"Noto Sans SC", "Microsoft YaHei", sans-serif',
    notoSerif: '"Noto Serif SC", "SimSun", serif',
    xingkai: '"STXingkai", "华文行楷", "KaiTi", cursive',
    shuti: '"FZShuTi", "方正舒体", "KaiTi", cursive',
    kaiti: '"STKaiti", "华文楷体", "KaiTi", serif',
    sans: '"Microsoft YaHei", "Segoe UI", sans-serif',
    songti: '"SimSun", "宋体", serif',
    fangsong: '"FangSong", "仿宋", serif'
  };
  return `${fontSize}px ${families[style] || field.fontFamily || families.sans}`;
}

function ensureFieldFont(field) {
  const style = field.fontStyle || (field.preset ? "cangshui" : "sans");
  const sample = field.value || "汉字 2026";
  const families = {
    handwriting: ['"Ma Shan Zheng"', '500 42px "LXGW WenKai"'],
    wenkai: ['500 42px "LXGW WenKai"'],
    brush: ['"Ma Shan Zheng"'],
    cangshui: ['"AaCangshuixingkai Web"'],
    notoSans: ['"Noto Sans SC"'],
    notoSerif: ['"Noto Serif SC"']
  };
  const descriptors = families[style] || [];
  if (!descriptors.length) return;
  Promise.allSettled(descriptors.map(value =>
    document.fonts.load(value.includes("px") ? value : `42px ${value}`, sample)
  )).then(() => {
    if (state.image) renderCanvas();
  });
}

function measureStyledLine(line, field, fontSize) {
  if (field.fontStyle !== "handwriting") {
    ctx.font = fieldFont(field, fontSize);
    return ctx.measureText(line).width;
  }
  return Array.from(line).reduce((width, character) => {
    ctx.font = fieldFont(field, fontSize, character);
    return width + ctx.measureText(character).width;
  }, 0);
}

function paintStyledLine(line, x, y, field, fontSize) {
  if (field.fontStyle !== "handwriting") {
    ctx.font = fieldFont(field, fontSize);
    ctx.textBaseline = "top";
    ctx.fillText(line, x, y);
    return;
  }
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  let penX = x;
  for (const character of Array.from(line)) {
    ctx.font = fieldFont(field, fontSize, character);
    if (!/[\u3000-\u303f\u3400-\u9fff\uff00-\uffef]/u.test(character)) {
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineWidth = .7;
      ctx.strokeText(character, penX, y);
    }
    ctx.fillText(character, penX, y);
    penX += ctx.measureText(character).width;
  }
}

function drawEditedField(field) {
  const { x0, y0, x1, y1 } = field.bbox;
  const rightEdge = Math.min(canvas.width - 20, field.rightAligned ? Math.max(x1, canvas.width - 54) : canvas.width - 54);
  const leftEdge = Math.max(0, field.labelEnd ? field.labelEnd + 9 : x0 - 3);
  let fontSize = field.fontSize || Math.max(20, Math.min(52, Math.round((y1 - y0) * 0.88)));
  const lines = String(field.value).split("\n");
  const available = Math.max(1, rightEdge - leftEdge);
  while (fontSize > 20) {
    if (lines.every(line => measureStyledLine(line, field, fontSize) <= available)) break;
    fontSize--;
  }
  const lineHeight = Math.round(fontSize * 1.25);
  const positions = lines.map(line => {
    const width = measureStyledLine(line, field, fontSize);
    const base = field.rightAligned ? Math.max(leftEdge, rightEdge - width) : leftEdge;
    return Math.max(leftEdge, Math.min(rightEdge - Math.min(width, available), base + (field.offsetX || 0)));
  });
  const offsetY = field.offsetY || 0;
  const nextY = state.fields
    .filter(other => other !== field && other.bbox.y0 > y0 + 8)
    .reduce((nearest, other) => Math.min(nearest, other.bbox.y0), canvas.height);
  const clipTop = Math.max(0, y0 - 6);
  const clipBottom = Math.min(canvas.height, y1 + 7, nextY - 5);
  ctx.save();
  ctx.beginPath();
  ctx.rect(leftEdge, clipTop, Math.max(1, rightEdge - leftEdge), Math.max(1, clipBottom - clipTop));
  ctx.clip();
  ctx.fillStyle = field.color || (field.label.includes("联系") && !field.label.includes("家长") ? "#318fdc" :
    /时间$/.test(field.label) && !field.label.includes("请假") && !field.label.includes("课程") ? "#8e8e8e" : "#202020");
  lines.forEach((line, index) => paintStyledLine(
    line, positions[index],
    field.fontStyle === "handwriting" ? (y0 + y1) / 2 + offsetY + index * lineHeight : y0 - 2 + offsetY + index * lineHeight,
    field, fontSize
  ));
  ctx.restore();
}

function clearImportedField(field) {
  ctx.save();
  ctx.fillStyle = sampleBackground(field);
  const boxes = [field.bbox, ...(field.extraBoxes || [])];
  for (const box of boxes) {
    const left = Math.max(0, box.x0 - 3, field.labelEnd ? field.labelEnd + 3 : 0);
    const right = Math.min(canvas.width, box.x1 + 3);
    if (right > left) ctx.fillRect(left, Math.max(0, box.y0 - 3), right - left,
      Math.min(canvas.height, box.y1 + 3) - Math.max(0, box.y0 - 3));
  }
  ctx.restore();
}

function renderCanvas() {
  if (!state.image) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(state.image, 0, 0);
  {
    state.fields.filter(field => field.dirty && !field.preset).forEach(clearImportedField);
    state.fields.filter(field => field.dirty && field.value).forEach(drawEditedField);
    if (state.currentId === "detail" && state.attachmentImage) {
      const { x, y, width, height } = attachmentBox;
      const image = state.attachmentImage;
      const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
      const imageWidth = image.naturalWidth * scale;
      const imageHeight = image.naturalHeight * scale;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, width, height);
      ctx.clip();
      ctx.fillStyle = "#0f040a";
      ctx.fillRect(x, y, width, height);
      ctx.drawImage(image, x + (width - imageWidth) / 2, y + (height - imageHeight) / 2, imageWidth, imageHeight);
      ctx.restore();
    }
    if (state.showGuides) {
      state.fields.forEach(field => {
        const { x0, y0, x1, y1 } = field.bbox;
        ctx.save();
        ctx.strokeStyle = field.dirty ? "rgba(255, 147, 50, .95)" : "rgba(58, 137, 255, .72)";
        ctx.lineWidth = 2;
        ctx.setLineDash([7, 5]);
        ctx.strokeRect(x0 - 5, y0 - 5, x1 - x0 + 10, y1 - y0 + 10);
        ctx.restore();
      });
    }
    if (state.selection) {
      const { x0, y0, x1, y1 } = state.selection;
      ctx.save();
      ctx.strokeStyle = "#ff9634";
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 6]);
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      ctx.restore();
    }
  }
  canvas.style.width = `${canvas.width * state.zoom}px`;
  canvas.style.height = `${canvas.height * state.zoom}px`;
  document.getElementById("zoomLabel").textContent = `${Math.round(state.zoom * 100)}%`;
}

function renderEditor() {
  const attachmentEditor = document.getElementById("attachmentEditor");
  attachmentEditor.hidden = state.currentId !== "detail";
  document.getElementById("attachmentStatus").textContent = state.attachmentFileName || "未选择图片，显示参考图的黑色缩略图";
  document.getElementById("fieldCount").textContent = `${state.fields.length} 个字段`;
  document.getElementById("sourceName").textContent = state.sourceName;
  document.getElementById("sourceStatus").textContent = state.sourceStatus;
  if (!state.fields.length) {
    fieldEditor.innerHTML = '<p class="empty-fields">正在识别图片。识别不到时，可以用“框选补充”添加字段。</p>';
    return;
  }
  const student = state.fields.filter(field => studentLabels.has(field.label));
  const others = state.fields.filter(field => !studentLabels.has(field.label));
  const renderGroup = (title, fields) => !fields.length ? "" : `
    <div class="field-section-title">${title} <span>${fields.length}</span></div>
    ${fields.map(field => `
      <div class="field-group ${field.dirty ? "changed" : ""}">
        <div class="field-meta"><input class="field-label" data-label-id="${escapeHtml(field.id)}" value="${escapeHtml(field.label)}" aria-label="字段名称" title="可修改识别出的字段名称"><span class="field-key">${field.manual ? "手动" : `Y ${Math.round(field.bbox.y0)}`}</span></div>
        <textarea class="field-input" rows="${field.value.includes("\n") ? 3 : 1}" data-field-id="${escapeHtml(field.id)}">${escapeHtml(field.value)}</textarea>
        <div class="field-style-controls">
          <label>字体 <select data-font-id="${escapeHtml(field.id)}">${fontChoices.map(([value, label]) => `<option value="${value}" ${value === (field.fontStyle || (field.preset ? "cangshui" : "sans")) ? "selected" : ""}>${label}</option>`).join("")}</select></label>
          <label>字号 <input type="number" min="20" max="72" step="1" data-size-id="${escapeHtml(field.id)}" value="${field.fontSize || Math.max(20, Math.min(52, Math.round((field.bbox.y1 - field.bbox.y0) * .88)))}"></label>
        </div>
        <div class="field-position-controls">
          <label>水平偏移 <input type="number" min="-200" max="200" step="1" data-offset-x="${escapeHtml(field.id)}" value="${field.offsetX || 0}"></label>
          <label>垂直偏移 <input type="number" min="-200" max="200" step="1" data-offset-y="${escapeHtml(field.id)}" value="${field.offsetY || 0}"></label>
        </div>
        <div class="field-hint">${field.manual ? "手动框选" : field.preset ? "原版校准" : field.needsReview ? "OCR 待核对" : "OCR 定位"} · ${Math.round(field.bbox.x0)}, ${Math.round(field.bbox.y0)} · ${Math.round(field.bbox.x1 - field.bbox.x0)} × ${Math.round(field.bbox.y1 - field.bbox.y0)}</div>
      </div>
    `).join("")}`;
  fieldEditor.innerHTML = renderGroup("学生信息", student) + renderGroup("其他信息", others);
  fieldEditor.querySelectorAll("textarea").forEach(input => input.addEventListener("input", event => {
    const field = state.fields.find(entry => entry.id === event.target.dataset.fieldId);
    if (!field) return;
    field.value = event.target.value;
    field.dirty = Boolean(field.value !== field.original || field.styleDirty);
    if (field.label === "开始人员") field.customized = true;
    event.target.closest(".field-group").classList.toggle("changed", field.dirty);
    if (studentLabels.has(field.label)) {
      state.overrides.set(field.label, field.value);
      for (const [id, fields] of state.cache) {
        for (const sibling of fields) {
          if (sibling !== field && sibling.label === field.label) {
            sibling.value = field.value;
            sibling.dirty = Boolean(sibling.value !== sibling.original || sibling.styleDirty);
          }
        }
        if (id === state.currentId) {
          fieldEditor.querySelectorAll("textarea").forEach(other => {
            const sibling = fields.find(entry => entry.id === other.dataset.fieldId);
            if (sibling && sibling !== field && sibling.label === field.label) other.value = field.value;
          });
        }
      }
      syncWorkflowApplicant();
    }
    renderCanvas();
  }));
  fieldEditor.querySelectorAll("[data-font-id], [data-size-id]").forEach(control => control.addEventListener("change", event => {
    const field = state.fields.find(entry => entry.id === (event.target.dataset.fontId || event.target.dataset.sizeId));
    if (!field) return;
    if (field.baseFontStyle === undefined) field.baseFontStyle = field.fontStyle || (field.preset ? "cangshui" : "sans");
    if (field.baseFontSize === undefined) field.baseFontSize = field.fontSize || Math.max(20, Math.min(52, Math.round((field.bbox.y1 - field.bbox.y0) * .88)));
    if (event.target.dataset.fontId) field.fontStyle = event.target.value;
    else {
      field.fontSize = Math.max(20, Math.min(72, Number(event.target.value) || field.baseFontSize));
      event.target.value = field.fontSize;
    }
    updateStyleDirty(field);
    event.target.closest(".field-group").classList.toggle("changed", field.dirty);
    renderCanvas();
    ensureFieldFont(field);
  }));
  fieldEditor.querySelectorAll("[data-offset-x], [data-offset-y]").forEach(control => control.addEventListener("input", event => {
    const field = state.fields.find(entry => entry.id === (event.target.dataset.offsetX || event.target.dataset.offsetY));
    if (!field) return;
    const offset = Math.max(-200, Math.min(200, Number(event.target.value) || 0));
    if (event.target.dataset.offsetX) field.offsetX = offset;
    else field.offsetY = offset;
    updateStyleDirty(field);
    event.target.closest(".field-group").classList.toggle("changed", field.dirty);
    renderCanvas();
  }));
  fieldEditor.querySelectorAll("[data-label-id]").forEach(control => control.addEventListener("change", event => {
    const field = state.fields.find(entry => entry.id === event.target.dataset.labelId);
    if (!field) return;
    const label = canonicalLabel(event.target.value) || event.target.value.trim();
    if (!label) return event.target.value = field.label;
    if (field.originalLabel === undefined) field.originalLabel = field.label;
    field.label = label;
    field.customLabel = field.label !== field.originalLabel;
    if (studentLabels.has(field.label)) state.overrides.set(field.label, field.value);
    renderEditor();
    renderCanvas();
  }));
}

function updateStyleDirty(field) {
  field.styleDirty =
    (field.fontStyle || field.baseFontStyle) !== (field.baseFontStyle || (field.preset ? "cangshui" : "notoSans")) ||
    (field.fontSize || field.baseFontSize) !== (field.baseFontSize || Math.max(20, Math.min(52, Math.round((field.bbox.y1 - field.bbox.y0) * .88)))) ||
    Boolean(field.offsetX || field.offsetY);
  field.dirty = Boolean(field.value !== field.original || field.styleDirty);
}

function fitZoom() {
  if (!state.image) return;
  const width = Math.max(160, canvasStage.clientWidth - 66);
  const height = Math.max(300, canvasStage.clientHeight - 46);
  state.zoom = Math.max(.2, Math.min(width / canvas.width, height / canvas.height, .78));
  renderCanvas();
}

function applyTxt(text) {
  const updates = new Map();
  for (const line of text.replace(/\r/g, "").split("\n")) {
    const match = line.match(/^\s*([^：:=]{1,30})\s*[：:=]\s*(.+?)\s*$/);
    if (!match) continue;
    const label = canonicalLabel(match[1]) || normalizeLabel(match[1]);
    if (label) updates.set(label, match[2]);
  }
  const times = text.match(/开始时间,班主任时间,结束时间为:\s*((?:\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{2}:\d{2}\s*){3})/);
  if (times) {
    const dates = times[1].match(/\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{2}:\d{2}/g);
    if (dates?.length === 3) ["开始时间", "班主任时间", "结束时间"].forEach((label, index) => updates.set(label, dates[index]));
  }
  const leave = text.match(/请假日期为(\d{4}[-/]\d{1,2}[-/]\d{1,2})\s+(\d{1,2}:\d{2})~(\d{4}[-/]\d{1,2}[-/]\d{1,2})\s+(\d{1,2}:\d{2})\s+请假天数为([\d.]+)天/);
  if (leave) {
    updates.set("请假时间", `${leave[1]} ${leave[2]}~${leave[3]} ${leave[4]}`);
    updates.set("请假天数", `${leave[5]}天`);
  }
  const local = state.localOverrides.get(state.currentId) || new Map();
  for (const [label, value] of updates) {
    if (studentLabels.has(label)) state.overrides.set(label, value);
    else local.set(label, value);
  }
  state.localOverrides.set(state.currentId, local);
  for (const [id, fields] of state.cache) applyOverrides(fields, id);
  syncWorkflowApplicant();
  renderEditor();
  renderCanvas();
  return updates.size;
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(reader.error || new Error("无法读取导出图片"));
    reader.readAsDataURL(blob);
  });
}

function exportCanvas() {
  if (!state.image) return;
  const guides = state.showGuides;
  state.showGuides = false;
  renderCanvas();
  const type = document.getElementById("formatSelect").value === "jpeg" ? "image/jpeg" : "image/png";
  const extension = type === "image/jpeg" ? "jpg" : "png";
  const name = state.currentId.replace(/[^a-z0-9-]/gi, "_") + "-edited." + extension;
  canvas.toBlob(async blob => {
    state.showGuides = guides;
    renderCanvas();
    if (!blob) return showToast("导出失败");
    if (Capacitor.getPlatform() === "android") {
      try {
        const base64 = await blobToBase64(blob);
        const result = await imageSaver.save({ name, mimeType: type, base64 });
        showToast(result.saved ? `已保存 ${name}` : "已取消保存");
      } catch (error) {
        console.error("Android image save failed:", error);
        showToast("保存失败，请重试或更换保存位置");
      }
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(`已导出 ${name}`);
  }, type, .95);
}

canvas.addEventListener("pointerdown", event => {
  if (!state.image || !state.manualMode) return;
  const point = imagePoint(event);
  state.selection = { x0: point.x, y0: point.y, x1: point.x, y1: point.y };
  canvas.setPointerCapture(event.pointerId);
  renderCanvas();
});
canvas.addEventListener("pointermove", event => {
  if (!state.selection) return;
  const point = imagePoint(event);
  state.selection.x1 = point.x;
  state.selection.y1 = point.y;
  renderCanvas();
});
canvas.addEventListener("pointerup", event => {
  if (!state.selection) return;
  const point = imagePoint(event);
  const x0 = Math.min(state.selection.x0, point.x);
  const x1 = Math.max(state.selection.x0, point.x);
  const y0 = Math.min(state.selection.y0, point.y);
  const y1 = Math.max(state.selection.y0, point.y);
  state.selection = null;
  if (x1 - x0 < 18 || y1 - y0 < 12) return renderCanvas();
  const field = {
    id: `manual-${Date.now()}`,
    label: `手动字段 ${state.fields.filter(entry => entry.manual).length + 1}`,
    original: "",
    value: "",
    dirty: false,
    manual: true,
    rightAligned: false,
    labelEnd: 0,
    bbox: { x0, y0, x1, y1 }
  };
  state.fields.push(field);
  state.cache.set(state.currentId, state.fields);
  state.manualMode = false;
  document.getElementById("manualButton").classList.remove("active");
  canvas.classList.remove("selecting");
  renderEditor();
  renderCanvas();
  const input = [...fieldEditor.querySelectorAll("textarea")].find(entry => entry.dataset.fieldId === field.id);
  input?.focus();
  showToast("已添加字段，请输入新文字");
});
canvas.addEventListener("click", event => {
  if (state.manualMode) return;
  const point = imagePoint(event);
  const field = state.fields.find(entry =>
    point.x >= entry.bbox.x0 - 8 && point.x <= entry.bbox.x1 + 8 &&
    point.y >= entry.bbox.y0 - 8 && point.y <= entry.bbox.y1 + 8
  );
  if (!field) return;
  const input = [...fieldEditor.querySelectorAll("textarea")].find(entry => entry.dataset.fieldId === field.id);
  input?.scrollIntoView({ block: "center", behavior: "smooth" });
  input?.focus();
});

document.getElementById("toggleGuides").addEventListener("click", () => {
  state.showGuides = !state.showGuides;
  renderCanvas();
});
document.getElementById("zoomOut").addEventListener("click", () => {
  state.zoom = Math.max(.2, state.zoom - .05);
  renderCanvas();
});
document.getElementById("zoomIn").addEventListener("click", () => {
  state.zoom = Math.min(1.5, state.zoom + .05);
  renderCanvas();
});
document.getElementById("fitButton").addEventListener("click", fitZoom);
document.getElementById("exportButton").addEventListener("click", exportCanvas);
document.getElementById("exportButtonBottom").addEventListener("click", exportCanvas);
document.getElementById("jumpToEditor").addEventListener("click", () => document.querySelector(".inspector").scrollIntoView({ behavior: "smooth", block: "start" }));
document.getElementById("jumpToPreview").addEventListener("click", () => document.querySelector(".workspace").scrollIntoView({ behavior: "smooth", block: "start" }));
document.getElementById("scanButton").addEventListener("click", () => {
  const item = templates.find(entry => entry.id === state.currentId);
  if (item && state.image) scanImage(item, true);
});
document.getElementById("manualButton").addEventListener("click", event => {
  state.manualMode = !state.manualMode;
  event.currentTarget.classList.toggle("active", state.manualMode);
  canvas.classList.toggle("selecting", state.manualMode);
  showToast(state.manualMode ? "在画布上拖动框选需要修改的文字" : "已退出框选");
});
document.getElementById("resetButton").addEventListener("click", () => {
  state.overrides.clear();
  state.localOverrides.clear();
  state.attachmentImage = null;
  state.attachmentFileName = "";
  for (const [id, fields] of state.cache) {
    const restored = fields.filter(field => !field.manual);
    restored.forEach(field => {
      field.value = field.original;
      field.dirty = false;
      field.customized = false;
      if (field.baseFontStyle !== undefined) field.fontStyle = field.baseFontStyle;
      if (field.baseFontSize !== undefined) field.fontSize = field.baseFontSize;
      if (field.originalLabel !== undefined) field.label = field.originalLabel;
      field.customLabel = false;
      field.offsetX = 0;
      field.offsetY = 0;
      field.styleDirty = false;
    });
    state.cache.set(id, restored);
    if (id === state.currentId) state.fields = restored;
  }
  renderEditor();
  renderCanvas();
  showToast("模板已清空；导入图片已还原");
});
document.getElementById("clearSource").addEventListener("click", () => {
  state.sourceName = "未导入 TXT";
  state.sourceStatus = "支持「字段：新值」格式";
  renderEditor();
});
document.getElementById("attachmentInput").addEventListener("change", event => {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type) || file.size > 20 * 1024 * 1024) {
    showToast("请选择不超过 20 MB 的 PNG、JPG、WebP 或 GIF 图片");
    return;
  }
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    URL.revokeObjectURL(url);
    if (!image.naturalWidth || !image.naturalHeight) return showToast("附件图片无法读取");
    state.attachmentImage = image;
    state.attachmentFileName = file.name;
    renderEditor();
    renderCanvas();
    showToast("附件图片已放入两节课模板");
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
    showToast("附件图片无法读取");
  };
  image.src = url;
});
document.getElementById("clearAttachment").addEventListener("click", () => {
  state.attachmentImage = null;
  state.attachmentFileName = "";
  renderEditor();
  renderCanvas();
  showToast("已恢复参考图的黑色缩略图");
});
document.getElementById("txtInput").addEventListener("change", event => {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const count = applyTxt(String(reader.result));
    state.sourceName = file.name;
    state.sourceStatus = `匹配 ${count} 个字段名称`;
    renderEditor();
    showToast(count ? `已读取 ${count} 个修改值` : "没有匹配到字段，请用“字段：新值”格式");
  };
  reader.readAsText(file, "UTF-8");
  event.target.value = "";
});
document.getElementById("fontInput").addEventListener("change", async event => {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  if (!/\.(ttf|otf|woff2?)$/i.test(file.name) || file.size > 30 * 1024 * 1024) {
    showToast("请选择不超过 30 MB 的 TTF、OTF、WOFF 或 WOFF2 字体");
    return;
  }
  try {
    const face = new FontFace("Uploaded Template Font", await file.arrayBuffer());
    await face.load();
    if (uploadedFontFace) document.fonts.delete(uploadedFontFace);
    document.fonts.add(face);
    uploadedFontFace = face;
    const previous = fontChoices.findIndex(([value]) => value === "uploaded");
    if (previous >= 0) fontChoices.splice(previous, 1);
    fontChoices.splice(2, 0, ["uploaded", `已导入 · ${file.name}`]);
    document.getElementById("fontStatus").textContent = `已加载 ${file.name}（仅当前浏览器会话）`;
    renderEditor();
    renderCanvas();
    showToast("字体已加载，可在每个字段的字体菜单中选择");
  } catch (error) {
    console.error("Font load failed:", error);
    showToast("字体文件无法加载，请检查文件是否有效");
  }
});
document.getElementById("imageInput").addEventListener("change", event => {
  const file = event.target.files?.[0];
  if (!file) return;
  const item = {
    id: `custom-${Date.now()}`,
    name: "导入 · " + file.name,
    fileName: file.name,
    src: URL.createObjectURL(file)
  };
  templates.push(item);
  loadTemplate(item.id);
  event.target.value = "";
});
window.addEventListener("resize", fitZoom);

renderTemplateList();
loadTemplate(templates[0].id);
