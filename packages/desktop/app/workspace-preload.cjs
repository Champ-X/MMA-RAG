const { contextBridge, ipcRenderer } = require('electron');
// Only installed app routes receive a bridge; API documents and child frames do not.
if (process.isMainFrame && location.protocol === 'tessmora:' && !location.pathname.startsWith('/api/')) {
  const workspaceId = location.hostname;
  let historyCallback;
  const pendingHistory = [];
  ipcRenderer.on('desktop:export-history', (_event, requestId) => {
    if (historyCallback) void historyCallback(requestId);
    else if (pendingHistory.length < 8) pendingHistory.push(requestId);
  });
  contextBridge.exposeInMainWorld('tessmoraDesktop', Object.freeze({
    workspaceId,
    apiOrigin: process.argv.find(value => value.startsWith('--tessmora-api-origin='))?.slice('--tessmora-api-origin='.length),
    serverId: process.argv.find(value => value.startsWith('--tessmora-server-id='))?.slice('--tessmora-server-id='.length),
    mode: process.argv.find(value => value.startsWith('--tessmora-workspace-mode='))?.slice('--tessmora-workspace-mode='.length),
    hasWorkspaceCredential: true,
    onHistoryExport: callback => {
      historyCallback = callback;
      for (const requestId of pendingHistory.splice(0)) void callback(requestId);
      return () => { if (historyCallback === callback) historyCallback = undefined; };
    },
    writeHistoryChunk: (requestId, sequence, bytes) => ipcRenderer.invoke('desktop:history-chunk', { requestId, sequence, bytes }),
    finishHistoryExport: (requestId, error) => ipcRenderer.invoke('desktop:history-finish', { requestId, error }),
    chooseWorkspace: () => ipcRenderer.invoke('desktop:show-launcher', { workspaceId }),
  }));
}
