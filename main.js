const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

const APP_DIR = app.getAppPath();
const OUTPUT_DIR = path.join(APP_DIR, "outputs");
const MEMORY_FILE = path.join(APP_DIR, "memory.json");

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 900,
    minHeight: 650,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: "Quintara Reports",
    backgroundColor: "#0A0A0A",
    show: false,
    titleBarStyle: "hiddenInset",
    frame: true,
  });

  mainWindow.loadFile("index.html");

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// ── IPC HANDLERS ─────────────────────────────────────────────────────────────

// Load memory stats
ipcMain.handle("get-stats", () => {
  try {
    if (!fs.existsSync(MEMORY_FILE)) return { jobCount: 0, niches: [] };
    const mem = JSON.parse(fs.readFileSync(MEMORY_FILE, "utf8"));
    return {
      jobCount: mem.jobCount || 0,
      niches: Object.keys(mem.nicheLearnings || {}),
    };
  } catch { return { jobCount: 0, niches: [] }; }
});

// Load past reports
ipcMain.handle("get-reports", () => {
  try {
    if (!fs.existsSync(OUTPUT_DIR)) return [];
    return fs.readdirSync(OUTPUT_DIR)
      .filter(f => f.endsWith(".md"))
      .map(f => {
        const stat = fs.statSync(path.join(OUTPUT_DIR, f));
        return { name: f, date: stat.mtime.toLocaleDateString("en-GB"), size: Math.round(stat.size / 1024) + " KB" };
      })
      .reverse();
  } catch { return []; }
});

// Open a report file in default app
ipcMain.handle("open-report", (_, filename) => {
  shell.openPath(path.join(OUTPUT_DIR, filename));
});

// Open outputs folder
ipcMain.handle("open-folder", () => {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  shell.openPath(OUTPUT_DIR);
});

// Save API key
ipcMain.handle("save-api-key", (_, key) => {
  try {
    const envFile = path.join(APP_DIR, ".env");
    fs.writeFileSync(envFile, `ANTHROPIC_API_KEY=${key.trim()}\n`);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

// Load API key
ipcMain.handle("load-api-key", () => {
  try {
    const envFile = path.join(APP_DIR, ".env");
    if (!fs.existsSync(envFile)) return "";
    const content = fs.readFileSync(envFile, "utf8");
    const match = content.match(/ANTHROPIC_API_KEY=(.+)/);
    return match ? match[1].trim() : "";
  } catch { return ""; }
});

// Read report content
ipcMain.handle("read-report", (_, filename) => {
  try {
    return fs.readFileSync(path.join(OUTPUT_DIR, filename), "utf8");
  } catch { return ""; }
});

// Save feedback to memory
ipcMain.handle("save-feedback", (_, { industry, feedback }) => {
  try {
    let mem = { nicheLearnings: {}, jobCount: 0, feedback: [] };
    if (fs.existsSync(MEMORY_FILE)) mem = JSON.parse(fs.readFileSync(MEMORY_FILE, "utf8"));
    const existing = mem.nicheLearnings[industry] || "";
    mem.nicheLearnings[industry] = existing + "\n- " + feedback;
    mem.feedback = mem.feedback || [];
    mem.feedback.push({ date: new Date().toISOString(), industry, feedback });
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(mem, null, 2));
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

// RUN PIPELINE — the main event
ipcMain.handle("run-pipeline", (_, clientDetails) => {
  return new Promise((resolve) => {
    // Write client details to temp file for pipeline
    const tempFile = path.join(APP_DIR, "client-temp.txt");
    fs.writeFileSync(tempFile, clientDetails);

    // Load API key from .env
    let apiKey = process.env.ANTHROPIC_API_KEY || "";
    const envFile = path.join(APP_DIR, ".env");
    if (fs.existsSync(envFile)) {
      const content = fs.readFileSync(envFile, "utf8");
      const match = content.match(/ANTHROPIC_API_KEY=(.+)/);
      if (match) apiKey = match[1].trim();
    }

    if (!apiKey) {
      resolve({ ok: false, error: "API key not set. Go to Settings and enter your Anthropic API key." });
      return;
    }

    const env = { ...process.env, ANTHROPIC_API_KEY: apiKey, CLIENT_TEMP_FILE: tempFile };
    const child = spawn("node", [path.join(APP_DIR, "pipeline.js")], { env, cwd: APP_DIR });

    let output = "";
    child.stdout.on("data", (data) => {
      output += data.toString();
      mainWindow.webContents.send("pipeline-log", data.toString());
    });
    child.stderr.on("data", (data) => {
      mainWindow.webContents.send("pipeline-log", "⚠️ " + data.toString());
    });
    child.on("close", (code) => {
      try { fs.unlinkSync(tempFile); } catch { }
      if (code === 0) {
        resolve({ ok: true, output });
      } else {
        resolve({ ok: false, error: "Pipeline exited with error. Check the log above." });
      }
    });
  });
});
