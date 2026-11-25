/**
 * 环境白噪音引擎
 * 基于 Web Audio API 实时合成，零音频文件、零外部依赖、完全离线可用。
 * 6 种场景：雨声 / 海浪 / 溪流 / 森林 / 咖啡馆 / 白噪音
 */

export type AmbientScene = 'rain' | 'waves' | 'stream' | 'forest' | 'cafe' | 'white'

export interface AmbientSceneMeta {
  id: AmbientScene
  label: string
  hint: string
}

export const AMBIENT_SCENES: AmbientSceneMeta[] = [
  { id: 'rain', label: '雨声', hint: '细雨落在窗沿' },
  { id: 'waves', label: '海浪', hint: '潮汐缓缓起伏' },
  { id: 'stream', label: '溪流', hint: '山涧流水潺潺' },
  { id: 'forest', label: '森林', hint: '风穿过树叶' },
  { id: 'cafe', label: '咖啡馆', hint: '远处的人声嗡鸣' },
  { id: 'white', label: '白噪音', hint: '均匀遮蔽杂音' },
]

type NoiseKind = 'white' | 'pink' | 'brown'
type FilterCfg = { type: BiquadFilterType; freq: number; q?: number }

interface SceneRecipe {
  kind: NoiseKind
  filters: FilterCfg[]
  gain: number
  lfo?: { freq: number; depth: number }
  layer?: { kind: NoiseKind; filters: FilterCfg[]; gain: number; lfo?: { freq: number; depth: number } }
}

const RECIPES: Record<AmbientScene, SceneRecipe> = {
  rain: {
    kind: 'white',
    filters: [{ type: 'highpass', freq: 480 }, { type: 'lowpass', freq: 7200 }],
    gain: 0.5,
    lfo: { freq: 6, depth: 0.06 },
  },
  waves: {
    kind: 'pink',
    filters: [{ type: 'lowpass', freq: 900 }],
    gain: 0.62,
    lfo: { freq: 0.11, depth: 0.34 },
  },
  stream: {
    kind: 'white',
    filters: [{ type: 'bandpass', freq: 1600, q: 0.55 }, { type: 'highpass', freq: 600 }],
    gain: 0.46,
    lfo: { freq: 3.2, depth: 0.08 },
  },
  forest: {
    kind: 'pink',
    filters: [{ type: 'bandpass', freq: 1100, q: 0.4 }, { type: 'lowpass', freq: 3200 }],
    gain: 0.5,
    lfo: { freq: 0.28, depth: 0.22 },
    layer: { kind: 'brown', filters: [{ type: 'lowpass', freq: 340 }], gain: 0.3 },
  },
  cafe: {
    kind: 'brown',
    filters: [{ type: 'lowpass', freq: 620 }],
    gain: 0.5,
    layer: {
      kind: 'pink',
      filters: [{ type: 'bandpass', freq: 720, q: 0.8 }],
      gain: 0.22,
      lfo: { freq: 0.9, depth: 0.12 },
    },
  },
  white: {
    kind: 'white',
    filters: [{ type: 'highpass', freq: 120 }, { type: 'lowpass', freq: 10000 }],
    gain: 0.38,
  },
}

class AmbientEngine {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private sources: AudioScheduledSourceNode[] = []
  private nodes: AudioNode[] = []
  private scene: AmbientScene | null = null
  private volume = 0.5

  private ensure(): AudioContext {
    if (!this.ctx) {
      const w = window as typeof window & { webkitAudioContext?: typeof AudioContext }
      const Ctor = w.AudioContext || w.webkitAudioContext
      if (!Ctor) throw new Error('当前环境不支持 Web Audio')
      this.ctx = new Ctor()
      this.master = this.ctx.createGain()
      this.master.gain.value = 0
      this.master.connect(this.ctx.destination)
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    return this.ctx
  }

  /** 生成 4 秒可循环的噪音样本 */
  private noiseBuffer(ctx: AudioContext, kind: NoiseKind): AudioBuffer {
    const seconds = 4
    const len = Math.floor(ctx.sampleRate * seconds)
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const out = buf.getChannelData(0)
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0

    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1
      if (kind === 'white') {
        out[i] = white
      } else if (kind === 'pink') {
        // Paul Kellet 粉红噪音近似
        b0 = 0.99886 * b0 + white * 0.0555179
        b1 = 0.99332 * b1 + white * 0.0750759
        b2 = 0.969 * b2 + white * 0.153852
        b3 = 0.8665 * b3 + white * 0.3104856
        b4 = 0.55 * b4 + white * 0.5329522
        b5 = -0.7616 * b5 - white * 0.016898
        out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11
        b6 = white * 0.115926
      } else {
        // 棕噪音（一阶积分，低频厚重）
        last = (last + 0.02 * white) / 1.02
        out[i] = last * 3.5
      }
    }
    return buf
  }

