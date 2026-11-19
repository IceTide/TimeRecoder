import { useMemo, useState } from 'react'
import { Plus, Play, Pencil, Trash2, Search, Check, ListTodo } from 'lucide-react'
import { useStore } from '../store/useStore'
import EmptyState from '../components/EmptyState'
import type { Priority, Task, TaskStatus } from '../types'
import Modal from '../components/Modal'
import { PRIORITY_LABEL, fmtDate } from '../utils/time'

interface Props { onToast: (msg: string) => void }

const FILTERS: { key: TaskStatus | 'all'; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'todo', label: '待办' },
  { key: 'doing', label: '进行中' },
  { key: 'done', label: '已完成' },
]

const emptyTask = (): Task => ({
  title: '', priority: 'medium', status: 'todo', tags: [], createdAt: Date.now(),
})

export default function TodoPage({ onToast }: Props) {
  const { tasks, projects, entries, addTask, updateTask, deleteTask, startFocus, focus } = useStore()
  const [filter, setFilter] = useState<TaskStatus | 'all'>('all')
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Task | null>(null)

  const filtered = useMemo(() => tasks
    .filter((t) => filter === 'all' || t.status === filter)
    .filter((t) => !query || t.title.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => {
      const rank = { high: 0, medium: 1, low: 2 }
      if (a.status === 'done' && b.status !== 'done') return 1
      if (b.status === 'done' && a.status !== 'done') return -1
      return rank[a.priority] - rank[b.priority] || b.createdAt - a.createdAt
    }), [tasks, filter, query])

  const taskTime = (id?: number) => entries.filter((e) => e.taskId === id).reduce((s, e) => s + e.durationSec, 0)

  const saveTask = async () => {
    if (!editing || !editing.title.trim()) return
    if (editing.id) await updateTask(editing.id, editing)
    else await addTask({ ...editing, createdAt: Date.now() })
    setEditing(null)
    onToast(editing.id ? '任务已更新' : '任务已创建')
  }

  const toggleDone = (t: Task) => {
    if (!t.id) return
    const done = t.status === 'done'
    updateTask(t.id, { status: done ? 'todo' : 'done', completedAt: done ? undefined : Date.now() })
  }

  const beginFocus = async (t: Task) => {
    if (focus) { onToast('已有专注进行中'); return }
    await startFocus(25, t.id)
    if (t.id) await updateTask(t.id, { status: 'doing' })
    onToast('已开始专注该任务')
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title">待办任务</div>
          <div className="page-desc">先决定做什么，再谈效率 · 共 {tasks.filter(t => t.status !== 'done').length} 项未完成</div>
        </div>
        <button className="btn" onClick={() => setEditing(emptyTask())}><Plus size={16} style={{ marginRight: 6 }} />新建任务</button>
      </div>

      <div className="todo-toolbar">
        <div style={{ display: 'flex', gap: 6 }}>
          {FILTERS.map((f) => (
            <button key={f.key} className={`filter-chip ${filter === f.key ? 'active' : ''}`} onClick={() => setFilter(f.key)}>{f.label}</button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ position: 'relative', width: 220 }}>
          <Search size={15} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-faint)' }} />
          <input className="input" style={{ paddingLeft: 32 }} placeholder="搜索任务…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>

      <div className="card">
        {filtered.length === 0 ? (
          <EmptyState
            icon={ListTodo}
            title={query ? '没有匹配的任务' : '还没有任务'}
            hint={query ? '试试换个关键词，或清空搜索条件' : '点击右上角「新建任务」，把要做的事一一清单化'}
          />
        ) : filtered.map((t) => {
          const proj = projects.find((p) => p.id === t.projectId)
          const spent = taskTime(t.id)
          return (
            <div className={`todo-item ${t.status === 'done' ? 'done' : ''}`} key={t.id}>
              <button className={`todo-check ${t.status === 'done' ? 'done' : ''}`} onClick={() => toggleDone(t)}>
                {t.status === 'done' && <Check size={13} />}
              </button>
              <div className="todo-main">
                <div className="todo-title">{t.title}</div>
                <div className="todo-meta">
                  <span className={`prio prio-${t.priority}`}>{PRIORITY_LABEL[t.priority]}优先</span>
                  {proj && <span className="tag"><span className="dot" style={{ background: proj.color, display: 'inline-block', width: 7, height: 7, marginRight: 5 }} />{proj.name}</span>}
                  {t.estimatedMin && <span className="tag">预计 {t.estimatedMin} 分</span>}
                  {spent > 0 && <span className="tag">已投入 {Math.round(spent / 60)} 分</span>}
                  {t.dueDate && <span className="tag">截止 {fmtDate(t.dueDate, 'M/d')}</span>}
                  {t.tags.map((tag) => <span className="tag" key={tag}>#{tag}</span>)}
                </div>
              </div>
              <div className="todo-actions">
                {t.status !== 'done' && <button className="icon-btn" title="开始专注" onClick={() => beginFocus(t)}><Play size={16} /></button>}
                <button className="icon-btn" title="编辑" onClick={() => setEditing({ ...t })}><Pencil size={16} /></button>
                <button className="icon-btn" title="删除" onClick={async () => { await deleteTask(t.id!); onToast('任务已删除') }}><Trash2 size={16} /></button>
              </div>
            </div>
          )
        })}
      </div>

      {editing && (
        <Modal title={editing.id ? '编辑任务' : '新建任务'} onClose={() => setEditing(null)} footer={
          <>
            <button className="btn ghost" onClick={() => setEditing(null)}>取消</button>
            <button className="btn" onClick={saveTask}>保存</button>
          </>
        }>
          <div className="field" style={{ marginBottom: 14 }}>
            <label>任务标题 *</label>
            <input className="input" autoFocus value={editing.title} placeholder="要做什么？" onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
          </div>
          <div className="row" style={{ marginBottom: 14 }}>
            <div className="field">
              <label>项目</label>
              <select className="select" value={editing.projectId ?? ''} onChange={(e) => setEditing({ ...editing, projectId: e.target.value ? Number(e.target.value) : undefined })}>
                <option value="">未分类</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label>优先级</label>
              <select className="select" value={editing.priority} onChange={(e) => setEditing({ ...editing, priority: e.target.value as Priority })}>
                <option value="high">高</option><option value="medium">中</option><option value="low">低</option>
              </select>
            </div>
          </div>
          <div className="row" style={{ marginBottom: 14 }}>
            <div className="field">
              <label>状态</label>
              <select className="select" value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value as TaskStatus })}>
                <option value="todo">待办</option><option value="doing">进行中</option><option value="done">已完成</option>
              </select>
            </div>
            <div className="field">
              <label>预计时长（分钟）</label>
              <input className="input" type="number" min="0" value={editing.estimatedMin ?? ''} onChange={(e) => setEditing({ ...editing, estimatedMin: e.target.value ? Number(e.target.value) : undefined })} />
            </div>
          </div>
          <div className="field" style={{ marginBottom: 14 }}>
            <label>截止日期</label>
            <input className="input" type="date" value={editing.dueDate ? fmtDate(editing.dueDate) : ''} onChange={(e) => setEditing({ ...editing, dueDate: e.target.value ? new Date(e.target.value).getTime() : undefined })} />
          </div>
          <div className="field">
            <label>备注</label>
            <textarea className="textarea" value={editing.note ?? ''} placeholder="补充信息…" onChange={(e) => setEditing({ ...editing, note: e.target.value })} />
          </div>
        </Modal>
      )}
    </div>
  )
}
