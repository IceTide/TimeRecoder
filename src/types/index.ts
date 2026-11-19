export type Priority = 'low' | 'medium' | 'high'
export type TaskStatus = 'todo' | 'doing' | 'done'
export type TimeCategory = 'focus' | 'meeting' | 'admin' | 'learning' | 'other'
export type TimeSource = 'focus' | 'manual' | 'auto'
export type FocusStatus = 'running' | 'completed' | 'aborted'

export interface Project {
  id?: number
  name: string
  color: string
  createdAt: number
}

export interface Task {
  id?: number
  title: string
  projectId?: number
  priority: Priority
  status: TaskStatus
  estimatedMin?: number
  dueDate?: number
  tags: string[]
  note?: string
  createdAt: number
  completedAt?: number
}

export interface TimeEntry {
  id?: number
  taskId?: number
  projectId?: number
  category: TimeCategory
  startAt: number
  endAt: number
  durationSec: number
  source: TimeSource
  note?: string
  createdAt: number
}

export interface FocusSession {
  id?: number
  taskId?: number
  plannedMin: number
  startAt: number
  endAt?: number
  pauseCount: number
  status: FocusStatus
}

export type EventType = 'meeting' | 'task' | 'personal' | 'break'

export interface CalendarEvent {
  id?: number
  title: string
  startAt: number
  endAt: number
  type: EventType
  color?: string
  taskId?: number
  note?: string
}

export interface Setting {
  key: string
  value: unknown
}

export interface FocusDurations {
  presets: number[]
  breakReminderMin: number
}

declare global {
  interface Window {
    electronAPI?: {
      openExternal: (url: string) => Promise<void>
      notify: (title: string, body: string) => Promise<void>
      getVersion: () => Promise<string>
      isDev: () => Promise<boolean>
      activeWindowTitle: () => Promise<string>
    }
  }
}
