<script setup lang="ts">
import type { HNode } from '~/types/hydraulic'

const sim = useSimulator()
const canvas = ref<HTMLCanvasElement>()
const wrap = ref<HTMLDivElement>()
let ctx: CanvasRenderingContext2D | null = null
let animEnabled = false, animating = false
let w = 0, h = 0, dpr = 1, raf = 0

const mouse = ref<{ x: number; y: number } | null>(null) // world
const pipeStart = ref<string | null>(null)
let drag: { id: string } | { pan: true; sx: number; sy: number; px: number; py: number } | null = null

const PAL = {
  dark: { bg: '#0E1822', halo: 'rgba(14,24,34,.9)', ink: '#E6EEF4', steel: '#8FB0C8', name: '#B9CBD9', off: '#64748B', fire: '#FF5A36', ok: '#2FBF71', warn: '#F2A33A', grid: '#1A2B3A', sel: '#60A5FA', pump: '#4C8DFF', idle: '#64748B' },
  light: { bg: '#FBFCFD', halo: 'rgba(251,252,253,.92)', ink: '#14202B', steel: '#3B5568', name: '#334155', off: '#94A3B8', fire: '#D6402B', ok: '#1F9D55', warn: '#E08A00', grid: '#E1E6EB', sel: '#2563EB', pump: '#2563EB', idle: '#94A3B8' }
}
const { theme } = useTheme()
let COL: typeof PAL.dark = { ...PAL.dark }
const NODE_R = 9

const toWorld = (sx: number, sy: number) => ({ x: (sx - sim.view.panX) / sim.view.zoom, y: (sy - sim.view.panY) / sim.view.zoom })
const rel = (e: PointerEvent | WheelEvent) => {
  const r = canvas.value!.getBoundingClientRect()
  return { x: e.clientX - r.left, y: e.clientY - r.top }
}

function hitNode(wx: number, wy: number): HNode | undefined {
  const r = (NODE_R + 4) / sim.view.zoom
  for (let i = sim.nodes.length - 1; i >= 0; i--) {
    const n = sim.nodes[i]
    if (Math.hypot(n.x - wx, n.y - wy) <= r) return n
  }
}
function hitPipe(wx: number, wy: number) {
  const tol = 7 / sim.view.zoom
  const byId = new Map(sim.nodes.map((n) => [n.id, n]))
  for (const p of sim.pipes) {
    const a = byId.get(p.from), b = byId.get(p.to)
    if (!a || !b) continue
    const dx = b.x - a.x, dy = b.y - a.y
    const t = Math.max(0, Math.min(1, ((wx - a.x) * dx + (wy - a.y) * dy) / (dx * dx + dy * dy || 1)))
    if (Math.hypot(wx - (a.x + t * dx), wy - (a.y + t * dy)) <= tol) return p
  }
}

