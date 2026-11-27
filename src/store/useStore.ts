import { create } from 'zustand'
import * as repo from '../db/database'
import { classifyWindow, DEFAULT_AUTO_RULES, isSelfWindow, makeRuleId } from '../utils/classify'
import {
  CORRECTIONS_MAX, isTimeCategory, learnedRuleKey, sanitizeCorrections, sanitizeDismissedKeys,
  type ClassifyCorrection, type CorrectionInput, type LearnedRule,
} from '../utils/smartClassify'
import { newSubtaskId, nextOccurrence } from '../utils/taskInput'
import type {
  CalendarEvent,
  ClassifyRule,
  FocusSession,
  Project,
  Task,
  TimeCategory,
  TimeEntry,
} from '../types'

const FOCUS_KEY = 'timerecoder.focus'
const AUTO_KEY = 'timerecoder.auto'

// 防止 1 秒 tick 在异步 finishFocus 完成前重复触发，造成重复记账/重复通知
let finishing = false
// 自动追踪轮询串行化，避免上一次 IPC 未返回时再次结算造成重复段
let autoPolling = false
// 退出流程中：停止采集，避免结算后又被在途轮询重新开段
let shuttingDown = false

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

/** 自动追踪的当前段（应用/标题/类别/起始时间） */
export interface AutoSegment {
  app: string
  title: string
  category: TimeCategory
  startAt: number
}

const AUTO_MAX_AGE_MS = 5 * 60 * 1000 // 自动段超过 5 分钟视为陈旧残留
const AUTO_SEGMENT_MAX_MS = 15 * 60 * 1000 // 单段最长 15 分钟：超时强制落库并续段，避免长时间同应用工作的数据丢失

function loadPersistedAuto(): AutoSegment | null {
  try {
    const raw = localStorage.getItem(AUTO_KEY)
    if (!raw) return null
    const seg = JSON.parse(raw) as AutoSegment
    // 隔夜关闭/崩溃残留的旧段不能恢复，否则下次采样会延续出跨越数小时的错误记录
    if (!seg || !seg.startAt || Date.now() - seg.startAt > AUTO_MAX_AGE_MS) {
      savePersistedAuto(null)
      return null
    }
    return seg
  } catch {
    return null
  }
}

