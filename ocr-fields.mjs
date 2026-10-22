// OCR field extraction is kept independent of the UI so it can be checked
// against the reference screenshots without opening a browser.
const aliases = {
  学号: "学号", 姓名: "姓名", 性别: "性别", 身份证号: "身份证号",
  身份征号: "身份证号", 年级: "年级", 学院: "学院", 专业: "专业",
  班级: "班级", 政治面貌: "政治面貌", 联系电话: "联系电话",
  民族: "民族", 籍贯: "籍贯", 出生日期: "出生日期", 手机号: "手机号",
  电子邮箱: "电子邮箱", 邮箱: "电子邮箱", 联系地址: "联系地址",
  住宿寝室: "住宿寝室", 住宿究室: "住宿寝室", 住宿穴室: "住宿寝室",
  住宿室: "住宿寝室", 寝室电话: "寝室电话", 究室电话: "寝室电话",
  冲室电话: "寝室电话",
  楼栋号: "楼栋号", 寝室号: "寝室号", 可室号: "寝室号", 宴室号: "寝室号",
  宿舍楼: "宿舍楼", 宿舍号: "宿舍号", 所在校区: "所在校区",
  家长姓名: "家长姓名", 家长联系方式: "家长联系方式",
  学年: "学年", 学期: "学期", 请假类型: "请假类型",
  是否法定节假日: "是否法定节假日", 请假时间: "请假时间",
  请假日期: "请假时间", 请假天数: "请假天数", 请假事由: "请假事由",
  请假开始时间: "请假开始时间", 请假结束时间: "请假结束时间",
  申请人: "申请人", 申请时间: "申请时间", 审批人: "审批人",
  审批时间: "审批时间", 审批状态: "审批状态", 辅导员: "辅导员",
  前往目的地: "前往目的地", 是否联系家长: "是否联系家长",
  日期: "日期", 节次: "节次", 课程名称: "课程名称", 译程名称: "课程名称",
  任课老师姓名: "任课老师姓名", 任译老师姓名: "任课老师姓名",
  任译老师巡名: "任课老师姓名", 任译老师名: "任课老师姓名",
  课程开始时间: "课程开始时间", 程开始时间: "课程开始时间",
  课程结束时间: "课程结束时间", 开始时间: "开始时间",
  班主任时间: "班主任时间", 结束时间: "结束时间"
};

export function normalizeLabel(value) {
  return String(value).replace(/[\s：:、，,。.（）()\-]/g, "");
}

export function canonicalLabel(raw) {
  return aliases[normalizeLabel(raw)] || "";
}

export function valueNeedsReview(label, value, confidence = 100) {
  if (!value || confidence < 55) return true;
  if (["是否法定节假日", "是否联系家长"].includes(label)) {
    return !/^(是|否|暂无|有|无)$/.test(value);
  }
  return false;
}

function lineWords(line) {
  return (line.words || [])
    .filter(word => word.text?.trim() && word.bbox)
    .sort((a, b) => a.bbox.x0 - b.bbox.x0);
}

function joinWords(words) {
  return words.reduce((result, word, index) => {
    const value = word.text.trim();
    if (!index) return value;
    const previous = words[index - 1];
    const gap = word.bbox.x0 - previous.bbox.x1;
    const space = gap > 8 && /[A-Za-z0-9]$/.test(previous.text.trim()) && /^[A-Za-z0-9]/.test(value);
    return result + (space ? " " : "") + value;
  }, "");
}

function knownPrefix(words, allowEmptyValue = false) {
  let result = null;
  for (let index = 1; index <= words.length; index++) {
    if (index === words.length && !allowEmptyValue) continue;
    const label = canonicalLabel(joinWords(words.slice(0, index)));
    if (label) result = { label, index };
  }
  return result;
}

function splitWord(word, position) {
  const text = word.text.trim();
  const width = word.bbox.x1 - word.bbox.x0;
  const x = word.bbox.x0 + width * position / Array.from(text).length;
  const left = { ...word, text: text.slice(0, position), bbox: { ...word.bbox, x1: x } };
  const right = { ...word, text: text.slice(position + 1), bbox: { ...word.bbox, x0: x + width / text.length } };
  return [left.text ? left : null, right.text ? right : null];
}

function colonSplit(words) {
  for (let index = 0; index < words.length; index++) {
    const word = words[index];
    const position = word.text.search(/[：:]/);
    if (position < 0) continue;
    const [before, after] = splitWord(word, position);
    const labelWords = [...words.slice(0, index), ...(position ? [before] : [])].filter(Boolean);
    const label = canonicalLabel(joinWords(labelWords));
    if (!label) continue;
    const valueWords = [...(word.text.length > position + 1 ? [after] : []), ...words.slice(index + 1)].filter(Boolean);
    return { label, labelWords, valueWords, rightAligned: false };
  }
  return null;
}

function splitField(words, imageWidth) {
  const colon = colonSplit(words);
  if (colon) return colon;

  const prefix = knownPrefix(words, true);
  if (prefix) {
    const labelWords = words.slice(0, prefix.index);
    const valueWords = words.slice(prefix.index);
    const gap = valueWords.length ? valueWords[0].bbox.x0 - labelWords.at(-1).bbox.x1 : 0;
    return { label: prefix.label, labelWords, valueWords,
      rightAligned: gap > Math.max(65, imageWidth * .06) };
  }

  // Unknown text with a large gap is often a heading followed by a button.
  // Only known information labels are editable automatically.
  return null;
}

