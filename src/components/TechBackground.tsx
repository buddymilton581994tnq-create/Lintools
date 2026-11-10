import { useEffect, useRef } from 'react'
import { THEME_EVENT, currentTheme } from '../lib/themes'

/**
 * Tech-style animated background: drifting grid + connected particles + scanline.
 * Decorative only; pointer-events disabled by the caller. 颜色跟着主题走。
 */
export default function TechBackground({ className = '' }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let accent = currentTheme().accentRgb
    const onTheme = () => {
      accent = currentTheme().accentRgb
    }
    window.addEventListener(THEME_EVENT, onTheme)

    let raf = 0
    let w = 0
    let h = 0
    const dpr = Math.min(window.devicePixelRatio || 1, 2)

    interface P {
      x: number
      y: number
      vx: number
      vy: number
    }
    let particles: P[] = []

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      w = rect.width
      h = rect.height
      canvas.width = Math.max(1, Math.floor(w * dpr))
      canvas.height = Math.max(1, Math.floor(h * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const count = Math.min(90, Math.floor((w * h) / 18000))
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.35,
        vy: (Math.random() - 0.5) * 0.35,
      }))
    }

    let t = 0
    const draw = () => {
      t += 1
      ctx.clearRect(0, 0, w, h)

      // grid
      const grid = 42
      const offset = (t * 0.12) % grid
      ctx.strokeStyle = `rgba(${accent}, 0.05)`
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let x = -offset; x < w; x += grid) {
        ctx.moveTo(x, 0)
        ctx.lineTo(x, h)
      }
      for (let y = -offset; y < h; y += grid) {
        ctx.moveTo(0, y)
        ctx.lineTo(w, y)
      }
      ctx.stroke()

      // scanline
      const scanY = ((t * 0.6) % (h + 200)) - 100
      const grad = ctx.createLinearGradient(0, scanY - 60, 0, scanY + 60)
      grad.addColorStop(0, `rgba(${accent},0)`)
      grad.addColorStop(0.5, `rgba(${accent},0.07)`)
      grad.addColorStop(1, `rgba(${accent},0)`)
      ctx.fillStyle = grad
      ctx.fillRect(0, scanY - 60, w, 120)

      // particles + links
      for (const p of particles) {
        p.x += p.vx
        p.y += p.vy
        if (p.x < 0 || p.x > w) p.vx *= -1
        if (p.y < 0 || p.y > h) p.vy *= -1
      }
      for (let i = 0; i < particles.length; i++) {
        const a = particles[i]
        for (let j = i + 1; j < particles.length; j++) {
          const b = particles[j]
          const dx = a.x - b.x
          const dy = a.y - b.y
          const d2 = dx * dx + dy * dy
          if (d2 < 120 * 120) {
            const alpha = 0.12 * (1 - Math.sqrt(d2) / 120)
            ctx.strokeStyle = `rgba(${accent},${alpha.toFixed(3)})`
            ctx.beginPath()
            ctx.moveTo(a.x, a.y)
            ctx.lineTo(b.x, b.y)
            ctx.stroke()
          }
        }
        ctx.fillStyle = `rgba(${accent},0.45)`
        ctx.fillRect(a.x - 1, a.y - 1, 2, 2)
      }

      raf = requestAnimationFrame(draw)
    }

    resize()
    const onResize = () => resize()
    window.addEventListener('resize', onResize)
    if (reduced) {
      // static single frame
      t = 0
      draw()
      cancelAnimationFrame(raf)
    } else {
      raf = requestAnimationFrame(draw)
    }
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      window.removeEventListener(THEME_EVENT, onTheme)
    }
  }, [])

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />
}
