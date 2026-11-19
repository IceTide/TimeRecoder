import { useMemo, useState } from 'react'
import { Plus, ChevronLeft, ChevronRight, Trash2, Play } from 'lucide-react'
import { format, startOfDay, addDays } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { useStore } from '../store/useStore'
import type { CalendarEvent, EventType } from '../types'
import Modal from '../components/Modal'
import { fmtTime } from '../utils/time'

interface Props { onToast: (msg: string) => void }

const TYPE_META: Record<EventType, { label: string; color: string; bg: string }> = {
  meeting: { label: '会议', color: '#f5a524', bg: 'rgba(245, 165, 36, .13)' },
  task: { label: '任务', color: '#7b8cff', bg: 'rgba(123, 140, 255, .14)' },
  personal: { label: '个人', color: '#34d399', bg: 'rgba(52, 211, 153, .13)' },
  break: { label: '休息', color: '#9aa0ac', bg: 'rgba(154, 160, 172, .13)' },
}

const HOURS = Array.from({ length: 16 }, (_, i) => i + 7) // 07:00 - 22:00

const emptyEvent = (day: number): CalendarEvent => ({
  title: '', type: 'task',
  startAt: startOfDay(day).getTime() + 9 * 3600_000,
  endAt: startOfDay(day).getTime() + 10 * 3600_000,
})

