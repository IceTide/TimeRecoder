import { app, BrowserWindow, ipcMain, Notification, shell, Tray, Menu, globalShortcut, nativeImage } from 'electron'
import * as path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { makeTrayIconDataURL } from './tray-icon'

const execFileAsync = promisify(execFile)

const isDev = !app.isPackaged
let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false // 区分「关闭窗口」与「真正退出」

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: 'TimeRecoder',
    backgroundColor: '#141619', // 与哑光深色主题一致，避免启动时白闪
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

  // 关闭按钮隐藏到托盘（后台继续做自动追踪），真正退出走托盘菜单
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

/** 显示并聚焦主窗口 */
function showWindow() {
  if (!mainWindow) createWindow()
  else {
    mainWindow.show()
    mainWindow.focus()
  }
}

/** 切换主窗口显示/隐藏 */
function toggleWindow() {
  if (!mainWindow) { createWindow(); return }
  if (mainWindow.isVisible() && !mainWindow.isMinimized()) mainWindow.hide()
  else showWindow()
}

/** 向渲染进程发送托盘/快捷键动作 */
function sendToRenderer(action: string) {
  mainWindow?.webContents.send('app-action', action)
}

/** 构建系统托盘及其右键菜单 */
function createTray() {
  if (tray) return
  // 图标由代码生成的合法 PNG data URL 加载（已验证签名/尺寸正确）
  const icon = nativeImage.createFromDataURL(makeTrayIconDataURL(32))
  tray = new Tray(icon)
  tray.setToolTip('TimeRecoder · 专注记录时间')

  const menu = Menu.buildFromTemplate([
    { label: '显示 / 隐藏窗口', click: toggleWindow },
    { type: 'separator' },
    { label: '开始专注（30 分钟）', click: () => sendToRenderer('start-focus') },
    { label: '结束当前专注', click: () => sendToRenderer('finish-focus') },
    { type: 'separator' },
    { label: '打开设置', click: () => { showWindow(); sendToRenderer('goto-settings') } },
    { type: 'separator' },
    {
      label: '退出 TimeRecoder',
      click: () => { isQuitting = true; app.quit() },
    },
  ])
  tray.setContextMenu(menu)
  tray.on('click', toggleWindow) // 左键点击切换窗口
}

/** 注册全局快捷键（失焦时也可用） */
function registerShortcuts() {
  // 专注开关：Ctrl/Cmd + Shift + F
  globalShortcut.register('CommandOrControl+Shift+F', () => sendToRenderer('toggle-focus'))
  // 显示/隐藏窗口：Ctrl/Cmd + Shift + D
  globalShortcut.register('CommandOrControl+Shift+D', () => toggleWindow())
}

app.whenReady().then(() => {
  createWindow()
  createTray()
  registerShortcuts()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) showWindow()
  })
})

// 退出握手：先让渲染进程结算自动追踪当前段并落库，再真正退出。
// 带 2 秒兜底，避免渲染进程无响应时卡死退出流程。
let quitConfirmed = false
let quitFallback: ReturnType<typeof setTimeout> | null = null

app.on('before-quit', (event) => {
  isQuitting = true
  if (quitConfirmed) return // 握手已完成或已兜底放行
  event.preventDefault()
  sendToRenderer('prepare-quit')
  quitFallback = setTimeout(() => {
    quitConfirmed = true
    app.quit()
  }, 2000)
})

ipcMain.on('quit-ready', () => {
  if (quitFallback) { clearTimeout(quitFallback); quitFallback = null }
  quitConfirmed = true
  app.quit()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  // 有托盘时常驻后台，不因窗口关闭而退出
  if (!tray && process.platform !== 'darwin') app.quit()
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
  $json = @{ app = $appName; title = $title } | ConvertTo-Json -Compress -Depth 3
  # 用 Base64 传输，规避 Windows 控制台代码页导致的中文乱码
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  Write-Output ([System.Convert]::ToBase64String($bytes))
`

interface ActiveWindowInfo { app: string; title: string }

async function readActiveWindow(): Promise<ActiveWindowInfo> {
  if (process.platform !== 'win32') return { app: '', title: '' }
  try {
    const { stdout } = await execFileAsync(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', ACTIVE_WINDOW_PS],
      { encoding: 'ascii', timeout: 3000, windowsHide: true },
    )
    // 输出为单行 Base64（UTF-8 JSON），解码后再解析，避免中文乱码
    const b64 = stdout.replace(/\s+/g, '')
    const json = Buffer.from(b64, 'base64').toString('utf8')
    const parsed = JSON.parse(json) as Partial<ActiveWindowInfo>
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
