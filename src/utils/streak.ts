import { addDays, differenceInCalendarDays, startOfDay } from 'date-fns'
import { fmtDate } from './time'

export interface FocusStreaks {
  /** 今天有记录则从今天起算，否则从昨天起算；今天尚未结束不算断签 */
  current: number
  /** 全部历史中的最长连续天数 */
  best: number
}

/** 输入 yyyy-MM-dd 形式的专注日期集合，计算当前/历史最长连续天数 */
export function computeFocusStreaks(days: Iterable<string>, now = Date.now()): FocusStreaks {
  const daySet = new Set(days)
  let current = 0
  let cursor = startOfDay(now)
  if (!daySet.has(fmtDate(cursor.getTime(), 'yyyy-MM-dd'))) cursor = addDays(cursor, -1)
  while (daySet.has(fmtDate(cursor.getTime(), 'yyyy-MM-dd'))) {
    current++
    cursor = addDays(cursor, -1)
  }

  let best = 0
  let run = 0
  let previous: Date | null = null
  for (const key of [...daySet].sort()) {
    const day = new Date(`${key}T00:00:00`)
    run = previous && differenceInCalendarDays(day, previous) === 1 ? run + 1 : 1
    best = Math.max(best, run)
    previous = day
  }
  return { current, best }
}
