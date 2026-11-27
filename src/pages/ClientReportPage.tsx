import { useCallback, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import {
  ChevronDown, Clock3, FileText, FileType, Image as ImageIcon, Loader2, Users,
} from 'lucide-react'
import EmptyState from '../components/EmptyState'
import { useStore } from '../store/useStore'
import type { TimeCategory, TimeEntry } from '../types'
import { exportReport, colorOf, type ExportKind } from '../utils/reportExport'
import { useTodayStart } from '../hooks/useTodayStart'
import { CATEGORY_LABEL, fmtDate, fmtDuration } from '../utils/time'

type RangeKey = 'thisMonth' | 'lastMonth' | 'last30' | 'all'
const RANGE_LABEL: Record<RangeKey, string> = {
  thisMonth: '本月', lastMonth: '上月', last30: '近 30 天', all: '全部时间',
}
const CATS: TimeCategory[] = ['focus', 'meeting', 'admin', 'learning', 'other']

const TOOLTIP_STYLE: CSSProperties = {
  background: 'var(--surface-2)',
  border: '1px solid var(--border)',
  borderRadius: 3,
  color: 'var(--text)',
  fontSize: 12,
  fontFamily: 'var(--font-mono)',
  boxShadow: '0 8px 24px oklch(0% 0 0 / .4)',
}

interface Props {
  onToast: (msg: string) => void
}

interface TaskSlice {
  title: string
  sec: number
  pct: number
  category: TimeCategory
}

function sumSec(list: TimeEntry[]): number {
  return list.reduce((s, e) => s + (Number.isFinite(e.durationSec) ? Math.max(0, e.durationSec) : 0), 0)
}

function safePct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0
}

function rangeBounds(range: RangeKey, todayStart: number): { from: number; to: number; label: string } {
  const now = new Date(todayStart)
  // 上界仍取实时时刻；日期边界由 todayStart 驱动，跨零点后自动刷新
  const to = Date.now()
  if (range === 'all') return { from: 0, to, label: '全部时间' }
  if (range === 'last30') {
    const from = new Date(now); from.setDate(from.getDate() - 29); from.setHours(0, 0, 0, 0)
    return { from: from.getTime(), to, label: `近 30 天（${fmtDate(from.getTime(), 'M月d日')} — ${fmtDate(to, 'M月d日')}）` }
  }
  if (range === 'thisMonth') {
    const from = new Date(now.getFullYear(), now.getMonth(), 1)
    return { from: from.getTime(), to, label: fmtDate(from.getTime(), 'yyyy年M月') }
  }
  const from = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const end = new Date(now.getFullYear(), now.getMonth(), 1)
  return { from: from.getTime(), to: end.getTime(), label: fmtDate(from.getTime(), 'yyyy年M月') }
}

