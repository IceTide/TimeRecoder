import { useEffect, useMemo, useState } from 'react'
import { Focus, CalendarDays, ListTodo, BarChart3, Settings2 } from 'lucide-react'
import { format } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { useStore } from './store/useStore'
import type { Project } from './types'
import Modal from './components/Modal'
import FocusPage from './pages/FocusPage'
import SchedulePage from './pages/SchedulePage'
import TodoPage from './pages/TodoPage'
import StatsPage from './pages/StatsPage'
import SettingsPage from './pages/SettingsPage'

type Tab = 'focus' | 'schedule' | 'todo' | 'stats' | 'settings'

const COLORS = ['var(--accent)', 'var(--cat-meeting)', 'var(--cat-learning)', 'var(--cat-other)', 'var(--red)', 'var(--blue)']

/** 顶栏今日专注读数：从 entries 派生，数据变化时才更新 */
function FocusTotalTag({ entries }: { entries: { startAt: number; endAt: number; durationSec: number; category: string }[] }) {
  const todayStart = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() }, [entries])
  const sec = entries
    .filter((e) => e.category === 'focus' && e.startAt >= todayStart)
    .reduce((s, e) => s + e.durationSec, 0)
  if (sec <= 0) return null
  const m = Math.floor(sec / 60)
  const label = m >= 60 ? `${Math.floor(m / 60)}h${m % 60}m` : `${m}m`
  return (
    <div className="focus-total-tag" title="今日累计专注">
      <span className="ftt-label">FOCUS</span><span className="ftt-value">{label}</span>
    </div>
  )
}

/** 独立时钟组件：仅自身每秒重渲染，不触发整个 App 刷新 */
function ClockTag() {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [])
  const d = new Date(now)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return (
    <div className="clock-tag" title="当前时间">
      <span className="clock-hm">{hh}:{mm}</span><span className="clock-s">:{ss}</span>
    </div>
  )
}

