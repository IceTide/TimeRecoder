import Dexie, { type Table } from 'dexie'
import type {
  CalendarEvent,
  FocusSession,
  Project,
  Setting,
  Task,
  TimeEntry,
} from '../types'

class TimeRecoderDB extends Dexie {
  projects!: Table<Project, number>
  tasks!: Table<Task, number>
  timeEntries!: Table<TimeEntry, number>
  focusSessions!: Table<FocusSession, number>
  events!: Table<CalendarEvent, number>
  settings!: Table<Setting, string>

  constructor() {
    super('TimeRecoder')
    this.version(1).stores({
      projects: '++id, name, createdAt',
      tasks: '++id, title, projectId, status, priority, dueDate, createdAt',
      timeEntries: '++id, taskId, projectId, category, startAt, endAt, source',
      focusSessions: '++id, taskId, startAt, endAt, status',
      events: '++id, startAt, endAt, type, taskId',
      settings: 'key',
    })
  }
}

export const db = new TimeRecoderDB()

// ---------- 项目 ----------
export const getProjects = () => db.projects.toArray()
export const addProject = (p: Project) => db.projects.add(p)
export const updateProject = (id: number, changes: Partial<Project>) =>
  db.projects.update(id, changes)
export const deleteProject = async (id: number) => {
  await db.tasks.where('projectId').equals(id).modify({ projectId: undefined })
  await db.projects.delete(id)
}

// ---------- 任务 ----------
export const getTasks = () => db.tasks.toArray()
export const addTask = (t: Task) => db.tasks.add(t)
export const updateTask = (id: number, changes: Partial<Task>) => db.tasks.update(id, changes)
export const deleteTask = async (id: number) => {
  await db.timeEntries.where('taskId').equals(id).modify({ taskId: undefined })
  await db.focusSessions.where('taskId').equals(id).modify({ taskId: undefined })
  await db.tasks.delete(id)
}

// ---------- 时间条目 ----------
export const getEntries = () => db.timeEntries.toArray()
export const addEntry = (e: TimeEntry) => db.timeEntries.add(e)
export const updateEntry = (id: number, changes: Partial<TimeEntry>) =>
  db.timeEntries.update(id, changes)
export const deleteEntry = (id: number) => db.timeEntries.delete(id)

// ---------- 专注会话 ----------
export const getSessions = () => db.focusSessions.toArray()
export const addSession = (s: FocusSession) => db.focusSessions.add(s)
export const updateSession = (id: number, changes: Partial<FocusSession>) =>
  db.focusSessions.update(id, changes)

// ---------- 日程 ----------
export const getEvents = () => db.events.toArray()
export const addEvent = (e: CalendarEvent) => db.events.add(e)
export const addEvents = (events: CalendarEvent[]) => db.events.bulkAdd(events)
export const updateEvent = (id: number, changes: Partial<CalendarEvent>) =>
  db.events.update(id, changes)
export const deleteEvent = (id: number) => db.events.delete(id)

// ---------- 设置 ----------
export const getSetting = async <T>(key: string, fallback: T): Promise<T> => {
  const row = await db.settings.get(key)
  return row ? (row.value as T) : fallback
}
export const setSetting = (key: string, value: unknown) =>
  db.settings.put({ key, value })

// ---------- 备份 / 恢复 ----------
export async function exportBackup() {
  const [projects, tasks, timeEntries, focusSessions, events, settings] = await Promise.all([
    db.projects.toArray(),
    db.tasks.toArray(),
    db.timeEntries.toArray(),
    db.focusSessions.toArray(),
    db.events.toArray(),
    db.settings.toArray(),
  ])
  return { version: 1, exportedAt: Date.now(), projects, tasks, timeEntries, focusSessions, events, settings }
}

/** 校验备份文件结构，避免脏数据覆盖现有数据 */
export function validateBackup(data: unknown): data is Awaited<ReturnType<typeof exportBackup>> {
  if (!data || typeof data !== 'object') return false
  const d = data as Record<string, unknown>
  if (d.version !== 1) return false
  return ['projects', 'tasks', 'timeEntries', 'focusSessions', 'events', 'settings']
    .every((key) => Array.isArray(d[key]))
}

export async function importBackup(data: unknown) {
  if (!validateBackup(data)) throw new Error('Invalid backup file')
  await db.transaction('rw', [db.projects, db.tasks, db.timeEntries, db.focusSessions, db.events, db.settings], async () => {
    await Promise.all([
      db.projects.clear(), db.tasks.clear(), db.timeEntries.clear(),
      db.focusSessions.clear(), db.events.clear(), db.settings.clear(),
    ])
    await Promise.all([
      db.projects.bulkAdd(data.projects),
      db.tasks.bulkAdd(data.tasks),
      db.timeEntries.bulkAdd(data.timeEntries),
      db.focusSessions.bulkAdd(data.focusSessions),
      db.events.bulkAdd(data.events),
      db.settings.bulkAdd(data.settings),
    ])
  })
}