/** 面向客户的时间报告：按项目/客户聚合，导出可交付的 Markdown/PNG/PDF */
export default function ClientReportPage({ onToast }: Props) {
  const { entries, projects, tasks } = useStore()
  const [projectId, setProjectId] = useState<number | 'all'>('all')
  const [range, setRange] = useState<RangeKey>('thisMonth')
  const [clientName, setClientName] = useState('')
  const [exporting, setExporting] = useState<ExportKind | null>(null)
  const reportRef = useRef<HTMLDivElement>(null)
  const todayStart = useTodayStart()

  const bounds = useMemo(() => rangeBounds(range, todayStart), [range, todayStart])
  const selectedProject = useMemo(
    () => projects.find((p) => p.id === projectId),
    [projects, projectId],
  )

  // 筛选：时间范围内 + 指定项目（或全部）
  const scoped = useMemo(() => entries.filter((e) => {
    if (e.startAt < bounds.from || e.startAt > bounds.to) return false
    if (projectId !== 'all' && e.projectId !== projectId) return false
    return true
  }), [entries, bounds, projectId])

  const totalSec = useMemo(() => sumSec(scoped), [scoped])
  const focusSec = useMemo(() => sumSec(scoped.filter((e) => e.category === 'focus')), [scoped])

  const byCategory = useMemo(() => CATS
    .map((c) => ({ key: c, name: CATEGORY_LABEL[c], sec: sumSec(scoped.filter((e) => e.category === c)) }))
    .filter((d) => d.sec > 0)
    .sort((a, b) => b.sec - a.sec), [scoped])

  const byTask = useMemo<TaskSlice[]>(() => {
    const buckets = new Map<string, { sec: number; category: TimeCategory }>()
    scoped.forEach((e) => {
      const task = e.taskId !== undefined ? tasks.find((t) => t.id === e.taskId) : undefined
      const key = task?.title || e.note?.trim() || '未命名工作'
      const cur = buckets.get(key) || { sec: 0, category: e.category }
      cur.sec += Number.isFinite(e.durationSec) ? Math.max(0, e.durationSec) : 0
      buckets.set(key, cur)
    })
    return Array.from(buckets.entries())
      .map(([title, v]) => ({ title, sec: v.sec, pct: safePct(v.sec, totalSec), category: v.category }))
      .sort((a, b) => b.sec - a.sec)
  }, [scoped, tasks, totalSec])

  const byDay = useMemo(() => {
    const buckets = new Map<string, number>()
    scoped.forEach((e) => {
      const key = fmtDate(e.startAt, 'M/d')
      buckets.set(key, (buckets.get(key) || 0) + (Number.isFinite(e.durationSec) ? Math.max(0, e.durationSec) : 0))
    })
    return Array.from(buckets.entries())
      .map(([name, sec]) => ({ name, min: Math.round(sec / 60) }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  }, [scoped])

  const notes = useMemo(() => {
    const set = new Set<string>()
    scoped.forEach((e) => { if (e.note?.trim()) set.add(e.note.trim()) })
    return Array.from(set).slice(0, 12)
  }, [scoped])

  const catPalette = useMemo(() => Object.fromEntries(
    CATS.map((c) => [c, colorOf(`--cat-${c}`)]),
  ) as Record<TimeCategory, string>, [])

  const subject = clientName.trim() || selectedProject?.name || '全部项目'
  const fileSlug = `${subject.replace(/[\\/:*?"<>|]/g, '_')}_${bounds.label.replace(/[^\d年月日\-— ]/g, '').trim() || range}`

  const markdown = useMemo(() => {
    const lines = [
      `# ${subject} · 时间报告`,
      '',
      `> 报告期间：${bounds.label} · 生成时间：${fmtDate(Date.now(), 'yyyy-MM-dd HH:mm')}`,
      `> 由 TimeRecoder 生成`,
      '',
      '## 一、概览',
      '',
      '| 指标 | 数值 |',
      '| --- | --- |',
      `| 报告对象 | ${subject} |`,
      `| 报告期间 | ${bounds.label} |`,
      `| 总投入时长 | ${fmtDuration(totalSec)} |`,
      `| 专注时长 | ${fmtDuration(focusSec)}（占比 ${safePct(focusSec, totalSec)}%） |`,
      `| 涉及任务数 | ${byTask.length} 项 |`,
      '',
      '## 二、工作明细',
      '',
    ]
    if (byTask.length) {
      lines.push('| 工作项 | 类别 | 时长 | 占比 |', '| --- | --- | --- | --- |')
      byTask.forEach((t) => lines.push(
        `| ${t.title.replace(/\|/g, '\\|')} | ${CATEGORY_LABEL[t.category]} | ${fmtDuration(t.sec)} | ${t.pct}% |`,
      ))
    } else {
      lines.push('所选范围内暂无工作记录。')
    }
    lines.push('', '## 三、类别分布', '')
    if (byCategory.length) {
      lines.push('| 类别 | 时长 | 占比 |', '| --- | --- | --- |')
      byCategory.forEach((c) => lines.push(`| ${c.name} | ${fmtDuration(c.sec)} | ${safePct(c.sec, totalSec)}% |`))
    } else {
      lines.push('暂无类别数据。')
    }
    lines.push('', '## 四、每日投入', '')
    if (byDay.length) {
      lines.push('| 日期 | 投入时长 |', '| --- | --- |')
      byDay.forEach((d) => lines.push(`| ${d.name} | ${d.min} 分钟 |`))
    } else {
      lines.push('暂无每日数据。')
    }
    if (notes.length) {
      lines.push('', '## 五、备注摘要', '')
      notes.forEach((n) => lines.push(`- ${n}`))
    }
    lines.push('')
    return lines.join('\n')
  }, [subject, bounds, totalSec, focusSec, byTask, byCategory, byDay, notes])

  const handleExport = useCallback(async (kind: ExportKind) => {
    if (exporting) return
    if (totalSec <= 0) {
      onToast('所选范围暂无数据可导出')
      return
    }
    setExporting(kind)
    try {
      await exportReport({ kind, node: reportRef.current, markdown, fileBase: `客户报告_${fileSlug}` })
      onToast(`${kind === 'markdown' ? 'Markdown' : kind.toUpperCase()} 报告导出成功`)
    } catch (error) {
      console.error('[ClientReportPage] 导出失败', error)
      onToast('导出失败，请稍后重试')
    } finally {
      setExporting(null)
    }
  }, [exporting, totalSec, onToast, markdown, fileSlug])

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title">客户报告</div>
          <div className="page-desc">按项目汇总投入，生成可交付给客户的工时报告</div>
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

      {/* 筛选控件：不进入截图 */}
      <div className="client-filters">
        <div className="field" style={{ flex: 1 }}>
          <label>客户 / 项目</label>
          <div className="select-wrap">
            <select className="select" value={projectId}
              onChange={(e) => setProjectId(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
              <option value="all">全部项目</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <ChevronDown size={14} className="select-chevron" />
          </div>
        </div>
        <div className="field" style={{ width: 170 }}>
          <label>报告期间</label>
          <div className="select-wrap">
            <select className="select" value={range} onChange={(e) => setRange(e.target.value as RangeKey)}>
              {(Object.keys(RANGE_LABEL) as RangeKey[]).map((k) => (
                <option key={k} value={k}>{RANGE_LABEL[k]}</option>
              ))}
            </select>
            <ChevronDown size={14} className="select-chevron" />
          </div>
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>报告标题（可选）</label>
          <input className="input" value={clientName} placeholder={selectedProject?.name || '全部项目'}
            onChange={(e) => setClientName(e.target.value)} />
        </div>
      </div>

      {totalSec <= 0 ? (
        <div className="card card-pad">
          <EmptyState icon={Users} title="所选范围暂无数据"
            hint="换个项目或时间范围试试；有记录后即可生成客户报告" />
        </div>
      ) : (
        <div className="report-sheet" ref={reportRef}>
          {/* 报告头：水印质感 */}
          <div className="report-masthead">
            <div>
              <div className="report-kicker">CLIENT REPORT · 客户时间报告</div>
              <div className="report-subject">{subject}</div>
            </div>
            <div className="report-brand">
              <div className="report-brand-name">TIMERECORDER</div>
              <div className="report-brand-sub">{bounds.label}</div>
            </div>
          </div>

          <div className="stat-grid">
            <div className="card stat-card"><div className="k">总投入</div><div className="v">{fmtDuration(totalSec)}</div><div className="d">TOTAL TIME</div></div>
            <div className="card stat-card"><div className="k">专注时长</div><div className="v" style={{ color: 'var(--accent)' }}>{fmtDuration(focusSec)}</div><div className="d">FOCUS · {safePct(focusSec, totalSec)}%</div></div>
            <div className="card stat-card"><div className="k">工作项</div><div className="v">{byTask.length}</div><div className="d">WORK ITEMS</div></div>
            <div className="card stat-card"><div className="k">涉及类别</div><div className="v">{byCategory.length}</div><div className="d">CATEGORIES</div></div>
          </div>

          <div className="client-charts">
            <div className="card chart-box">
              <div className="card-title">工作项明细</div>
              <div className="card-sub" style={{ marginBottom: 10 }}>按投入时长排序</div>
              <div className="task-breakdown">
                {byTask.slice(0, 10).map((t, i) => (
                  <div className="breakdown-row" key={`${t.title}-${i}`}>
                    <div className="breakdown-top">
                      <span className="breakdown-name" title={t.title}>{t.title}</span>
                      <span className="breakdown-val">{fmtDuration(t.sec)} · {t.pct}%</span>
                    </div>
                    <div className="breakdown-track">
                      <div className="breakdown-fill" style={{ width: `${t.pct}%`, background: catPalette[t.category] }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="card chart-box">
              <div className="card-title">类别分布</div>
              <div className="card-sub" style={{ marginBottom: 8 }}>投入时间构成</div>
              {byCategory.length ? (
                <>
                  <div className="pie-wrap">
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart>
                        <Pie data={byCategory} dataKey="sec" nameKey="name" innerRadius={52} outerRadius={78}
                          paddingAngle={2} stroke="none">
                          {byCategory.map((c) => <Cell key={c.key} fill={catPalette[c.key]} />)}
                        </Pie>
                        <Tooltip contentStyle={TOOLTIP_STYLE}
                          formatter={(value: number) => fmtDuration(value)} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="cat-legend">
                    {byCategory.map((c) => (
                      <div key={c.key} className="cat-legend-row">
                        <span className="cat-legend-dot" style={{ background: catPalette[c.key] }} />
                        <span>{c.name}</span>
                        <span>{fmtDuration(c.sec)}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : <EmptyState icon={Clock3} title="暂无类别数据" hint="有记录后自动汇总" />}
            </div>
          </div>

          <div className="card chart-box">
            <div className="card-title">每日投入趋势</div>
            <div className="card-sub" style={{ marginBottom: 8 }}>单位：分钟</div>
            <div className="chart-h">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byDay} margin={{ top: 8, right: 8, bottom: 4, left: -18 }}>
                  <CartesianGrid stroke="var(--border-soft)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: 'var(--text-faint)', fontSize: 10, fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: 'var(--text-faint)', fontSize: 10, fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'var(--accent-wash)' }}
                    formatter={(value: number) => [`${value} 分钟`, '投入']} />
                  <Bar dataKey="min" fill="var(--accent)" radius={[4, 4, 0, 0]} maxBarSize={26} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {notes.length > 0 && (
            <div className="card chart-box">
              <div className="card-title">备注摘要</div>
              <div className="card-sub" style={{ marginBottom: 10 }}>来自时间记录的备注</div>
              <ul className="note-list">
                {notes.map((n, i) => <li key={i}>{n}</li>)}
              </ul>
            </div>
          )}

          <div className="report-footer">
            <span>本报告由 TimeRecoder 基于本地时间记录生成</span>
            <span>{fmtDate(Date.now(), 'yyyy-MM-dd HH:mm')}</span>
          </div>
        </div>
      )}
    </div>
  )
}
