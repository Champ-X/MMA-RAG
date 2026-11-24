const { contextBridge, ipcRenderer } = require('electron');
const invoke = (name, value) => ipcRenderer.invoke(`desktop:${name}`, value);
contextBridge.exposeInMainWorld('tessmoraLauncher', Object.freeze({
  list: () => invoke('list'),
  chooseDirectory: () => invoke('choose-directory'),
  create: value => invoke('create', value),
  connect: value => invoke('connect', value),
  forget: id => invoke('forget', id),
  quit: () => invoke('quit'),
  onProgress: callback => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('desktop:progress', listener);
    return () => ipcRenderer.removeListener('desktop:progress', listener);
  },
}));