// ---------- Etkileşim ----------
function onDown(e: PointerEvent) {
  canvas.value!.setPointerCapture(e.pointerId)
  const s = rel(e), p = toWorld(s.x, s.y)
  const node = hitNode(p.x, p.y)
  const tool = sim.tool

  if (e.button === 1 || e.button === 2 || (tool === 'select' && !node && !hitPipe(p.x, p.y))) {
    if (tool === 'select' && e.button === 0) sim.selected = null
    drag = { pan: true, sx: s.x, sy: s.y, px: sim.view.panX, py: sim.view.panY }
    return
  }
  if (e.button !== 0) return
  if (sim.readOnly && tool !== 'select') return

  if (tool === 'select') {
    if (node) { sim.selected = { kind: 'node', id: node.id }; drag = sim.readOnly ? null : { id: node.id } }
    else { const pipe = hitPipe(p.x, p.y); if (pipe) sim.selected = { kind: 'pipe', id: pipe.id } }
  } else if (tool === 'delete') {
    if (node) sim.removeNode(node.id)
    else { const pipe = hitPipe(p.x, p.y); if (pipe) sim.removePipe(pipe.id) }
  } else if (tool === 'pipe' || tool === 'pump') {
    const target = node ?? sim.addNode('joint', p.x, p.y)
    if (pipeStart.value) {
      sim.addPipe(pipeStart.value, target.id, tool)
      pipeStart.value = target.id // zincir çizim
    } else pipeStart.value = target.id
  } else if (!node) {
    const n = sim.addNode(tool, p.x, p.y)
    sim.selected = { kind: 'node', id: n.id }
  }
}
function onMove(e: PointerEvent) {
  const s = rel(e), p = toWorld(s.x, s.y)
  mouse.value = sim.snapPt(p.x, p.y)
  if (!drag) return
  if ('pan' in drag) {
    sim.view.panX = drag.px + (s.x - drag.sx)
    sim.view.panY = drag.py + (s.y - drag.sy)
  } else {
    const dragId = drag.id
    const n = sim.nodes.find((n) => n.id === dragId)
    if (n) { const q = sim.snapPt(p.x, p.y); n.x = q.x; n.y = q.y }
  }
}
function onUp() { drag = null }
function onDbl(e: MouseEvent) {
  if (sim.tool !== 'select' || sim.readOnly) return
  const r = canvas.value!.getBoundingClientRect()
  const p = toWorld(e.clientX - r.left, e.clientY - r.top)
  const n = hitNode(p.x, p.y)
  if (n && (n.type === 'sprinkler' || n.type === 'hydrant')) n.open = n.open === false
}
function onWheel(e: WheelEvent) {
  e.preventDefault()
  const s = rel(e), before = toWorld(s.x, s.y)
  const z = Math.min(4, Math.max(0.15, sim.view.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12)))
  sim.view.zoom = z
  sim.view.panX = s.x - before.x * z
  sim.view.panY = s.y - before.y * z
}
function onKey(e: KeyboardEvent) {
  if ((e.target as HTMLElement)?.matches?.('input, select, textarea')) return
  if (e.key === 'Escape') { pipeStart.value = null; sim.tool = 'select' }
  if ((e.key === 'Delete' || e.key === 'Backspace') && sim.selected) {
    sim.selected.kind === 'node' ? sim.removeNode(sim.selected.id) : sim.removePipe(sim.selected.id)
  }
}

function fit() {
  if (!sim.nodes.length || !w) return
  const xs = sim.nodes.map((n) => n.x), ys = sim.nodes.map((n) => n.y)
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
  const pad = 80
  const z = Math.min(2, Math.max(0.15, Math.min((w - pad * 2) / Math.max(maxX - minX, 1), (h - pad * 2) / Math.max(maxY - minY, 1))))
  sim.view.zoom = z
  sim.view.panX = w / 2 - ((minX + maxX) / 2) * z
  sim.view.panY = h / 2 - ((minY + maxY) / 2) * z
}

