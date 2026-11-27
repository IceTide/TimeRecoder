import { contextBridge, ipcRenderer } from 'electron'

// 只暴露白名单 API，渲染进程拿不到 ipcRenderer 本体
const api = {
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  notify: (title: string, body: string) => ipcRenderer.invoke('notify', { title, body }),
  getVersion: () => ipcRenderer.invoke('app-version'),
  isDev: () => ipcRenderer.invoke('is-dev'),
  activeWindowTitle: () => ipcRenderer.invoke('active-window-title'),
  activeWindowInfo: () => ipcRenderer.invoke('active-window-info'),
  /** Obsidian 每日日志：选择文件夹 / 写日志 / 检查路径 */
  pickFolder: () => ipcRenderer.invoke('pick-folder') as Promise<string | null>,
  writeDailyNote: (baseDir: string, fileName: string, content: string) =>
    ipcRenderer.invoke('write-daily-note', { baseDir, fileName, content }) as Promise<string>,
  checkFolder: (folder: string) => ipcRenderer.invoke('check-folder', folder) as Promise<{ ok: boolean; reason: string }>,
  /** 监听托盘/全局快捷键动作，返回取消监听函数 */
  onAppAction: (handler: (action: string) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, action: string) => handler(action)
    ipcRenderer.on('app-action', listener)
    return () => ipcRenderer.removeListener('app-action', listener)
  },
  /** 通知主进程：渲染侧的退出结算已完成，可以真正退出 */
  quitReady: () => ipcRenderer.send('quit-ready'),
}

contextBridge.exposeInMainWorld('electronAPI', api)

export type ElectronAPI = typeof api
