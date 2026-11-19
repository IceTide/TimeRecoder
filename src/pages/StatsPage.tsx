import { useMemo, useState, type CSSProperties } from 'react'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts'
import { format, startOfDay, addDays } from 'date-fns'
import { Plus, Pencil, Trash2, Flame } from 'lucide-react'
import { useStore } from '../store/useStore'
import type { TimeCategory, TimeEntry } from '../types'
import Modal from '../components/Modal'
import { CATEGORY_LABEL, fmtDuration, fmtDate, fmtTime, fmtFriendlyDay } from '../utils/time'

type Range = 'today' | 'week' | 'month'

const CATS: TimeCategory[] = ['focus', 'meeting', 'admin', 'learning', 'other']

/* 科技青紫图表配色：高饱和霓虹色，深色背景下清晰醒目 */
const CHART_COLOR: Record<string, string> = {
  focus: '#22d3ee',   // 霓虹青
  meeting: '#f5a524', // 琥珀
  admin: '#7a8fa0',   // 冷灰蓝
  learning: '#a78bfa',// 亮紫
  other: '#34d399',   // 翠绿
}

/* Recharts 深色 Tooltip 统一样式 */
const TOOLTIP_STYLE: CSSProperties = {
  background: '#1e222c',
  border: '1px solid #343a49',
  borderRadius: 10,
  color: '#eef0f6',
  fontSize: 12,
  boxShadow: '0 10px 30px rgba(0, 0, 0, .5)',
}

const emptyEntry = (): TimeEntry => {
  const end = Date.now()
  return {
    category: 'focus', startAt: end - 3600_000, endAt: end,
    durationSec: 3600, source: 'manual', createdAt: Date.now(),
  }
}

