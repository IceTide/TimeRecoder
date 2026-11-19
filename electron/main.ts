import { app, BrowserWindow, ipcMain, Notification, shell } from 'electron'
import * as path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

const isDev = !app.isPackaged
let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: 'TimeRecoder',
    backgroundColor: '#0e0f13', // 与深色主题一致，避免启动时白闪
    darkTheme: true, // Windows/Linux 使用深色系统标题栏
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

// Phase 2：读取本机活动窗口信息（进程名 + 标题），用于自动时间追踪
const ACTIVE_WINDOW_PS = `
  Add-Type @"
    using System;
    using System.Runtime.InteropServices;
    using System.Text;
    public class Win32 {
      [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
      [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
      [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    }
  "@
  $w = [Win32]::GetForegroundWindow()
  $procId = [uint32]0
  [Win32]::GetWindowThreadProcessId($w, [ref]$procId) | Out-Null
  $appName = ''
  try { $appName = (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch {}
  $sb = New-Object System.Text.StringBuilder 512
  [Win32]::GetWindowText($w, $sb, 512) | Out-Null
  $title = $sb.ToString()
  $json = @{ app = $appName; title = $title } | ConvertTo-Json -Compress
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  Write-Output $json
`

interface ActiveWindowInfo { app: string; title: string }

async function readActiveWindow(): Promise<ActiveWindowInfo> {
  if (process.platform !== 'win32') return { app: '', title: '' }
  try {
    const { stdout } = await execFileAsync(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', ACTIVE_WINDOW_PS],
      { encoding: 'utf8', timeout: 3000, windowsHide: true },
    )
    const line = stdout.trim().split('\n').find((l) => l.trim().startsWith('{')) || '{}'
    const parsed = JSON.parse(line) as Partial<ActiveWindowInfo>
    return { app: String(parsed.app ?? ''), title: String(parsed.title ?? '') }
  } catch {
    return { app: '', title: '' }
  }
}

// 返回结构化 JSON 字符串（渲染进程侧解析），避免依赖 IPC 结构化克隆的类型丢失
ipcMain.handle('active-window-info', async () => JSON.stringify(await readActiveWindow()))

// 兼容旧接口：仅返回标题
ipcMain.handle('active-window-title', async () => (await readActiveWindow()).title)

// 供渲染进程判断是否 packaged
ipcMain.handle('is-dev', () => isDev)

// 便于定位资源路径（调试用）
ipcMain.handle('resources-path', () => process.resourcesPath)
