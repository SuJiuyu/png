import assert from "node:assert/strict";
import { extractFields } from "../ocr-fields.mjs";

const word = (text, x0, x1, y0) => ({ text, bbox: { x0, y0, x1, y1: y0 + 42 } });
const line = (words, y0, confidence = 90) => ({
  text: words.map(item => item.text).join(" "),
  confidence,
  words,
  bbox: {
    x0: Math.min(...words.map(item => item.bbox.x0)),
    y0,
    x1: Math.max(...words.map(item => item.bbox.x1)),
    y1: y0 + 42
  }
});
const blocks = (...lines) => [{ paragraphs: [{ lines }] }];

const fields = extractFields(blocks(
  line([word("姓名:张三", 55, 230, 600)], 600),
  line([word("住宿", 55, 150, 700), word("究室", 151, 245, 700)], 700, 0),
  line([word("申请信息", 55, 320, 800), word("(查看学生信息)", 424, 708, 800)], 800)
), 1440);
assert.equal(fields.length, 2);
assert.equal(fields[0].label, "姓名");
assert.equal(fields[0].value, "张三");
assert.ok(fields[0].bbox.x0 > fields[0].labelEnd);
assert.equal(fields[1].label, "住宿寝室");
assert.equal(fields[1].value, "");
assert.equal(fields[1].needsReview, true);

const workflow = extractFields(blocks(
  line([word("开始", 128, 208, 860)], 860),
  line([word("吕", 131, 181, 924), word("博", 183, 224, 924), word("(2405014337)", 231, 485, 924)], 924, 8),
  line([word("2026-09-23", 128, 375, 989), word("23:37:01", 392, 555, 989)], 989),
  line([word("班主任", 128, 252, 1085)], 1085),
  line([word("邢", 129, 166, 1148), word("杰", 185, 220, 1148), word("(20050655)", 219, 442, 1148)], 1148)
), 1440);
assert.deepEqual(workflow.map(field => field.label), ["开始人员", "开始时间", "班主任"]);
assert.equal(workflow[0].value, "吕博(2405014337)");

const imported = extractFields(blocks(
  line([word("请假详情", 55, 235, 540), word("查看记录", 1020, 1190, 540)], 540),
  line([word("姓名", 55, 145, 610), word("李四", 1020, 1110, 610)], 610),
  line([word("身份证号", 55, 230, 680), word("123456789012345678", 790, 1180, 680)], 680),
  line([word("提交", 100, 180, 750), word("返回", 1000, 1080, 750)], 750)
), 1216);
assert.deepEqual(imported.map(field => field.label), ["姓名", "身份证号"]);
assert.equal(imported[0].bbox.x0, 1020);
assert.equal(imported[1].value, "123456789012345678");

const emptyPhone = extractFields(blocks(
  line([word("究", 55, 98, 820), word("室", 120, 147, 820), word("电话", 168, 246, 820)], 820)
), 1440);
assert.equal(emptyPhone[0].label, "寝室电话");
assert.equal(emptyPhone[0].value, "");

console.log("OCR field extraction checks passed");
