const { app, BrowserWindow, net, protocol, session } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const scheme = "template-editor";
const origin = `${scheme}://app`;

protocol.registerSchemesAsPrivileged([
  { scheme, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
]);

function createWindow() {
  const window = new BrowserWindow({
    width: 1500,
    height: 900,
    minWidth: 960,
    minHeight: 650,
    show: false,
    title: "截图模板编辑器",
    backgroundColor: "#f5f7fb",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, destination) => {
    if (!destination.startsWith(`${origin}/`)) event.preventDefault();
  });
  window.once("ready-to-show", () => window.show());
  window.loadURL(`${origin}/index.html`);
}

app.whenReady().then(() => {
  const root = path.resolve(__dirname, "..", "dist");
  protocol.handle(scheme, request => {
    const url = new URL(request.url);
    if (url.host !== "app") return new Response("Not found", { status: 404 });
    let requested;
    try {
      requested = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
    } catch {
      return new Response("Bad path", { status: 400 });
    }
    const file = path.resolve(root, requested);
    if (file !== root && !file.startsWith(root + path.sep)) {
      return new Response("Not found", { status: 404 });
    }
    return net.fetch(pathToFileURL(file).toString());
  });

  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => app.quit());
