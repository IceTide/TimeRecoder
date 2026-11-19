import { create } from 'zustand'
import * as repo from '../db/database'
import type {
  CalendarEvent,
  FocusSession,
  Project,
  Task,
  TimeEntry,
} from '../types'

const FOCUS_KEY = 'timerecoder.focus'

interface PersistedFocus {
  sessionId: number
  taskId?: number
  plannedMin: number
  startAt: number
  accumulatedSec: number
  segmentStartAt: number | null
  pauseCount: number
}

function loadPersistedFocus(): PersistedFocus | null {
  try {
    const raw = localStorage.getItem(FOCUS_KEY)
    return raw ? (JSON.parse(raw) as PersistedFocus) : null
  } catch {
    return null
  }
}

function savePersistedFocus(f: PersistedFocus | null) {
  if (f) localStorage.setItem(FOCUS_KEY, JSON.stringify(f))
  else localStorage.removeItem(FOCUS_KEY)
}

export interface FocusState {
  sessionId: number
  taskId?: number
  plannedMin: number
  startAt: number
  accumulatedSec: number
  segmentStartAt: number | null
  pauseCount: number
  elapsedSec: number
}

interface State {
  projects: Project[]
  tasks: Task[]
  entries: TimeEntry[]
  sessions: FocusSession[]
  events: CalendarEvent[]
  focus: FocusState | null
  loaded: boolean

  loadAll: () => Promise<void>
  addProject: (p: Project) => Promise<number>
  updateProject: (id: number, c: Partial<Project>) => Promise<void>
  deleteProject: (id: number) => Promise<void>
  addTask: (t: Task) => Promise<number>
  updateTask: (id: number, c: Partial<Task>) => Promise<void>
  deleteTask: (id: number) => Promise<void>
  addEntry: (e: TimeEntry) => Promise<number>
  updateEntry: (id: number, c: Partial<TimeEntry>) => Promise<void>
  deleteEntry: (id: number) => Promise<void>
  addEvent: (e: CalendarEvent) => Promise<number>
  updateEvent: (id: number, c: Partial<CalendarEvent>) => Promise<void>
  deleteEvent: (id: number) => Promise<void>

  startFocus: (plannedMin: number, taskId?: number) => Promise<void>
  pauseFocus: () => void
  resumeFocus: () => void
  finishFocus: (status: 'completed' | 'aborted') => Promise<number | undefined>
  tickFocus: () => void
}

function toFocusState(p: PersistedFocus): FocusState {
  const live = p.segmentStartAt ? (Date.now() - p.segmentStartAt) / 1000 : 0
  return { ...p, elapsedSec: p.accumulatedSec + live }
}

export const useStore = create<State>((set, get) => ({
  projects: [],
  tasks: [],
  entries: [],
  sessions: [],
  events: [],
  focus: null,
  loaded: false,

  loadAll: async () => {
    const [projects, tasks, entries, sessions, events] = await Promise.all([
      repo.getProjects(), repo.getTasks(), repo.getEntries(), repo.getSessions(), repo.getEvents(),
    ])
    const pf = loadPersistedFocus()
    // 会话若已被删除则丢弃残留状态
    const valid = pf && pf.sessionId && sessions.some((s) => s.id === pf.sessionId && s.status === 'running')
    set({
      projects, tasks, entries, sessions, events,
      focus: valid ? toFocusState(pf!) : null,
      loaded: true,
    })
  },

  addProject: async (p) => {
    const id = await repo.addProject(p)
    await get().loadAll()
    return id as number
  },
  updateProject: async (id, c) => { await repo.updateProject(id, c); await get().loadAll() },
  deleteProject: async (id) => { await repo.deleteProject(id); await get().loadAll() },

  addTask: async (t) => {
    const id = await repo.addTask(t)
    await get().loadAll()
    return id as number
  },
  updateTask: async (id, c) => { await repo.updateTask(id, c); await get().loadAll() },
  deleteTask: async (id) => { await repo.deleteTask(id); await get().loadAll() },

  addEntry: async (e) => {
    const id = await repo.addEntry(e)
    await get().loadAll()
    return id as number
  },
  updateEntry: async (id, c) => { await repo.updateEntry(id, c); await get().loadAll() },
  deleteEntry: async (id) => { await repo.deleteEntry(id); await get().loadAll() },

  addEvent: async (e) => {
    const id = await repo.addEvent(e)
    await get().loadAll()
    return id as number
  },
  updateEvent: async (id, c) => { await repo.updateEvent(id, c); await get().loadAll() },
  deleteEvent: async (id) => { await repo.deleteEvent(id); await get().loadAll() },

  startFocus: async (plannedMin, taskId) => {
    if (get().focus) return
    const now = Date.now()
    const id = await repo.addSession({
      taskId, plannedMin, startAt: now, pauseCount: 0, status: 'running',
    })
    const pf: PersistedFocus = {
      sessionId: id as number, taskId, plannedMin, startAt: now,
      accumulatedSec: 0, segmentStartAt: now, pauseCount: 0,
    }
    savePersistedFocus(pf)
    set({ focus: { ...pf, elapsedSec: 0 }, sessions: await repo.getSessions() })
  },

  pauseFocus: () => {
    const f = get().focus
    if (!f || f.segmentStartAt === null) return
    const accumulatedSec = f.accumulatedSec + (Date.now() - f.segmentStartAt) / 1000
    const next: PersistedFocus = { ...f, accumulatedSec, segmentStartAt: null }
    savePersistedFocus(next)
    set({ focus: { ...next, elapsedSec: accumulatedSec } })
  },

  resumeFocus: () => {
    const f = get().focus
    if (!f || f.segmentStartAt !== null) return
    const next: PersistedFocus = { ...f, segmentStartAt: Date.now(), pauseCount: f.pauseCount + 1 }
    savePersistedFocus(next)
    set({ focus: toFocusState(next) })
  },

  finishFocus: async (status) => {
    const f = get().focus
    if (!f) return
    const endAt = Date.now()
    const elapsedSec = f.segmentStartAt !== null
      ? f.accumulatedSec + (endAt - f.segmentStartAt) / 1000
      : f.accumulatedSec

    await repo.updateSession(f.sessionId, {
      endAt,
      status,
      pauseCount: f.pauseCount,
    })
    if (status === 'completed' && elapsedSec >= 1) {
      const task = f.taskId ? get().tasks.find((t) => t.id === f.taskId) : undefined
      await repo.addEntry({
        taskId: f.taskId,
        projectId: task?.projectId,
        category: 'focus',
        startAt: f.startAt,
        endAt,
        durationSec: Math.round(elapsedSec),
        source: 'focus',
        note: `专注 ${f.plannedMin} 分钟`,
        createdAt: Date.now(),
      })
      if (task?.id && task.status !== 'done') {
        await repo.updateTask(task.id, { status: 'done', completedAt: Date.now() })
      }
    }
    savePersistedFocus(null)
    const [sessions, entries, tasks] = await Promise.all([
      repo.getSessions(), repo.getEntries(), repo.getTasks(),
    ])
    set({ focus: null, sessions, entries, tasks })
    return elapsedSec
  },

  tickFocus: () => {
    const f = get().focus
    if (!f || f.segmentStartAt === null) return
    const elapsedSec = f.accumulatedSec + (Date.now() - f.segmentStartAt) / 1000
    set({ focus: { ...f, elapsedSec } })
  },
}))
