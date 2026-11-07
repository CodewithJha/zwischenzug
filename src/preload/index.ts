import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC, type ZzApi } from '../shared/ipc';
import type { AppSnapshot } from '../shared/types';
// Exposes window.__smartspectraBridge for the renderer-side SDK.
import '@smartspectra/node-sdk/preload';

const api: ZzApi = {
  getSnapshot: () => ipcRenderer.invoke(IPC.getSnapshot),
  onSnapshot: (listener) => {
    const handler = (_e: IpcRendererEvent, s: AppSnapshot): void => listener(s);
    ipcRenderer.on(IPC.snapshot, handler);
    return () => ipcRenderer.removeListener(IPC.snapshot, handler);
  },
  giveConsent: (mode) => ipcRenderer.invoke(IPC.giveConsent, mode),
  setUsername: (username) => ipcRenderer.invoke(IPC.setUsername, username),
  saveBaseline: (bpm, samples) => ipcRenderer.invoke(IPC.saveBaseline, bpm, samples),
  recalibrate: () => ipcRenderer.invoke(IPC.recalibrate),
  reportPulse: (bpm, stable) => ipcRenderer.send(IPC.pulse, bpm, stable),
  override: (sentence) => ipcRenderer.invoke(IPC.override, sentence),
  requestCamera: () => ipcRenderer.invoke(IPC.requestCamera),
  getPresageConfig: () => ipcRenderer.invoke(IPC.presageConfig),
  setPresageKey: (key) => ipcRenderer.invoke(IPC.setPresageKey, key),
  getLog: () => ipcRenderer.invoke(IPC.getLog),
  deleteAllData: () => ipcRenderer.invoke(IPC.deleteAll),
  setDiagnostics: (open) => ipcRenderer.invoke(IPC.setDiagnostics, open),
  getDiagnostics: () => ipcRenderer.invoke(IPC.getDiagnostics),
  log: (level, message) => ipcRenderer.send(IPC.log, level, message),
};

contextBridge.exposeInMainWorld('zz', api);
