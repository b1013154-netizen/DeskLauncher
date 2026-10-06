'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const on = channel => cb => {
  const fn = (_e, data) => cb(data);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
};

contextBridge.exposeInMainWorld('dl', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: cfg => ipcRenderer.invoke('config:set', cfg),
  run: id => ipcRenderer.invoke('launcher:run', id),
  resize: size => ipcRenderer.invoke('launcher:resize', size),
  contextMenu: id => ipcRenderer.invoke('launcher:context', id),
  openSettings: id => ipcRenderer.invoke('settings:open', id),
  testSteps: steps => ipcRenderer.invoke('steps:test', steps),
  autoIcon: btn => ipcRenderer.invoke('icon:auto', btn),
  pick: kind => ipcRenderer.invoke('dialog:pick', kind),
  exportConfig: () => ipcRenderer.invoke('config:export'),
  importConfig: () => ipcRenderer.invoke('config:import'),
  resetConfig: () => ipcRenderer.invoke('config:reset'),
  openBackups: () => ipcRenderer.invoke('config:openBackups'),
  keyNames: () => ipcRenderer.invoke('keys:names'),
  listDocs: () => ipcRenderer.invoke('docs:list'),
  readDoc: id => ipcRenderer.invoke('docs:read', id),
  openDocExternal: id => ipcRenderer.invoke('docs:openExternal', id),
  quit: () => ipcRenderer.invoke('app:quit'),
  onConfig: on('config-changed'),
  onToast: on('toast'),
  onSelectButton: on('select-button'),
  onShowTab: on('show-tab')
});
