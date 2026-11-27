import { useCallback, useEffect, useRef } from 'react'
import { getSetting, setSetting } from '../db/database'
import { useStore } from '../store/useStore'
import type { Task, TimeEntry } from '../types'
import {
  dailyNoteFileName, hasAnyData, isValidWriteTime, renderDailyLog,
} from '../utils/obsidianLog'

export interface ObsidianConfig {
  enabled: boolean
  folder: string
  writeTime: string
  template: string
}

export const DEFAULT_OBSIDIAN_CONFIG: ObsidianConfig = {
  enabled: false,
  folder: '',
  writeTime: '21:00',
  template: '',
}

export const OBSIDIAN_SETTING_KEY = 'obsidianLogConfig'
export const OBSIDIAN_LAST_WRITE_KEY = 'obsidianLogLastWrite'

interface Result {
  ok: boolean
  message: string
}

/** 读取配置（带清洗与兜底） */
async function readConfig(): Promise<ObsidianConfig> {
  try {
    const raw = await getSetting<Partial<ObsidianConfig>>(OBSIDIAN_SETTING_KEY, {})
    return {
      enabled: raw?.enabled === true,
      folder: typeof raw?.folder === 'string' ? raw.folder : '',
      writeTime: isValidWriteTime(raw?.writeTime || '') ? raw!.writeTime! : DEFAULT_OBSIDIAN_CONFIG.writeTime,
      template: typeof raw?.template === 'string' ? raw.template : '',
    }
  } catch {
    return { ...DEFAULT_OBSIDIAN_CONFIG }
  }
}

/** 共享核心：配置读写 + 日志写入（不产生自动调度副作用） */
function useObsidianCore() {
  const { entries, tasks, sessions } = useStore()

  const loadConfig = useCallback(() => readConfig(), [])

  const saveConfig = useCallback(async (config: ObsidianConfig) => {
    await setSetting(OBSIDIAN_SETTING_KEY, config)
  }, [])

  const performWrite = useCallback(async (config: ObsidianConfig, now: Date): Promise<Result> => {
    if (!config.folder) return { ok: false, message: '请先选择日志文件夹' }
    const api = window.electronAPI
    if (!api?.writeDailyNote) return { ok: false, message: '当前环境不支持文件写入（请在桌面应用中运行）' }

    const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0)
    const dayEnd = new Date(now); dayEnd.setHours(23, 59, 59, 999)
    const dayEntries = entries.filter((e) => e.startAt >= dayStart.getTime() && e.startAt <= dayEnd.getTime())
    const doneSessions = sessions.filter((s) => {
      if (s.status !== 'completed' || !s.endAt) return false
      return s.endAt >= dayStart.getTime() && s.endAt <= dayEnd.getTime()
    }).length

    if (!hasAnyData(dayEntries, doneSessions, tasks, now.getTime())) {
      return { ok: false, message: '今天还没有可记录的数据' }
    }

    const fileName = dailyNoteFileName(now.getTime())
    const content = renderDailyLog({
      dayEntries: dayEntries as TimeEntry[],
      sessions: doneSessions,
      tasks: tasks as Task[],
      template: config.template,
      at: now.getTime(),
    })
    try {
      await api.writeDailyNote(config.folder, fileName, content)
      await setSetting(OBSIDIAN_LAST_WRITE_KEY, fileName)
      return { ok: true, message: `已写入 ${fileName}` }
    } catch (error) {
      return { ok: false, message: `写入失败：${error instanceof Error ? error.message : '未知错误'}` }
    }
  }, [entries, sessions, tasks])

  return { loadConfig, saveConfig, performWrite }
}

/** 设置页用：配置 + 手动立即写入 */
export function useObsidianLog() {
  const { loadConfig, saveConfig, performWrite } = useObsidianCore()

  const writeNow = useCallback(async (): Promise<Result> => {
    const config = await loadConfig()
    return performWrite(config, new Date())
  }, [loadConfig, performWrite])

  return { loadConfig, saveConfig, writeNow }
}

/** App 层用：到点自动写入（全局挂载，切页不影响） */
export function useObsidianAutoWrite() {
  const { loaded } = useStore()
  const { loadConfig, performWrite } = useObsidianCore()
  const lastCheckRef = useRef(0)

  useEffect(() => {
    // 等数据加载完成后再启动调度，避免首屏 store 为空误判"无数据"
    if (!loaded) return
    let alive = true
    const check = async () => {
      if (!alive) return
      const now = new Date()
      if (now.getTime() - lastCheckRef.current < 55_000) return
      lastCheckRef.current = now.getTime()

      try {
        const config = await loadConfig()
        if (!config.enabled || !config.folder) return
        const [h, m] = config.writeTime.split(':').map(Number)
        if (now.getHours() * 60 + now.getMinutes() < h * 60 + m) return // 未到时间

        const todayFile = dailyNoteFileName(now.getTime())
        const lastFile = await getSetting<string>(OBSIDIAN_LAST_WRITE_KEY, '')
        if (lastFile === todayFile) return // 今天已写过

        await performWrite(config, now)
      } catch {
        // 自动写入失败静默，不打扰用户
      }
    }
    void check()
    const timer = window.setInterval(() => { void check() }, 60_000)
    return () => { alive = false; window.clearInterval(timer) }
  }, [loaded, loadConfig, performWrite])
}
