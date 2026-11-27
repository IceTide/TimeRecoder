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
  /** 自动追踪记录的来源进程名（可选，旧数据无此字段） */
  sourceApp?: string
  /** 自动追踪记录的来源窗口标题（可选，旧数据无此字段） */
  sourceTitle?: string
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

/** 自动追踪：把活动窗口归类到时间类别的一条关键词规则 */
export interface ClassifyRule {
  id: string
  /** 匹配关键词（小写包含匹配） */
  keyword: string
  /** 命中后归入的类别 */
  category: TimeCategory
  enabled: boolean
  /** 匹配范围：app=仅进程名 / title=仅窗口标题 / both=两者（默认 both） */
  scope?: 'app' | 'title' | 'both'
  /** 是否来自本地学习建议（仅用于界面标识，不影响匹配逻辑） */
  learned?: boolean
}

declare global {
  interface Window {
    electronAPI?: {
      openExternal: (url: string) => Promise<void>
      notify: (title: string, body: string) => Promise<void>
      getVersion: () => Promise<string>
      isDev: () => Promise<boolean>
      activeWindowTitle: () => Promise<string>
      activeWindowInfo: () => Promise<string>
      onAppAction: (handler: (action: string) => void) => () => void
      quitReady: () => void
    }
  }
}
