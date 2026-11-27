import { useEffect, useState } from 'react'

/** 本地今天 00:00 的时间戳；跨零点后自动刷新，避免长时间挂机沿用昨天的“今日”范围。 */
export function useTodayStart(intervalMs = 30_000): number {
  const [state, setState] = useState(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return { key: d.toDateString(), start: d.getTime() }
  })

  useEffect(() => {
    const timer = window.setInterval(() => {
      const d = new Date()
      d.setHours(0, 0, 0, 0)
      const key = d.toDateString()
      setState((prev) => prev.key === key ? prev : { key, start: d.getTime() })
    }, intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs])

  return state.start
}