  /** 给 AudioParam 挂一个低频振荡器做缓慢起伏 */
  private attachLfo(ctx: AudioContext, target: AudioParam, freq: number, depth: number): void {
    const osc = ctx.createOscillator()
    osc.frequency.value = freq
    const amount = ctx.createGain()
    amount.gain.value = depth
    osc.connect(amount)
    amount.connect(target)
    osc.start()
    this.sources.push(osc)
    this.nodes.push(amount)
  }

  /** 搭建一层噪音源：source → filters → gain → master */
  private addLayer(ctx: AudioContext, recipe: Pick<SceneRecipe, 'kind' | 'filters' | 'gain' | 'lfo'>): void {
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuffer(ctx, recipe.kind)
    src.loop = true

    let tail: AudioNode = src
    recipe.filters.forEach((cfg) => {
      const f = ctx.createBiquadFilter()
      f.type = cfg.type
      f.frequency.value = cfg.freq
      if (cfg.q !== undefined) f.Q.value = cfg.q
      tail.connect(f)
      tail = f
      this.nodes.push(f)
    })

    const layerGain = ctx.createGain()
    layerGain.gain.value = recipe.gain
    tail.connect(layerGain)
    this.nodes.push(layerGain)

    if (recipe.lfo) this.attachLfo(ctx, layerGain.gain, recipe.lfo.freq, recipe.lfo.depth)
    layerGain.connect(this.master!)

    src.start()
    this.sources.push(src)
  }

  /** 开始/切换场景（带淡入，避免爆音） */
  play(scene: AmbientScene, volume: number): void {
    const ctx = this.ensure()
    this.clearNodes()
    this.volume = Math.min(1, Math.max(0, volume))

    const recipe = RECIPES[scene]
    this.addLayer(ctx, recipe)
    if (recipe.layer) this.addLayer(ctx, recipe.layer)

    const now = ctx.currentTime
    this.master!.gain.cancelScheduledValues(now)
    this.master!.gain.setValueAtTime(0.0001, now)
    this.master!.gain.linearRampToValueAtTime(this.volume, now + 0.7)
    this.scene = scene
  }

  /** 淡出停止 */
  stop(): void {
    if (!this.ctx || !this.master) {
      this.scene = null
      return
    }
    const now = this.ctx.currentTime
    const gain = this.master.gain
    gain.cancelScheduledValues(now)
    gain.setValueAtTime(gain.value, now)
    gain.linearRampToValueAtTime(0.0001, now + 0.35)
    const snapshot = this.sources
    const nodes = this.nodes
    this.sources = []
    this.nodes = []
    window.setTimeout(() => {
      snapshot.forEach((s) => { try { s.stop() } catch { /* 已停止 */ } })
      nodes.forEach((n) => { try { n.disconnect() } catch { /* 已断开 */ } })
    }, 420)
    this.scene = null
  }

  setVolume(volume: number): void {
    this.volume = Math.min(1, Math.max(0, volume))
    if (!this.ctx || !this.master || !this.scene) return
    const now = this.ctx.currentTime
    this.master.gain.cancelScheduledValues(now)
    this.master.gain.linearRampToValueAtTime(this.volume, now + 0.12)
  }

  private clearNodes(): void {
    this.sources.forEach((s) => { try { s.stop() } catch { /* 已停止 */ } })
    this.nodes.forEach((n) => { try { n.disconnect() } catch { /* 已断开 */ } })
    this.sources = []
    this.nodes = []
  }

  isPlaying(): boolean { return this.scene !== null }
  currentScene(): AmbientScene | null { return this.scene }
}

/** 模块级单例：切页时声音延续，不随组件卸载中断 */
export const ambientEngine = new AmbientEngine()
