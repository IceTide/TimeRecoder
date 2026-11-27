import type { ClassifyRule, TimeCategory } from '../types'

/** 修正日志上限：防止本地设置无限增长（超出后丢弃最旧记录） */
export const CORRECTIONS_MAX = 500
/** 触发一条建议所需的最少有效修正次数 */
export const MIN_CORRECTIONS_FOR_SUGGESTION = 2

/**
 * 一次「自动记录被用户手动改分类」的事件。
 * 独立于 TimeEntry 存储：条目本身保持干净，学习数据可单独淘汰。
 */
export interface ClassifyCorrection {
  /** 进程名（来自自动追踪段） */
  app: string
  /** 窗口标题（来自自动追踪段） */
  title: string
  /** 自动追踪最初给出的类别 */
  fromCategory: TimeCategory
  /** 用户修正后的类别 */
  toCategory: TimeCategory
  /** 修正时间戳 */
  at: number
}

/** 写入修正日志的输入（StatsPage 编辑自动记录时提交） */
export interface CorrectionInput {
  sourceApp?: string
  sourceTitle?: string
  /** 旧数据兜底：自动记录的 note 形如 "app · title" */
  note?: string
  fromCategory: TimeCategory
  toCategory: TimeCategory
  at?: number
}

/**
 * 学习产物：一条待用户确认的个性化归类建议。
 * 采纳后会被转换为普通 ClassifyRule（带 learned 标记）插入 autoRules 最前面。
 */
export interface LearnedRule {
  keyword: string
  scope: 'app' | 'title' | 'both'
  category: TimeCategory
  /** 修正到该类别的命中次数 */
  hits: number
  /** 0~1：一致性 × 样本量，单调递增 */
  confidence: number
  /** 最近一次命中该类别的窗口标题（供用户确认语义） */
  sampleTitle: string
}

const VALID_CATEGORIES: readonly TimeCategory[] = ['focus', 'meeting', 'admin', 'learning', 'other']

/** 通用/无区分度的词：不作为学习关键词，避免学到「Chrome 一律改专注」这类过度泛化规则 */
const STOP_WORDS = new Set<string>([
  'chrome', 'msedge', 'edge', 'firefox', 'safari', 'browser', 'google', 'microsoft',
  'windows', 'electron', 'the', 'and', 'for', 'with', 'from', 'this', 'that',
  'you', 'your', 'new', 'tab', 'page', 'file', 'com', 'www', 'http', 'https',
  '打开', '使用', '窗口', '页面', '浏览器', '文件', '设计稿', '工作', '项目',
  '标题', '新建', '搜索', '设置', '关闭', '一个', '我的', '时间',
])

/** 类型守卫：校验来自 IndexedDB / 备份文件的脏数据 */
export function isTimeCategory(value: unknown): value is TimeCategory {
  return typeof value === 'string' && (VALID_CATEGORIES as readonly string[]).includes(value)
}

/**
 * 规范化修正日志：过滤脏数据、截断超长字段、只保留最近 CORRECTIONS_MAX 条。
 * 纯函数，可单测；不对入参做任何修改。
 */
export function sanitizeCorrections(value: unknown): ClassifyCorrection[] {
  if (!Array.isArray(value)) return []
  const result: ClassifyCorrection[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const app = typeof row.app === 'string' ? row.app.trim().slice(0, 200) : ''
    const title = typeof row.title === 'string' ? row.title.trim().slice(0, 200) : ''
    const { fromCategory, toCategory } = row
    if (!app && !title) continue
    if (!isTimeCategory(fromCategory) || !isTimeCategory(toCategory)) continue
    if (fromCategory === toCategory) continue
    const at = typeof row.at === 'number' && Number.isFinite(row.at) ? row.at : 0
    result.push({ app, title, fromCategory, toCategory, at })
  }
  return result.slice(-CORRECTIONS_MAX)
}

/** 规范化「已处理（采纳或忽略）」的规则 key 列表 */
export function sanitizeDismissedKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const keys = value.filter((k): k is string => typeof k === 'string' && k.trim().length > 0)
  return Array.from(new Set(keys.map((k) => k.trim()))).slice(-CORRECTIONS_MAX * 2)
}

/** 建议 / 规则的稳定标识：同一关键词 + 范围只会被建议一次 */
export function learnedRuleKey(keyword: string, scope: ClassifyRule['scope']): string {
  return `${scope ?? 'both'}|${keyword.trim().toLowerCase()}`
}

function normalizeApp(app: string): string {
  return app.trim().toLowerCase().replace(/\.(exe|app|bin)$/i, '').replace(/[._-]+$/, '')
}

interface Token {
  value: string
  index: number
}

/**
 * 从一次修正中提取最有区分度的关键词。
 * 优先取窗口标题里的具体词（如 figma），过滤掉进程名同名词和通用词；
 * 标题无可用词时才退化为进程名（scope=app）。
 */