export default function App() {
  const [tab, setTab] = useState<Tab>('focus')
  const [toast, setToast] = useState('')
  const [projModal, setProjModal] = useState(false)
  const [projName, setProjName] = useState('')
  const [projColor, setProjColor] = useState(COLORS[0])
  const { loadAll, loaded, projects, entries, addProject, focus, tickFocus, finishFocus,
    autoEnabled, autoIntervalSec, autoCurrent, pollAuto, flushAuto } = useStore()

  useEffect(() => { loadAll() }, [loadAll])

  // 自动追踪：按设定间隔采集活动窗口；关闭/卸载时结算当前段
  useEffect(() => {
    if (!autoEnabled) return
    const timer = window.setInterval(() => { void pollAuto() }, autoIntervalSec * 1000)
    void pollAuto() // 开启后立即采一次
    return () => window.clearInterval(timer)
  }, [autoEnabled, autoIntervalSec, pollAuto])

  useEffect(() => {
    const onLeave = () => { void flushAuto() }
    window.addEventListener('beforeunload', onLeave)
    return () => window.removeEventListener('beforeunload', onLeave)
  }, [flushAuto])

  // 全局每秒推进专注计时；到点自动完成并提醒
  useEffect(() => {
    const timer = window.setInterval(async () => {
      const f = useStore.getState().focus
      if (!f || f.segmentStartAt === null) return
      tickFocus()
      const latest = useStore.getState().focus
      if (latest && latest.elapsedSec >= latest.plannedMin * 60) {
        // finishFocus 返回 undefined 表示已被并发调用锁定/处理，避免重复通知
        const finished = await finishFocus('completed')
        if (finished !== undefined) {
          window.electronAPI?.notify?.('专注完成 🎉', `已完成 ${latest.plannedMin} 分钟专注，起来活动一下吧`)
          setToast('专注完成！已记录到时间统计')
        }
      }
    }, 1000)
    return () => window.clearInterval(timer)
  }, [tickFocus, finishFocus])

  // 系统托盘 / 全局快捷键动作
  useEffect(() => {
    const api = window.electronAPI
    if (!api?.onAppAction) return
    const off = api.onAppAction(async (action) => {
      const s = useStore.getState()
      // 主进程退出握手：先结算自动追踪当前段落库，再回复允许退出
      if (action === 'prepare-quit') {
        try { await s.prepareShutdown() } finally { window.electronAPI?.quitReady?.() }
        return
      }
      if (action === 'goto-settings') { setTab('settings'); return }
      if (action === 'start-focus') {
        if (s.focus) { setToast('已有进行中的专注'); setTab('focus'); return }
        const { getSetting } = await import('./db/database')
        const presets = await getSetting<number[]>('focusPresets', [25, 50, 90])
        await s.startFocus(presets[0] || 25)
        setTab('focus')
        setToast('已从快捷键开始专注')
      } else if (action === 'finish-focus' || action === 'toggle-focus') {
        if (s.focus) {
          const sec = await s.finishFocus('aborted')
          if (sec !== undefined) setToast('专注已结束并记录')
        } else if (action === 'toggle-focus') {
          const { getSetting } = await import('./db/database')
          const presets = await getSetting<number[]>('focusPresets', [25, 50, 90])
          await s.startFocus(presets[0] || 25)
          setTab('focus')
          setToast('已从快捷键开始专注')
        } else {
          setToast('当前没有进行中的专注')
        }
      }
    })
    return off
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(''), 3000)
    return () => window.clearTimeout(t)
  }, [toast])

  const nav = [
    { id: 'focus' as Tab, label: '专注模式', icon: Focus },
    { id: 'schedule' as Tab, label: '日程安排', icon: CalendarDays },
    { id: 'todo' as Tab, label: '待办任务', icon: ListTodo },
    { id: 'stats' as Tab, label: '时间统计', icon: BarChart3 },
  ]

  if (!loaded) return <div className="app"><div className="empty" style={{ margin: 'auto' }}>加载中…</div></div>

  const createProject = async () => {
    if (!projName.trim()) return
    const p: Project = { name: projName.trim(), color: projColor, createdAt: Date.now() }
    await addProject(p)
    setProjName(''); setProjModal(false); setToast('项目已创建')
  }

  return (
    <div className={focus ? 'focus-mode' : ''}>
      <div className="app">
        <aside className="sidebar">
          <div className="brand">
            <div className="brand-logo">T</div>
            <div><div className="brand-name">TimeRecoder</div><div className="brand-sub">专注 · 记录 · 复盘</div></div>
          </div>

          <nav className="nav">
            {nav.map((n) => {
              const Icon = n.icon
              return (
                <button key={n.id} className={`nav-item ${tab === n.id ? 'active' : ''}`} onClick={() => setTab(n.id)}>
                  <Icon size={17} /> {n.label}
                </button>
              )
            })}
          </nav>

          <div className="side-section">
            <div className="side-title">项目</div>
            {projects.map((p) => (
              <div className="project-item" key={p.id}>
                <span className="dot" style={{ background: p.color }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
              </div>
            ))}
            <button className="side-add" onClick={() => setProjModal(true)}>+ 新建项目</button>
          </div>

          <div className="sidebar-footer">
            <button className={`nav-item ${tab === 'settings' ? 'active' : ''}`} onClick={() => setTab('settings')}>
              <Settings2 size={17} /> 设置
            </button>
            <div className="mini">本地存储 · 数据仅保存在本机<br/>v0.1.0 MVP</div>
          </div>
        </aside>

        <div className="main">
          <header className="topbar">
            <div className="today-label">
              {format(Date.now(), 'yyyy年M月d日 EEEE', { locale: zhCN })}
              <span>把时间花在重要的事上</span>
            </div>
            <div className="topbar-right">
              <ClockTag />
              <FocusTotalTag entries={entries} />
              <div className="sys-tag"><span className="led" />SYS · ONLINE</div>
              {autoEnabled && !focus && (
                <button className="auto-pill" onClick={() => setTab('settings')} title="自动追踪进行中，点击设置查看">
                  <span className={`auto-dot ${autoCurrent ? 'live' : ''}`} />
                  自动追踪{autoCurrent ? ` · ${autoCurrent.app}` : '中'}
                </button>
              )}
              {focus && (
                <button className="running-pill" onClick={() => setTab('focus')}>
                  <span className="pulse" /> 专注中 · {Math.floor(focus.elapsedSec / 60)} 分钟
                </button>
              )}
            </div>
          </header>

          <div className="content">
            {tab === 'focus' && <FocusPage onToast={setToast} onGoSchedule={() => setTab('schedule')} />}
            {tab === 'schedule' && <SchedulePage onToast={setToast} />}
            {tab === 'todo' && <TodoPage onToast={setToast} />}
            {tab === 'stats' && <StatsPage />}
            {tab === 'settings' && <SettingsPage onToast={setToast} />}
          </div>
        </div>
      </div>

      {projModal && (
        <Modal title="新建项目" onClose={() => setProjModal(false)} footer={
          <>
            <button className="btn ghost" onClick={() => setProjModal(false)}>取消</button>
            <button className="btn" onClick={createProject}>创建</button>
          </>
        }>
          <div className="field" style={{ marginBottom: 16 }}>
            <label>项目名称</label>
            <input className="input" autoFocus value={projName} placeholder="例如：产品设计" onChange={(e) => setProjName(e.target.value)} />
          </div>
          <div className="field">
            <label>颜色</label>
            <div style={{ display: 'flex', gap: 10 }}>
              {COLORS.map((c) => (
                <button key={c} onClick={() => setProjColor(c)}
                  style={{ width: 28, height: 28, borderRadius: '50%', background: c,
                    border: projColor === c ? '2px solid #fff' : '2px solid transparent',
                    boxShadow: projColor === c ? '0 0 0 2px var(--accent-strong)' : '0 0 0 1px rgba(255,255,255,.1)' }} />
              ))}
            </div>
          </div>
        </Modal>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
