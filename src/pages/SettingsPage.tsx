import { useEffect, useMemo, useState } from 'react'
import { Download, Upload, Info, Save, Activity, Plus, Trash2, ShieldCheck, Sparkles } from 'lucide-react'
import { getSetting, setSetting, exportBackup, importBackup, validateBackup } from '../db/database'
import { useStore } from '../store/useStore'
import { makeRuleId } from '../utils/classify'
import { learnedRuleKey, learnRules } from '../utils/smartClassify'
import EmptyState from '../components/EmptyState'
import {
  DEFAULT_BLOCK_RULES, DEFAULT_GUARD_INTERVAL_SEC, blockRuleKey, sanitizeBlockRules,
  type BlockRule,
} from '../utils/focusGuard'
import type { ClassifyRule, TimeCategory } from '../types'
import { CATEGORY_LABEL } from '../utils/time'

interface Props { onToast: (msg: string) => void }

const CATS: TimeCategory[] = ['focus', 'meeting', 'admin', 'learning', 'other']

export default function SettingsPage({ onToast }: Props) {
  const {
    loadAll, autoEnabled, autoIntervalSec, autoMinSec, autoRules, autoCurrent,
    setAutoEnabled, setAutoIntervalSec, setAutoMinSec, setAutoRules,
    classifyCorrections, dismissedRuleKeys, adoptLearnedRule, dismissLearnedRule,
  } = useStore()
  const [presets, setPresets] = useState<number[]>([25, 50, 90])
  const [breakMin, setBreakMin] = useState(45)
  const [dailyGoalMin, setDailyGoalMin] = useState(120)
  const [version, setVersion] = useState('')
  const [isWin, setIsWin] = useState(true)
  const [draftRules, setDraftRules] = useState<ClassifyRule[]>(autoRules)
  const [newKw, setNewKw] = useState('')
  const [newCat, setNewCat] = useState<TimeCategory>('focus')
  const [guardEnabled, setGuardEnabled] = useState(false)
  const [guardInterval, setGuardInterval] = useState(DEFAULT_GUARD_INTERVAL_SEC)
  const [blockRules, setBlockRules] = useState<BlockRule[]>(DEFAULT_BLOCK_RULES)
  const [newBlockKw, setNewBlockKw] = useState('')
  const [newBlockScope, setNewBlockScope] = useState<BlockRule['scope']>('title')

  useEffect(() => {
    getSetting<number[]>('focusPresets', [25, 50, 90]).then(setPresets)
    getSetting<number>('breakReminderMin', 45).then(setBreakMin)
    getSetting<number>('dailyFocusGoalMin', 120)
      .then((v) => setDailyGoalMin(Math.min(1440, Math.max(10, Number(v) || 120))))
    getSetting<boolean>('focusGuardEnabled', false).then((v) => setGuardEnabled(v === true))
    getSetting<number>('focusGuardIntervalSec', DEFAULT_GUARD_INTERVAL_SEC)
      .then((v) => setGuardInterval(Math.min(30, Math.max(2, Math.round(Number(v) || DEFAULT_GUARD_INTERVAL_SEC)))))
    getSetting<BlockRule[]>('focusGuardRules', DEFAULT_BLOCK_RULES)
      .then((v) => setBlockRules(sanitizeBlockRules(v)))
    window.electronAPI?.getVersion?.().then(setVersion)
    // 粗略判断平台：仅 Windows 支持活动窗口自动追踪
    setIsWin(/win/i.test(navigator.platform || navigator.userAgent))
  }, [])

  useEffect(() => { setDraftRules(autoRules) }, [autoRules])

  // 本地学习：只在数据/规则变化时计算，不进入渲染热路径
  const suggestions = useMemo(() => {
    const handled = new Set(dismissedRuleKeys)
    return learnRules(classifyCorrections).filter((rule) => {
      if (handled.has(learnedRuleKey(rule.keyword, rule.scope))) return false
      // 已有同关键词同范围的规则时不重复建议（即使类别不同，交由用户自行调整）
      return !autoRules.some((existing) => {
        const scope = existing.scope ?? 'both'
        return scope === rule.scope && existing.keyword.trim().toLowerCase() === rule.keyword.toLowerCase()
      })
    })
  }, [classifyCorrections, dismissedRuleKeys, autoRules])

  const save = async () => {
    const valid = presets.map((n) => Number(n)).filter((n) => n > 0 && n <= 240)
    if (!valid.length) return
    await setSetting('focusPresets', valid)
    await setSetting('breakReminderMin', breakMin)
    await setSetting('dailyFocusGoalMin', Math.min(1440, Math.max(10, Number(dailyGoalMin) || 120)))
    await setSetting('focusGuardEnabled', guardEnabled)
    await setSetting('focusGuardIntervalSec', Math.min(30, Math.max(2, Math.round(Number(guardInterval) || DEFAULT_GUARD_INTERVAL_SEC))))
    await setSetting('focusGuardRules', sanitizeBlockRules(blockRules))
    onToast('设置已保存')
  }

  const addRule = async () => {
    const kw = newKw.trim()
    if (!kw) return
    await setAutoRules([...draftRules, { id: makeRuleId(), keyword: kw, category: newCat, enabled: true }])
    setNewKw('')
    onToast('规则已添加')
  }

  const patchRule = async (id: string, c: Partial<ClassifyRule>) => {
    await setAutoRules(draftRules.map((r) => (r.id === id ? { ...r, ...c } : r)))
  }

  const removeRule = async (id: string) => {
    await setAutoRules(draftRules.filter((r) => r.id !== id))
  }

  const addBlockRule = () => {
    const kw = newBlockKw.trim()
    if (!kw) return
    const rule: BlockRule = { keyword: kw, scope: newBlockScope, enabled: true }
    if (blockRules.some((r) => blockRuleKey(r) === blockRuleKey(rule))) {
      onToast('该规则已存在')
      return
    }
    setBlockRules([...blockRules, rule])
    setNewBlockKw('')
  }

  const removeBlockRule = (idx: number) => {
    setBlockRules(blockRules.filter((_, i) => i !== idx))
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
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title">设置</div>
          <div className="page-desc">调整专注习惯与自动追踪，管理本地数据</div>
        </div>
      </div>

      <div className="card card-pad" style={{ marginBottom: 20 }}>
        <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Activity size={16} /> 自动活动追踪
        </div>
        <div className="card-sub" style={{ marginBottom: 6 }}>
          后台定时读取当前应用名与窗口标题，按下方规则自动归类为时间记录（不记录键盘输入、不截图）
        </div>

        <div className="auto-switch-row">
          <div className="auto-switch-info">
            <div style={{ fontWeight: 600, fontSize: 14 }}>
              {autoEnabled ? '自动追踪已开启' : '自动追踪已关闭'}
              {autoEnabled && <span className={`auto-dot ${autoCurrent ? 'live' : ''}`} style={{ marginLeft: 8, display: 'inline-block' }} />}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 3 }}>
              {!isWin
                ? '当前系统暂不支持活动窗口读取（仅 Windows）'
                : autoCurrent
                  ? `正在记录：${autoCurrent.app} · ${CATEGORY_LABEL[autoCurrent.category]}`
                  : '开启后按间隔采样前台窗口，专注时自动暂停'}
            </div>
          </div>
          <button
            className={`switch ${autoEnabled ? 'on' : ''}`}
            disabled={!isWin}
            onClick={async () => { await setAutoEnabled(!autoEnabled); onToast(autoEnabled ? '自动追踪已关闭' : '自动追踪已开启') }}
            aria-label="切换自动追踪"
          >
            <span className="switch-knob" />
          </button>
        </div>

        <div className="row" style={{ margin: '16px 0' }}>
          <div className="field">
            <label>采样间隔（秒）</label>
            <input className="input" type="number" min="10" max="600" value={autoIntervalSec}
              onChange={(e) => setAutoIntervalSec(Number(e.target.value))} />
          </div>
          <div className="field">
            <label>最短记录时长（秒）</label>
            <input className="input" type="number" min="10" max="600" value={autoMinSec}
              onChange={(e) => setAutoMinSec(Number(e.target.value))} />
            <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>不足此时长的临时切换不入库，减少噪音</span>
          </div>
        </div>

        <div className="rule-head">
          <div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>归类规则</div>
            <div className="card-sub">按顺序匹配，命中关键词即归入对应类别（应用名或标题包含即可）</div>
          </div>
        </div>
        <div className="rule-list">
          {draftRules.map((r) => (
            <div className={`rule-row ${r.enabled ? '' : 'off'}`} key={r.id}>
              <input type="checkbox" checked={r.enabled} onChange={(e) => patchRule(r.id, { enabled: e.target.checked })} />
              <input className="input" value={r.keyword} placeholder="关键词，如 cursor / 钉钉"
                onChange={(e) => patchRule(r.id, { keyword: e.target.value })} />
              <select className="select" value={r.category} onChange={(e) => patchRule(r.id, { category: e.target.value as TimeCategory })}>
                {CATS.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
              </select>
              {r.learned && <span className="learned-badge" title="来自本地学习建议">已学习</span>}
              <button className="icon-btn" title="删除规则" onClick={() => removeRule(r.id)}><Trash2 size={15} /></button>
            </div>
          ))}
          {!draftRules.length && <div className="empty" style={{ padding: 20 }}>暂无规则</div>}
        </div>
        <div className="rule-add">
          <input className="input" value={newKw} placeholder="新关键词，如 figma" onChange={(e) => setNewKw(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addRule() }} />
          <select className="select" value={newCat} onChange={(e) => setNewCat(e.target.value as TimeCategory)}>
            {CATS.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
          </select>
          <button className="btn sm" onClick={addRule}><Plus size={14} style={{ marginRight: 4 }} />添加</button>
        </div>
      </div>

      <div className="card card-pad" style={{ marginBottom: 20 }}>
        <div className="smart-head">
          <div>
            <div className="smart-head-title"><Sparkles size={16} /> 智能归类建议</div>
            <div className="card-sub" style={{ marginTop: 4 }}>
              纯本地学习你的修正习惯，不联网、不调用外部 AI；采纳后才会生效
            </div>
          </div>
          <span className="smart-count">已记录 {classifyCorrections.length} 次修正</span>
        </div>
        {suggestions.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            title="还没有足够的学习样本"
            hint="在时间统计里手动修改自动记录的分类，系统会学习你的习惯；同一偏好修正 2 次后会出现建议"
          />
        ) : (
          <div className="smart-list">
            {suggestions.map((rule) => (
              <div className="smart-item" key={learnedRuleKey(rule.keyword, rule.scope)}>
                <div className="smart-item-main">
                  <div className="smart-kw">
                    {rule.keyword}
                    <span className="smart-scope">
                      {rule.scope === 'app' ? '进程名' : rule.scope === 'title' ? '窗口标题' : '两者'}
                    </span>
                  </div>
                  <div className="smart-meta">
                    建议归入 <b>{CATEGORY_LABEL[rule.category]}</b> · 命中 {rule.hits} 次 · 置信度{' '}
                    <span className="smart-confidence">{Math.round(rule.confidence * 100)}%</span>
                  </div>
                  {rule.sampleTitle && (
                    <div className="smart-sample" title={rule.sampleTitle}>样例：{rule.sampleTitle}</div>
                  )}
                </div>
                <div className="smart-actions">
                  <button className="btn sm" onClick={async () => { await adoptLearnedRule(rule); onToast('已采纳，规则优先生效') }}>采纳</button>
                  <button className="btn ghost sm" onClick={async () => { await dismissLearnedRule(rule); onToast('已忽略这条建议') }}>忽略</button>
                </div>
              </div>
            ))}
          </div>
        )}
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
        <div className="field" style={{ marginBottom: 18 }}>
          <label>每日专注目标（分钟）</label>
          <input className="input" type="number" min="10" max="1440" value={dailyGoalMin}
            onChange={(e) => setDailyGoalMin(Number(e.target.value))} />
          <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>专注页「今日目标」进度按此目标计算</span>
        </div>

        {/* 专注守护：非侵入式干扰提醒 */}
        <div className="guard-section">
          <div className="guard-head">
            <div className="guard-head-title">
              <ShieldCheck size={16} style={{ color: 'var(--accent)' }} />
              <div>
                <div className="guard-title">专注守护</div>
                <div className="guard-sub">专注时检测干扰窗口，及时提醒你回到任务（不强制拦截）</div>
              </div>
            </div>
            <button className={`switch ${guardEnabled ? 'on' : ''}`}
              aria-label="专注守护开关" onClick={() => setGuardEnabled(!guardEnabled)}>
              <span className="switch-knob" />
            </button>
          </div>

          <div className="guard-interval">
            <label>检测间隔（秒）</label>
            <input className="input" type="number" min="2" max="30" value={guardInterval}
              onChange={(e) => setGuardInterval(Number(e.target.value))} />
          </div>

          <div className="guard-rules">
            <div className="guard-rules-label">屏蔽关键词</div>
            {blockRules.length === 0 ? (
              <div className="guard-empty">还没有规则，添加后会开始检测</div>
            ) : blockRules.map((r, i) => (
              <div className="guard-rule-row" key={blockRuleKey(r)}>
                <input type="checkbox" checked={r.enabled}
                  onChange={(e) => setBlockRules(blockRules.map((x, j) => j === i ? { ...x, enabled: e.target.checked } : x))} />
                <span className="guard-kw">{r.keyword}</span>
                <span className="guard-scope">
                  {r.scope === 'app' ? '进程名' : r.scope === 'title' ? '窗口标题' : '两者'}
                </span>
                <button className="guard-del" onClick={() => removeBlockRule(i)} title="删除"><Trash2 size={14} /></button>
              </div>
            ))}
            <div className="rule-add">
              <input className="input" placeholder="关键词，如 微博 / youtube" value={newBlockKw}
                onChange={(e) => setNewBlockKw(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addBlockRule() }} />
              <select className="select" value={newBlockScope}
                onChange={(e) => setNewBlockScope(e.target.value as BlockRule['scope'])}>
                <option value="title">窗口标题</option>
                <option value="app">进程名</option>
                <option value="both">两者</option>
              </select>
              <button className="btn ghost" onClick={addBlockRule}><Plus size={14} /></button>
            </div>
          </div>
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
          <div><strong>TimeRecoder</strong> v{version || '0.1.0'}</div>
          <div>技术栈：Electron + React + TypeScript + Dexie + Recharts</div>
          <div>功能：专注模式、日程安排、待办任务、时间统计、自动活动追踪、本地智能归类、数据备份</div>
          <div style={{ color: 'var(--text-faint)', marginTop: 8 }}>后续规划：系统托盘与全局快捷键、跨设备同步</div>
        </div>
      </div>
    </div>
  )
}
