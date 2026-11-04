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
let drag: { id: string } | { pan: true; sx: number; sy: number; px: number; py: number } | { plan: true; sx: number; sy: number; ox: number; oy: number } | null = null
/** Plan ölçekleme: tıklanan noktalar (dünya) */
const calib = ref<{ x: number; y: number }[]>([])

// ---------- Arka plan planı görseli (özel bucket: imzalı URL) ----------
const client = useSupabaseClient()
let planImg: HTMLImageElement | null = null
let planPath = ''
watch(() => sim.background?.path, async (path) => {
  planImg = null
  planPath = path ?? ''
  schedule()
  if (!path) return
  const { data } = await client.storage.from(PLAN_BUCKET).createSignedUrl(path, 3600)
  if (!data || planPath !== path) return
  const img = new Image()
  img.crossOrigin = 'anonymous' // rapor için canvas.toDataURL kirlenmesin
  img.onload = () => { if (planPath === path) { planImg = img; schedule() } }
  img.src = data.signedUrl
}, { immediate: true })

const PAL = {
  dark: { bg: '#0E1822', halo: 'rgba(14,24,34,.9)', ink: '#E6EEF4', steel: '#8FB0C8', name: '#B9CBD9', off: '#64748B', fire: '#FF5A36', ok: '#2FBF71', warn: '#F2A33A', grid: '#1A2B3A', sel: '#60A5FA', pump: '#4C8DFF', idle: '#64748B' },
  light: { bg: '#FBFCFD', halo: 'rgba(251,252,253,.92)', ink: '#14202B', steel: '#3B5568', name: '#334155', off: '#94A3B8', fire: '#D6402B', ok: '#1F9D55', warn: '#E08A00', grid: '#E1E6EB', sel: '#2563EB', pump: '#2563EB', idle: '#94A3B8' }
}
const { theme } = useTheme()
let COL: typeof PAL.dark = { ...PAL.dark }
const NODE_R = 9
const LABEL_R = 12

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
  const bg = sim.background
  if (e.button === 0 && sim.planMode && bg && !sim.readOnly) {
    if (sim.planMode === 'move') { if (!bg.locked) drag = { plan: true, sx: s.x, sy: s.y, ox: bg.x, oy: bg.y }; return }
    calib.value = [...calib.value, p]
    if (calib.value.length === 2) {
      const [a, b] = calib.value
      // Diyalogdan önce ikinci nokta ve çizgi görünsün
      requestAnimationFrame(() => setTimeout(() => {
        const m = Number(prompt('İki nokta arasındaki gerçek mesafe (metre):')?.replace(',', '.'))
        if (m > 0) sim.calibratePlan(a, b, m)
        calib.value = []
        sim.planMode = null
      }))
    }
    return
  }
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
  mouse.value = sim.planMode === 'calibrate' ? p : sim.snapPt(p.x, p.y)
  if (!drag) return
  if ('plan' in drag) {
    if (!sim.background) return
    sim.background.x = drag.ox + (s.x - drag.sx) / sim.view.zoom
    sim.background.y = drag.oy + (s.y - drag.sy) / sim.view.zoom
  } else if ('pan' in drag) {
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
  if ((e.target as HTMLElement)?.closest?.('input, select, textarea, [contenteditable="true"]')) return
  if (e.ctrlKey || e.metaKey) {
    const k = e.key.toLowerCase()
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); pipeStart.value = null; sim.undo() }
    else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); pipeStart.value = null; sim.redo() }
    return
  }
  if (e.altKey) return
  // 1–8: araç seçimi (araç çubuğundaki sırayla)
  if (/^[1-9]$/.test(e.key)) {
    const t = TOOLS[Number(e.key) - 1]
    if (t && (!sim.readOnly || t.id === 'select')) { e.preventDefault(); sim.tool = t.id }
    return
  }
  if (e.key === 'Escape') { pipeStart.value = null; calib.value = []; sim.planMode = null; sim.tool = 'select' }
  if ((e.key === 'Delete' || e.key === 'Backspace') && sim.selected) {
    sim.selected.kind === 'node' ? sim.removeNode(sim.selected.id) : sim.removePipe(sim.selected.id)
  }
}

