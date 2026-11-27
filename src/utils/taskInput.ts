import { addDays, addMonths, addWeeks, setHours, setMinutes, startOfDay } from 'date-fns'
import type { Priority, Recurrence } from '../types'

export interface ParsedTaskInput {
  title: string
  priority?: Priority
  estimatedMin?: number
  dueDate?: number
  projectName?: string
  tags: string[]
  recurrence?: Recurrence
}

export const RECURRENCE_LABEL: Record<Recurrence, string> = {
  none: '不重复',
  daily: '每天',
  weekdays: '工作日',
  weekly: '每周',
  monthly: '每月',
}

export const newSubtaskId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

const WEEKDAYS: Record<string, number> = {
  日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6,
}

function takeMatch(text: string, pattern: RegExp): { matched: string; groups: string[] } | null {
  const m = text.match(pattern)
  if (!m) return null
  return { matched: m[0], groups: m.slice(1) }
}

/** 解析「明天 15:00 高优先级 评审 @产品 #会议 预计60分 每周」这类自然语言输入 */
export function parseTaskInput(raw: string, now = Date.now()): ParsedTaskInput {
  let rest = raw.trim()
  const result: ParsedTaskInput = { title: '', tags: [] }
  let dueDate: number | undefined
  if (!rest) return result

  // 「每周五」既表示重复规则，也隐含了首次截止日，必须整体消费，不能只删「每周」
  const weeklyDayHit = takeMatch(rest, /每周([一二三四五六日天])|每星期([一二三四五六日天])/)
  if (weeklyDayHit) {
    const key = weeklyDayHit.groups.find(Boolean)!
    const current = new Date(now).getDay()
    const delta = (WEEKDAYS[key] - current + 7) % 7 || 7
    result.recurrence = 'weekly'
    dueDate = addDays(startOfDay(now), delta).getTime()
    rest = rest.replace(weeklyDayHit.matched, ' ')
  }

  // 其他重复规则
  const recurrencePatterns: { re: RegExp; value: Recurrence }[] = [
    { re: /工作日|每周一至周五|weekdays/i, value: 'weekdays' },
    { re: /每天|每日|daily/i, value: 'daily' },
    { re: /每月|monthly/i, value: 'monthly' },
    { re: /每周|每星期|weekly/i, value: 'weekly' },
    { re: /不重复|单次|none/i, value: 'none' },
  ]
  for (const { re, value } of recurrencePatterns) {
    const hit = takeMatch(rest, re)
    if (hit) {
      result.recurrence = value
      rest = rest.replace(re, ' ')
      break
    }
  }

  // 优先级
  const priorityHit = takeMatch(rest, /[!！]\s*([高中低])|([高中低])优先/)
  if (priorityHit) {
    const p = priorityHit.groups.find(Boolean)
    if (p === '高' || p === '中' || p === '低') {
      result.priority = ({ 高: 'high', 中: 'medium', 低: 'low' } as const)[p]
      rest = rest.replace(priorityHit.matched, ' ')
    }
  }

  // 项目 @名称（取第一个，其余保留为普通文字）
  const projectHit = takeMatch(rest, /@([^\s#@,，]+)/)
  if (projectHit) {
    result.projectName = projectHit.groups[0].trim()
    rest = rest.replace(projectHit.matched, ' ')
  }

  // 标签 #名称
  rest = rest.replace(/(?:^|\s)#([^\s#@,，]+)/g, (_all, tag: string) => {
    result.tags.push(tag.trim())
    return ' '
  })

  // 预计时长
  const durationHit = takeMatch(rest, /预计\s*(\d+(?:\.\d+)?)\s*(小时|时|h|分钟|分|m)?/i)
  if (durationHit) {
    const amount = Number(durationHit.groups[0])
    const unit = (durationHit.groups[1] || '').toLowerCase()
    const isHour = unit === '小时' || unit === '时' || unit === 'h'
    if (Number.isFinite(amount)) {
      result.estimatedMin = Math.max(1, Math.round(isHour ? amount * 60 : amount))
      rest = rest.replace(durationHit.matched, ' ')
    }
  }

  // 截止日期。多个日期 token 只取第一个，其余留给标题，避免误删正文。
  type DateHandler = (groups: string[]) => number | undefined
  const dateRules: { re: RegExp; build: DateHandler }[] = [
    {
      re: /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/,
      build: (g) => new Date(Number(g[0]), Number(g[1]) - 1, Number(g[2])).getTime(),
    },
    {
      re: /(\d{1,2})月(\d{1,2})[日号]/,
      build: (g) => {
        const d = new Date(new Date(now).getFullYear(), Number(g[0]) - 1, Number(g[1]))
        return d.getTime() < startOfDay(now).getTime()
          ? new Date(d.getFullYear() + 1, d.getMonth(), d.getDate()).getTime()
          : d.getTime()
      },
    },
    { re: /今天|今日/, build: () => startOfDay(now).getTime() },
    { re: /明天|明日/, build: () => addDays(startOfDay(now), 1).getTime() },
    { re: /后天/, build: () => addDays(startOfDay(now), 2).getTime() },
    {
      re: /下周([一二三四五六日天])/,
      build: (g) => {
        const current = new Date(now).getDay()
        const delta = (WEEKDAYS[g[0]] - current + 7) % 7
        return addDays(startOfDay(now), delta + 7).getTime()
      },
    },
    {
      re: /本周([一二三四五六日天])|周([一二三四五六日天])|星期([一二三四五六日天])/,
      build: (g) => {
        const key = g.find(Boolean) ?? '一'
        const current = new Date(now).getDay()
        const delta = (WEEKDAYS[key] - current + 7) % 7 || 7
        return addDays(startOfDay(now), delta).getTime()
      },
    },
  ]

  for (const rule of dateRules) {
    const hit = takeMatch(rest, rule.re)
    if (!hit) continue
    const built = rule.build(hit.groups)
    if (built !== undefined) {
      dueDate = built
      rest = rest.replace(rule.re, ' ')
      break
    }
  }

  // 时刻（支持上午/下午）
  const timeHit = takeMatch(rest, /(上午|下午|早上|晚上)?\s*(\d{1,2})[:：](\d{2})/)
  if (timeHit) {
    let hour = Number(timeHit.groups[1])
    const minute = Number(timeHit.groups[2])
    const meridiem = timeHit.groups[0]
    if ((meridiem === '下午' || meridiem === '晚上') && hour < 12) hour += 12
    if ((meridiem === '上午' || meridiem === '早上') && hour === 12) hour = 0
    if (hour < 24 && minute < 60) {
      const base = dueDate !== undefined ? new Date(dueDate) : new Date(now)
      const withTime = setMinutes(setHours(startOfDay(base), hour), minute)
      // 没有明确日期时，若今天这个时刻已过去则自动顺延到明天
      dueDate = dueDate === undefined && withTime.getTime() < now
        ? addDays(withTime, 1).getTime()
        : withTime.getTime()
      rest = rest.replace(timeHit.matched, ' ')
    }
  }

  result.title = rest.replace(/\s+/g, ' ').replace(/^[，,。；;、\s]+/, '').trim()
  if (!result.title) result.title = raw.trim()
  if (dueDate !== undefined) result.dueDate = dueDate
  return result
}

/** 计算下一次重复任务的截止日期；weekdays 自动跳过周末 */
export function nextOccurrence(from: number, recurrence: Recurrence): number {
  const base = new Date(from)
  switch (recurrence) {
    case 'daily': return addDays(base, 1).getTime()
    case 'weekdays': {
      let next = addDays(base, 1)
      while (next.getDay() === 0 || next.getDay() === 6) next = addDays(next, 1)
      return next.getTime()
    }
    case 'weekly': return addWeeks(base, 1).getTime()
    case 'monthly': return addMonths(base, 1).getTime()
    default: return from
  }
}
