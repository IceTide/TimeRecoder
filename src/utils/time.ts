import { format, isToday, isYesterday, startOfDay, endOfDay } from 'date-fns'
import { zhCN } from 'date-fns/locale'

export function fmtDate(ts: number, pattern = 'yyyy-MM-dd') {
  return format(ts, pattern, { locale: zhCN })
}

export function fmtTime(ts: number) {
  return format(ts, 'HH:mm')
}

export function fmtDuration(sec: number) {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h}小时${m}分`
  if (m > 0) return `${m}分${s % 60}秒`
  return `${s}秒`
}

export function fmtClock(sec: number) {
  const s = Math.max(0, Math.floor(sec))
  const m = Math.floor(s / 60)
  const ss = s % 60
  return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

export function fmtFriendlyDay(ts: number) {
  if (isToday(ts)) return '今天'
  if (isYesterday(ts)) return '昨天'
  return format(ts, 'M月d日', { locale: zhCN })
}

export function dayRange(ts: number) {
  return { start: startOfDay(ts).getTime(), end: endOfDay(ts).getTime() }
}

export const CATEGORY_LABEL: Record<string, string> = {
  focus: '专注',
  meeting: '会议',
  admin: '事务',
  learning: '学习',
  other: '其他',
}

export const CATEGORY_COLOR: Record<string, string> = {
  focus: '#5b6ef5',
  meeting: '#f2994a',
  admin: '#9b9faa',
  learning: '#27ae60',
  other: '#bb6bd9',
}

export const PRIORITY_LABEL: Record<string, string> = {
  low: '低',
  medium: '中',
  high: '高',
}

export const STATUS_LABEL: Record<string, string> = {
  todo: '待办',
  doing: '进行中',
  done: '已完成',
}
