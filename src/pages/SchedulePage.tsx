import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Plus, ChevronLeft, ChevronRight, Trash2, Play, CalendarPlus, Upload, Download, Check } from 'lucide-react'
import { format, startOfDay, addDays } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { useStore } from '../store/useStore'
import type { CalendarEvent, EventType } from '../types'
import Modal from '../components/Modal'
import { fmtTime } from '../utils/time'
import { downloadIcs, eventIdentity, parseIcs } from '../utils/ics'

interface Props { onToast: (msg: string) => void }

interface DragState {
  id: number
  mode: 'move' | 'resize'
  startY: number
  deltaMin: number
  startAt: number
  endAt: number
}

const TYPE_META: Record<EventType, { label: string; color: string; bg: string }> = {
  meeting: { label: '会议', color: 'var(--cat-meeting)', bg: 'color-mix(in oklch, var(--cat-meeting) 13%, transparent)' },
  task: { label: '任务', color: 'var(--accent)', bg: 'color-mix(in oklch, var(--accent) 12%, transparent)' },
  personal: { label: '个人', color: 'var(--cat-learning)', bg: 'color-mix(in oklch, var(--cat-learning) 13%, transparent)' },
  break: { label: '休息', color: 'var(--cat-admin)', bg: 'color-mix(in oklch, var(--cat-admin) 13%, transparent)' },
}

const HOURS = Array.from({ length: 16 }, (_, i) => i + 7) // 07:00 - 22:00
const ROW_HEIGHT = 52 // 与 .tl-row 的 min-height 保持一致
const DRAG_SNAP_MIN = 5

const emptyEvent = (day: number): CalendarEvent => ({
  title: '', type: 'task',
  startAt: startOfDay(day).getTime() + 9 * 3600_000,
  endAt: startOfDay(day).getTime() + 10 * 3600_000,
})

