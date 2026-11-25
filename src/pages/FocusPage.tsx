import { useEffect, useMemo, useState } from 'react'
import { Play, Pause, Square, Timer, CheckCircle2, Coffee, Target } from 'lucide-react'
import { useStore } from '../store/useStore'
import { fmtClock, fmtDuration, fmtDate } from '../utils/time'
import { getSetting } from '../db/database'
import SoundscapeCard from '../components/SoundscapeCard'

interface Props {
  onToast: (msg: string) => void
  onGoSchedule: () => void
}

const DEFAULT_PRESETS = [25, 50, 90]
const DEFAULT_DAILY_GOAL_MIN = 120

export default function FocusPage({ onToast, onGoSchedule }: Props) {
  const { tasks, projects, focus, startFocus, pauseFocus, resumeFocus, finishFocus, entries, sessions } = useStore()
  const [preset, setPreset] = useState(25)
  const [taskId, setTaskId] = useState<number | undefined>()
  const [presets, setPresets] = useState(DEFAULT_PRESETS)
  const [dailyGoalMin, setDailyGoalMin] = useState(DEFAULT_DAILY_GOAL_MIN)

  useEffect(() => {
    getSetting<number[]>('focusPresets', DEFAULT_PRESETS).then(setPresets)
    getSetting<number>('dailyFocusGoalMin', DEFAULT_DAILY_GOAL_MIN)
      .then((v) => setDailyGoalMin(Math.min(1440, Math.max(10, Number(v) || DEFAULT_DAILY_GOAL_MIN))))
  }, [])
  useEffect(() => { if (presets.length && !presets.includes(preset)) setPreset(presets[0]) }, [presets, preset])

  const todayStart = useMemo(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime()
  }, [entries])
  const todayFocusSec = entries.filter((e) => e.startAt >= todayStart && e.category === 'focus')
    .reduce((s, e) => s + e.durationSec, 0)
  const todaySessions = sessions.filter((s) => s.startAt >= todayStart && s.status === 'completed').length
  const selectedTask = tasks.find((t) => t.id === taskId)

  // 今日专注目标：已累计 / 每日目标（目标来自设置，默认 120 分钟）
  const todayFocusMin = Math.round(todayFocusSec / 60)
  const goalSec = Math.max(1, dailyGoalMin) * 60
  const goalProgress = Math.min(1, todayFocusSec / goalSec)
  const goalPct = Math.round(goalProgress * 100)

  const totalSec = focus ? focus.plannedMin * 60 : preset * 60
  const remainSec = focus ? Math.max(0, totalSec - focus.elapsedSec) : totalSec
  const progress = focus ? Math.min(1, focus.elapsedSec / totalSec) : 0
  const R = 112
  const C = 2 * Math.PI * R
  const arcTipX = 130 + R * Math.cos(progress * 2 * Math.PI)
  const arcTipY = 130 + R * Math.sin(progress * 2 * Math.PI)

  const handleStart = async () => {
    await startFocus(preset, taskId)
    onToast('专注开始，保持心流 💪')
  }

  const handleFinish = async () => {
    const sec = await finishFocus('aborted')
    onToast(sec && sec >= 60 ? `已结束，记录 ${fmtDuration(sec)}` : '已结束本次专注')
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title">专注模式</div>
          <div className="page-desc">选定一件事，屏蔽干扰，把时间完整地交给它</div>
        </div>
      </div>

      <div className="focus-wrap">
        <div className="card focus-hero">
          <div className="ring">
            <svg width="260" height="260" viewBox="0 0 260 260">
              {/* 双层刻度盘：圆头短刻 + 稀疏分段，保留仪器感但不再密集锐利 */}
              <circle cx="130" cy="130" r="126" fill="none" stroke="var(--border-faint)" strokeWidth="1" />
              <circle cx="130" cy="130" r="126" fill="none" stroke="var(--border)" strokeWidth="2"
                strokeLinecap="round" strokeDasharray="1 26" />
              <circle cx="130" cy="130" r="96" fill="none" stroke="var(--border-faint)" strokeWidth="1"
                strokeLinecap="round" strokeDasharray="1 30" />
              {/* 四方位主刻度：柔化冷光短线 */}
              {[0, 90, 180, 270].map((deg) => (
                <line key={deg} x1="130" y1="4" x2="130" y2="12"
                  stroke="var(--accent-line)" strokeWidth="1.5" strokeLinecap="round"
                  transform={`rotate(${deg} 130 130)`} />
              ))}
              {/* 中心十字准星：更淡、更稀疏的分段线 */}
              <g stroke="var(--border)" strokeWidth="1" strokeDasharray="2 10" opacity="0.5">
                <line x1="130" y1="58" x2="130" y2="94" />
                <line x1="130" y1="166" x2="130" y2="202" />
                <line x1="58" y1="130" x2="94" y2="130" />
                <line x1="166" y1="130" x2="202" y2="130" />
              </g>
              {/* 主轨道：凹槽 + 柔化描边 */}
              <circle cx="130" cy="130" r={R} fill="none" stroke="var(--bg-deep)" strokeWidth="9" />
              <circle cx="130" cy="130" r={R} fill="none" stroke="var(--border-faint)" strokeWidth="1" />
              {/* 低饱和冷光弧：圆头端点 + 漫射微光，不产生锐利端点 */}
              <circle cx="130" cy="130" r={R} fill="none" stroke="var(--accent)" strokeWidth="7"
                strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - progress)}
                style={{ transition: 'stroke-dashoffset .5s linear', filter: 'drop-shadow(0 0 5px var(--accent-soft))' }} />
              {/* 弧端点光点：弱化，仅作柔和收尾 */}
              {progress > 0.001 && (
                <circle cx={arcTipX} cy={arcTipY} r="3" fill="var(--accent)" opacity="0.85"
                  style={{ filter: 'drop-shadow(0 0 5px var(--accent-soft))', transition: 'cx .5s linear, cy .5s linear' }} />
              )}
            </svg>
            <div className="ring-center">
              <div className="ring-time">{fmtClock(remainSec)}</div>
              <div className="ring-status">{focus ? (focus.segmentStartAt === null ? '已暂停' : '专注进行中') : '准备开始'}</div>
            </div>
          </div>

          {focus && (
            <div className="focus-task-line">
              <Target size={15} />
              {selectedTask ? selectedTask.title : '自由专注'}
              <span style={{ color: 'var(--text-faint)' }}>· 已暂停 {focus.pauseCount} 次</span>
            </div>
          )}

          <div className="focus-controls">
            {!focus ? (
              <button className="btn btn-lg" onClick={handleStart}><Play size={17} fill="currentColor" style={{ marginRight: 8 }} />开始专注</button>
            ) : (
              <>
                {focus.segmentStartAt === null
                  ? <button className="btn btn-lg" onClick={resumeFocus}><Play size={17} fill="currentColor" style={{ marginRight: 8 }} />继续</button>
                  : <button className="btn ghost btn-lg" onClick={pauseFocus}><Pause size={17} style={{ marginRight: 8 }} />暂停</button>}
                <button className="btn danger btn-lg" onClick={handleFinish}><Square size={15} style={{ marginRight: 8 }} />结束</button>
              </>
            )}
          </div>

          <div className="focus-ambient">
            <span className="ambient-line" />
            {focus ? '保持节奏，你正在变得更好' : '一次只做一件事 · 把时间交给重要的事'}
            <span className="ambient-line" />
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="card card-pad">
            <div className="card-title">时长设置</div>
            <div className="card-sub" style={{ marginBottom: 14 }}>选择预设或自定义</div>
            <div className="preset-list">
              {presets.map((m) => (
                <button key={m} className={`preset ${preset === m && !focus ? 'active' : ''}`}
                  disabled={!!focus} onClick={() => setPreset(m)}>
                  {m}<small>分钟</small>
                </button>
              ))}
            </div>
            <div className="field" style={{ marginTop: 12 }}>
              <label>关联任务（可选）</label>
              <select className="select" value={taskId ?? ''} disabled={!!focus}
                onChange={(e) => setTaskId(e.target.value ? Number(e.target.value) : undefined)}>
                <option value="">自由专注（不关联任务）</option>
                {tasks.filter((t) => t.status !== 'done').map((t) => (
                  <option key={t.id} value={t.id}>{t.title}</option>
                ))}
              </select>
            </div>
            {selectedTask && (
              <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 8 }}>
                所属项目：{projects.find((p) => p.id === selectedTask.projectId)?.name || '未分类'}
              </div>
            )}
          </div>

          <SoundscapeCard onToast={onToast} />

          <div className="card card-pad">
            <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <Timer size={15} style={{ color: 'var(--accent)' }} /> 今日概览
            </div>
            {/* 今日专注目标：HUD 数据条 */}
            <div className="goal-block">
              <div className="goal-head">
                <span className="goal-label">今日专注目标 / DAILY GOAL</span>
                <span className="goal-pct">{goalPct}%</span>
              </div>
              <div className="goal-track">
                <div className="goal-fill" style={{ width: `${goalProgress * 100}%` }} />
                <div className="goal-tip" style={{ left: `${goalProgress * 100}%` }} />
              </div>
              <div className="goal-readout">
                <span className="goal-now"><em>{todayFocusMin}</em> / {dailyGoalMin} 分钟</span>
                <span className="goal-target">{todayFocusMin >= dailyGoalMin ? '已达成 · 保持' : '继续专注'}</span>
              </div>
            </div>
            <div>
              <div className="stat-mini"><span>专注时长</span><span style={{ color: 'var(--accent)' }}>{fmtDuration(todayFocusSec)}</span></div>
              <div className="stat-mini"><span>完成专注</span><span>{todaySessions} 次</span></div>
              <div className="stat-mini"><span>待办剩余</span><span>{tasks.filter((t) => t.status !== 'done').length} 项</span></div>
              <div className="stat-mini"><span>日期</span><span style={{ fontSize: 12 }}>{fmtDate(Date.now(), 'M月d日')}</span></div>
            </div>
          </div>

          <button className="ghost btn" style={{ display: 'flex', justifyContent: 'center', gap: 8 }} onClick={onGoSchedule}>
            <Coffee size={15} /> 看看今天的日程安排
          </button>
        </div>
      </div>

      {focus && focus.elapsedSec >= focus.plannedMin * 60 && (
        <div style={{ textAlign: 'center', marginTop: 18, color: 'var(--green)', fontSize: 13 }}>
          <CheckCircle2 size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />
          目标时长已到，可以收尾了
        </div>
      )}
    </div>
  )
}
