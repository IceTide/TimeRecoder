/**
 * Obsidian 每日日志生成
 * 把当天的时间记录渲染为 Markdown Daily Note，纯函数、零依赖。
 * 写入由 Electron 主进程完成（用户选定文件夹内，仅 .md 文件）。
 */
import type { Task, TimeCategory, TimeEntry } from '../types'
import { CATEGORY_LABEL, fmtDuration, fmtTime } from './time'

export const DEFAULT_LOG_TEMPLATE = `## 时间投入

- 总记录：{{total}}
- 专注：{{focus}}（{{sessions}} 次）
- 完成的任务：{{doneTasks}}

{{categories}}

## 时间明细

{{timeline}}

## 备注

{{notes}}
`

export const DEFAULT_WRITE_TIME = '21:00'

/** 支持的占位符（用于设置页提示） */
export const LOG_PLACEHOLDERS = [
  { key: '{{date}}', desc: '日期 YYYY-MM-DD' },
  { key: '{{weekday}}', desc: '星期' },
  { key: '{{total}}', desc: '总记录时长' },
  { key: '{{focus}}', desc: '专注时长' },
  { key: '{{sessions}}', desc: '完成专注次数' },
  { key: '{{doneTasks}}', desc: '完成任务数' },
  { key: '{{categories}}', desc: '类别分布列表' },
  { key: '{{timeline}}', desc: '时间记录明细' },
  { key: '{{notes}}', desc: '记录备注列表' },
] as const

const CATS: TimeCategory[] = ['focus', 'meeting', 'admin', 'learning', 'other']
const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']

function sumSec(list: TimeEntry[]): number {
  return list.reduce((s, e) => s + (Number.isFinite(e.durationSec) ? Math.max(0, e.durationSec) : 0), 0)
}

/** 统一有效记录口径：渲染与“当天是否有数据”必须一致，否则会写出空日记并标记已写 */
export function cleanEntries(list: TimeEntry[]): TimeEntry[] {
  return list.filter((e) => Number.isFinite(e.durationSec) && e.durationSec > 0)
}

/** 生成 YYYY-MM-DD.md 文件名（按本地日期） */
export function dailyNoteFileName(at: number = Date.now()): string {
  const d = new Date(at)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}.md`
}

/** 判断 "HH:mm" 是否合法 */
export function isValidWriteTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
}

export interface LogContext {
  /** 当天的记录（调用方按日期筛好） */
  dayEntries: TimeEntry[]
  /** 当天完成的专注会话数 */
  sessions: number
  /** 所有任务（用于统计当天完成数） */
  tasks: Task[]
  /** 模板，空则用默认 */
  template?: string
  /** 日期时间戳 */
  at?: number
}

/** 把当天数据渲染成 Markdown */
export function renderDailyLog(ctx: LogContext): string {
  const at = ctx.at ?? Date.now()
  const d = new Date(at)
  const entries = cleanEntries(ctx.dayEntries)
  const totalSec = sumSec(entries)
  const focusSec = sumSec(entries.filter((e) => e.category === 'focus'))
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

  // 类别分布
  const catLines = CATS
    .map((c) => ({ c, sec: sumSec(entries.filter((e) => e.category === c)) }))
    .filter((x) => x.sec > 0)
    .map((x) => `- ${CATEGORY_LABEL[x.c]}：${fmtDuration(x.sec)}`)
  const categories = catLines.length ? catLines.join('\n') : '- 暂无记录'

  // 时间明细（按开始时间排序）
  const timeline = entries
    .slice()
    .sort((a, b) => a.startAt - b.startAt)
    .map((e) => {
      const task = e.taskId !== undefined ? ctx.tasks.find((t) => t.id === e.taskId) : undefined
      const name = task?.title || e.note || CATEGORY_LABEL[e.category]
      return `- ${fmtTime(e.startAt)}–${fmtTime(e.endAt)}　${name}（${fmtDuration(e.durationSec)}）`
    })
    .join('\n') || '- 暂无记录'

  // 备注
  const notes = entries
    .map((e) => e.note?.trim())
    .filter((n): n is string => !!n)
    .filter((n, i, arr) => arr.indexOf(n) === i)
    .map((n) => `- ${n}`)
    .join('\n') || '- 无'

  // 当天完成任务（completedAt 落在当天）
  const dayStart = new Date(d); dayStart.setHours(0, 0, 0, 0)
  const dayEnd = new Date(d); dayEnd.setHours(23, 59, 59, 999)
  const doneCount = ctx.tasks.filter((t) => {
    if (!t.completedAt) return false
    return t.completedAt >= dayStart.getTime() && t.completedAt <= dayEnd.getTime()
  }).length

  const values: Record<string, string> = {
    '{{date}}': date,
    '{{weekday}}': WEEKDAYS[d.getDay()],
    '{{total}}': fmtDuration(totalSec),
    '{{focus}}': fmtDuration(focusSec),
    '{{sessions}}': String(ctx.sessions),
    '{{doneTasks}}': String(doneCount),
    '{{categories}}': categories,
    '{{timeline}}': timeline,
    '{{notes}}': notes,
  }

  const template = (ctx.template || DEFAULT_LOG_TEMPLATE).trim()
  const rendered = template.replace(/\{\{(\w+)\}\}/g, (match) => values[match] ?? match)
  return `${rendered.trim()}\n`
}

/** 空数据是否也应生成：默认否，避免每天写空文件 */
export function hasAnyData(dayEntries: TimeEntry[], sessions: number, tasks: Task[], at: number = Date.now()): boolean {
  if (Number.isFinite(sessions) && sessions > 0) return true
  if (cleanEntries(dayEntries).length > 0) return true
  const d = new Date(at)
  const dayStart = new Date(d); dayStart.setHours(0, 0, 0, 0)
  const dayEnd = new Date(d); dayEnd.setHours(23, 59, 59, 999)
  return tasks.some((t) => t.completedAt && t.completedAt >= dayStart.getTime() && t.completedAt <= dayEnd.getTime())
}