// ---------- Çizim ----------
function draw(ts = performance.now()) {
  raf = 0
  animating = false
  if (!ctx) return
  const { zoom, panX, panY } = sim.view
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = COL.bg
  ctx.fillRect(0, 0, w, h)

  // grid
  ctx.save()
  ctx.translate(panX, panY); ctx.scale(zoom, zoom)
  const step = GRID * (zoom < 0.5 ? 5 : 1)
  const x0 = -panX / zoom, y0 = -panY / zoom, x1 = x0 + w / zoom, y1 = y0 + h / zoom
  ctx.strokeStyle = COL.grid; ctx.lineWidth = 1 / zoom
  ctx.beginPath()
  for (let x = Math.floor(x0 / step) * step; x < x1; x += step) { ctx.moveTo(x, y0); ctx.lineTo(x, y1) }
  for (let y = Math.floor(y0 / step) * step; y < y1; y += step) { ctx.moveTo(x0, y); ctx.lineTo(x1, y) }
  ctx.stroke()

  const byId = new Map(sim.nodes.map((n) => [n.id, n]))
  const res = sim.result

  // borular
  for (const p of sim.pipes) {
    const a = byId.get(p.from), b = byId.get(p.to)
    if (!a || !b) continue
    const r = res.pipes[p.id]
    if (p.kind === 'pump') { drawPump(a, b, r, sim.selected?.id === p.id); continue }
    const color = !r || !res.nodes[a.id]?.reachable || Math.abs(r.flow) < 0.5 ? COL.idle : r.status === 'danger' ? COL.fire : r.status === 'warn' ? COL.warn : COL.ok
    const isSel = sim.selected?.kind === 'pipe' && sim.selected.id === p.id
    ctx.strokeStyle = isSel ? COL.sel : color
    ctx.lineWidth = (2 + p.dn / 40) * (isSel ? 1.4 : 1)
    ctx.lineCap = 'round'
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
    if (animEnabled && r && Math.abs(r.flow) > 0.5 && res.nodes[a.id]?.reachable) {
      // akış noktaları: hız ile orantılı, akış yönünde ilerler
      animating = true
      const speed = 25 + Math.min(r.velocity, 6) * 30
      ctx.save()
      ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.lineWidth = 3; ctx.lineCap = 'round'
      ctx.setLineDash([0.1, 14]); ctx.lineDashOffset = -Math.sign(r.flow) * ((ts / 1000) * speed)
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
      ctx.restore()
    }
    if (r && zoom > 0.5 && sim.showLabels && Math.abs(r.flow) > 0.5) {
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
      label(`${Math.abs(r.flow).toFixed(0)} L/dk · DN${p.dn}`, mx, my - 10, color, zoom)
    }
  }
  // çizim önizleme
  if (pipeStart.value && mouse.value) {
    const a = byId.get(pipeStart.value)
    if (a) {
      ctx.setLineDash([6 / zoom, 5 / zoom]); ctx.strokeStyle = COL.steel; ctx.lineWidth = 2 / zoom
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(mouse.value.x, mouse.value.y); ctx.stroke()
      ctx.setLineDash([])
    }
  }
  // düğümler
  for (const n of sim.nodes) {
    const isSel = sim.selected?.kind === 'node' && sim.selected.id === n.id
    const r = res.nodes[n.id]
    drawNode(n, isSel, r?.reachable !== false)
    if (r && zoom > 0.4 && sim.showLabels) {
      const t = n.type === 'source' ? (n.supply ? `${r.pressure.toFixed(2)} bar (statik ${(n.pressure ?? 0).toFixed(1)})` : `${(n.pressure ?? 0).toFixed(1)} bar`) : r.reachable ? `${r.pressure.toFixed(2)} bar` : 'bağlı değil'
      const zt = n.z ? ` · ${n.z > 0 ? '+' : ''}${n.z} m` : ''
      label(t + (r.reachable ? zt : ''), n.x, n.y + NODE_R + 12, r.reachable ? COL.ink : COL.off, zoom)
      const showFlow = (n.type === 'sprinkler' || n.type === 'hydrant') && n.open !== false
      if (showFlow) label(`${r.flow.toFixed(0)} L/dk`, n.x, n.y - NODE_R - 6, COL.steel, zoom)
      if (n.name) label(n.name, n.x, n.y - NODE_R - (showFlow ? 19 : 7), COL.name, zoom)
    }
  }
  ctx.restore()
  if (animating) raf = requestAnimationFrame(draw)
}

function drawPump(a: HNode, b: HNode, r: { flow: number; lossBar: number } | undefined, sel: boolean) {
  const c = ctx!
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
  c.strokeStyle = sel ? COL.sel : COL.pump; c.lineWidth = 5; c.lineCap = 'round'
  c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke()
  // yön oku
  const ang = Math.atan2(b.y - a.y, b.x - a.x)
  c.fillStyle = c.strokeStyle
  c.beginPath(); c.moveTo(mx + Math.cos(ang) * 16, my + Math.sin(ang) * 16)
  c.lineTo(mx + Math.cos(ang + 2.5) * 12, my + Math.sin(ang + 2.5) * 12)
  c.lineTo(mx + Math.cos(ang - 2.5) * 12, my + Math.sin(ang - 2.5) * 12); c.closePath(); c.fill()
  c.beginPath(); c.arc(mx, my, 11, 0, Math.PI * 2); c.fillStyle = COL.bg; c.fill(); c.lineWidth = 2.5; c.stroke()
  c.fillStyle = COL.pump; c.font = 'bold 12px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('P', mx, my + 0.5)
  if (r && sim.view.zoom > 0.4) label(`+${(-r.lossBar).toFixed(2)} bar · ${r.flow.toFixed(0)} L/dk`, mx, my - 22, COL.pump, sim.view.zoom)
}
function drawNode(n: HNode, sel: boolean, ok: boolean) {
  const c = ctx!
  c.lineWidth = 2
  c.strokeStyle = sel ? COL.sel : ok ? COL.ink : COL.off
  c.fillStyle = COL.bg
  c.beginPath()
  if (n.type === 'source') {
    c.rect(n.x - NODE_R, n.y - NODE_R, NODE_R * 2, NODE_R * 2); c.fillStyle = COL.pump; c.fill(); c.stroke()
    c.fillStyle = '#fff'; c.font = 'bold 10px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('P', n.x, n.y + 0.5)
  } else if (n.type === 'sprinkler') {
    const open = n.open !== false
    c.arc(n.x, n.y, NODE_R, 0, Math.PI * 2); c.fillStyle = open ? COL.fire : COL.bg; c.fill(); c.stroke()
    c.beginPath(); c.moveTo(n.x - 4, n.y - 4); c.lineTo(n.x + 4, n.y + 4); c.moveTo(n.x + 4, n.y - 4); c.lineTo(n.x - 4, n.y + 4)
    c.strokeStyle = open ? '#fff' : COL.steel; c.lineWidth = 1.5; c.stroke()
  } else if (n.type === 'hydrant') {
    c.moveTo(n.x, n.y - NODE_R - 2); c.lineTo(n.x + NODE_R + 2, n.y + NODE_R); c.lineTo(n.x - NODE_R - 2, n.y + NODE_R); c.closePath()
    c.fillStyle = n.open === false ? COL.bg : '#E5483A'; c.fill(); c.stroke()
  } else {
    c.arc(n.x, n.y, 5, 0, Math.PI * 2); c.fillStyle = COL.bg; c.fill(); c.stroke()
  }
}
function label(t: string, x: number, y: number, color: string, zoom: number) {
  const c = ctx!
  c.font = `${11 / Math.max(zoom, 0.7)}px ui-sans-serif, system-ui, sans-serif`
  c.textAlign = 'center'; c.textBaseline = 'middle'
  c.lineWidth = 3 / zoom; c.strokeStyle = COL.halo; c.strokeText(t, x, y)
  c.fillStyle = color; c.fillText(t, x, y)
}

