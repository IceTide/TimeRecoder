import { deflateSync } from 'zlib'

/** CRC32 校验（PNG chunk 需要） */
function crc32(buf: Buffer): number {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i]
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** 构造一个 PNG chunk */
function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([length, typeBuf, data, crc])
}

/** 颜色插值：左上蓝 -> 右下紫 */
function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t)
}

/**
 * 纯代码生成托盘图标：圆角方块 + 白色 "T"，蓝紫渐变。
 * 不依赖任何二进制资源文件，跨平台可用。
 * 返回 PNG 的 data URL，供 nativeImage.createFromDataURL 使用。
 */
export function makeTrayIconDataURL(size = 32): string {
  const radius = Math.round(size * 0.22)
  const pixels = Buffer.alloc(size * size * 4)

  // 圆角矩形判定：是否在圆角外的角落区域
  const inRoundedRect = (x: number, y: number): boolean => {
    const cx = x < radius ? radius : x > size - 1 - radius ? size - 1 - radius : x
    const cy = y < radius ? radius : y > size - 1 - radius ? size - 1 - radius : y
    const dx = x - cx
    const dy = y - cy
    if ((x < radius || x > size - 1 - radius) && (y < radius || y > size - 1 - radius)) {
      return dx * dx + dy * dy <= radius * radius
    }
    return true
  }

  // "T" 字的横杠与竖杠范围
  const barTop = Math.round(size * 0.26)
  const barH = Math.max(2, Math.round(size * 0.13))
  const barLeft = Math.round(size * 0.2)
  const barRight = size - barLeft
  const stemL = Math.round(size * 0.44)
  const stemR = stemL + Math.max(2, Math.round(size * 0.12))
  const stemBottom = Math.round(size * 0.76)

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      if (!inRoundedRect(x, y)) {
        // 透明
        pixels[i] = 0; pixels[i + 1] = 0; pixels[i + 2] = 0; pixels[i + 3] = 0
        continue
      }
      const t = (x + y) / (2 * (size - 1))
      let r = lerp(0x5b, 0x9a, t)
      let g = lerp(0x6e, 0x6b, t)
      let b = lerp(0xf5, 0xff, t)
      const isT = (y >= barTop && y < barTop + barH && x >= barLeft && x < barRight)
        || (x >= stemL && x < stemR && y >= barTop && y < stemBottom)
      if (isT) { r = 0xff; g = 0xff; b = 0xff }
      pixels[i] = r; pixels[i + 1] = g; pixels[i + 2] = b; pixels[i + 3] = 0xff
    }
  }

  // 每行前加 filter byte 0，再整体 zlib 压缩
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8  // bit depth
  ihdr[9] = 6  // color type: RGBA
  ihdr[10] = 0 // compression
  ihdr[11] = 0 // filter
  ihdr[12] = 0 // interlace

  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])

  return `data:image/png;base64,${png.toString('base64')}`
}
