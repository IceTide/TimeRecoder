import { contextBridge, ipcRenderer } from 'electron'

// 只暴露白名单 API，渲染进程拿不到 ipcRenderer 本体
const api = {
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  notify: (title: string, body: string) => ipcRenderer.invoke('notify', { title, body }),
  getVersion: () => ipcRenderer.invoke('app-version'),
  isDev: () => ipcRenderer.invoke('is-dev'),
  activeWindowTitle: () => ipcRenderer.invoke('active-window-title'),
}

contextBridge.exposeInMainWorld('electronAPI', api)

export type ElectronAPI = typeof api
