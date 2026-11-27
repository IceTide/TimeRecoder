import { addDays, addMonths, startOfWeek } from 'date-fns'
import type { CalendarEvent, EventType } from '../types'

/** 解析 iCalendar 文本（兼容 Google/Outlook 导出的 .ics），返回可写入本地库的日程。 */
export function parseIcs(raw: string): CalendarEvent[] {
  const unfolded = raw.replace(/\r\n/g, '\n').split('\n').reduce<string[]>((lines, line) => {
    if (/^[ \t]/.test(line) && lines.length) lines[lines.length - 1] += line.slice(1)
    else lines.push(line)
    return lines
  }, [])

  const blocks: string[][] = []
  let current: string[] | null = null
  for (const line of unfolded) {
    if (line === 'BEGIN:VEVENT') current = []
    else if (line === 'END:VEVENT') {
      if (current) blocks.push(current)
      current = null
    } else if (current) current.push(line)
  }

  const result: CalendarEvent[] = []
  for (const block of blocks) {
    const props = new Map<string, { value: string; params: string }>()
    for (const line of block) {
      const colon = line.indexOf(':')
      if (colon < 0) continue
      const head = line.slice(0, colon)
      const semi = head.indexOf(';')
      const key = (semi >= 0 ? head.slice(0, semi) : head).toUpperCase()
      const params = semi >= 0 ? head.slice(semi + 1) : ''
      props.set(key, { value: line.slice(colon + 1), params })
    }

    const startProp = props.get('DTSTART')
    if (!startProp) continue
    const startAt = parseICalDate(startProp)
    if (startAt === undefined) continue
    const endProp = props.get('DTEND')
    const parsedEnd = endProp ? parseICalDate(endProp) : undefined
    const endAt = parsedEnd && parsedEnd > startAt
      ? parsedEnd
      : startAt + (/VALUE=DATE/.test(startProp.params) ? 86400_000 : 30 * 60_000)

    const title = unescapeIcs(props.get('SUMMARY')?.value || '未命名日程')
    const note = unescapeIcs(props.get('DESCRIPTION')?.value || '') || undefined
    const rrule = props.get('RRULE')?.value
    const occurrences = expandRecurrence(startAt, endAt, rrule)

    for (const [s, e] of occurrences) {
      result.push({
        title,
        startAt: s,
        endAt: e,
        type: guessEventType(`${title} ${note ?? ''}`),
        note,
      })
      if (result.length >= 300) return result
    }
  }
  return result
}

function parseICalDate(prop: { value: string; params: string }): number | undefined {
  const value = prop.value.trim()
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(value)
  if (dateOnly) {
    return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])).getTime()
  }
  const dateTime = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(value)
  if (!dateTime) return undefined
  const [, y, m, d, hh, mm, ss, utc] = dateTime
  if (utc || /TZID=(UTC|Etc\/UTC|GMT)/i.test(prop.params)) {
    return Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss))
  }
  // 其他 TZID 按本地时间解释：不引入时区库，避免依赖膨胀；导出时仍使用本地时间。
  return new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss)).getTime()
}

function unescapeIcs(value: string): string {
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim()
}

function guessEventType(text: string): EventType {
  if (/会议|评审|meeting|standup|sync|call/i.test(text)) return 'meeting'
  if (/休息|午休|break|lunch/i.test(text)) return 'break'
  if (/个人|健身|personal|gym/i.test(text)) return 'personal'
  return 'task'
}

const BYDAY_MAP: Record<string, number> = {
  MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 0,
}

/** ICS 的 SU=0 对应 JS getDay() 的周日；周一为一周起点时需要特别映射。 */
const mondayBasedIndex = (jsDay: number) => (jsDay === 0 ? 6 : jsDay - 1)

/** 只展开常见的 daily/weekly/monthly 规则；不支持的规则保留首条occurrence，避免误导入。 */
function expandRecurrence(startAt: number, endAt: number, rule?: string): [number, number][] {
  const duration = Math.max(60_000, endAt - startAt)
  if (!rule) return [[startAt, endAt]]

  const params = new Map<string, string>()
  for (const part of rule.split(';')) {
    const [key, value] = part.split('=')
    if (key && value) params.set(key.toUpperCase(), value.toUpperCase())
  }
  const interval = Math.max(1, Number(params.get('INTERVAL')) || 1)
  const count = Math.max(1, Math.min(200, Number(params.get('COUNT')) || 60))
  const untilRaw = params.get('UNTIL')
  const until = untilRaw ? parseICalDate({ value: untilRaw, params: '' }) : undefined
  const freq = params.get('FREQ')
  const byDays = (params.get('BYDAY') || '').split(',').map((d) => BYDAY_MAP[d]).filter((d) => d !== undefined)

  const limit = Math.min(until ?? Number.MAX_SAFE_INTEGER, Date.now() + 365 * 86400_000)
  const result: [number, number][] = []

  if (freq === 'DAILY') {
    for (let i = 0; i < count; i++) {
      const s = addDays(startAt, i * interval).getTime()
      if (s > limit) break
      result.push([s, s + duration])
    }
  } else if (freq === 'WEEKLY') {
    const weekStart = startOfWeek(startAt, { weekStartsOn: 1 }).getTime()
    for (let w = 0; w < count && result.length < count; w++) {
      const week = addDays(weekStart, w * interval * 7).getTime()
      const days = byDays.length ? byDays : [new Date(startAt).getDay()]
      for (const day of days) {
        const target = addDays(week, mondayBasedIndex(day))
        const s = new Date(target).setHours(new Date(startAt).getHours(), new Date(startAt).getMinutes(), 0, 0)
        if (s < startAt || s > limit) continue
        result.push([s, s + duration])
        if (result.length >= count) break
      }
    }
  } else if (freq === 'MONTHLY') {
    for (let i = 0; i < count; i++) {
      const s = addMonths(startAt, i * interval).getTime()
      if (s > limit) break
      result.push([s, s + duration])
    }
  } else {
    result.push([startAt, endAt])
  }

  return result.length ? result : [[startAt, endAt]]
}

function escapeIcs(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
}

function formatICalDate(timestamp: number): string {
  const d = new Date(timestamp)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

/** 导出为可被 Google Calendar / Outlook 直接导入的 .ics 文本 */
export function eventsToIcs(events: CalendarEvent[]): string {
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//TimeRecoder//Local-first Time Manager//ZH',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:TimeRecoder 日程',
    `X-WR-TIMEZONE:${tz}`,
  ]
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:timerecoder-${e.id ?? `${e.startAt}-${e.title.length}`}@local`,
      `DTSTAMP:${now}`,
      `DTSTART;TZID=${tz}:${formatICalDate(e.startAt)}`,
      `DTEND;TZID=${tz}:${formatICalDate(e.endAt)}`,
      `SUMMARY:${escapeIcs(e.title)}`,
    )
    if (e.note) lines.push(`DESCRIPTION:${escapeIcs(e.note)}`)
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}

export function downloadIcs(events: CalendarEvent[], fileName: string) {
  const blob = new Blob([eventsToIcs(events)], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export const eventIdentity = (e: CalendarEvent) => `${e.title}|${e.startAt}|${e.endAt}`
