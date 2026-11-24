const { contextBridge, ipcRenderer } = require('electron');
// Only installed app routes receive a bridge; API documents and child frames do not.
if (process.isMainFrame && location.protocol === 'tessmora:' && !location.pathname.startsWith('/api/')) {
  const workspaceId = location.hostname;
  contextBridge.exposeInMainWorld('tessmoraDesktop', Object.freeze({
    workspaceId,
    apiOrigin: process.argv.find(value => value.startsWith('--tessmora-api-origin='))?.slice('--tessmora-api-origin='.length),
    hasWorkspaceCredential: true,
    chooseWorkspace: () => ipcRenderer.invoke('desktop:show-launcher', { workspaceId }),
  }));
}
