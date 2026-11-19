import { app, BrowserWindow, ipcMain, Notification, shell } from 'electron'
import * as path from 'path'

const isDev = !app.isPackaged
let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: 'TimeRecoder',
    backgroundColor: '#f6f7f9',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    // 打包后：渲染产物在 app 根目录的 dist 下
    const indexPath = path.join(process.resourcesPath, 'dist', 'index.html')
    mainWindow.loadFile(indexPath).catch(() => {
      const fallback = path.join(__dirname, '..', 'dist', 'index.html')
      mainWindow?.loadFile(fallback)
    })
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// 允许渲染进程打开外部链接（系统默认浏览器）
ipcMain.handle('open-external', (_e, url: string) => {
  if (/^https?:\/\//.test(url)) return shell.openExternal(url)
  return
})

// 系统通知：专注结束 / 休息提醒
ipcMain.handle('notify', (_e, payload: { title: string; body: string }) => {
  if (Notification.isSupported()) {
    new Notification({ title: payload.title, body: payload.body }).show()
  }
})

ipcMain.handle('app-version', () => app.getVersion())

// Phase 2 预留：读取本机活动窗口标题，用于自动时间追踪
ipcMain.handle('active-window-title', async () => {
  if (process.platform !== 'win32') return ''
  try {
    const { execFileSync } = await import('child_process')
    const ps = `
      Add-Type @"
        using System;
        using System.Runtime.InteropServices;
        using System.Text;
        public class Win32 {
          [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
          [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
        }
      "@
      $w = [Win32]::GetForegroundWindow()
      $sb = New-Object System.Text.StringBuilder 512
      [Win32]::GetWindowText($w, $sb, 512) | Out-Null
      $sb.ToString()
    `
    return execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      encoding: 'utf8',
      timeout: 3000,
    }).trim()
  } catch {
    return ''
  }
})

// 供渲染进程判断是否 packaged
ipcMain.handle('is-dev', () => isDev)

// 便于定位资源路径（调试用）
ipcMain.handle('resources-path', () => process.resourcesPath)