export default function SchedulePage({ onToast }: Props) {
  const { events, tasks, addEvent, addEvents, updateEvent, deleteEvent, startFocus, focus } = useStore()
  const [day, setDay] = useState(() => startOfDay(Date.now()).getTime())
  const [editing, setEditing] = useState<CalendarEvent | null>(null)
  const [view, setView] = useState<'day' | 'week'>('day')
  const [drag, setDrag] = useState<DragState | null>(null)
  const [importPreview, setImportPreview] = useState<CalendarEvent[] | null>(null)
  const [importSkipped, setImportSkipped] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const dragging = !!drag

  const dayEvents = useMemo(() => events
    .filter((e) => e.startAt >= startOfDay(day).getTime() && e.startAt < startOfDay(day).getTime() + 86400_000)
    .sort((a, b) => a.startAt - b.startAt), [events, day])

  const now = Date.now()
  const totalPlannedMin = dayEvents.reduce((s, e) => s + (e.endAt - e.startAt) / 60000, 0)
  const freeHours = Math.max(0, 16 - totalPlannedMin / 60)
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(day, i - ((new Date(day).getDay() + 6) % 7)))

  useEffect(() => { dragRef.current = drag }, [drag])

  useEffect(() => {
    if (!dragging) return
    const onMove = (e: PointerEvent) => {
      const current = dragRef.current
      if (!current) return
      const deltaMin = Math.round(((e.clientY - current.startY) / ROW_HEIGHT) * 60 / DRAG_SNAP_MIN) * DRAG_SNAP_MIN
      if (deltaMin === current.deltaMin) return
      const next = { ...current, deltaMin }
      dragRef.current = next
      setDrag(next)
    }
    const onUp = async () => {
      const current = dragRef.current
      dragRef.current = null
      setDrag(null)
      if (!current || current.deltaMin === 0) return
      const shift = current.deltaMin * 60_000
      const startAt = current.startAt + shift
      const endAt = current.mode === 'resize'
        ? Math.max(current.startAt + 15 * 60_000, current.endAt + shift)
        : current.endAt + shift
      if (startAt === current.startAt && endAt === current.endAt) return
      await useStore.getState().updateEvent(current.id, { startAt, endAt })
      onToast(current.mode === 'move' ? '日程时间已调整' : '日程时长已调整')
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [dragging, onToast])

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

  const beginDrag = (e: ReactPointerEvent<HTMLDivElement>, event: CalendarEvent) => {
    if (!event.id || (e.target as HTMLElement).closest('button')) return
    const rect = e.currentTarget.getBoundingClientRect()
    const next: DragState = {
      id: event.id,
      mode: e.clientY > rect.bottom - 12 ? 'resize' : 'move',
      startY: e.clientY,
      deltaMin: 0,
      startAt: event.startAt,
      endAt: event.endAt,
    }
    dragRef.current = next
    setDrag(next)
    e.preventDefault()
  }

  const handleIcsFile = async (file?: File) => {
    if (!file) return
    try {
      const parsed = parseIcs(await file.text())
      const seen = new Set(events.map(eventIdentity))
      const unique: CalendarEvent[] = []
      let skipped = 0
      for (const item of parsed) {
        const key = eventIdentity(item)
        if (seen.has(key)) { skipped++; continue }
        seen.add(key)
        unique.push(item)
      }
      setImportSkipped(skipped)
      if (!unique.length) onToast('没有可导入的新日程')
      else setImportPreview(unique)
    } catch {
      onToast('无法解析该 .ics 文件')
    }
  }

  const confirmImport = async () => {
    if (!importPreview) return
    await addEvents(importPreview)
    setImportPreview(null)
    onToast(`已导入 ${importPreview.length} 条日程${importSkipped ? ` · 跳过 ${importSkipped} 条重复` : ''}`)
  }

  const exportCurrent = () => {
    const start = weekDays[0].getTime()
    const end = addDays(weekDays[6], 1).getTime()
    const list = view === 'day'
      ? dayEvents
      : events.filter((e) => e.startAt >= start && e.startAt < end).sort((a, b) => a.startAt - b.startAt)
    if (!list.length) { onToast('当前视图没有日程可导出'); return }
    downloadIcs(list, `timerecoder-${view}-${format(day, 'yyyy-MM-dd')}.ics`)
    onToast(`已导出 ${list.length} 条日程`)
  }

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
        <button className="btn ghost sm" onClick={() => fileRef.current?.click()}><Upload size={14} style={{ marginRight: 5 }} />导入 .ics</button>
        <button className="btn ghost sm" onClick={exportCurrent}><Download size={14} style={{ marginRight: 5 }} />导出当前视图</button>
        <input ref={fileRef} type="file" accept=".ics,text/calendar" hidden onChange={(e) => {
          void handleIcsFile(e.target.files?.[0])
          e.target.value = ''
        }} />
      </div>

      {view === 'day' ? (
        <div className="card timeline">
          {dayEvents.length === 0 && (
            <div className="timeline-hint">
              <div className="timeline-hint-icon"><CalendarPlus size={24} strokeWidth={1.6} /></div>
              <div className="timeline-hint-title">这一天还没有安排</div>
              <div className="timeline-hint-sub">点击时间轴的空白处快速添加，或导入 .ics 日历</div>
            </div>
          )}
          {HOURS.map((h) => {
            const hs = startOfDay(day).getTime() + h * 3600_000
            const he = hs + 3600_000
            const hourEvents = dayEvents.filter((e) => e.startAt < he && e.endAt > hs)
            const activeDrag = drag
            return (
              <div className="tl-row" key={h}>
                <div className="tl-hour">{String(h).padStart(2, '0')}:00</div>
                <div className="tl-cells">
                  {hourEvents.map((e) => {
                    const meta = TYPE_META[e.type]
                    const isNow = now >= e.startAt && now < e.endAt
                    const active = activeDrag?.id === e.id
                    const shift = active && activeDrag ? activeDrag.deltaMin * 60_000 : 0
                    const shownStart = e.startAt + shift
                    const shownEnd = active && activeDrag?.mode === 'resize'
                      ? Math.max(e.startAt + 15 * 60_000, e.endAt + shift)
                      : e.endAt + shift
                    return (
                      <div
                        key={e.id}
                        className={`ev-block ${isNow ? 'now' : ''} ${active ? 'dragging' : ''} ${active && activeDrag?.mode === 'resize' ? 'resizing' : ''}`}
                        style={{
                          borderLeftColor: meta.color, background: meta.bg,
                          transform: active && activeDrag?.mode === 'move' ? `translateY(${activeDrag.deltaMin * ROW_HEIGHT / 60}px)` : undefined,
                          zIndex: active ? 5 : undefined,
                        }}
                        onPointerDown={(ev) => beginDrag(ev, e)}
                        title="拖动主体移动时间 · 拖动底部边缘调整时长"
                      >
                        <div className="ev-t">{e.title} {isNow && <span style={{ fontSize: 10, color: meta.color }}>· 进行中</span>}</div>
                        <div className="ev-time">{fmtTime(shownStart)} - {fmtTime(shownEnd)} · {meta.label}</div>
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

      {importPreview && (
        <Modal title="确认导入日程" onClose={() => setImportPreview(null)} footer={
          <>
            <button className="btn ghost" onClick={() => setImportPreview(null)}>取消</button>
            <button className="btn" onClick={() => void confirmImport()}><Check size={15} style={{ marginRight: 6 }} />导入 {importPreview.length} 条</button>
          </>
        }>
          <div className="import-summary">
            从日历文件中识别到 <strong>{importPreview.length}</strong> 条新日程
            {importSkipped > 0 && `，另有 ${importSkipped} 条与现有日程重复将跳过`}。重复规则已展开为具体日程，不支持的规则仅导入首条。
          </div>
          <div className="import-list">
            {importPreview.slice(0, 8).map((e, i) => (
              <div className="import-row" key={`${e.startAt}-${i}`}>
                <span className="import-dot" style={{ background: TYPE_META[e.type].color }} />
                <span className="import-title">{e.title}</span>
                <span className="import-time">{format(e.startAt, 'M/d HH:mm')} – {format(e.endAt, 'HH:mm')}</span>
              </div>
            ))}
            {importPreview.length > 8 && <div className="import-more">还有 {importPreview.length - 8} 条…</div>}
          </div>
        </Modal>
      )}
    </div>
  )
}
