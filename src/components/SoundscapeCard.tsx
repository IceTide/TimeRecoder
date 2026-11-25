import { useEffect, useState } from 'react'
import {
  CloudRain, Waves, Wind, Trees, Coffee, Radio, Play, Pause, Volume2, VolumeX,
  type LucideIcon,
} from 'lucide-react'
import { getSetting, setSetting } from '../db/database'
import {
  AMBIENT_SCENES, ambientEngine, type AmbientScene,
} from '../utils/ambientSound'

const SCENE_ICONS: Record<AmbientScene, LucideIcon> = {
  rain: CloudRain,
  waves: Waves,
  stream: Wind,
  forest: Trees,
  cafe: Coffee,
  white: Radio,
}

interface Props {
  onToast: (msg: string) => void
}

/** 专注页环境音卡片：Web Audio 实时合成，支持场景切换与音量持久化 */
export default function SoundscapeCard({ onToast }: Props) {
  const [scene, setScene] = useState<AmbientScene>('rain')
  const [playing, setPlaying] = useState(false)
  const [volume, setVolume] = useState(0.5)

  useEffect(() => {
    let alive = true
    Promise.all([
      getSetting<AmbientScene>('ambientScene', 'rain'),
      getSetting<number>('ambientVolume', 0.5),
    ]).then(([s, v]) => {
      if (!alive) return
      const valid = AMBIENT_SCENES.some((m) => m.id === s) ? s : 'rain'
      const vol = Math.min(1, Math.max(0, Number(v) || 0.5))
      setScene(valid)
      setVolume(vol)
      ambientEngine.setVolume(vol)
      // 若从其他页返回、声音仍在播放，同步播放状态
      setPlaying(ambientEngine.isPlaying())
    })
    return () => { alive = false }
  }, [])

  const toggle = () => {
    try {
      if (playing) {
        ambientEngine.stop()
        setPlaying(false)
      } else {
        ambientEngine.play(scene, volume)
        setPlaying(true)
      }
    } catch {
      onToast('当前环境不支持音频播放')
    }
  }

  const chooseScene = (id: AmbientScene) => {
    setScene(id)
    void setSetting('ambientScene', id)
    if (playing) {
      try {
        ambientEngine.play(id, volume) // 播放中直接无缝切换（带淡入）
      } catch {
        onToast('切换环境音失败')
      }
    }
  }

  const changeVolume = (v: number) => {
    setVolume(v)
    ambientEngine.setVolume(v)
    void setSetting('ambientVolume', v)
  }

  const meta = AMBIENT_SCENES.find((m) => m.id === scene)!

  return (
    <div className="card card-pad soundscape-card">
      <div className="soundscape-head">
        <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <Radio size={15} style={{ color: 'var(--accent)' }} /> 环境音
        </div>
        <div className={`soundscape-state ${playing ? 'on' : ''}`}>
          <span className="soundscape-led" />{playing ? 'PLAYING' : 'STANDBY'}
        </div>
      </div>
      <div className="card-sub" style={{ marginBottom: 14 }}>实时合成，无需联网 · 帮你屏蔽杂音</div>

      <div className="scene-grid">
        {AMBIENT_SCENES.map((m) => {
          const Icon = SCENE_ICONS[m.id]
          return (
            <button key={m.id} className={`scene-btn ${scene === m.id ? 'active' : ''}`}
              onClick={() => chooseScene(m.id)} title={m.hint}>
              <Icon size={17} strokeWidth={1.7} />
              <span>{m.label}</span>
            </button>
          )
        })}
      </div>

      <div className="soundscape-controls">
        <button className={`sound-play ${playing ? 'playing' : ''}`} onClick={toggle}
          aria-label={playing ? '暂停' : '播放'}>
          {playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}
        </button>
        <div className={`sound-wave ${playing ? 'on' : ''}`} aria-hidden="true">
          {[0, 1, 2, 3, 4].map((i) => <i key={i} style={{ animationDelay: `${i * 0.11}s` }} />)}
        </div>
        <div className="sound-volume">
          {volume === 0 ? <VolumeX size={14} /> : <Volume2 size={14} />}
          <input type="range" min="0" max="100" value={Math.round(volume * 100)}
            onChange={(e) => changeVolume(Number(e.target.value) / 100)}
            aria-label="音量" />
        </div>
      </div>
      <div className="soundscape-now">
        {playing ? `正在播放 · ${meta.label}` : `已选择 · ${meta.label}`}
      </div>
    </div>
  )
}