function fit() {
  const bg = sim.background && !sim.background.hidden ? sim.background : null
  if ((!sim.nodes.length && !bg) || !w) return
  const xs = sim.nodes.map((n) => n.x), ys = sim.nodes.map((n) => n.y)
  if (bg) { xs.push(bg.x, bg.x + bg.w * bg.scale); ys.push(bg.y, bg.y + bg.h * bg.scale) }
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

  // arka plan planı (koyu temada renkleri ters çevir: beyaz kâğıt koyu zemine uyar)
  const bg = sim.background
  if (bg && !bg.hidden && planImg) {
    ctx.save()
    ctx.translate(panX, panY); ctx.scale(zoom, zoom)
    ctx.globalAlpha = bg.opacity
    if (theme.value === 'dark') ctx.filter = 'invert(1) hue-rotate(180deg)'
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(planImg, bg.x, bg.y, bg.w * bg.scale, bg.h * bg.scale)
    ctx.restore()
    if (sim.planMode === 'move') {
      ctx.save()
      ctx.strokeStyle = COL.sel; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4])
      ctx.strokeRect(panX + bg.x * zoom, panY + bg.y * zoom, bg.w * bg.scale * zoom, bg.h * bg.scale * zoom)
      ctx.restore()
    }
  }

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
  queue = []
  const obstacles: Box[] = []
  const selId = sim.selected?.id
  // Etiket ölçüleri dünya biriminde; yazı ekranda sabit boyutlu olduğundan boşluklar da ekran pikseline göre
  const fs = 11 / Math.max(zoom, 0.7), gap = 3 / zoom, line = fs * 1.25

  // borular
  for (const p of sim.pipes) {
    const a = byId.get(p.from), b = byId.get(p.to)
    if (!a || !b) continue
    const r = res.pipes[p.id]
    if (p.kind === 'pump') {
      drawPump(a, b, r, selId === p.id, p.id)
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
      obstacles.push([mx - LABEL_R, my - LABEL_R, mx + LABEL_R, my + LABEL_R, p.id])
      continue
    }
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
      // Etiketi çizginin yanına koy: yatay boruda üste, dikey boruda sağa
      const half = ((2 + p.dn / 40) * (isSel ? 1.4 : 1)) / 2 + gap
      // Çapraz boruda yazıyı çizginin uzaklaştığı tarafa yasla ki çizgi yazının içinden geçmesin
      const dx = b.x - a.x, dy = b.y - a.y, th = fs * 0.6
      const t = `${Math.abs(r.flow).toFixed(0)} L/dk · DN${p.dn}`
      const pr = isSel ? PRIO.selected : PRIO.pipe
      if (Math.abs(dy) > Math.abs(dx)) label(t, mx + half + th * Math.abs(dx / dy), my, color, zoom, pr, p.id, 'left')
      else if (Math.abs(dy) < 1) label(t, mx, my - half - th, color, zoom, pr, p.id)
      else label(t, mx, my - half - th, color, zoom, pr, p.id, dy / dx > 0 ? 'left' : 'right')
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
    const R = NODE_R + 2
    obstacles.push([n.x - R, n.y - R, n.x + R, n.y + R, n.id])
    const pr = (base: number) => (isSel ? PRIO.selected : base)
    if (r && zoom > 0.4 && sim.showLabels) {
      const t = n.type === 'source' ? (n.supply ? `${r.pressure.toFixed(2)} bar (statik ${(n.pressure ?? 0).toFixed(1)})` : `${(n.pressure ?? 0).toFixed(1)} bar`) : r.reachable ? `${r.pressure.toFixed(2)} bar` : 'bağlı değil'
      const zt = n.z ? ` · ${n.z > 0 ? '+' : ''}${n.z} m` : ''
      // LABEL_R: pompa simgesi (r=11) düğümlerden büyük; etiketler ikisini de aşacak kadar uzakta başlar
      const below = n.y + LABEL_R + gap + fs * 0.6, above = n.y - LABEL_R - gap - fs * 0.6
      label(t + (r.reachable ? zt : ''), n.x, below, r.reachable ? COL.ink : COL.off, zoom, pr(PRIO.pressure), n.id)
      const showFlow = (n.type === 'sprinkler' || n.type === 'hydrant') && n.open !== false
      if (showFlow) label(`${r.flow.toFixed(0)} L/dk`, n.x, above, COL.steel, zoom, pr(PRIO.flow), n.id)
      if (n.name) label(n.name, n.x, showFlow ? above - line : above, COL.name, zoom, pr(PRIO.name), n.id)
    }
  }
  flushLabels(zoom, obstacles, [x0, y0, x1, y1])
  ctx.restore()

  // plan ölçekleme: seçilen noktalar ve fareye uzanan ölçü çizgisi (ekran koordinatı)
  if (sim.planMode === 'calibrate') {
    const pts = [...calib.value, ...(calib.value.length === 1 && mouse.value ? [mouse.value] : [])].map((q) => ({ x: panX + q.x * zoom, y: panY + q.y * zoom }))
    ctx.strokeStyle = COL.fire; ctx.fillStyle = COL.fire; ctx.lineWidth = 2
    if (pts.length === 2) { ctx.setLineDash([6, 4]); ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); ctx.lineTo(pts[1].x, pts[1].y); ctx.stroke(); ctx.setLineDash([]) }
    calib.value.forEach((_, i) => { const q = pts[i]; ctx!.beginPath(); ctx!.moveTo(q.x - 7, q.y); ctx!.lineTo(q.x + 7, q.y); ctx!.moveTo(q.x, q.y - 7); ctx!.lineTo(q.x, q.y + 7); ctx!.stroke() })
  }
  if (animating) raf = requestAnimationFrame(draw)
}

