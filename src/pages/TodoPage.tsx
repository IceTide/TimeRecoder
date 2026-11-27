import { useMemo, useState } from 'react'
import { Plus, Play, Pencil, Trash2, Search, Check, ListTodo, Sparkles, X } from 'lucide-react'
import { useStore } from '../store/useStore'
import EmptyState from '../components/EmptyState'
import type { Priority, Recurrence, Subtask, Task, TaskStatus } from '../types'
import Modal from '../components/Modal'
import { PRIORITY_LABEL, fmtDate } from '../utils/time'
import { newSubtaskId, parseTaskInput, RECURRENCE_LABEL } from '../utils/taskInput'

interface Props { onToast: (msg: string) => void }

const FILTERS: { key: TaskStatus | 'all'; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'todo', label: '待办' },
  { key: 'doing', label: '进行中' },
  { key: 'done', label: '已完成' },
]

const emptyTask = (): Task => ({
  title: '', priority: 'medium', status: 'todo', tags: [],
  subtasks: [], recurrence: 'none', createdAt: Date.now(),
})

export default function TodoPage({ onToast }: Props) {
  const { tasks, projects, entries, addTask, updateTask, deleteTask, completeTask, startFocus, focus } = useStore()
  const [filter, setFilter] = useState<TaskStatus | 'all'>('all')
  const [projectFilter, setProjectFilter] = useState<number | 'all' | 'none'>('all')
  const [tagFilter, setTagFilter] = useState('')
  const [query, setQuery] = useState('')
  const [quick, setQuick] = useState('')
  const [editing, setEditing] = useState<Task | null>(null)
  const [parseNotice, setParseNotice] = useState('')
  const [newTag, setNewTag] = useState('')

  const allTags = useMemo(() =>
    Array.from(new Set(tasks.flatMap((t) => t.tags ?? []))).sort(), [tasks])

  const filtered = useMemo(() => tasks
    .filter((t) => filter === 'all' || t.status === filter)
    .filter((t) => !query || t.title.toLowerCase().includes(query.toLowerCase()))
    .filter((t) => projectFilter === 'all' || (projectFilter === 'none' ? !t.projectId : t.projectId === projectFilter))
    .filter((t) => !tagFilter || (t.tags ?? []).includes(tagFilter))
    .sort((a, b) => {
      const rank = { high: 0, medium: 1, low: 2 }
      if (a.status === 'done' && b.status !== 'done') return 1
      if (b.status === 'done' && a.status !== 'done') return -1
      return rank[a.priority] - rank[b.priority] || b.createdAt - a.createdAt
    }), [tasks, filter, query, projectFilter, tagFilter])

  const taskTime = (id?: number) => entries.filter((e) => e.taskId === id).reduce((s, e) => s + e.durationSec, 0)

  const solveProject = (name?: string) => {
    if (!name) return undefined
    const lower = name.toLowerCase()
    return projects.find((p) => p.name.toLowerCase() === lower)
      ?? projects.find((p) => p.name.toLowerCase().includes(lower))
  }

  const applyParsedFields = (base: Task, text: string): { task: Task; notice: string } => {
    const parsed = parseTaskInput(text)
    const task: Task = { ...base, title: parsed.title }
    const notices: string[] = []
    if (parsed.priority) { task.priority = parsed.priority; notices.push(PRIORITY_LABEL[parsed.priority]) }
    if (parsed.estimatedMin) { task.estimatedMin = parsed.estimatedMin; notices.push(`${parsed.estimatedMin} 分钟`) }
    if (parsed.dueDate) { task.dueDate = parsed.dueDate; notices.push(fmtDate(parsed.dueDate, 'M/d HH:mm')) }
    const project = solveProject(parsed.projectName)
    if (project?.id) { task.projectId = project.id; notices.push(project.name) }
    if (parsed.tags.length) {
      task.tags = Array.from(new Set([...(task.tags ?? []), ...parsed.tags]))
      notices.push(parsed.tags.map((t) => `#${t}`).join(' '))
    }
    if (parsed.recurrence) {
      task.recurrence = parsed.recurrence
      notices.push(RECURRENCE_LABEL[parsed.recurrence])
    }
    return { task, notice: notices.join(' · ') }
  }

  const quickAdd = async () => {
    const { task } = applyParsedFields(emptyTask(), quick)
    if (!task.title.trim()) return
    await addTask({ ...task, createdAt: Date.now() })
    setQuick('')
    onToast(`已添加「${task.title}」`)
  }

  const saveTask = async () => {
    if (!editing || !editing.title.trim()) return
    const { task: parsed } = applyParsedFields(editing, editing.title)
    const task: Task = {
      ...parsed,
      subtasks: (parsed.subtasks ?? []).filter((s) => s.title.trim()),
    }
    if (editing.id) {
      const previous = tasks.find((t) => t.id === editing.id)
      if (task.status === 'done' && previous?.status !== 'done') {
        // 先保存本次编辑（含截止日期等），再按最新配置生成下一次重复实例
        await updateTask(editing.id, { ...task, status: previous?.status ?? 'todo' })
        await completeTask(editing.id)
      } else {
        await updateTask(editing.id, task)
      }
    } else {
      await addTask({ ...task, createdAt: Date.now() })
    }
    setEditing(null)
    setParseNotice('')
    onToast(editing.id ? '任务已更新' : '任务已创建')
  }

  const toggleDone = (t: Task) => {
    if (!t.id) return
    if (t.status === 'done') updateTask(t.id, { status: 'todo', completedAt: undefined })
    else completeTask(t.id)
  }

  const toggleSubtask = (t: Task, subtaskId: string) => {
    if (!t.id || !t.subtasks) return
    updateTask(t.id, {
      subtasks: t.subtasks.map((s) => s.id === subtaskId ? { ...s, done: !s.done } : s),
    })
  }

  const editSubtasks = (mutate: (list: Subtask[]) => Subtask[]) => {
    setEditing((prev) => prev ? { ...prev, subtasks: mutate([...(prev.subtasks ?? [])]) } : prev)
  }

  const addTag = (raw: string) => {
    const tag = raw.trim().replace(/^#/, '').trim()
    if (!tag || !editing) return
    if (!(editing.tags ?? []).some((t) => t.toLowerCase() === tag.toLowerCase())) {
      setEditing({ ...editing, tags: [...(editing.tags ?? []), tag] })
    }
    setNewTag('')
  }

  const toggleTag = (tag: string) => {
    if (!editing) return
    const exists = (editing.tags ?? []).some((t) => t.toLowerCase() === tag.toLowerCase())
    setEditing({
      ...editing,
      tags: exists
        ? (editing.tags ?? []).filter((t) => t.toLowerCase() !== tag.toLowerCase())
        : [...(editing.tags ?? []), tag],
    })
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
        <button className="btn" onClick={() => { setEditing(emptyTask()); setParseNotice(''); setNewTag('') }}><Plus size={16} style={{ marginRight: 6 }} />新建任务</button>
      </div>

      <div className="todo-toolbar">
        <div style={{ display: 'flex', gap: 6 }}>
          {FILTERS.map((f) => (
            <button key={f.key} className={`filter-chip ${filter === f.key ? 'active' : ''}`} onClick={() => setFilter(f.key)}>{f.label}</button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <select className="select" style={{ width: 130 }} value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value === 'all' ? 'all' : e.target.value === 'none' ? 'none' : Number(e.target.value))}>
          <option value="all">全部项目</option>
          <option value="none">未分类</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select className="select" style={{ width: 120 }} value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
          <option value="">全部标签</option>
          {allTags.map((tag) => <option key={tag} value={tag}>#{tag}</option>)}
        </select>
        {(projectFilter !== 'all' || tagFilter) && (
          <button className="btn ghost sm" onClick={() => { setProjectFilter('all'); setTagFilter('') }}>重置筛选</button>
        )}
        <div style={{ position: 'relative', width: 220 }}>
          <Search size={15} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-faint)' }} />
          <input className="input" style={{ paddingLeft: 32 }} placeholder="搜索任务…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>

      <div className="quick-add-bar">
        <Sparkles size={15} className="quick-add-icon" />
        <input
          className="input"
          value={quick}
          placeholder="快速添加：明天 15:00 评审 !高 @产品 #会议 预计60分 每周"
          onChange={(e) => setQuick(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void quickAdd() }}
        />
        <button className="btn sm" onClick={() => void quickAdd()}>添加</button>
        <span className="quick-add-hint">支持日期 / 时间 / !优先级 / @项目 / #标签 / 预计时长 / 重复</span>
      </div>

      <div className="card">
        {filtered.length === 0 ? (
          <EmptyState
            icon={ListTodo}
            title={query ? '没有匹配的任务' : '还没有任务'}
            hint={query ? '试试换个关键词，或清空搜索条件' : '在上方输入一句话，或点击右上角「新建任务」'}
          />
        ) : filtered.map((t) => {
          const proj = projects.find((p) => p.id === t.projectId)
          const spent = taskTime(t.id)
          const doneSubs = t.subtasks?.filter((s) => s.done).length ?? 0
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
                  {t.recurrence && t.recurrence !== 'none' && <span className="tag">{RECURRENCE_LABEL[t.recurrence]}</span>}
                  {t.tags.map((tag) => <span className="tag" key={tag}>#{tag}</span>)}
                </div>
                {!!t.subtasks?.length && (
                  <div className="subtask-inline">
                    {t.subtasks.map((s) => (
                      <button key={s.id} className={`subtask-chip ${s.done ? 'done' : ''}`} onClick={() => toggleSubtask(t, s.id)} title="点击切换完成状态">
                        <span className="subtask-box">{s.done && <Check size={10} />}</span>
                        {s.title}
                      </button>
                    ))}
                    <span className="subtask-count">{doneSubs}/{t.subtasks.length}</span>
                  </div>
                )}
              </div>
              <div className="todo-actions">
                {t.status !== 'done' && <button className="icon-btn" title="开始专注" onClick={() => beginFocus(t)}><Play size={16} /></button>}
                <button className="icon-btn" title="编辑" onClick={() => { setEditing({ ...t, subtasks: [...(t.subtasks ?? [])] }); setParseNotice(''); setNewTag('') }}><Pencil size={16} /></button>
                <button className="icon-btn" title="删除" onClick={async () => { await deleteTask(t.id!); onToast('任务已删除') }}><Trash2 size={16} /></button>
              </div>
            </div>
          )
        })}
      </div>

      {editing && (
        <Modal title={editing.id ? '编辑任务' : '新建任务'} onClose={() => { setEditing(null); setParseNotice('') }} footer={
          <>
            <button className="btn ghost" onClick={() => { setEditing(null); setParseNotice('') }}>取消</button>
            <button className="btn" onClick={saveTask}>保存</button>
          </>
        }>
          <div className="field" style={{ marginBottom: 14 }}>
            <label>任务标题 * <span className="field-note">支持自然语言，点「解析」自动填表</span></label>
            <div className="inline-field">
              <input className="input" autoFocus value={editing.title} placeholder="例如：明天 15:00 评审 !高 @产品 #会议 预计60分 每周" onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
              <button className="btn ghost sm" title="解析标题中的日期、优先级、项目等信息" onClick={() => {
                const result = applyParsedFields(editing, editing.title)
                setEditing(result.task)
                setParseNotice(result.notice || '未识别到可解析的信息')
              }}><Sparkles size={14} />解析</button>
            </div>
            {parseNotice && <div className="field-hint">已识别：{parseNotice}</div>}
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
            <div className="field">
              <label>重复</label>
              <select className="select" value={editing.recurrence ?? 'none'} onChange={(e) => setEditing({ ...editing, recurrence: e.target.value as Recurrence })}>
                {(Object.keys(RECURRENCE_LABEL) as Recurrence[]).map((r) => <option key={r} value={r}>{RECURRENCE_LABEL[r]}</option>)}
              </select>
            </div>
          </div>
          <div className="field" style={{ marginBottom: 14 }}>
            <label>截止日期</label>
            <input className="input" type="date" value={editing.dueDate ? fmtDate(editing.dueDate) : ''} onChange={(e) => setEditing({ ...editing, dueDate: e.target.value ? new Date(e.target.value).getTime() : undefined })} />
          </div>

          <div className="field" style={{ marginBottom: 14 }}>
            <label>标签 <span className="field-note">回车添加，点击标签可移除</span></label>
            <div className="tag-editor">
              {(editing.tags ?? []).map((tag) => (
                <button key={tag} className="filter-chip active" title="点击移除" onClick={() => toggleTag(tag)}>#{tag} ×</button>
              ))}
              <input className="input" value={newTag} placeholder="输入标签后回车" onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(newTag) } }} />
            </div>
            {allTags.length > 0 && (
              <div className="tag-suggestions">
                <span>已有：</span>
                {allTags.filter((t) => !(editing.tags ?? []).some((x) => x.toLowerCase() === t.toLowerCase()))
                  .slice(0, 12)
                  .map((tag) => <button key={tag} className="filter-chip" onClick={() => toggleTag(tag)}>#{tag}</button>)}
              </div>
            )}
          </div>

          <div className="field" style={{ marginBottom: 14 }}>
            <label>子任务 <span className="field-note">{editing.subtasks?.filter((s) => s.done).length ?? 0}/{editing.subtasks?.length ?? 0} 已完成</span></label>
            <div className="subtask-list">
              {(editing.subtasks ?? []).map((s) => (
                <div className="subtask-row" key={s.id}>
                  <button className={`subtask-box ${s.done ? 'done' : ''}`} onClick={() => editSubtasks((list) => list.map((x) => x.id === s.id ? { ...x, done: !x.done } : x))}>
                    {s.done && <Check size={11} />}
                  </button>
                  <input className="input" value={s.title} placeholder="子任务内容" onChange={(e) => editSubtasks((list) => list.map((x) => x.id === s.id ? { ...x, title: e.target.value } : x))} />
                  <button className="icon-btn" title="删除子任务" onClick={() => editSubtasks((list) => list.filter((x) => x.id !== s.id))}><X size={14} /></button>
                </div>
              ))}
              <button className="btn ghost sm" onClick={() => editSubtasks((list) => [...list, { id: newSubtaskId(), title: '', done: false }])}><Plus size={13} style={{ marginRight: 5 }} />添加子任务</button>
            </div>
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
