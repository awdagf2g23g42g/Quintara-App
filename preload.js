const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  getStats: () => ipcRenderer.invoke("get-stats"),
  getReports: () => ipcRenderer.invoke("get-reports"),
  openReport: (filename) => ipcRenderer.invoke("open-report", filename),
  openFolder: () => ipcRenderer.invoke("open-folder"),
  saveApiKey: (key) => ipcRenderer.invoke("save-api-key", key),
  loadApiKey: () => ipcRenderer.invoke("load-api-key"),
  readReport: (filename) => ipcRenderer.invoke("read-report", filename),
  saveFeedback: (data) => ipcRenderer.invoke("save-feedback", data),
  runPipeline: (clientDetails) => ipcRenderer.invoke("run-pipeline", clientDetails),
  onPipelineLog: (cb) => ipcRenderer.on("pipeline-log", (_, msg) => cb(msg)),
  removePipelineLog: () => ipcRenderer.removeAllListeners("pipeline-log"),
});
