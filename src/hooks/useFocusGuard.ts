import { useEffect, useRef, useState } from 'react'
import { getSetting } from '../db/database'
import { useStore } from '../store/useStore'
import {
  DEFAULT_BLOCK_RULES, DEFAULT_GUARD_INTERVAL_SEC, matchBlocked, sanitizeBlockRules,
  type BlockRule,
} from '../utils/focusGuard'

interface GuardState {
  /** 本次专注累计打断次数 */
  distractionCount: number
  /** 最近一次命中的关键词（用于展示） */
  lastHit: string | null
}

/**
 * 专注守护 hook：仅在进行专注且开启守护时轮询前台窗口。
 * - 命中屏蔽名单 → 触发 onHit 回调（toast + 通知），同一关键词在冷却期内不重复提醒
 * - 专注会话结束后计数随组件持续，直到下一次专注开始重置
 */
export function useFocusGuard(onHit: (keyword: string) => void) {
  const { focus } = useStore()
  const [enabled, setEnabled] = useState(false)
  const [intervalSec, setIntervalSec] = useState(DEFAULT_GUARD_INTERVAL_SEC)
  const [rules, setRules] = useState<BlockRule[]>(DEFAULT_BLOCK_RULES)
  const [guard, setGuard] = useState<GuardState>({ distractionCount: 0, lastHit: null })
  const lastAlertRef = useRef<{ keyword: string; at: number } | null>(null)
  const onHitRef = useRef(onHit)
  onHitRef.current = onHit

  // 读取守护配置（设置页修改后，切回专注页会重新挂载并读取最新值）
  useEffect(() => {
    let alive = true
    Promise.all([
      getSetting<boolean>('focusGuardEnabled', false),
      getSetting<number>('focusGuardIntervalSec', DEFAULT_GUARD_INTERVAL_SEC),
      getSetting<BlockRule[]>('focusGuardRules', DEFAULT_BLOCK_RULES),
    ]).then(([on, sec, rs]) => {
      if (!alive) return
      setEnabled(on === true)
      const safeSec = Math.min(30, Math.max(2, Math.round(Number(sec) || DEFAULT_GUARD_INTERVAL_SEC)))
      setIntervalSec(safeSec)
      setRules(sanitizeBlockRules(rs))
    })
    return () => { alive = false }
  }, [])

  // 专注开始时重置计数与冷却
  const focusId = focus?.sessionId
  useEffect(() => {
    if (focusId !== undefined) {
      setGuard({ distractionCount: 0, lastHit: null })
      lastAlertRef.current = null
    }
  }, [focusId])

  // 轮询：仅专注进行中 + 已开启守护 + 有启用规则
  useEffect(() => {
    if (!focus || !enabled || focus.segmentStartAt === null) return
    const activeRules = rules.filter((r) => r.enabled)
    if (!activeRules.length) return

    const timer = window.setInterval(() => {
      void (async () => {
        let raw = ''
        try {
          raw = (await window.electronAPI?.activeWindowInfo?.()) || ''
        } catch {
          return
        }
        const current = useStore.getState().focus
        if (!current || current.segmentStartAt === null) return

        let info: { app: string; title: string } = { app: '', title: '' }
        try { info = JSON.parse(raw) as { app: string; title: string } } catch { return }

        const hit = matchBlocked(info.app, info.title, activeRules)
        if (!hit) return

        const now = Date.now()
        const last = lastAlertRef.current
        // 同一关键词 30 秒内不重复提醒，避免连续弹窗骚扰
        if (last && last.keyword === hit.keyword && now - last.at < 30_000) return
        lastAlertRef.current = { keyword: hit.keyword, at: now }

        setGuard((g) => ({
          distractionCount: g.distractionCount + 1,
          lastHit: hit.keyword,
        }))
        onHitRef.current(hit.keyword)
      })()
    }, intervalSec * 1000)

    return () => window.clearInterval(timer)
  }, [focus?.sessionId, focus?.segmentStartAt, enabled, intervalSec, rules])

  return guard
}
