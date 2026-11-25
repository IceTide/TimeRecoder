import { useMemo } from 'react'
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts'
import {
  Sun, CalendarClock, Activity, Waves, Sparkles, TrendingUp, TrendingDown,
} from 'lucide-react'
import { useStore } from '../store/useStore'
import { fmtDuration, fmtDate } from '../utils/time'
import EmptyState from '../components/EmptyState'

/** 效率洞察：基于全量本地数据，回答「我什么时候最高效、专注质量如何、被什么打断」 */

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const HOURS = Array.from({ length: 24 }, (_, i) => i)

interface Props {
  onGoFocus: () => void
}

export default function InsightsPage({ onGoFocus }: Props) {
  const { entries, sessions } = useStore()

  // 只看有效的专注记录
  const focusEntries = useMemo(
    () => entries.filter((e) => e.category === 'focus' && Number.isFinite(e.durationSec) && e.durationSec > 0),
    [entries],
  )

  // 数据总量门槛：少于 3 条不做可靠洞察
  const enough = focusEntries.length >= 3

  // —— 黄金时段：按小时聚合专注时长 ——
  const hourStats = useMemo(() => {
    const buckets = HOURS.map((h) => ({ hour: h, sec: 0, count: 0 }))
    focusEntries.forEach((e) => {
      const h = new Date(e.startAt).getHours()
      buckets[h].sec += e.durationSec
      buckets[h].count += 1
    })
    const max = Math.max(1, ...buckets.map((b) => b.sec))
    return buckets.map((b) => ({ ...b, ratio: b.sec / max }))
  }, [focusEntries])

  const peakHours = useMemo(() => {
    return [...hourStats]
      .sort((a, b) => b.sec - a.sec)
      .filter((b) => b.sec > 0)
      .slice(0, 3)
      .map((b) => b.hour)
      .sort((a, b) => a - b)
  }, [hourStats])

  const fmtHour = (h: number) => `${String(h).padStart(2, '0')}:00`
  const peakLabel = peakHours.length
    ? peakHours.map(fmtHour).join('、')
    : '暂无'

  // —— 星期效率：按周一~周日聚合 ——
  const weekdayStats = useMemo(() => {
    const buckets = WEEKDAYS.map((label, i) => ({ label, index: i, sec: 0, count: 0 }))
    focusEntries.forEach((e) => {
      const jsDay = new Date(e.startAt).getDay() // 0=周日
      const idx = (jsDay + 6) % 7 // 转为周一=0
      buckets[idx].sec += e.durationSec
      buckets[idx].count += 1
    })
    const max = Math.max(1, ...buckets.map((b) => b.sec))
    return buckets.map((b) => ({ ...b, ratio: b.sec / max }))
  }, [focusEntries])

  const bestWeekday = useMemo(() => {
    const top = [...weekdayStats].sort((a, b) => b.sec - a.sec)[0]
    return top && top.sec > 0 ? top.label : '暂无'
  }, [weekdayStats])

  // —— 专注质量指标 ——
  const quality = useMemo(() => {
    const totalSec = focusEntries.reduce((s, e) => s + e.durationSec, 0)
    const avgSec = focusEntries.length ? totalSec / focusEntries.length : 0
    const longestSec = focusEntries.reduce((m, e) => Math.max(m, e.durationSec), 0)
    const completedSessions = sessions.filter((s) => s.status === 'completed')
    const totalSessions = sessions.length
    const completionRate = totalSessions ? completedSessions.length / totalSessions : 0
    // 碎片化：低于 15 分钟的专注条目占比
    const shortCount = focusEntries.filter((e) => e.durationSec < 15 * 60).length
    const fragmentRate = focusEntries.length ? shortCount / focusEntries.length : 0
    return { totalSec, avgSec, longestSec, completionRate, fragmentRate, count: focusEntries.length }
  }, [focusEntries, sessions])

  // —— 近 8 周趋势（面积图）——
  const trend = useMemo(() => {
    const mondayOf = (d: Date) => {
      const x = new Date(d); x.setHours(0, 0, 0, 0)
      const day = (x.getDay() + 6) % 7
      x.setDate(x.getDate() - day)
      return x.getTime()
    }
    const thisMonday = mondayOf(new Date())
    const weeks: { name: string; 专注: number; ms: number }[] = []
    for (let i = 7; i >= 0; i--) {
      const start = thisMonday - i * 7 * 86400_000
      const end = start + 7 * 86400_000
      const sec = focusEntries
        .filter((e) => e.startAt >= start && e.startAt < end)
        .reduce((s, e) => s + e.durationSec, 0)
      weeks.push({ name: fmtDate(start, 'M/d'), 专注: Math.round(sec / 60), ms: start })
    }
    return weeks
  }, [focusEntries])

  const trendDelta = useMemo(() => {
    if (trend.length < 2) return 0
    const last = trend[trend.length - 1].专注
    const prev = trend[trend.length - 2].专注
    if (prev <= 0) return last > 0 ? 100 : 0
    return Math.round(((last - prev) / prev) * 100)
  }, [trend])

  // —— 干扰分析：类别构成 ——
  const distraction = useMemo(() => {
    const total = entries.reduce((s, e) => s + (Number.isFinite(e.durationSec) ? e.durationSec : 0), 0)
    const focusSec = focusEntries.reduce((s, e) => s + e.durationSec, 0)
    const focusRatio = total > 0 ? focusSec / total : 0
    return { focusRatio, nonFocusRatio: 1 - focusRatio, total }
  }, [entries, focusEntries])

  // —— 可行动洞察 ——
  const suggestions = useMemo(() => {
    const out: string[] = []
    if (peakHours.length) {
      out.push(`你的高效时段集中在 ${peakLabel}，建议把最重要的任务安排在这些时间。`)
    }
    if (bestWeekday !== '暂无') {
      out.push(`${bestWeekday}是你专注投入最多的一天，可考虑把关键工作前置到这天。`)
    }
    if (quality.fragmentRate > 0.4) {
      out.push(`有 ${Math.round(quality.fragmentRate * 100)}% 的专注不足 15 分钟，尝试减少切换、拉长单次专注。`)
    } else if (quality.fragmentRate < 0.15 && quality.count > 0) {
      out.push('你的专注连续性很好，短时打断很少，保持这个节奏。')
    }
    if (distraction.focusRatio < 0.3 && distraction.total > 0) {
      out.push(`专注只占总记录时间的 ${Math.round(distraction.focusRatio * 100)}%，事务与会议偏多，留意深度工作是否被挤压。`)
    }
    if (trendDelta > 10) {
      out.push(`本周专注比上周提升 ${trendDelta}%，势头不错。`)
    } else if (trendDelta < -10) {
      out.push(`本周专注比上周下降 ${Math.abs(trendDelta)}%，可以回顾一下是什么占用了时间。`)
    }
    if (!out.length) out.push('继续保持记录，积累更多数据后会给出更具体的建议。')
    return out
  }, [peakLabel, peakHours, bestWeekday, quality, distraction, trendDelta])

  if (!enough) {
    return (
      <div className="page">
        <div className="page-head">
          <div>
            <div className="page-title">效率洞察</div>
            <div className="page-desc">基于你的时间数据，发现高效规律与改进空间</div>
          </div>
        </div>
        <div className="card card-pad">
          <EmptyState
            icon={Sparkles}
            title="数据还不够"
            hint="完成几次专注后，这里会分析你的黄金时段、专注质量与改进建议"
          />
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title">效率洞察</div>
          <div className="page-desc">基于 {quality.count} 次专注记录，发现你的高效规律</div>
        </div>
        <button className="btn ghost" onClick={onGoFocus}>
          <Activity size={15} style={{ marginRight: 6 }} /> 去专注
        </button>
      </div>

      {/* 核心指标 */}
      <div className="stat-grid" style={{ marginBottom: 20 }}>
        <div className="stat-card">
          <div className="k">平均专注</div>
          <div className="v">{Math.round(quality.avgSec / 60)}<span style={{ fontSize: '14px', marginLeft: 3 }}>分</span></div>
          <div className="d">单次平均时长</div>
        </div>
        <div className="stat-card">
          <div className="k">最长专注</div>
          <div className="v">{Math.round(quality.longestSec / 60)}<span style={{ fontSize: '14px', marginLeft: 3 }}>分</span></div>
          <div className="d">单次最长记录</div>
        </div>
        <div className="stat-card">
          <div className="k">完成率</div>
          <div className="v">{Math.round(quality.completionRate * 100)}<span style={{ fontSize: '14px', marginLeft: 3 }}>%</span></div>
          <div className="d">番茄钟完成 / 开始</div>
        </div>
        <div className="stat-card">
          <div className="k">本周趋势</div>
          <div className="v" style={{ color: trendDelta > 0 ? 'var(--green)' : trendDelta < 0 ? 'var(--red)' : 'var(--text)' }}>
            {trendDelta > 0 ? '+' : ''}{trendDelta}<span style={{ fontSize: '14px', marginLeft: 3 }}>%</span>
          </div>
          <div className="d">对比上一周</div>
        </div>
      </div>

      <div className="charts-row">
        {/* 黄金时段 */}
        <div className="card chart-box">
          <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <Sun size={15} /> 黄金时段
          </div>
          <div className="card-sub" style={{ marginBottom: 14 }}>各小时专注时长分布 · 峰值 {peakLabel}</div>
          <div className="hour-grid">
            {hourStats.map((b) => (
              <div className="hour-cell" key={b.hour} title={`${fmtHour(b.hour)} · ${fmtDuration(b.sec)}`}>
                <div className="hour-bar-track">
                  <div className={`hour-bar ${peakHours.includes(b.hour) ? 'peak' : ''}`}
                    style={{ height: `${Math.max(4, b.ratio * 100)}%` }} />
                </div>
                <div className="hour-label">{b.hour % 3 === 0 ? String(b.hour).padStart(2, '0') : ''}</div>
              </div>
            ))}
          </div>
        </div>

        {/* 星期效率 */}
        <div className="card chart-box">
          <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <CalendarClock size={15} /> 星期效率
          </div>
          <div className="card-sub" style={{ marginBottom: 14 }}>一周中哪天投入最多 · 最佳 {bestWeekday}</div>
          <div className="weekday-list">
            {weekdayStats.map((b) => (
              <div className="weekday-row" key={b.label}>
                <span className={`weekday-name ${b.label === bestWeekday ? 'best' : ''}`}>{b.label}</span>
                <div className="weekday-track">
                  <div className={`weekday-fill ${b.label === bestWeekday ? 'best' : ''}`}
                    style={{ width: `${Math.max(2, b.ratio * 100)}%` }} />
                </div>
                <span className="weekday-val">{b.sec > 0 ? `${Math.round(b.sec / 60)}m` : '—'}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="charts-row">
        {/* 近8周趋势 */}
        <div className="card chart-box">
          <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            {trendDelta >= 0 ? <TrendingUp size={15} /> : <TrendingDown size={15} />} 专注趋势
          </div>
          <div className="card-sub" style={{ marginBottom: 8 }}>近 8 周专注分钟数</div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={trend} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <defs>
                <linearGradient id="trendGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-soft)" />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--text-mute)' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-mute)' }} axisLine={false} tickLine={false} />
              <Tooltip
                formatter={(v) => `${v} 分钟`}
                contentStyle={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 3, fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text)' }}
                itemStyle={{ color: 'var(--text)' }}
                labelStyle={{ color: 'var(--text-faint)' }}
              />
              <Area type="monotone" dataKey="专注" stroke="var(--accent)" strokeWidth={2} fill="url(#trendGradient)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* 干扰分析 */}
        <div className="card chart-box">
          <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <Waves size={15} /> 专注占比
          </div>
          <div className="card-sub" style={{ marginBottom: 18 }}>专注在全部记录时间中的比例</div>
          <div className="ratio-donut-wrap">
            <div className="ratio-donut" style={{
              background: `conic-gradient(var(--accent) 0 ${distraction.focusRatio * 360}deg, var(--surface-3) ${distraction.focusRatio * 360}deg 360deg)`,
            }}>
              <div className="ratio-donut-inner">
                <div className="ratio-num">{Math.round(distraction.focusRatio * 100)}%</div>
                <div className="ratio-cap">FOCUS</div>
              </div>
            </div>
            <div className="ratio-legend">
              <div><span className="ratio-dot" style={{ background: 'var(--accent)' }} /> 专注 {fmtDuration(focusEntries.reduce((s, e) => s + e.durationSec, 0))}</div>
              <div><span className="ratio-dot" style={{ background: 'var(--surface-3)' }} /> 其他 {fmtDuration(Math.max(0, distraction.total - focusEntries.reduce((s, e) => s + e.durationSec, 0)))}</div>
            </div>
          </div>
        </div>
      </div>

      {/* 可行动洞察 */}
      <div className="card card-pad">
        <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12 }}>
          <Sparkles size={15} /> 洞察建议
        </div>
        <ul className="insight-list">
          {suggestions.map((text, i) => (
            <li key={i}><Sparkles size={14} /> {text}</li>
          ))}
        </ul>
      </div>
    </div>
  )
}
