import type { ClassifyRule, TimeCategory } from '../types'

/**
 * 默认归类规则：按应用名 / 窗口标题的关键词把活动窗口归入时间类别。
 * 用户可在设置页自由增删改；这里提供开箱即用的中英文常用软件规则。
 * 顺序即优先级：越靠前越先匹配。
 */
export const DEFAULT_AUTO_RULES: ClassifyRule[] = [
  // 沟通协作 → 会议（进程名精确匹配，避免标题里出现 "meet" 之类误判）
  { id: 'meet-zoom', keyword: 'zoom', category: 'meeting', enabled: true, scope: 'app' },
  { id: 'meet-teams', keyword: 'teams', category: 'meeting', enabled: true, scope: 'app' },
  { id: 'meet-dingtalk', keyword: 'dingtalk', category: 'meeting', enabled: true, scope: 'app' },
  { id: 'meet-ding', keyword: '钉钉', category: 'meeting', enabled: true, scope: 'title' },
  { id: 'meet-feishu', keyword: 'feishu', category: 'meeting', enabled: true, scope: 'app' },
  { id: 'meet-lark', keyword: 'lark', category: 'meeting', enabled: true, scope: 'app' },
  { id: 'meet-wxwork', keyword: 'wxwork', category: 'meeting', enabled: true, scope: 'app' }, // 企业微信进程名
  { id: 'meet-qywx', keyword: '企业微信', category: 'meeting', enabled: true, scope: 'title' },
  { id: 'meet-slack', keyword: 'slack', category: 'meeting', enabled: true, scope: 'app' },
  { id: 'meet-skype', keyword: 'skype', category: 'meeting', enabled: true, scope: 'app' },
  { id: 'meet-google', keyword: 'google meet', category: 'meeting', enabled: true, scope: 'title' },
  // 开发工具 / 设计 → 专注（进程名精确匹配）
  { id: 'focus-code', keyword: 'code', category: 'focus', enabled: true, scope: 'app' }, // Code.exe / Code
  { id: 'focus-vscode', keyword: 'vscode', category: 'focus', enabled: true, scope: 'app' },
  { id: 'focus-cursor', keyword: 'cursor', category: 'focus', enabled: true, scope: 'app' },
  { id: 'focus-jetbrains', keyword: 'jetbrains', category: 'focus', enabled: true, scope: 'app' },
  { id: 'focus-idea', keyword: 'idea', category: 'focus', enabled: true, scope: 'app' },
  { id: 'focus-webstorm', keyword: 'webstorm', category: 'focus', enabled: true, scope: 'app' },
  { id: 'focus-pycharm', keyword: 'pycharm', category: 'focus', enabled: true, scope: 'app' },
  { id: 'focus-figma', keyword: 'figma', category: 'focus', enabled: true, scope: 'app' },
  { id: 'focus-sketch', keyword: 'sketch', category: 'focus', enabled: true, scope: 'app' },
  { id: 'focus-terminal', keyword: 'terminal', category: 'focus', enabled: true, scope: 'app' },
  { id: 'focus-powershell', keyword: 'powershell', category: 'focus', enabled: true, scope: 'app' },
  // 文档 / 邮件 → 行政事务
  { id: 'admin-excel', keyword: 'excel', category: 'admin', enabled: true, scope: 'app' },
  { id: 'admin-word', keyword: 'winword', category: 'admin', enabled: true, scope: 'app' },
  { id: 'admin-ppt', keyword: 'powerpnt', category: 'admin', enabled: true, scope: 'app' },
  { id: 'admin-outlook', keyword: 'outlook', category: 'admin', enabled: true, scope: 'app' },
  { id: 'admin-mail', keyword: 'mail', category: 'admin', enabled: true, scope: 'app' },
  { id: 'admin-notion', keyword: 'notion', category: 'admin', enabled: true, scope: 'app' },
  // 浏览器站点 → 学习/会议（按标题匹配，需排在通用浏览器规则之前）
  { id: 'site-youtube', keyword: 'youtube', category: 'learning', enabled: true, scope: 'title' },
  { id: 'site-bilibili', keyword: 'bilibili', category: 'learning', enabled: true, scope: 'title' },
  { id: 'site-ding-web', keyword: '钉钉', category: 'meeting', enabled: true, scope: 'title' },
  // 通用浏览器 → 学习（进程名匹配，兜底）
  { id: 'learn-chrome', keyword: 'chrome', category: 'learning', enabled: true, scope: 'app' },
  { id: 'learn-edge', keyword: 'msedge', category: 'learning', enabled: true, scope: 'app' },
  { id: 'learn-firefox', keyword: 'firefox', category: 'learning', enabled: true, scope: 'app' },
  { id: 'learn-safari', keyword: 'safari', category: 'learning', enabled: true, scope: 'app' },
]

/** 兜底类别：无任何规则命中时 */
export const FALLBACK_CATEGORY: TimeCategory = 'other'

/**
 * 把活动窗口信息归入一个时间类别。
 * 按规则顺序返回首个命中项；scope 决定关键词匹配进程名、标题还是两者。
 * 未指定 scope 的历史规则默认按 both 处理，保证向后兼容。
 */
export function classifyWindow(
  app: string,
  title: string,
  rules: ClassifyRule[],
): TimeCategory {
  const appLower = app.toLowerCase()
  const titleLower = title.toLowerCase()
  for (const rule of rules) {
    if (!rule.enabled) continue
    const keyword = rule.keyword.trim().toLowerCase()
    if (!keyword) continue
    const scope = rule.scope ?? 'both'
    if (scope === 'app' && appLower.includes(keyword)) return rule.category
    if (scope === 'title' && titleLower.includes(keyword)) return rule.category
    if (scope === 'both' && (appLower.includes(keyword) || titleLower.includes(keyword))) return rule.category
  }
  return FALLBACK_CATEGORY
}

/** 生成一条规则的唯一 id */
export function makeRuleId(): string {
  return `rule-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}
