const { app, BrowserWindow } = require("electron");
require("../desktop/main.cjs");

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitForWindow() {
  for (let attempt = 0; attempt < 100; attempt++) {
    const window = BrowserWindow.getAllWindows()[0];
    if (window && !window.webContents.isLoading()) return window;
    await delay(100);
  }
  throw new Error("桌面窗口未载入");
}

app.whenReady().then(async () => {
  try {
    const window = await waitForWindow();
    const result = await window.webContents.executeJavaScript(`(async () => {
      const waitFor = async predicate => {
        for (let attempt = 0; attempt < 100; attempt++) {
          if (predicate()) return;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        throw new Error('页面状态等待超时');
      };
      const preview = document.getElementById('previewCanvas');
      const attachmentEditor = document.getElementById('attachmentEditor');
      const sizes = {};
      for (const id of ['detail1', 'detail', 'detail3', 'workflow']) {
        document.querySelector('[data-template="' + id + '"]').click();
        await waitFor(() => preview.height === 2560 && document.querySelector('[data-template="' + id + '"]').classList.contains('active') && document.getElementById('ocrStatus').textContent.startsWith('已校准'));
        sizes[id] = [preview.width, preview.height];
        if (attachmentEditor.hidden !== (id !== 'detail')) throw new Error('附件编辑区显示错误：' + id);
      }
      document.querySelector('[data-template="detail"]').click();
      await waitFor(() => !attachmentEditor.hidden && document.getElementById('ocrStatus').textContent === '已校准 19 个字段');
      const sourcePixel = [...preview.getContext('2d').getImageData(810, 2120, 1, 1).data];
      const testCanvas = document.createElement('canvas');
      testCanvas.width = 100;
      testCanvas.height = 150;
      const testContext = testCanvas.getContext('2d');
      testContext.fillStyle = '#e83c42';
      testContext.fillRect(0, 0, 100, 150);
      const blob = await new Promise(resolve => testCanvas.toBlob(resolve, 'image/png'));
      const transfer = new DataTransfer();
      transfer.items.add(new File([blob], 'attachment-probe.png', { type: 'image/png' }));
      const input = document.getElementById('attachmentInput');
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await waitFor(() => document.getElementById('attachmentStatus').textContent === 'attachment-probe.png');
      const imagePixel = [...preview.getContext('2d').getImageData(810, 2120, 1, 1).data];
      document.getElementById('clearAttachment').click();
      const clearedPixel = [...preview.getContext('2d').getImageData(810, 2120, 1, 1).data];
      const ocrResource = await fetch('/ocr/worker.min.js');
      if (sourcePixel[0] > 50 || imagePixel[0] < 200 || imagePixel[1] > 120 || clearedPixel[0] > 50 || !ocrResource.ok) {
        throw new Error(JSON.stringify({sourcePixel, imagePixel, clearedPixel, ocrStatus: ocrResource.status}));
      }
      return {sizes, sourcePixel, imagePixel, clearedPixel, ocrResource: ocrResource.status};
    })()`);
    console.log("Desktop smoke passed:", JSON.stringify(result));
    app.exit(0);
  } catch (error) {
    console.error("Desktop smoke failed:", error);
    app.exit(1);
  }
});
