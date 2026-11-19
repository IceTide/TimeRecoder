import type { LucideIcon } from 'lucide-react'

interface Props {
  icon: LucideIcon
  title: string
  hint: string
}

/** 精致空状态：青色图标 + 标题 + 引导文案（带入场动画） */
export default function EmptyState({ icon: Icon, title, hint }: Props) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon"><Icon size={26} strokeWidth={1.6} /></div>
      <div className="empty-state-title">{title}</div>
      <div className="empty-state-hint">{hint}</div>
    </div>
  )
}