function drawPump(a: HNode, b: HNode, r: { flow: number; lossBar: number } | undefined, sel: boolean, id: string) {
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
  const z = sim.view.zoom, fs = 11 / Math.max(z, 0.7)
  if (r && z > 0.4) label(`${-r.lossBar >= 0 ? '+' : '−'}${Math.abs(r.lossBar).toFixed(2)} bar · ${r.flow.toFixed(0)} L/dk`, mx, my - LABEL_R - 3 / z - fs * 0.6, COL.pump, z, sel ? PRIO.selected : PRIO.pump, id)
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
// ---------- Etiket yerleşimi ----------
// Etiketler hemen çizilmez; önceliğe göre sıralanır, başka bir etiketle veya simgeyle çakışan atlanır.
// Yakınlaştırdıkça yer açılır ve gizlenen etiketler görünür. Seçili öğenin etiketleri her zaman çizilir.
interface Lbl { t: string; x: number; y: number; color: string; prio: number; owner?: string; align: CanvasTextAlign }
/** [x0, y0, x1, y1, sahip öğe] — aynı öğenin etiketleri/simgesi birbirini engellemez */
type Box = [number, number, number, number, string?]
let queue: Lbl[] = []
const widthCache = new Map<string, number>()
// Pompa basma yüksekliği en kritik bilgi: düğüm adlarından önce yerleşir
const PRIO = { selected: 0, pump: 1, name: 2, pressure: 2, flow: 3, pipe: 4 } as const

function label(t: string, x: number, y: number, color: string, _zoom: number, prio: number = PRIO.flow, owner?: string, align: 'center' | 'left' | 'right' = 'center') {
  queue.push({ t, x, y, color, prio, owner, align })
}
function flushLabels(zoom: number, obstacles: Box[], view: [number, number, number, number]) {
  const c = ctx!
  const fs = 11 / Math.max(zoom, 0.7)
  const font = `${fs}px ui-sans-serif, system-ui, sans-serif`
  c.font = font; c.textAlign = 'center'; c.textBaseline = 'middle'
  if (widthCache.size > 5000) widthCache.clear()
  // Basit ızgara tabanlı çakışma kontrolü
  const cell = Math.max(fs * 8, 1)
  const buckets = new Map<string, Box[]>()
  const keys = (b: Box) => {
    const out: string[] = []
    for (let i = Math.floor(b[0] / cell); i <= Math.floor(b[2] / cell); i++)
      for (let j = Math.floor(b[1] / cell); j <= Math.floor(b[3] / cell); j++) out.push(`${i},${j}`)
    return out
  }
  const hits = (b: Box) => keys(b).some((k) => buckets.get(k)?.some((o) => (b[4] === undefined || o[4] !== b[4]) && b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]))
  const place = (b: Box) => { for (const k of keys(b)) (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(b) }
  for (const o of obstacles) place(o)

  queue.sort((a, b) => a.prio - b.prio)
  const padX = 2 / zoom, padY = 1 / zoom
  for (const l of queue) {
    const key = `${fs}|${l.t}`
    let tw = widthCache.get(key)
    if (tw === undefined) { tw = c.measureText(l.t).width; widthCache.set(key, tw) }
    const left = l.align === 'left' ? l.x : l.align === 'right' ? l.x - tw : l.x - tw / 2
    const b: Box = [left - padX, l.y - fs * 0.6 - padY, left + tw + padX, l.y + fs * 0.6 + padY, l.owner]
    if (b[2] < view[0] || b[0] > view[2] || b[3] < view[1] || b[1] > view[3]) continue
    if (l.prio > PRIO.selected && hits(b)) continue
    place(b)
    // Zemin: altından geçen boru çizgisi yazıyı bozmasın
    c.fillStyle = COL.halo
    c.fillRect(b[0], b[1], b[2] - b[0], b[3] - b[1])
    c.textAlign = l.align
    c.fillStyle = l.color; c.fillText(l.t, l.x, l.y)
  }
  queue = []
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
watch(() => sim.tool, () => { pipeStart.value = null; sim.planMode = null })
watch(() => sim.planMode, () => { calib.value = [] })
watch([() => sim.showLabels, () => sim.nodes, () => sim.pipes, () => sim.view, () => sim.selected, () => sim.result, () => sim.background, () => sim.planMode, mouse, pipeStart, calib], schedule, { deep: true })

const cursor = computed(() => (sim.planMode === 'move' ? (sim.background?.locked ? 'not-allowed' : 'move') : sim.planMode === 'calibrate' || sim.tool !== 'select' ? (sim.tool === 'delete' && !sim.planMode ? 'not-allowed' : 'crosshair') : 'default'))
</script>

<template>
  <div ref="wrap" class="relative h-full w-full overflow-hidden">
    <canvas
      ref="canvas"
      :style="{ cursor, touchAction: 'none' }"
      @pointerdown="onDown" @pointermove="onMove" @pointerup="onUp" @pointerleave="mouse = null"
      @wheel="onWheel" @dblclick="onDbl" @contextmenu.prevent
    />
    <div class="pointer-events-none absolute inset-x-2 bottom-2 flex flex-wrap items-end justify-between gap-2 text-xs">
      <div class="min-w-0 max-w-full rounded bg-white/90 px-2 py-1 text-slate-600">
        <span v-if="sim.planMode === 'move'"><b>Planı taşı</b> · sürükleyin · Esc: bitir</span>
        <span v-else-if="sim.planMode === 'calibrate'"><b>Planı ölçekle</b> · ölçüsünü bildiğiniz iki noktaya tıklayın ({{ calib.length }}/2) · Esc: vazgeç</span>
        <span v-else-if="sim.tool === 'pipe' || sim.tool === 'pump'">{{ sim.tool === 'pump' ? 'Pompa: emme düğümünden basma düğümüne tıklayın (yön önemli)' : 'Boru: düğümlere tıklayın' }} · Esc ile bitir</span>
        <span v-else-if="sim.tool !== 'select'"><b>{{ TOOLS.find((t) => t.id === sim.tool)?.label }}</b> · tuvale tıklayın · Esc: Seç aracına dön</span>
        <span v-else>Çift tık: aç-kapat · Tekerlek: yakınlaştır · Sağ tuş: kaydır · Del: sil · 1–8: araçlar · Ctrl+Z / Ctrl+Y: geri al / yinele</span>
      </div>
      <div class="flex shrink-0 gap-3 rounded bg-white/90 px-2 py-1">
        <span style="color:#2FBF71">● &lt; 4 m/s</span><span style="color:#F2A33A">● 4–6 m/s</span><span style="color:#FF5A36">● &gt; 6 m/s</span><span style="color:#64748B">● akış yok</span>
      </div>
    </div>
  </div>
</template>