const schedule = () => { if (!raf) raf = requestAnimationFrame(draw) }

function resize() {
  if (!wrap.value || !canvas.value) return
  dpr = window.devicePixelRatio || 1
  w = wrap.value.clientWidth; h = wrap.value.clientHeight
  canvas.value.width = w * dpr; canvas.value.height = h * dpr
  canvas.value.style.width = `${w}px`; canvas.value.style.height = `${h}px`
  schedule()
}

let ro: ResizeObserver
onMounted(() => {
  COL = { ...PAL[theme.value] }
  ctx = canvas.value!.getContext('2d')
  animEnabled = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ro = new ResizeObserver(resize); ro.observe(wrap.value!)
  window.addEventListener('keydown', onKey)
  resize()
  if (sim.nodes.length) fit()
})
onBeforeUnmount(() => { ro?.disconnect(); window.removeEventListener('keydown', onKey); cancelAnimationFrame(raf) })

watch(theme, (t) => { COL = { ...PAL[t] }; schedule() })
watch(() => sim.fitRequest, () => nextTick(() => { fit(); schedule() }))
watch(() => sim.tool, () => { pipeStart.value = null })
watch([() => sim.showLabels, () => sim.nodes, () => sim.pipes, () => sim.view, () => sim.selected, () => sim.result, mouse, pipeStart], schedule, { deep: true })

const cursor = computed(() => (sim.tool === 'select' ? 'default' : sim.tool === 'delete' ? 'not-allowed' : 'crosshair'))
</script>

<template>
  <div ref="wrap" class="relative h-full w-full overflow-hidden">
    <canvas
      ref="canvas"
      :style="{ cursor, touchAction: 'none' }"
      @pointerdown="onDown" @pointermove="onMove" @pointerup="onUp" @pointerleave="mouse = null"
      @wheel="onWheel" @dblclick="onDbl" @contextmenu.prevent
    />
    <div class="pointer-events-none absolute bottom-2 left-2 rounded bg-white/90 px-2 py-1 text-xs text-slate-600">
      <span v-if="sim.tool === 'pipe' || sim.tool === 'pump'">{{ sim.tool === 'pump' ? 'Pompa: emme düğümünden basma düğümüne tıklayın (yön önemli)' : 'Boru: düğümlere tıklayın' }} · Esc ile bitir</span>
      <span v-else>Çift tık: sprinkler/hidrant aç-kapat · Tekerlek: yakınlaştır · Sağ tuş sürükle: kaydır · Del: sil</span>
    </div>
    <div class="pointer-events-none absolute bottom-2 right-2 flex gap-3 rounded bg-white/90 px-2 py-1 text-xs">
      <span style="color:#2FBF71">● &lt; 4 m/s</span><span style="color:#F2A33A">● 4–6 m/s</span><span style="color:#FF5A36">● &gt; 6 m/s</span><span style="color:#64748B">● akış yok</span>
    </div>
  </div>
</template>