export default function SchedulePage({ onToast }: Props) {
  const { events, tasks, addEvent, updateEvent, deleteEvent, startFocus, focus } = useStore()
  const [day, setDay] = useState(() => startOfDay(Date.now()).getTime())
  const [editing, setEditing] = useState<CalendarEvent | null>(null)
  const [view, setView] = useState<'day' | 'week'>('day')

  const dayEvents = useMemo(() => events
    .filter((e) => e.startAt >= startOfDay(day).getTime() && e.startAt < startOfDay(day).getTime() + 86400_000)
    .sort((a, b) => a.startAt - b.startAt), [events, day])

  const now = Date.now()
  const totalPlannedMin = dayEvents.reduce((s, e) => s + (e.endAt - e.startAt) / 60000, 0)
  const freeHours = Math.max(0, 16 - totalPlannedMin / 60)

  const save = async () => {
    if (!editing || !editing.title.trim()) return
    if (editing.id) await updateEvent(editing.id, editing)
    else await addEvent(editing)
    setEditing(null)
    onToast('日程已保存')
  }

  const beginFocus = async (e: CalendarEvent) => {
    if (focus) { onToast('已有专注进行中'); return }
    await startFocus(Math.max(1, Math.round((e.endAt - e.startAt) / 60000)), e.taskId)
    onToast('已按该日程时长开始专注')
  }

  // 以周一为周起始，与统计页的周范围口径保持一致
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(day, i - ((new Date(day).getDay() + 6) % 7)))

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title">日程安排</div>
          <div className="page-desc">把任务放进时间轴，看清一天的容量</div>
        </div>
        <button className="btn" onClick={() => setEditing(emptyEvent(day))}><Plus size={16} style={{ marginRight: 6 }} />新建日程</button>
      </div>

      <div className="todo-toolbar">
        <div className="date-nav">
          <button className="icon-btn" onClick={() => setView('day')} style={{ background: view === 'day' ? 'var(--accent-soft)' : undefined, color: view === 'day' ? 'var(--accent)' : undefined }}>日</button>
          <button className="icon-btn" onClick={() => setView('week')} style={{ background: view === 'week' ? 'var(--accent-soft)' : undefined, color: view === 'week' ? 'var(--accent)' : undefined }}>周</button>
          <button className="icon-btn" onClick={() => setDay(day - 86400_000)}><ChevronLeft size={17} /></button>
          <button className="btn ghost sm" onClick={() => setDay(startOfDay(Date.now()).getTime())}>今天</button>
          <button className="icon-btn" onClick={() => setDay(day + 86400_000)}><ChevronRight size={17} /></button>
          <span style={{ fontWeight: 600, marginLeft: 8 }}>{format(day, 'yyyy年M月d日 EEEE', { locale: zhCN })}</span>
        </div>
        <div style={{ flex: 1 }} />
        <span className="tag">已安排 {Math.round(totalPlannedMin / 60 * 10) / 10} 小时</span>
        <span className="tag">空闲约 {Math.round(freeHours * 10) / 10} 小时</span>
      </div>

      {view === 'day' ? (
        <div className="card timeline">
          {HOURS.map((h) => {
            const hs = startOfDay(day).getTime() + h * 3600_000
            const he = hs + 3600_000
            const hourEvents = dayEvents.filter((e) => e.startAt < he && e.endAt > hs)
            return (
              <div className="tl-row" key={h}>
                <div className="tl-hour">{String(h).padStart(2, '0')}:00</div>
                <div className="tl-cells">
                  {hourEvents.map((e) => {
                    const meta = TYPE_META[e.type]
                    const isNow = now >= e.startAt && now < e.endAt
                    return (
                      <div key={e.id} className={`ev-block ${isNow ? 'now' : ''}`} style={{ borderLeftColor: meta.color, background: meta.bg }}>
                        <div className="ev-t">{e.title} {isNow && <span style={{ fontSize: 10, color: meta.color }}>· 进行中</span>}</div>
                        <div className="ev-time">{fmtTime(e.startAt)} - {fmtTime(e.endAt)} · {meta.label}</div>
                        <button className="icon-btn ev-del" title="按此时长开始专注" onClick={() => beginFocus(e)}><Play size={14} /></button>
                        <button className="icon-btn ev-del" title="编辑" style={{ right: 34 }} onClick={() => setEditing({ ...e })}><span style={{ fontSize: 13 }}>✎</span></button>
                        <button className="icon-btn ev-del" title="删除" style={{ right: 4 }} onClick={async () => { await deleteEvent(e.id!); onToast('日程已删除') }}><Trash2 size={13} /></button>
                      </div>
                    )
                  })}
                  {hourEvents.length === 0 && <div style={{ height: 40 }} onClick={() => {
                    const ev = emptyEvent(day); ev.startAt = hs; ev.endAt = he; setEditing(ev)
                  }} />}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8 }}>
          {weekDays.map((d) => {
            const ds = startOfDay(d).getTime()
            const evs = events.filter((e) => e.startAt >= ds && e.startAt < ds + 86400_000).sort((a, b) => a.startAt - b.startAt)
            const isToday = ds === startOfDay(Date.now()).getTime()
            return (
              <div className="card" key={ds} style={{ padding: 10, minHeight: 220, borderColor: isToday ? 'var(--accent)' : undefined }}>
                <div style={{ textAlign: 'center', fontSize: 12, fontWeight: 600, marginBottom: 10, color: isToday ? 'var(--accent)' : undefined }}>
                  {format(d, 'EEE d日', { locale: zhCN })}
                </div>
                {evs.map((e) => (
                  <div key={e.id} title={e.title} onClick={() => setEditing({ ...e })}
                    style={{ fontSize: 11, padding: '5px 7px', borderRadius: 6, marginBottom: 5, background: TYPE_META[e.type].bg, borderLeft: `3px solid ${TYPE_META[e.type].color}`, cursor: 'pointer' }}>
                    <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.title}</div>
                    <div style={{ color: 'var(--text-faint)', marginTop: 2 }}>{fmtTime(e.startAt)}</div>
                  </div>
                ))}
                {evs.length === 0 && <div style={{ textAlign: 'center', color: 'var(--text-faint)', fontSize: 11, marginTop: 30 }}>空闲</div>}
              </div>
            )
          })}
        </div>
      )}

      {editing && (
        <Modal title={editing.id ? '编辑日程' : '新建日程'} onClose={() => setEditing(null)} footer={
          <>
            <button className="btn ghost" onClick={() => setEditing(null)}>取消</button>
            <button className="btn" onClick={save}>保存</button>
          </>
        }>
          <div className="field" style={{ marginBottom: 14 }}>
            <label>标题 *</label>
            <input className="input" autoFocus value={editing.title} placeholder="例如：产品评审会" onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
          </div>
          <div className="field" style={{ marginBottom: 14 }}>
            <label>类型</label>
            <select className="select" value={editing.type} onChange={(e) => setEditing({ ...editing, type: e.target.value as EventType })}>
              {(Object.keys(TYPE_META) as EventType[]).map((k) => <option key={k} value={k}>{TYPE_META[k].label}</option>)}
            </select>
          </div>
          <div className="row" style={{ marginBottom: 14 }}>
            <div className="field">
              <label>开始</label>
              <input className="input" type="datetime-local" value={format(editing.startAt, "yyyy-MM-dd'T'HH:mm")}
                onChange={(e) => {
                  const v = new Date(e.target.value).getTime()
                  if (!isNaN(v)) setEditing({ ...editing, startAt: v, endAt: Math.max(v + 1800_000, editing.endAt) })
                }} />
            </div>
            <div className="field">
              <label>结束</label>
              <input className="input" type="datetime-local" value={format(editing.endAt, "yyyy-MM-dd'T'HH:mm")}
                onChange={(e) => {
                  const v = new Date(e.target.value).getTime()
                  if (!isNaN(v)) setEditing({ ...editing, endAt: Math.max(editing.startAt + 60000, v) })
                }} />
            </div>
          </div>
          <div className="field" style={{ marginBottom: 14 }}>
            <label>关联任务（可选）</label>
            <select className="select" value={editing.taskId ?? ''} onChange={(e) => setEditing({ ...editing, taskId: e.target.value ? Number(e.target.value) : undefined })}>
              <option value="">不关联</option>
              {tasks.filter(t => t.status !== 'done').map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
            </select>
          </div>
          <div className="field">
            <label>备注</label>
            <textarea className="textarea" value={editing.note ?? ''} onChange={(e) => setEditing({ ...editing, note: e.target.value })} />
          </div>
        </Modal>
      )}
    </div>
  )
}