export default function StatsPage() {
  const { entries, tasks, projects, addEntry, updateEntry, deleteEntry } = useStore()
  const [range, setRange] = useState<Range>('today')
  const [editing, setEditing] = useState<TimeEntry | null>(null)

  const rangeFrom = useMemo(() => {
    const now = new Date()
    if (range === 'today') return new Date(now.setHours(0, 0, 0, 0)).getTime()
    if (range === 'week') {
      const d = new Date(); d.setHours(0, 0, 0, 0); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow)
      return d.getTime()
    }
    return new Date(now.getFullYear(), now.getMonth(), 1).getTime()
  }, [range])

  const scoped = useMemo(() => {
    return entries.filter((e) => e.startAt >= rangeFrom).sort((a, b) => b.startAt - a.startAt)
  }, [entries, rangeFrom])

  const totalSec = scoped.reduce((s, e) => s + e.durationSec, 0)
  const focusSec = scoped.filter((e) => e.category === 'focus').reduce((s, e) => s + e.durationSec, 0)
  const doneTasks = tasks.filter((t) => t.status === 'done' && t.completedAt && t.completedAt >= rangeFrom).length

  const byCategory = CATS.map((c) => ({
    name: CATEGORY_LABEL[c],
    value: Math.round(scoped.filter((e) => e.category === c).reduce((s, e) => s + e.durationSec, 0) / 60),
    color: CHART_COLOR[c],
  })).filter((d) => d.value > 0)

  const byProject = projects.map((p) => ({
    name: p.name,
    value: Math.round(scoped.filter((e) => e.projectId === p.id).reduce((s, e) => s + e.durationSec, 0) / 60),
    color: p.color,
  })).filter((d) => d.value > 0)
  const untagged = Math.round(scoped.filter((e) => !e.projectId).reduce((s, e) => s + e.durationSec, 0) / 60)
  if (untagged > 0) byProject.push({ name: '未分类', value: untagged, color: '#6f7686' })

  const byDay = useMemo(() => {
    const map = new Map<string, number>()
    scoped.forEach((e) => {
      const k = fmtDate(e.startAt, 'M/d')
      map.set(k, (map.get(k) || 0) + e.durationSec / 60)
    })
    return Array.from(map.entries()).reverse().map(([name, min]) => ({ name, 分钟: Math.round(min) }))
  }, [scoped])

  // 全量专注记录按天汇总（热力图/streak 不受 range 过滤，反映长期习惯）
  const focusByDay = useMemo(() => {
    const map = new Map<string, number>() // yyyy-MM-dd -> 专注秒数
    entries.filter((e) => e.category === 'focus').forEach((e) => {
      const k = fmtDate(e.startAt, 'yyyy-MM-dd')
      map.set(k, (map.get(k) || 0) + e.durationSec)
    })
    return map
  }, [entries])

  // 连续专注天数：今天有记录则从今天起算，否则从昨天起算（今天还没结束不断签）
  const streak = useMemo(() => {
    let count = 0
    let cursor = startOfDay(Date.now())
    if (!focusByDay.has(fmtDate(cursor.getTime(), 'yyyy-MM-dd'))) {
      cursor = addDays(cursor, -1)
    }
    while (focusByDay.has(fmtDate(cursor.getTime(), 'yyyy-MM-dd'))) {
      count++
      cursor = addDays(cursor, -1)
    }
    return count
  }, [focusByDay])

  // 热力图：最近 12 周（84 天），按列=周、行=周一~周日排列
  const heatmap = useMemo(() => {
    const today = startOfDay(Date.now())
    const days: { key: string; date: Date; sec: number; level: number }[] = []
    const total = 7 * 12
    const start = addDays(today, -(total - 1))
    for (let i = 0; i < total; i++) {
      const d = addDays(start, i)
      const key = fmtDate(d.getTime(), 'yyyy-MM-dd')
      const sec = focusByDay.get(key) || 0
      const min = sec / 60
      const level = min <= 0 ? 0 : min < 25 ? 1 : min < 50 ? 2 : min < 90 ? 3 : 4
      days.push({ key, date: d, sec, level })
    }
    // 补齐首列，使其从周一开始（date-fns getDay: 周日=0）
    const lead = (days[0].date.getDay() + 6) % 7
    for (let i = 0; i < lead; i++) {
      days.unshift({ key: `pad-${i}`, date: addDays(days[0].date, -1), sec: -1, level: -1 })
    }
    return days
  }, [focusByDay])

  const heatWeeks = useMemo(() => {
    const weeks: typeof heatmap[] = []
    for (let i = 0; i < heatmap.length; i += 7) weeks.push(heatmap.slice(i, i + 7))
    return weeks
  }, [heatmap])

  const totalFocusDays = focusByDay.size
  const bestDay = useMemo(() => {
    let best = 0
    focusByDay.forEach((v) => { if (v > best) best = v })
    return best
  }, [focusByDay])

  const save = async () => {
    if (!editing || editing.endAt <= editing.startAt) return // 无效时间段不入库，弹窗内已有红字提示
    const durationSec = Math.max(0, Math.round((editing.endAt - editing.startAt) / 1000))
    const payload = { ...editing, durationSec }
    if (editing.id) await updateEntry(editing.id, payload)
    else await addEntry({ ...payload, createdAt: Date.now() })
    setEditing(null)
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title">时间统计</div>
          <div className="page-desc">看清时间去哪了，才能决定下一步怎么花</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn ghost" onClick={() => setEditing(emptyEntry())}><Plus size={15} style={{ marginRight: 5 }} />补录时间</button>
          <div className="date-nav">
            {([['today', '今日'], ['week', '本周'], ['month', '本月']] as [Range, string][]).map(([k, l]) => (
              <button key={k} className={`filter-chip ${range === k ? 'active' : ''}`} onClick={() => setRange(k)}>{l}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="stat-grid">
        <div className="card stat-card"><div className="k">总记录时长</div><div className="v">{fmtDuration(totalSec)}</div><div className="d">{range === 'today' ? '今日' : range === 'week' ? '本周' : '本月'}累计</div></div>
        <div className="card stat-card"><div className="k">专注时长</div><div className="v" style={{ color: 'var(--accent)' }}>{fmtDuration(focusSec)}</div><div className="d">占比 {totalSec ? Math.round(focusSec / totalSec * 100) : 0}%</div></div>
        <div className="card stat-card"><div className="k">连续专注</div><div className="v" style={{ color: 'var(--orange)' }}>{streak}<span style={{ fontSize: 14 }}> 天</span></div><div className="d"><Flame size={11} style={{ verticalAlign: -1 }} /> 最长连续记录</div></div>
        <div className="card stat-card"><div className="k">本次完成</div><div className="v">{doneTasks}</div><div className="d">任务 · 专注 {totalFocusDays} 天</div></div>
      </div>

      <div className="charts-row">
        <div className="card chart-box">
          <div className="card-title">时间构成</div>
          <div className="card-sub" style={{ marginBottom: 8 }}>按活动类别</div>
          {byCategory.length ? (
            <>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={byCategory} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={3}>
                    {byCategory.map((d) => <Cell key={d.name} fill={d.color} />)}
                  </Pie>
                  <Tooltip
                    formatter={(v) => `${v} 分钟`}
                    contentStyle={TOOLTIP_STYLE}
                    itemStyle={{ color: '#eef0f6' }}
                    labelStyle={{ color: '#a2a8b8' }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="legend">{byCategory.map((d) => <span key={d.name}><i style={{ background: d.color }} />{d.name} {d.value}分</span>)}</div>
            </>
          ) : <div className="empty">暂无数据</div>}
        </div>

        <div className="card chart-box">
          <div className="card-title">每日趋势</div>
          <div className="card-sub" style={{ marginBottom: 8 }}>每日记录分钟数</div>
          {byDay.length ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={byDay}>
                <defs>
                  <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#22d3ee" />
                    <stop offset="100%" stopColor="#8b6bff" />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(34,211,238,.09)" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#8b93a5' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#8b93a5' }} axisLine={false} tickLine={false} />
                <Tooltip
                  formatter={(v) => `${v} 分钟`}
                  contentStyle={TOOLTIP_STYLE}
                  itemStyle={{ color: '#eef0f6' }}
                  labelStyle={{ color: '#a2a8b8' }}
                  cursor={{ fill: 'rgba(255,255,255,.04)' }}
                />
                <Bar dataKey="分钟" fill="url(#barGradient)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <div className="empty">暂无数据</div>}
        </div>
      </div>

      <div className="card heatmap-card" style={{ marginBottom: 20 }}>
        <div style={{ padding: '18px 18px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12 }}>
          <div>
            <div className="card-title">专注热力图</div>
            <div className="card-sub">最近 12 周的专注分布 · 单日最佳 {fmtDuration(bestDay)}</div>
          </div>
          <div className="heat-legend">
            <span>少</span>
            {[0, 1, 2, 3, 4].map((lv) => <i key={lv} className={`heat-cell heat-lv-${lv}`} />)}
            <span>多</span>
          </div>
        </div>
        <div className="heatmap-body">
          <div className="heat-map">
            {heatWeeks.map((week, wi) => (
              <div className="heat-week" key={wi}>
                {week.map((d) => (
                  <div
                    key={d.key}
                    className={`heat-cell heat-lv-${d.level}`}
                    title={d.level < 0 ? '' : `${d.key} · 专注 ${fmtDuration(d.sec)}`}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ padding: '18px 18px 6px' }}>
          <div className="card-title">项目分布</div>
          <div className="card-sub">按项目汇总投入时间</div>
        </div>
        {byProject.length ? (
          <div style={{ padding: 10, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {byProject.map((p) => (
              <div key={p.name} style={{ flex: '1 1 180px', padding: '12px 14px', border: '1px solid var(--border)', borderRadius: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 600 }}><span className="dot" style={{ background: p.color }} />{p.name}</div>
                <div style={{ fontSize: 20, fontWeight: 700, marginTop: 8 }}>{Math.floor(p.value / 60)}<span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-faint)' }}> 小时 {p.value % 60} 分</span></div>
              </div>
            ))}
          </div>
        ) : <div className="empty">暂无项目数据</div>}
      </div>

      <div className="card">
        <div style={{ padding: '18px 18px 6px' }}>
          <div className="card-title">时间明细</div>
          <div className="card-sub">共 {scoped.length} 条记录</div>
        </div>
        {scoped.length === 0 ? <div className="empty">还没有记录，完成一次专注或手动补录吧</div> : scoped.map((e) => {
          const task = tasks.find((t) => t.id === e.taskId)
          const proj = projects.find((p) => p.id === e.projectId)
          return (
            <div className="entry-row" key={e.id}>
              <div className="entry-cat" style={{ background: CHART_COLOR[e.category] }} />
              <div className="entry-main">
                <div className="entry-title">{task?.title || e.note || CATEGORY_LABEL[e.category]}</div>
                <div className="entry-sub">{fmtFriendlyDay(e.startAt)} {fmtTime(e.startAt)}–{fmtTime(e.endAt)} · {CATEGORY_LABEL[e.category]}{proj ? ` · ${proj.name}` : ''} · {e.source === 'focus' ? '专注' : e.source === 'manual' ? '手动' : '自动'}</div>
              </div>
              <div className="entry-dur">{fmtDuration(e.durationSec)}</div>
              <button className="icon-btn" onClick={() => setEditing({ ...e })}><Pencil size={15} /></button>
              <button className="icon-btn" onClick={async () => { await deleteEntry(e.id!); }}><Trash2 size={15} /></button>
            </div>
          )
        })}
      </div>

      {editing && (
        <Modal title={editing.id ? '编辑时间记录' : '补录时间'} onClose={() => setEditing(null)} footer={
          <>
            <button className="btn ghost" onClick={() => setEditing(null)}>取消</button>
            <button className="btn" onClick={save}>保存</button>
          </>
        }>
          <div className="field" style={{ marginBottom: 14 }}>
            <label>类别</label>
            <select className="select" value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value as TimeCategory })}>
              {CATS.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
            </select>
          </div>
          <div className="field" style={{ marginBottom: 14 }}>
            <label>关联项目</label>
            <select className="select" value={editing.projectId ?? ''} onChange={(e) => setEditing({ ...editing, projectId: e.target.value ? Number(e.target.value) : undefined })}>
              <option value="">未分类</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="row" style={{ marginBottom: 14 }}>
            <div className="field">
              <label>开始</label>
              <input className="input" type="datetime-local" value={format(editing.startAt, "yyyy-MM-dd'T'HH:mm")}
                onChange={(e) => { const v = new Date(e.target.value).getTime(); if (!isNaN(v)) setEditing({ ...editing, startAt: v }) }} />
            </div>
            <div className="field">
              <label>结束</label>
              <input className="input" type="datetime-local" value={format(editing.endAt, "yyyy-MM-dd'T'HH:mm")}
                onChange={(e) => { const v = new Date(e.target.value).getTime(); if (!isNaN(v)) setEditing({ ...editing, endAt: v }) }} />
            </div>
          </div>
          <div className="field">
            <label>备注</label>
            <input className="input" value={editing.note ?? ''} placeholder="这段时间做了什么？" onChange={(e) => setEditing({ ...editing, note: e.target.value })} />
          </div>
          {editing.endAt <= editing.startAt && <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 8 }}>结束时间需晚于开始时间</div>}
        </Modal>
      )}
    </div>
  )
}