export function extractKeyword(app: string, title: string): { keyword: string; scope: 'app' | 'title' } | null {
  const appKey = normalizeApp(app)
  const tokens: Token[] = []

  const latin = /[a-z][a-z0-9+#._-]{2,}/gi
  for (const matched of title.matchAll(latin)) {
    tokens.push({ value: matched[0].toLowerCase().replace(/[._-]+$/, ''), index: matched.index ?? 0 })
  }
  const cjk = /[\u4e00-\u9fff]{2,}/g
  for (const matched of title.matchAll(cjk)) {
    tokens.push({ value: matched[0], index: matched.index ?? 0 })
  }

  const candidates = tokens.filter((token) => {
    const value = token.value
    if (!value || STOP_WORDS.has(value)) return false
    if (!/[\u4e00-\u9fff]/.test(value) && value.length < 3) return false
    if (appKey && (value === appKey || appKey.includes(value))) return false
    return true
  })

  // 更长的词通常更具体；同长度时保留标题中出现更早的词
  candidates.sort((a, b) => b.value.length - a.value.length || a.index - b.index)
  if (candidates.length) {
    return { keyword: candidates[0].value.slice(0, 40), scope: 'title' }
  }

  const cjkApp = /[\u4e00-\u9fff]/.test(appKey)
  if (appKey && appKey.length >= (cjkApp ? 2 : 3) && !STOP_WORDS.has(appKey)) {
    return { keyword: appKey.slice(0, 40), scope: 'app' }
  }
  return null
}

interface Bucket {
  keyword: string
  scope: 'app' | 'title' | 'both'
  total: number
  categories: Map<TimeCategory, number>
  latestAt: Map<TimeCategory, number>
  samples: Map<TimeCategory, string>
}

/**
 * 从修正日志中学习个性化归类偏好。
 *
 * 算法：逐条提取关键词 → 按 (scope, keyword) 聚合 → 取命中次数最多的目标类别；
 * 置信度 = 目标类别纯度 × 样本量因子（1/2/3/4 次分别约 0.70/0.80/0.90/1.00）。
 *
 * @param value 修正日志（允许传入未校验数据，内部会清洗）
 * @param minHits 最少命中次数，默认 2（低于此值不给建议）
 */
export function learnRules(
  value: unknown,
  minHits: number = MIN_CORRECTIONS_FOR_SUGGESTION,
): LearnedRule[] {
  const corrections = sanitizeCorrections(value)
  const buckets = new Map<string, Bucket>()

  for (const correction of corrections) {
    const extracted = extractKeyword(correction.app, correction.title)
    if (!extracted) continue
    const key = learnedRuleKey(extracted.keyword, extracted.scope)
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = {
        keyword: extracted.keyword,
        scope: extracted.scope,
        total: 0,
        categories: new Map<TimeCategory, number>(),
        latestAt: new Map<TimeCategory, number>(),
        samples: new Map<TimeCategory, string>(),
      }
      buckets.set(key, bucket)
    }
    bucket.total += 1
    bucket.categories.set(correction.toCategory, (bucket.categories.get(correction.toCategory) ?? 0) + 1)

    const previousAt = bucket.latestAt.get(correction.toCategory) ?? -1
    if (correction.at >= previousAt) {
      bucket.latestAt.set(correction.toCategory, correction.at)
      bucket.samples.set(correction.toCategory, correction.title || correction.app)
    }
  }

  const threshold = Number.isFinite(minHits) ? Math.max(1, Math.floor(minHits)) : MIN_CORRECTIONS_FOR_SUGGESTION
  const result: LearnedRule[] = []

  buckets.forEach((bucket) => {
    let winner: TimeCategory | null = null
    bucket.categories.forEach((count, category) => {
      if (winner === null) {
        winner = category
        return
      }
      const winnerCount = bucket.categories.get(winner) ?? 0
      const winnerAt = bucket.latestAt.get(winner) ?? -1
      const candidateAt = bucket.latestAt.get(category) ?? -1
      if (count > winnerCount || (count === winnerCount && candidateAt > winnerAt)) {
        winner = category
      }
    })
    if (winner === null) return

    const hits = bucket.categories.get(winner) ?? 0
    if (hits < threshold) return
    const purity = bucket.total > 0 ? hits / bucket.total : 0
    const volume = Math.min(1, hits / 4)
    const confidence = Math.round(Math.min(1, purity * (0.6 + 0.4 * volume)) * 100) / 100

    result.push({
      keyword: bucket.keyword,
      scope: bucket.scope,
      category: winner,
      hits,
      confidence,
      sampleTitle: (bucket.samples.get(winner) ?? '').slice(0, 120),
    })
  })

  return result.sort(
    (a, b) => b.confidence - a.confidence || b.hits - a.hits || a.keyword.localeCompare(b.keyword, 'zh-CN'),
  )
}
