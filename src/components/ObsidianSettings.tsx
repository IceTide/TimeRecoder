import { useEffect, useRef, useState } from 'react'
import { BookOpen, FolderOpen, Clock3, Sparkles, RefreshCw, Save } from 'lucide-react'
import {
  DEFAULT_OBSIDIAN_CONFIG, useObsidianLog, type ObsidianConfig,
} from '../hooks/useObsidianLog'
import { DEFAULT_LOG_TEMPLATE, LOG_PLACEHOLDERS, isValidWriteTime } from '../utils/obsidianLog'

interface Props {
  onToast: (msg: string) => void
}

/** Obsidian 每日日志设置卡片 */
export default function ObsidianSettings({ onToast }: Props) {
  const { loadConfig, saveConfig, writeNow } = useObsidianLog()
  const [config, setConfig] = useState<ObsidianConfig>({ ...DEFAULT_OBSIDIAN_CONFIG })
  const configRef = useRef<ObsidianConfig>({ ...DEFAULT_OBSIDIAN_CONFIG })
  const [folderOk, setFolderOk] = useState<{ ok: boolean; reason: string } | null>(null)
  const [writing, setWriting] = useState(false)

  useEffect(() => {
    let alive = true
    loadConfig().then((c) => {
      if (alive) { setConfig(c); configRef.current = c }
    })
    return () => { alive = false }
  }, [loadConfig])

  // 配置变化时检查文件夹可写状态
  useEffect(() => {
    let alive = true
    if (!config.folder) { setFolderOk(null); return }
    window.electronAPI?.checkFolder?.(config.folder).then((r) => { if (alive) setFolderOk(r) })
    return () => { alive = false }
  }, [config.folder])

  const patch = (c: Partial<ObsidianConfig>) => {
    const next = { ...configRef.current, ...c }
    configRef.current = next
    setConfig(next)
  }

  const persist = async (next: ObsidianConfig) => {
    if (!isValidWriteTime(next.writeTime)) {
      onToast('写入时间格式应为 HH:mm（如 21:00）')
      return
    }
    await saveConfig(next)
    onToast('Obsidian 日志设置已保存')
  }

  const pickFolder = async () => {
    const folder = await window.electronAPI?.pickFolder?.()
    if (folder) patch({ folder })
  }

  const handleWriteNow = async () => {
    if (writing) return
    setWriting(true)
    try {
      const result = await writeNow()
      onToast(result.message)
    } finally {
      setWriting(false)
    }
  }

  return (
    <div className="card card-pad obsidian-card" style={{ marginBottom: 20 }}>
      <div className="obsidian-head">
        <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <BookOpen size={16} style={{ color: 'var(--accent)' }} /> Obsidian 每日日志
        </div>
        <button className={`switch ${config.enabled ? 'on' : ''}`}
          aria-label="Obsidian 日志开关"
          onClick={() => {
            const next = { ...configRef.current, enabled: !configRef.current.enabled }
            configRef.current = next
            setConfig(next)
            void persist(next)
          }}>
          <span className="switch-knob" />
        </button>
      </div>
      <div className="card-sub" style={{ marginBottom: 18 }}>
        每天自动把当天的时间记录写入 Obsidian Vault 的指定文件夹，生成一篇 Daily Note
      </div>

      <div className="field" style={{ marginBottom: 16 }}>
        <label>日志文件夹</label>
        <div className="obsidian-folder">
          <input className="input" value={config.folder} placeholder="点击右侧按钮选择 Vault 中的文件夹"
            readOnly />
          <button className="btn ghost" onClick={() => void pickFolder()} title="选择文件夹">
            <FolderOpen size={15} />
          </button>
        </div>
        {folderOk && (
          <span className={`obsidian-folder-status ${folderOk.ok ? 'ok' : 'bad'}`}>
            {folderOk.ok ? '✓ 文件夹可写' : `✗ ${folderOk.reason}`}
          </span>
        )}
      </div>

      <div className="obsidian-row">
        <div className="field" style={{ flex: 1 }}>
          <label>每日写入时间</label>
          <div className="obsidian-time">
            <Clock3 size={14} />
            <input className="input" type="time" value={config.writeTime}
              onChange={(e) => patch({ writeTime: e.target.value })} />
          </div>
          <span className="obsidian-hint">到点后当天首次运行自动写入一次，重复打开不会覆盖</span>
        </div>
        <div className="field" style={{ flex: '0 0 auto' }}>
          <label>&nbsp;</label>
          <button className="btn" disabled={writing} onClick={() => void handleWriteNow()}>
            <RefreshCw size={14} className={writing ? 'spin' : ''} style={{ marginRight: 6 }} />
            {writing ? '写入中…' : '立即生成'}
          </button>
        </div>
      </div>

      <div className="field" style={{ marginTop: 16 }}>
        <label>日志模板（可自定义）</label>
        <textarea className="textarea obsidian-template" value={config.template || DEFAULT_LOG_TEMPLATE}
          placeholder={DEFAULT_LOG_TEMPLATE}
          onChange={(e) => patch({ template: e.target.value })} />
        <div className="obsidian-placeholders">
          <span><Sparkles size={12} /> 可用占位符：</span>
          {LOG_PLACEHOLDERS.map((p) => (
            <code key={p.key} title={p.desc}>{p.key}</code>
          ))}
        </div>
      </div>

      <button className="btn" style={{ marginTop: 14 }} onClick={() => void persist(configRef.current)}>
        <Save size={14} style={{ marginRight: 6 }} />保存 Obsidian 设置
      </button>
    </div>
  )
}
