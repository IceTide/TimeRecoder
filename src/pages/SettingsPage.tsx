import { useEffect, useState } from 'react'
import { Download, Upload, Info, Save } from 'lucide-react'
import { getSetting, setSetting, exportBackup, importBackup, validateBackup } from '../db/database'
import { useStore } from '../store/useStore'

interface Props { onToast: (msg: string) => void }

export default function SettingsPage({ onToast }: Props) {
  const loadAll = useStore((s) => s.loadAll)
  const [presets, setPresets] = useState<number[]>([25, 50, 90])
  const [breakMin, setBreakMin] = useState(45)
  const [version, setVersion] = useState('')

  useEffect(() => {
    getSetting<number[]>('focusPresets', [25, 50, 90]).then(setPresets)
    getSetting<number>('breakReminderMin', 45).then(setBreakMin)
    window.electronAPI?.getVersion?.().then(setVersion)
  }, [])

  const save = async () => {
    const valid = presets.map((n) => Number(n)).filter((n) => n > 0 && n <= 240)
    if (!valid.length) return
    await setSetting('focusPresets', valid)
    await setSetting('breakReminderMin', breakMin)
    onToast('设置已保存')
  }

  const doExport = async () => {
    const data = await exportBackup()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `timerecoder-backup-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    // 延迟释放，避免部分浏览器在 click 尚未完成下载时就撤销 URL
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    onToast('备份已导出')
  }

  const doImport = async (file: File) => {
    try {
      const data: unknown = JSON.parse(await file.text())
      if (!validateBackup(data)) {
        onToast('导入失败：不是有效的 TimeRecoder 备份文件')
        return
      }
      await importBackup(data)
      await loadAll()
      onToast('数据已恢复')
    } catch {
      onToast('导入失败：文件解析错误或数据损坏')
    }
  }

  return (
    <div className="page" style={{ maxWidth: 780 }}>
      <div className="page-head">
        <div>
          <div className="page-title">设置</div>
          <div className="page-desc">调整专注习惯，管理你的本地数据</div>
        </div>
      </div>

      <div className="card card-pad" style={{ marginBottom: 20 }}>
        <div className="card-title">专注设置</div>
        <div className="card-sub" style={{ marginBottom: 18 }}>设置常用的专注时长预设</div>
        <div className="field" style={{ marginBottom: 16 }}>
          <label>时长预设（分钟，用逗号分隔，最多 4 个）</label>
          <input className="input" value={presets.join(', ')}
            onChange={(e) => setPresets(e.target.value.split(/[,，]/).map((s) => parseInt(s.trim()) || 0).filter(Boolean).slice(0, 4))} />
        </div>
        <div className="field" style={{ marginBottom: 18 }}>
          <label>久坐提醒间隔（分钟）</label>
          <input className="input" type="number" min="10" max="180" value={breakMin} onChange={(e) => setBreakMin(Number(e.target.value))} />
        </div>
        <button className="btn" onClick={save}><Save size={15} style={{ marginRight: 6 }} />保存设置</button>
      </div>

      <div className="card card-pad" style={{ marginBottom: 20 }}>
        <div className="card-title">数据管理</div>
        <div className="card-sub" style={{ marginBottom: 18 }}>所有数据默认保存在本机浏览器数据库中，不上传任何服务器</div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn ghost" onClick={doExport}><Download size={15} style={{ marginRight: 6 }} />导出备份（JSON）</button>
          <label className="btn ghost" style={{ display: 'inline-flex', alignItems: 'center' }}>
            <Upload size={15} style={{ marginRight: 6 }} />导入备份
            <input type="file" accept="application/json" hidden onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) doImport(f)
              e.target.value = ''
            }} />
          </label>
        </div>
      </div>

      <div className="card card-pad">
        <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 7 }}><Info size={16} /> 关于</div>
        <div style={{ fontSize: 13, color: 'var(--text-sub)', lineHeight: 1.9, marginTop: 10 }}>
          <div><strong>TimeRecoder</strong> v{version || '0.1.0'} · MVP</div>
          <div>技术栈：Electron + React + TypeScript + Dexie + Recharts</div>
          <div>当前版本功能：专注模式、日程安排、待办任务、时间统计、数据备份</div>
          <div style={{ color: 'var(--text-faint)', marginTop: 8 }}>后续规划：自动活动追踪、AI 归类、系统托盘与全局快捷键、跨设备同步</div>
        </div>
      </div>
    </div>
  )
}
