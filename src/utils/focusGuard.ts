/**
 * 专注守护：非侵入式干扰提醒
 * 专注期间轮询前台窗口，命中屏蔽名单时提醒并记录。不杀进程、不改 hosts、不装扩展。
 * 规则存于 setting（focusGuardRules / focusGuardEnabled）。
 */

export interface BlockRule {
  /** 匹配关键词（小写包含匹配） */
  keyword: string
  /** 匹配范围：app=仅进程名 / title=仅窗口标题 / both=两者 */
  scope: 'app' | 'title' | 'both'
  enabled: boolean
}

export const DEFAULT_BLOCK_RULES: BlockRule[] = [
  { keyword: 'youtube', scope: 'title', enabled: false },
  { keyword: '微博', scope: 'title', enabled: false },
  { keyword: '抖音', scope: 'title', enabled: false },
]

export const DEFAULT_GUARD_INTERVAL_SEC = 4

/** 生成规则 id（用关键词+scope，稳定且无需额外字段） */
export function blockRuleKey(rule: BlockRule): string {
  return `${rule.scope}:${rule.keyword.trim().toLowerCase()}`
}

/** 窗口是否命中任一启用的屏蔽规则 */
export function matchBlocked(
  app: string,
  title: string,
  rules: BlockRule[],
): BlockRule | null {
  const a = (app || '').toLowerCase()
  const t = (title || '').toLowerCase()
  if (!a && !t) return null
  for (const rule of rules) {
    if (!rule.enabled) continue
    const kw = rule.keyword.trim().toLowerCase()
    if (!kw) continue
    const hitApp = a.includes(kw)
    const hitTitle = t.includes(kw)
    if (
      (rule.scope === 'app' && hitApp) ||
      (rule.scope === 'title' && hitTitle) ||
      (rule.scope === 'both' && (hitApp || hitTitle))
    ) return rule
  }
  return null
}

/** 清洗规则：去空、去重、去非法 scope */
export function sanitizeBlockRules(input: unknown): BlockRule[] {
  if (!Array.isArray(input)) return DEFAULT_BLOCK_RULES
  const out: BlockRule[] = []
  const seen = new Set<string>()
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Partial<BlockRule>
    const keyword = typeof r.keyword === 'string' ? r.keyword.trim() : ''
    if (!keyword) continue
    const scope: BlockRule['scope'] = r.scope === 'app' || r.scope === 'title' ? r.scope : 'both'
    const rule: BlockRule = { keyword, scope, enabled: r.enabled !== false }
    const key = blockRuleKey(rule)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(rule)
  }
  return out
}