function collectLines(blocks, imageWidth) {
  const lines = [];
  for (const block of blocks || []) {
    for (const paragraph of block.paragraphs || []) {
      for (const line of paragraph.lines || []) {
        const words = lineWords(line);
        if (!line.bbox || !words.length) continue;
        if (line.confidence >= 25 || knownPrefix(words, true) || colonSplit(words) ||
            /[（(]\d{6,}[)）]/.test(joinWords(words))) lines.push(line);
      }
    }
  }
  lines.sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
  const used = new Set();
  return lines.flatMap((line, index) => {
    if (used.has(index)) return [];
    const words = lineWords(line);
    if (line.bbox.x1 < imageWidth * .42 &&
        (knownPrefix(words, true) || colonSplit(words))) {
      const center = (line.bbox.y0 + line.bbox.y1) / 2;
      const height = line.bbox.y1 - line.bbox.y0;
      const partner = lines.findIndex((other, otherIndex) => {
        if (otherIndex === index || used.has(otherIndex) || other.bbox.x0 <= imageWidth * .52) return false;
        const otherWords = lineWords(other);
        if (knownPrefix(otherWords, true) || colonSplit(otherWords)) return false;
        const otherCenter = (other.bbox.y0 + other.bbox.y1) / 2;
        return Math.abs(otherCenter - center) <= Math.max(height, other.bbox.y1 - other.bbox.y0) * .45;
      });
      if (partner >= 0) {
        used.add(partner);
        const other = lines[partner];
        return [{
          text: `${line.text} ${other.text}`,
          confidence: Math.min(line.confidence, other.confidence),
          bbox: {
            x0: line.bbox.x0, y0: Math.min(line.bbox.y0, other.bbox.y0),
            x1: other.bbox.x1, y1: Math.max(line.bbox.y1, other.bbox.y1)
          },
          words: [...words, ...lineWords(other)]
        }];
      }
    }
    return [line];
  });
}

export function extractFields(blocks, imageWidth) {
  const lines = collectLines(blocks, imageWidth);
  const fields = [];
  let workflowStep = "";
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const words = lineWords(line);
    const fullText = joinWords(words);
    const compact = normalizeLabel(fullText);
    if (compact.includes("班主任") && !/\d{4}/.test(compact)) workflowStep = "班主任";
    else if (compact.includes("开始") && !/\d{4}/.test(compact)) workflowStep = "开始";
    else if (compact.includes("结束") && !/\d{4}/.test(compact)) workflowStep = "结束";

    let split = splitField(words, imageWidth);
    if (!split && /\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(fullText) && workflowStep) {
      split = { label: `${workflowStep}时间`, labelWords: [], valueWords: words, rightAligned: false };
    } else if (!split && workflowStep && workflowStep !== "结束" &&
               /[（(]\d{6,}[)）]/.test(fullText) && line.bbox.x0 < imageWidth * .5) {
      split = { label: workflowStep === "开始" ? "开始人员" : "班主任",
        labelWords: [], valueWords: words, rightAligned: false };
    } else if (!split && compact === "同意" && workflowStep === "班主任") {
      split = { label: "班主任状态", labelWords: [], valueWords: words, rightAligned: false };
    }
    if (!split) continue;
    const { label, labelWords, valueWords, rightAligned } = split;
    if (line.bbox.y0 < 500 && !canonicalLabel(label)) continue;
    const value = joinWords(valueWords).replace(/[\r\n]+/g, " ").trim();
    if (!value && !canonicalLabel(label)) continue;
    if (!canonicalLabel(label) && /[（(]\s*查看/.test(value)) continue;
    const box = valueWords.length ? {
      x0: Math.min(...valueWords.map(word => word.bbox.x0)),
      y0: Math.min(...valueWords.map(word => word.bbox.y0)),
      x1: Math.max(...valueWords.map(word => word.bbox.x1)),
      y1: Math.max(...valueWords.map(word => word.bbox.y1))
    } : {
      x0: Math.max(line.bbox.x1 + 12, imageWidth * .7),
      y0: line.bbox.y0,
      x1: imageWidth * .965,
      y1: line.bbox.y1
    };
    const field = {
      id: `ocr-${fields.length}`,
      label,
      original: value,
      value,
      dirty: false,
      manual: false,
      fontStyle: "notoSans",
      rightAligned: rightAligned || !valueWords.length,
      labelEnd: labelWords.length ? Math.max(...labelWords.map(word => word.bbox.x1)) : 0,
      bbox: box,
      confidence: line.confidence,
      needsReview: valueNeedsReview(label, value, line.confidence)
    };
    if (label === "课程名称" && value) {
      const next = lines[lineIndex + 1];
      const continuationWords = next ? lineWords(next) : [];
      if (next && continuationWords.length &&
          next.bbox.x0 < imageWidth * .24 &&
          next.bbox.y0 - box.y1 < Math.max(26, box.y1 - box.y0) * .7 &&
          next.bbox.y0 >= box.y0 &&
          !splitField(continuationWords, imageWidth)) {
        const continuation = joinWords(continuationWords);
        if (continuation && continuation.length < 18) {
          field.original += continuation;
          field.value += continuation;
          field.extraBoxes = [next.bbox];
          lineIndex++;
        }
      }
    }
    fields.push(field);
  }
  return fields;
}
