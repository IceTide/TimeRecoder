import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { addDays, addWeeks, endOfWeek, getISOWeek, isSameDay, startOfWeek } from 'date-fns'
import {
  Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import {
  Check, ChevronLeft, ChevronRight, Clock3, FileBarChart2,
  FileText, FileType, Image as ImageIcon, Loader2, Minus, Target,
  TrendingDown, TrendingUp,
} from 'lucide-react'
import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import EmptyState from '../components/EmptyState'
import { getSetting } from '../db/database'
import { useStore } from '../store/useStore'
import type { TimeCategory, TimeEntry } from '../types'
import { CATEGORY_LABEL, fmtDate, fmtDuration } from '../utils/time'

type ExportKind = 'markdown' | 'png' | 'pdf'

const CATS: TimeCategory[] = ['focus', 'meeting', 'admin', 'learning', 'other']
const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const DEFAULT_GOAL_MIN = 120
const CAPTURE_BG = '#262a31'

/** 旧内核无法解析 oklch 时，token → 色的兜底值（与 index.css 的 oklch 色板等效） */
const TOKEN_FALLBACK: Record<string, string> = {
  '--accent': '#a8d8dc',
  '--accent-dim': '#8bb9bd',
  '--accent-deep': '#5d8189',
  '--amber': '#d9c08a',
  '--cat-focus': '#a8d8dc',
  '--cat-meeting': '#a0aedb',
  '--cat-admin': '#989ca4',
  '--cat-learning': '#a8d4bd',
  '--cat-other': '#c2a4d0',
}

/* Recharts Tooltip：与 StatsPage 一致的仪器面板风格 */
const TOOLTIP_STYLE: CSSProperties = {
  background: 'var(--surface-2)',
  border: '1px solid var(--border)',
  borderRadius: 3,
  color: 'var(--text)',
  fontSize: 12,
  fontFamily: 'var(--font-mono)',
  boxShadow: '0 8px 24px oklch(0% 0 0 / .4)',
}

/**
 * 把设计 token（如 var(--cat-focus) → oklch(...)）解析为 hex。
 * 目的：1) SVG 图表在 html2canvas 截图时颜色可正确还原；2) 不硬编码色值，仍由 token 驱动。
 */
function tokenToHex(value: string, fallback: string): string {
  const input = value.trim()
  if (!input) return fallback
  if (/^#[0-9a-f]{3,8}$/i.test(input)) return input
  let raw = input
  const varMatch = /^var\(\s*(--[\w-]+)\s*\)$/.exec(input)
  if (varMatch) {
    raw = getComputedStyle(document.documentElement).getPropertyValue(varMatch[1]).trim()
    if (!raw) return fallback
  }
  try {
    const probe = document.createElement('canvas')
    probe.width = 1
    probe.height = 1
    const ctx = probe.getContext('2d')
    if (!ctx) return fallback
    ctx.fillStyle = raw
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
    const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`
    // 内核不支持 oklch 时 fillStyle 保持默认黑色，此时回退，避免整张图表变黑
    if (/^(oklch|lch|lab|color\()/i.test(raw) && r === 0 && g === 0 && b === 0) return fallback
    return hex
  } catch {
    return fallback
  }
}

function colorOf(token: string): string {
  return tokenToHex(`var(${token})`, TOKEN_FALLBACK[token] ?? TOKEN_FALLBACK['--accent'])
}

/** html2canvas 不解析 oklch：截图时把全部设计 token 降为等效 hex / rgba */
const CAPTURE_TOKENS: Record<string, string> = {
  '--bg': '#262a31',
  '--surface-1': '#30343c',
  '--surface-2': '#393d45',
  '--surface-3': '#43474f',
  '--bg-deep': '#1e2228',
  '--text': '#eef0f2',
  '--text-sub': '#c8ccd0',
  '--text-faint': '#9aa0a6',
  '--text-mute': '#80868c',
  '--border': '#484d56',
  '--border-soft': '#3b3f47',
  '--border-faint': '#34383f',
  '--accent': '#a8d8dc',
  '--accent-dim': '#8bb9bd',
  '--accent-deep': '#5d8189',
  '--accent-soft': 'rgba(168, 216, 220, 0.10)',
  '--accent-line': 'rgba(168, 216, 220, 0.26)',
  '--accent-glow': 'rgba(168, 216, 220, 0.22)',
  '--accent-wash': 'rgba(168, 216, 220, 0.05)',
  '--accent-halo': 'rgba(168, 216, 220, 0.07)',
  '--grid': 'rgba(168, 216, 220, 0.015)',
  '--cat-focus': '#a8d8dc',
  '--cat-meeting': '#a0aedb',
  '--cat-admin': '#989ca4',
  '--cat-learning': '#a8d4bd',
  '--cat-other': '#c2a4d0',
  '--violet': '#c2a4d0',
  '--green': '#a8d4bd',
  '--amber': '#d9c08a',
  '--orange': '#d9b08a',
  '--red': '#d99a95',
  '--blue': '#a0aedb',
  '--shadow': '0 1px 2px rgba(0, 0, 0, 0.28), 0 10px 30px rgba(0, 0, 0, 0.26)',
  '--shadow-soft': 'inset 0 1px 0 rgba(238, 240, 242, 0.022)',
}

/**
 * 在 html2canvas 的克隆文档里消除 oklch，不污染真实 DOM。
 *
 * 关键点：html2canvas 的 parseBackgroundColor 会额外读取克隆文档 <html>/<body> 的
 * background-color（它们继承 :root 的 oklch），即使只截报告节点也会崩溃；
 * 这正是 "Attempting to parse an unsupported color function oklch" 的来源。
 * onclone 在 parseBackgroundColor / parseTree 之前执行，是唯一可靠的干预点。
 */
function sanitizeCloneForCapture(clonedDoc: Document, clonedRoot: HTMLElement): void {
  // 1) 直接给克隆文档的 html / body 上 hex 背景，修掉 parseBackgroundColor 的崩溃点
  clonedDoc.documentElement.style.setProperty('background-color', CAPTURE_BG, 'important')
  clonedDoc.body.style.setProperty('background-color', CAPTURE_BG, 'important')

  // 2) 全文档 token 降级为 hex；!important 可压过 focus-mode 等局部 oklch 定义
  const tokenRules = Object.entries(CAPTURE_TOKENS)
    .map(([key, value]) => `${key}: ${value} !important;`)
    .join('\n')
  const style = clonedDoc.createElement('style')
  style.textContent = `
    html, html * { ${tokenRules} }
    html .card, html .stat-card { background: ${CAPTURE_TOKENS['--surface-1']} !important; }
    html .recharts-tooltip-wrapper { display: none !important; }
  `
  clonedDoc.head.appendChild(style)

  // 3) 兜底：清理 oklch 内联样式；并把 SVG 的 var(--token) 属性改成 hex 字面量
  //    （Recharts 用 fill/stroke="var(--...)" 绘图，序列化为图片时变量可能丢失）
  clonedRoot.querySelectorAll<Element>('*').forEach((element) => {
    const inline = element.getAttribute('style')
    if (inline && /oklch\(/i.test(inline)) {
      const sanitized = inline.replace(/oklch\([^)]*\)/gi, (match) => tokenToHex(match, CAPTURE_TOKENS['--accent']))
      element.setAttribute('style', sanitized)
    }
    Array.from(element.attributes).forEach((attribute) => {
      const tokenMatch = /^var\(\s*(--[\w-]+)\s*\)$/.exec(attribute.value.trim())
      const hex = tokenMatch ? CAPTURE_TOKENS[tokenMatch[1]] : undefined
      if (hex) element.setAttribute(attribute.name, hex)
    })
  })
}

/** 安全求和：过滤非法/负值，避免 NaN 与脏数据影响聚合 */
function sumSec(list: TimeEntry[]): number {
  return list.reduce((total, entry) => {
    const sec = Number.isFinite(entry.durationSec) ? Math.max(0, entry.durationSec) : 0
    return total + sec
  }, 0)
}

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0
}

/** 通用 Blob 下载（Markdown / PNG 共用） */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // 立即 revoke 在部分内核会中断下载，延迟释放
  window.setTimeout(() => URL.revokeObjectURL(url), 1500)
}

interface DayBucket {
  key: string
  label: string
  min: number
  sec: number
  goalMin: number
  reached: boolean
  ratio: number
  isFuture: boolean
}

interface CategorySlice {
  key: TimeCategory
  name: string
  sec: number
  min: number
  color: string
}

interface ProjectSlice {
  name: string
  sec: number
  min: number
  color: string
}

interface Props {
  onToast: (message: string) => void
}

export default function ReportsPage({ onToast }: Props) {
  const { entries, tasks, projects, sessions } = useStore()
  const [weekOffset, setWeekOffset] = useState(0)
  const [goalMin, setGoalMin] = useState<number>(DEFAULT_GOAL_MIN)
  const [exporting, setExporting] = useState<ExportKind | null>(null)
  const reportRef = useRef<HTMLDivElement>(null)

  // 每日专注目标来自设置页（dailyFocusGoalMin），兜底 120 分钟并防除零
  useEffect(() => {
    let alive = true
    getSetting<number>('dailyFocusGoalMin', DEFAULT_GOAL_MIN).then((value) => {
      if (!alive) return
      const safe = Number.isFinite(value) ? Math.min(1440, Math.max(1, Math.round(value))) : DEFAULT_GOAL_MIN
      setGoalMin(safe)
    }).catch(() => { /* 读取失败时保持默认目标 */ })
    return () => { alive = false }
  }, [])

  // 图表颜色由设计 token 解析而来，仅计算一次
  const palette = useMemo(() => ({
    accent: colorOf('--accent'),
    accentDim: colorOf('--accent-dim'),
    amber: colorOf('--amber'),
    cats: Object.fromEntries(CATS.map((c) => [c, colorOf(`--cat-${c}`)])) as Record<TimeCategory, string>,
  }), [])

  // 周一为一周起点；weekOffset=0 本周，-1 上周，+1 下周
  const weekStart = useMemo(
    () => startOfWeek(addWeeks(new Date(), weekOffset), { weekStartsOn: 1 }),
    [weekOffset],
  )
  const weekEnd = useMemo(() => endOfWeek(weekStart, { weekStartsOn: 1 }), [weekStart])
  const startMs = weekStart.getTime()
  const endMs = weekEnd.getTime()
  const prevStartMs = addWeeks(weekStart, -1).getTime()

  const scoped = useMemo(
    () => entries.filter((e) => e.startAt >= startMs && e.startAt <= endMs),
    [entries, startMs, endMs],
  )
  const prevScoped = useMemo(
    () => entries.filter((e) => e.startAt >= prevStartMs && e.startAt < startMs),
    [entries, prevStartMs, startMs],
  )

  const totalSec = useMemo(() => sumSec(scoped), [scoped])
  const focusSec = useMemo(() => sumSec(scoped.filter((e) => e.category === 'focus')), [scoped])
  const prevFocusSec = useMemo(() => sumSec(prevScoped.filter((e) => e.category === 'focus')), [prevScoped])
  const sessionCount = useMemo(
    () => sessions.filter((s) => s.startAt >= startMs && s.startAt <= endMs).length,
    [sessions, startMs, endMs],
  )
  const doneTasks = useMemo(
    () => tasks.filter((t) => t.status === 'done'
      && typeof t.completedAt === 'number'
      && t.completedAt >= startMs && t.completedAt <= endMs).length,
    [tasks, startMs, endMs],
  )

  const byCategory = useMemo<CategorySlice[]>(() => CATS.map((c) => {
    const sec = sumSec(scoped.filter((e) => e.category === c))
    return { key: c, name: CATEGORY_LABEL[c], sec, min: Math.round(sec / 60), color: palette.cats[c] }
  }).filter((d) => d.sec > 0).sort((a, b) => b.sec - a.sec), [scoped, palette])

  const byProject = useMemo<ProjectSlice[]>(() => {
    const UNTAGGED = '__untagged__'
    const buckets = new Map<string, ProjectSlice>()
    projects.forEach((p) => {
      buckets.set(String(p.id ?? p.name), {
        name: p.name, sec: 0, min: 0,
        color: tokenToHex(p.color, palette.accentDim),
      })
    })
    buckets.set(UNTAGGED, { name: '未分类', sec: 0, min: 0, color: palette.accentDim })
    scoped.forEach((e) => {
      const key = e.projectId !== undefined ? String(e.projectId) : UNTAGGED
      const bucket = buckets.get(key) ?? buckets.get(UNTAGGED)!
      const sec = Number.isFinite(e.durationSec) ? Math.max(0, e.durationSec) : 0
      bucket.sec += sec
    })
    return Array.from(buckets.values())
      .filter((d) => d.sec > 0)
      .map((d) => ({ ...d, min: Math.round(d.sec / 60) }))
      .sort((a, b) => b.sec - a.sec)
  }, [projects, scoped, palette])

  const daily = useMemo<DayBucket[]>(() => WEEKDAYS.map((label, index) => {
    const day = addDays(weekStart, index)
    const sec = sumSec(scoped.filter((e) => isSameDay(e.startAt, day) && e.category === 'focus'))
    const min = Math.round(sec / 60)
    return {
      key: fmtDate(day.getTime(), 'yyyy-MM-dd'),
      label,
      sec,
      min,
      goalMin,
      reached: goalMin > 0 && min >= goalMin,
      ratio: goalMin > 0 ? Math.min(1, min / goalMin) : 0,
      isFuture: day.getTime() > Date.now(),
    }
  }), [weekStart, scoped, goalMin])

  const reachedDays = daily.filter((d) => d.reached).length
  const deltaPct = prevFocusSec > 0 ? Math.round(((focusSec - prevFocusSec) / prevFocusSec) * 100) : null

  const insights = useMemo<string[]>(() => {
    if (totalSec <= 0) {
      return ['本周尚无时间记录。完成一次专注、开启自动追踪，或在「时间统计」页补录时间后，即可生成周报。']
    }
    const trend = deltaPct === null
      ? '上周暂无可比数据'
      : deltaPct > 0 ? `比上周 +${deltaPct}%` : deltaPct < 0 ? `比上周 ${deltaPct}%` : '与上周持平'
    const list = [
      `本周专注 ${fmtDuration(focusSec)}，${trend}，占全部记录时间的 ${pct(focusSec, totalSec)}%。`,
      `共完成 ${doneTasks} 项任务、${sessionCount} 次专注会话，累计记录 ${fmtDuration(totalSec)}。`,
    ]
    if (byCategory.length) {
      list.push(`投入最多的类别是「${byCategory[0].name}」，共 ${fmtDuration(byCategory[0].sec)}，占比 ${pct(byCategory[0].sec, totalSec)}%。`)
    }
    if (byProject.length) {
      list.push(`投入最多的项目是「${byProject[0].name}」，共 ${fmtDuration(byProject[0].sec)}。`)
    }
    list.push(`按每日 ${goalMin} 分钟专注目标计算，本周有 ${reachedDays} / 7 天达标。`)
    return list
  }, [totalSec, focusSec, deltaPct, doneTasks, sessionCount, byCategory, byProject, goalMin, reachedDays])

  const rangeLabel = useMemo(
    () => `${fmtDate(startMs, 'yyyy年M月d日')} — ${fmtDate(endMs, 'yyyy年M月d日')}`,
    [startMs, endMs],
  )
  const fileSlug = useMemo(
    () => `${fmtDate(startMs, 'yyyyMMdd')}-${fmtDate(endMs, 'yyyyMMdd')}`,
    [startMs, endMs],
  )

  /** 生成 Markdown 报表（零依赖，表格 + 列表） */
  const buildMarkdown = useCallback((): string => {
    const lines: string[] = [
      `# 时间周报 · ${rangeLabel}`,
      '',
      `> 生成时间：${fmtDate(Date.now(), 'yyyy-MM-dd HH:mm')} · TimeRecoder`,
      '',
      '## 一、本周概览',
      '',
      '| 指标 | 数值 |',
      '| --- | --- |',
      `| 总记录时长 | ${fmtDuration(totalSec)} |`,
      `| 专注时长 | ${fmtDuration(focusSec)}（占比 ${pct(focusSec, totalSec)}%） |`,
      `| 专注会话数 | ${sessionCount} 次 |`,
      `| 完成任务数 | ${doneTasks} 项 |`,
      `| 每日专注目标 | ${goalMin} 分钟 / 天 |`,
      `| 达标天数 | ${reachedDays} / 7 天 |`,
      '',
      '## 二、类别分布',
      '',
    ]
    if (byCategory.length) {
      lines.push('| 类别 | 时长 | 占比 |', '| --- | --- | --- |')
      byCategory.forEach((d) => lines.push(`| ${d.name} | ${fmtDuration(d.sec)} | ${pct(d.sec, totalSec)}% |`))
    } else {
      lines.push('本周暂无类别数据。')
    }
    lines.push('', '## 三、项目分布', '')
    if (byProject.length) {
      lines.push('| 项目 | 时长 | 占比 |', '| --- | --- | --- |')
      byProject.forEach((d) => lines.push(`| ${d.name} | ${fmtDuration(d.sec)} | ${pct(d.sec, totalSec)}% |`))
    } else {
      lines.push('本周暂无项目数据。')
    }
    lines.push('', '## 四、每日专注', '', '| 日期 | 星期 | 专注时长 | 目标达成 |', '| --- | --- | --- | --- |')
    daily.forEach((d) => {
      lines.push(`| ${d.key} | ${d.label} | ${fmtDuration(d.sec)} | ${d.reached ? '✓ 达标' : '未达标'} |`)
    })
    lines.push('', '## 五、文字洞察', '')
    insights.forEach((text) => lines.push(`- ${text}`))
    lines.push('')
    return lines.join('\n')
  }, [rangeLabel, totalSec, focusSec, sessionCount, doneTasks, goalMin, reachedDays, byCategory, byProject, daily, insights])

  /** 统一导出入口：Markdown / PNG / PDF */
  const handleExport = useCallback(async (kind: ExportKind) => {
    if (exporting) return
    if (totalSec <= 0) {
      onToast('本周暂无数据可导出')
      return
    }
    setExporting(kind)
    try {
      if (kind === 'markdown') {
        downloadBlob(new Blob([`\uFEFF${buildMarkdown()}`], { type: 'text/markdown;charset=utf-8' }), `周报_${fileSlug}.md`)
      } else {
        const node = reportRef.current
        if (!node) throw new Error('报告内容节点不存在')
        // 在 html2canvas 的克隆文档上批量替换 oklch；真实 DOM 不受影响，也无颜色闪烁
        const canvas = await html2canvas(node, {
          scale: 2,
          useCORS: true,
          logging: false,
          backgroundColor: CAPTURE_BG,
          onclone: sanitizeCloneForCapture,
        })
        if (kind === 'png') {
          const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
          if (!blob) throw new Error('PNG 编码失败')
          downloadBlob(blob, `周报_${fileSlug}.png`)
        } else {
          const pdf = new jsPDF({
            orientation: canvas.width >= canvas.height ? 'landscape' : 'portrait',
            unit: 'px',
            format: [canvas.width, canvas.height],
            compress: true,
          })
          pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, canvas.width, canvas.height)
          pdf.save(`周报_${fileSlug}.pdf`)
        }
      }
      onToast(`${kind === 'markdown' ? 'Markdown' : kind.toUpperCase()} 周报导出成功`)
    } catch (error) {
      console.error('[ReportsPage] 导出失败', error)
      onToast('导出失败，请稍后重试')
    } finally {
      setExporting(null)
    }
  }, [exporting, totalSec, onToast, buildMarkdown, fileSlug])

  const isCurrentWeek = weekOffset === 0
  const weekBadge = isCurrentWeek ? '本周' : weekOffset < 0 ? `${-weekOffset} 周前` : `${weekOffset} 周后`

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title">周报生成</div>
          <div className="page-desc">按周回顾投入与产出，一键导出分享</div>
        </div>
        <div className="export-group">
          <button className="btn ghost btn-sm" disabled={exporting !== null}
            onClick={() => void handleExport('markdown')} title="导出 Markdown">
            {exporting === 'markdown' ? <Loader2 size={14} className="spin" /> : <FileText size={14} />}
            Markdown
          </button>
          <button className="btn ghost btn-sm" disabled={exporting !== null}
            onClick={() => void handleExport('png')} title="导出 PNG 图片">
            {exporting === 'png' ? <Loader2 size={14} className="spin" /> : <ImageIcon size={14} />}
            PNG
          </button>
          <button className="btn btn-sm" disabled={exporting !== null}
            onClick={() => void handleExport('pdf')} title="导出 PDF">
            {exporting === 'pdf' ? <Loader2 size={14} className="spin" /> : <FileType size={14} />}
            PDF
          </button>
        </div>
      </div>

      {/* 周切换器：交互控件，不进入截图 */}
      <div className="week-switcher">
        <button className="week-nav" onClick={() => setWeekOffset((n) => n - 1)} title="上一周"><ChevronLeft size={17} /></button>
        <div className="week-range">
          <div className="week-range-main">{rangeLabel}</div>
          <div className="week-range-sub">{weekBadge} · ISO 第 {getISOWeek(weekStart)} 周 · 周一至周日</div>
        </div>
        <button className="week-nav" onClick={() => setWeekOffset((n) => n + 1)} title="下一周"><ChevronRight size={17} /></button>
        <button className="filter-chip" onClick={() => setWeekOffset(0)} disabled={isCurrentWeek}>回到本周</button>
      </div>

      {/* 报告内容区：仅此区域进入截图/导出 */}
      <div className="report-sheet" ref={reportRef}>
        <div className="report-sheet-head">
          <div>
            <div className="report-sheet-title">时间周报</div>
            <div className="report-sheet-range">{rangeLabel} · {weekBadge}</div>
          </div>
          <div className="report-sheet-brand">TimeRecoder / Weekly Report</div>
        </div>

        {totalSec <= 0 ? (
          <EmptyState icon={FileBarChart2} title="本周暂无数据"
            hint="完成专注、开启自动追踪或补录时间后，这里会生成本周的可视化周报" />
        ) : (
          <>
            <div className="stat-grid">
              <div className="stat-card"><div className="k">总记录时长</div><div className="v">{fmtDuration(totalSec)}</div><div className="d">本周累计 · {scoped.length} 条记录</div></div>
              <div className="stat-card"><div className="k">专注时长</div><div className="v" style={{ color: 'var(--accent)' }}>{fmtDuration(focusSec)}</div><div className="d">占比 {pct(focusSec, totalSec)}%</div></div>
              <div className="stat-card"><div className="k">专注会话</div><div className="v">{sessionCount}<span style={{ fontSize: 14 }}> 次</span></div><div className="d">本周累计会话数</div></div>
              <div className="stat-card"><div className="k">完成任务</div><div className="v">{doneTasks}<span style={{ fontSize: 14 }}> 项</span></div><div className="d">本周完成的任务</div></div>
            </div>

            <div className="charts-row">
              <div className="card chart-box">
                <div className="card-title">类别分布</div>
                <div className="card-sub" style={{ marginBottom: 8 }}>按活动类别汇总</div>
                {byCategory.length ? (
                  <>
                    <ResponsiveContainer width="100%" height={220}>
                      <PieChart>
                        <Pie data={byCategory} dataKey="sec" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={3}>
                          {byCategory.map((d) => <Cell key={d.key} fill={d.color} />)}
                        </Pie>
                        <Tooltip formatter={(v) => fmtDuration(Number(v))} contentStyle={TOOLTIP_STYLE}
                          itemStyle={{ color: 'var(--text)' }} labelStyle={{ color: 'var(--text-faint)' }} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="legend">{byCategory.map((d) => <span key={d.key}><i style={{ background: d.color }} />{d.name} {fmtDuration(d.sec)}</span>)}</div>
                  </>
                ) : <EmptyState icon={FileBarChart2} title="暂无类别数据" hint="记录时间后按类别汇总展示" />}
              </div>

              <div className="card chart-box">
                <div className="card-title">项目分布</div>
                <div className="card-sub" style={{ marginBottom: 8 }}>按项目汇总投入时间</div>
                {byProject.length ? (
                  <div style={{ paddingTop: 4 }}>
                    {byProject.slice(0, 6).map((p) => (
                      <div className="proj-row" key={p.name}>
                        <div className="proj-row-head">
                          <span>{p.name}</span>
                          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-faint)' }}>{fmtDuration(p.sec)} · {pct(p.sec, totalSec)}%</span>
                        </div>
                        <div className="proj-track"><div className="proj-fill" style={{ width: `${pct(p.sec, totalSec)}%`, background: p.color }} /></div>
                      </div>
                    ))}
                  </div>
                ) : <EmptyState icon={FileBarChart2} title="暂无项目数据" hint="为任务或专注关联项目后按项目查看投入" />}
              </div>
            </div>

            <div className="card chart-box" style={{ marginBottom: 20 }}>
              <div className="card-title">每日专注时长</div>
              <div className="card-sub" style={{ marginBottom: 8 }}>周一至周日 · 虚线为每日目标 {goalMin} 分钟</div>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={daily}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-soft)" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--text-mute)' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--text-mute)' }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(v) => `${Number(v)} 分钟`} contentStyle={TOOLTIP_STYLE}
                    itemStyle={{ color: 'var(--text)' }} labelStyle={{ color: 'var(--text-faint)' }}
                    cursor={{ fill: 'var(--accent-wash)' }} />
                  <ReferenceLine y={goalMin} stroke={palette.amber} strokeDasharray="4 4" />
                  <Bar dataKey="min" radius={[6, 6, 0, 0]} maxBarSize={44}>
                    {daily.map((d) => <Cell key={d.key} fill={d.reached ? palette.accent : palette.accentDim} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div className="report-goal-strip">
                {daily.map((d) => (
                  <div className={`goal-day ${d.reached ? 'reached' : ''}`} key={d.key}>
                    <div className="gd-label">{d.label}</div>
                    <div className="gd-bar"><div className="gd-fill" style={{ width: `${Math.round(d.ratio * 100)}%` }} /></div>
                    <div className="gd-val">{d.isFuture && d.min === 0 ? '—' : `${d.min}分`}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card insight-card">
              <div style={{ padding: '18px 18px 6px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Target size={15} style={{ color: 'var(--accent)' }} />
                <div className="card-title">本周洞察</div>
              </div>
              <ul className="insight-list">
                {insights.map((text, index) => (
                  <li key={index}>
                    {index === 0
                      ? deltaPct === null ? <Minus size={14} /> : deltaPct > 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />
                      : index === 1 ? <Clock3 size={14} /> : <Check size={14} />}
                    <span>{text}</span>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