function savePersistedAuto(s: AutoSegment | null) {
  if (s) localStorage.setItem(AUTO_KEY, JSON.stringify(s))
  else localStorage.removeItem(AUTO_KEY)
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

  // 自动追踪
  autoEnabled: boolean
  autoIntervalSec: number
  autoMinSec: number
  autoRules: ClassifyRule[]
  autoCurrent: AutoSegment | null

  // 本地智能归类（从手动修正中学习，零联网）
  classifyCorrections: ClassifyCorrection[]
  dismissedRuleKeys: string[]

  loadAll: () => Promise<void>
  addProject: (p: Project) => Promise<number>
  updateProject: (id: number, c: Partial<Project>) => Promise<void>
  deleteProject: (id: number) => Promise<void>
  addTask: (t: Task) => Promise<number>
  updateTask: (id: number, c: Partial<Task>) => Promise<void>
  /** 完成任务；若配置了重复规则，自动生成下一次实例 */
  completeTask: (id: number) => Promise<void>
  deleteTask: (id: number) => Promise<void>
  addEntry: (e: TimeEntry) => Promise<number>
  updateEntry: (id: number, c: Partial<TimeEntry>) => Promise<void>
  deleteEntry: (id: number) => Promise<void>
  addEvent: (e: CalendarEvent) => Promise<number>
  addEvents: (events: CalendarEvent[]) => Promise<void>
  updateEvent: (id: number, c: Partial<CalendarEvent>) => Promise<void>
  deleteEvent: (id: number) => Promise<void>

  startFocus: (plannedMin: number, taskId?: number) => Promise<void>
  pauseFocus: () => void
  resumeFocus: () => void
  finishFocus: (status: 'completed' | 'aborted') => Promise<number | undefined>
  tickFocus: () => void

  setAutoEnabled: (enabled: boolean) => Promise<void>
  setAutoIntervalSec: (sec: number) => Promise<void>
  setAutoMinSec: (sec: number) => Promise<void>
  setAutoRules: (rules: ClassifyRule[]) => Promise<void>
  /** 采集一次活动窗口并推进自动记账状态机 */
  pollAuto: () => Promise<void>
  /** 结算当前段（切走 / 锁屏 / 关闭追踪时调用） */
  flushAuto: () => Promise<void>
  /** 退出前结算：停止后续采集并落库当前段 */
  prepareShutdown: () => Promise<void>

  /** 记录一次「自动记录被手动改分类」，供本地学习使用 */
  recordCorrection: (input: CorrectionInput) => Promise<void>
  /** 采纳一条学习建议：插入规则列表最前并标记为已学习 */
  adoptLearnedRule: (rule: LearnedRule) => Promise<void>
  /** 忽略一条学习建议：之后不再重复建议 */
  dismissLearnedRule: (rule: LearnedRule) => Promise<void>
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
  autoEnabled: false,
  autoIntervalSec: 60,
  autoMinSec: 60,
  autoRules: DEFAULT_AUTO_RULES,
  autoCurrent: null,
  classifyCorrections: [],
  dismissedRuleKeys: [],

  loadAll: async () => {
    const [
      projects, tasks, entries, sessions, events, autoEnabled, autoIntervalSec, autoMinSec, autoRules,
      correctionsRaw, dismissedRaw,
    ] = await Promise.all([
      repo.getProjects(), repo.getTasks(), repo.getEntries(), repo.getSessions(), repo.getEvents(),
      repo.getSetting<boolean>('autoEnabled', false),
      repo.getSetting<number>('autoIntervalSec', 60),
      repo.getSetting<number>('autoMinSec', 60),
      repo.getSetting<ClassifyRule[]>('autoRules', DEFAULT_AUTO_RULES),
      repo.getSetting<unknown>('classifyCorrections', []),
      repo.getSetting<unknown>('classifyLearnedDismissed', []),
    ])
    const pf = loadPersistedFocus()
    // 会话若已被删除则丢弃残留状态
    const valid = pf && pf.sessionId && sessions.some((s) => s.id === pf.sessionId && s.status === 'running')
    set({
      projects, tasks, entries, sessions, events,
      focus: valid ? toFocusState(pf!) : null,
      autoEnabled, autoIntervalSec, autoMinSec,
      autoRules: Array.isArray(autoRules) && autoRules.length ? autoRules : DEFAULT_AUTO_RULES,
      autoCurrent: loadPersistedAuto(),
      classifyCorrections: sanitizeCorrections(correctionsRaw),
      dismissedRuleKeys: sanitizeDismissedKeys(dismissedRaw),
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

  completeTask: async (id) => {
    const task = get().tasks.find((t) => t.id === id)
    if (!task || task.status === 'done') return
    await repo.updateTask(id, { status: 'done', completedAt: Date.now() })

    const recurrence = task.recurrence
    if (recurrence && recurrence !== 'none') {
      const template: Task = { ...task }
      delete template.id
      delete template.completedAt
      const seriesId = task.seriesId ?? `series-${id}-${Date.now()}`
      await repo.addTask({
        ...template,
        seriesId,
        status: 'todo',
        createdAt: Date.now(),
        dueDate: nextOccurrence(task.dueDate ?? Date.now(), recurrence),
        subtasks: task.subtasks?.map((s) => ({ ...s, id: newSubtaskId(), done: false })),
      })
    }
    await get().loadAll()
  },

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
  addEvents: async (events) => {
    if (!events.length) return
    await repo.addEvents(events)
    await get().loadAll()
  },
  updateEvent: async (id, c) => { await repo.updateEvent(id, c); await get().loadAll() },
  deleteEvent: async (id) => { await repo.deleteEvent(id); await get().loadAll() },

  startFocus: async (plannedMin, taskId) => {
    if (get().focus) return
    // 开始专注前先结算自动段，避免与专注计时重复记账
    if (get().autoCurrent) await get().flushAuto()
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
    if (finishing) return undefined
    const f = get().focus
    if (!f) return undefined
    finishing = true
    try {
      const wallEndAt = Date.now()
      const elapsedSec = f.segmentStartAt !== null
        ? f.accumulatedSec + (wallEndAt - f.segmentStartAt) / 1000
        : f.accumulatedSec

      // completed 走番茄钟语义：记账时长收敛到计划时长，避免后台/休眠导致定时器节流、
      // 到点检测延迟时记出超出计划的时长（如 25 分钟专注记成数小时），并保证备注与时长一致。
      // aborted 为手动结束，据实记录实际专注时长。
      const plannedSec = f.plannedMin * 60
      const isCompleted = status === 'completed'
      const bookedSec = isCompleted && elapsedSec > plannedSec ? plannedSec : elapsedSec
      // completed 时把到点检测延迟产生的溢出量从墙钟结束时刻回退；
      // 不能简单用 startAt + plannedSec，否则中途暂停过的会话会被错误前移到暂停之前。
      const overtimeSec = isCompleted ? Math.max(0, elapsedSec - plannedSec) : 0
      const endAt = overtimeSec > 0
        ? Math.max(f.startAt + Math.round(bookedSec * 1000), wallEndAt - Math.round(overtimeSec * 1000))
        : wallEndAt

      // 先同步清空前端状态，避免 1 秒 tick 或 UI 再读到进行中的会话
      savePersistedFocus(null)
      set({ focus: null })

      await repo.updateSession(f.sessionId, {
        endAt,
        status,
        pauseCount: f.pauseCount,
      })

      const task = f.taskId ? get().tasks.find((t) => t.id === f.taskId) : undefined
      // 完成或手动提前结束，只要产生了有效时长都记账，避免专注成果丢失
      if (bookedSec >= 1) {
        await repo.addEntry({
          taskId: f.taskId,
          projectId: task?.projectId,
          category: 'focus',
          startAt: f.startAt,
          endAt,
          durationSec: Math.round(bookedSec),
          source: 'focus',
          note: isCompleted
            ? `专注 ${Math.round(bookedSec / 60)} 分钟`
            : `专注中断 · 实际 ${Math.round(bookedSec / 60)} 分钟`,
          createdAt: Date.now(),
        })
      }
      // 只有真正完成整个番茄钟才自动把任务标记为完成；重复任务会在此生成下一次实例
      if (isCompleted && task?.id && task.status !== 'done') {
        await get().completeTask(task.id)
      }

      const [sessions, entries] = await Promise.all([
        repo.getSessions(), repo.getEntries(),
      ])
      set({ sessions, entries })
      return bookedSec
    } finally {
      finishing = false
    }
  },

  tickFocus: () => {
    const f = get().focus
    if (!f || f.segmentStartAt === null) return
    const elapsedSec = f.accumulatedSec + (Date.now() - f.segmentStartAt) / 1000
    set({ focus: { ...f, elapsedSec } })
  },

  setAutoEnabled: async (enabled) => {
    await repo.setSetting('autoEnabled', enabled)
    set({ autoEnabled: enabled })
    // 关闭时结算当前段，避免最后一段时间丢失
    if (!enabled) await get().flushAuto()
  },
  setAutoIntervalSec: async (sec) => {
    const v = Math.min(600, Math.max(10, Math.round(sec)))
    await repo.setSetting('autoIntervalSec', v)
    set({ autoIntervalSec: v })
  },
  setAutoMinSec: async (sec) => {
    const v = Math.min(600, Math.max(10, Math.round(sec)))
    await repo.setSetting('autoMinSec', v)
    set({ autoMinSec: v })
  },
  setAutoRules: async (rules) => {
    await repo.setSetting('autoRules', rules)
    set({ autoRules: rules })
    // 规则变更后结算当前段，下个采样周期按新规则重新归类
    if (get().autoCurrent) await get().flushAuto()
  },

  flushAuto: async () => {
    const seg = get().autoCurrent
    if (!seg) return
    // 先同步清空当前段，避免并发重复结算
    savePersistedAuto(null)
    set({ autoCurrent: null })
    const endAt = Date.now()
    const durationSec = Math.round((endAt - seg.startAt) / 1000)
    if (durationSec >= get().autoMinSec) {
      await repo.addEntry({
        category: seg.category,
        startAt: seg.startAt,
        endAt,
        durationSec,
        source: 'auto',
        note: `${seg.app} · ${seg.title}`.slice(0, 120),
        createdAt: endAt,
        // 可选字段：让后续手动修正能被用于本地学习（旧数据无此字段，兼容）
        sourceApp: seg.app.slice(0, 200),
        sourceTitle: seg.title.slice(0, 200),
      })
      set({ entries: await repo.getEntries() })
    }
  },

  prepareShutdown: async () => {
    // 标记退出中，阻止在途 pollAuto 再开新段
    shuttingDown = true
    if (get().autoCurrent) await get().flushAuto()
  },

  recordCorrection: async (input) => {
    const { fromCategory, toCategory } = input
    if (!isTimeCategory(fromCategory) || !isTimeCategory(toCategory)) return
    if (fromCategory === toCategory) return

    const app = typeof input.sourceApp === 'string' ? input.sourceApp.trim().slice(0, 200) : ''
    let title = typeof input.sourceTitle === 'string' ? input.sourceTitle.trim().slice(0, 200) : ''
    // 兼容旧数据：没有 sourceTitle 时，从自动记录的 note（"app · title"）里还原
    if (!title && typeof input.note === 'string') {
      const parts = input.note.split('·').map((part) => part.trim())
      if (parts.length > 1) title = parts.slice(1).join(' · ').slice(0, 200)
    }
    if (!app && !title) return

    const at = typeof input.at === 'number' && Number.isFinite(input.at) ? input.at : Date.now()
    const correction: ClassifyCorrection = {
      app, title, fromCategory, toCategory, at,
    }
    const next = [...get().classifyCorrections, correction].slice(-CORRECTIONS_MAX)
    await repo.setSetting('classifyCorrections', next)
    set({ classifyCorrections: next })
  },

  adoptLearnedRule: async (rule) => {
    const key = learnedRuleKey(rule.keyword, rule.scope)
    const alreadyExists = get().autoRules.some((r) =>
      r.enabled && r.category === rule.category && learnedRuleKey(r.keyword, r.scope) === key,
    )
    if (!alreadyExists) {
      // 采纳的规则放在列表最前：classifyWindow 顺序匹配，学习结果优先生效
      const learned: ClassifyRule = {
        id: makeRuleId(),
        keyword: rule.keyword,
        category: rule.category,
        enabled: true,
        scope: rule.scope,
        learned: true,
      }
      await get().setAutoRules([learned, ...get().autoRules])
    }
    // 已处理（采纳/忽略共用一个列表）：历史修正仍在，但不再重复建议
    const nextKeys = sanitizeDismissedKeys([...get().dismissedRuleKeys, key])
    await repo.setSetting('classifyLearnedDismissed', nextKeys)
    set({ dismissedRuleKeys: nextKeys })
  },

  dismissLearnedRule: async (rule) => {
    const key = learnedRuleKey(rule.keyword, rule.scope)
    const nextKeys = sanitizeDismissedKeys([...get().dismissedRuleKeys, key])
    await repo.setSetting('classifyLearnedDismissed', nextKeys)
    set({ dismissedRuleKeys: nextKeys })
  },

  pollAuto: async () => {
    if (autoPolling || shuttingDown || !get().autoEnabled) return
    autoPolling = true
    try {
      const state = get()

      // 专注进行中：暂停自动记账，避免与专注时间重复；同时结算已开启的自动段
      if (state.focus) {
        if (state.autoCurrent) await get().flushAuto()
        return
      }

      let info: { app: string; title: string } = { app: '', title: '' }
      try {
        const raw = await window.electronAPI?.activeWindowInfo?.()
        if (raw) info = JSON.parse(raw) as { app: string; title: string }
      } catch {
        info = { app: '', title: '' }
      }
      // IPC 等待期间状态可能已变化：关闭追踪 / 进入专注则结算当前段后退出
      const after = get()
      if (!after.autoEnabled || after.focus) {
        if (after.autoCurrent) await get().flushAuto()
        return
      }
      const app = (info.app || '').trim()
      const title = (info.title || '').trim()

      // 锁屏 / 无前台窗口 / 本机自身应用：结算当前段后跳过
      if ((!app && !title) || isSelfWindow(app, title)) {
        if (get().autoCurrent) await get().flushAuto()
        return
      }

      const category = classifyWindow(app, title, get().autoRules)
      const now = Date.now()
      const current = get().autoCurrent

      if (current) {
        const sameApp = current.app.toLowerCase() === app.toLowerCase()
        const sameCat = current.category === category
        const tooLong = now - current.startAt >= AUTO_SEGMENT_MAX_MS
        if (sameApp && sameCat && !tooLong) {
          // 同一应用同一类别且未超时，仅更新标题展示，不新开段
          const next: AutoSegment = { ...current, title }
          savePersistedAuto(next)
          set({ autoCurrent: next })
          return
        }
        // 应用/类别变化，或单段超过上限：结算旧段（长段会被切成多个段落库，避免退出丢失）
        await get().flushAuto()
      }

      const next: AutoSegment = { app, title, category, startAt: now }
      savePersistedAuto(next)
      set({ autoCurrent: next })
    } finally {
      autoPolling = false
    }
  },
}))
