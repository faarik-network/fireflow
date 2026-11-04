import { defineStore } from 'pinia'
import type { HNode, HPipe, Tool, DN, CFactor, GridData, SolveResult, NodeType, DesignSettings, PlanBackground } from '~/types/hydraulic'
import { defaultDesign, evaluateDesign, autoDesignArea } from '~/utils/nfpa'
import { DEFAULT_PUMP } from '~/utils/hydraulicSolver'

const uid = () => crypto.randomUUID()

/** Araç çubuğu sırası; 1–8 klavye kısayolları bu sırayı izler */
export const TOOLS: { id: Tool; label: string; icon: string }[] = [
  { id: 'select', label: 'Seç / Taşı', icon: 'lucide:mouse-pointer-2' },
  { id: 'pipe', label: 'Boru çiz', icon: 'lucide:git-commit-horizontal' },
  { id: 'source', label: 'Su kaynağı / Depo', icon: 'lucide:droplets' },
  { id: 'pump', label: 'Pompa', icon: 'lucide:fan' },
  { id: 'joint', label: 'Bağlantı düğümü', icon: 'lucide:circle-dot' },
  { id: 'sprinkler', label: 'Sprinkler', icon: 'lucide:sprout' },
  { id: 'hydrant', label: 'Hidrant', icon: 'lucide:flame' },
  { id: 'delete', label: 'Sil', icon: 'lucide:eraser' }
]
const HISTORY_MAX = 100
export const GRID = 20
const PREFIX: Record<NodeType, string> = { source: 'K', joint: 'B', sprinkler: 'S', hydrant: 'H' }
function nextName(prefix: string, names: (string | undefined)[]) {
  let m = 0
  for (const n of names) {
    const v = n && n.startsWith(prefix) ? Number(n.slice(prefix.length)) : NaN
    if (Number.isFinite(v)) m = Math.max(m, v)
  }
  return `${prefix}${m + 1}`
}

export const useSimulator = defineStore('simulator', () => {
  const nodes = ref<HNode[]>([])
  const pipes = ref<HPipe[]>([])
  const tool = ref<Tool>('select')
  const selected = ref<{ kind: 'node' | 'pipe'; id: string } | null>(null)
  const snap = ref(true)
  const view = ref({ zoom: 1, panX: 0, panY: 0 })
  const defaults = ref<{ dn: DN; c: CFactor; z: number }>({ dn: 100, c: 120, z: 0 })
  const fitRequest = ref(0)
  const showLabels = ref(true)
  /** Başkasının projesini (yetkisiz) açınca true: düzenleme ve kaydetme kapalı */
  const readOnly = ref(false)
  const design = ref<DesignSettings>(defaultDesign())
  const background = ref<PlanBackground | null>(null)
  /** Plan üzerinde etkileşim: taşı veya iki noktayla ölçekle (kaydedilmez) */
  const planMode = ref<'move' | 'calibrate' | null>(null)

  const result = computed<SolveResult>(() => solveNetwork(nodes.value, pipes.value))
  // ---------- Geri al / yinele (model: düğüm, boru, tasarım, plan yerleşimi; görünüm hariç) ----------
  const past: string[] = []
  const future: string[] = []
  let present = ''
  let applying = false
  let histTimer: ReturnType<typeof setTimeout> | undefined
  const canUndo = ref(false)
  const canRedo = ref(false)
  const snapshot = () => JSON.stringify({ nodes: nodes.value, pipes: pipes.value, design: design.value, background: background.value })
  const syncHist = () => { canUndo.value = past.length > 0; canRedo.value = future.length > 0 }
  /** Arka arkaya gelen küçük değişiklikleri (ör. sürükleme) tek adımda topla */
  function commitHistory() {
    clearTimeout(histTimer)
    const s = snapshot()
    if (s === present) return
    past.push(present)
    if (past.length > HISTORY_MAX) past.shift()
    present = s
    future.length = 0
    syncHist()
  }
  /** Geçmişe yazmadan modeli değiştir (yükleme, geri alma) */
  function silently(fn: () => void) {
    applying = true
    fn()
    nextTick(() => { applying = false })
  }
  function resetHistory() {
    clearTimeout(histTimer)
    past.length = 0; future.length = 0
    present = snapshot()
    syncHist()
  }
  function applySnapshot(s: string) {
    const d = JSON.parse(s) as { nodes: HNode[]; pipes: HPipe[]; design: DesignSettings; background: PlanBackground | null }
    silently(() => { nodes.value = d.nodes; pipes.value = d.pipes; design.value = d.design; background.value = d.background })
    present = s
    const sel = selected.value
    if (sel && !(sel.kind === 'node' ? nodes.value : pipes.value).some((x) => x.id === sel.id)) selected.value = null
    syncHist()
  }
  function undo() {
    if (readOnly.value) return
    commitHistory()
    const s = past.pop()
    if (s === undefined) return
    future.push(present)
    applySnapshot(s)
  }
  function redo() {
    if (readOnly.value) return
    commitHistory()
    const s = future.pop()
    if (s === undefined) return
    past.push(present)
    applySnapshot(s)
  }
  watch([nodes, pipes, design, background], () => {
    if (applying) return
    clearTimeout(histTimer)
    histTimer = setTimeout(commitHistory, 300)
  }, { deep: true })

  const designEval = computed(() => (design.value.hazard === 'off' ? null : evaluateDesign(nodes.value, result.value, design.value)))

  const snapPt = (x: number, y: number) =>
    snap.value ? { x: Math.round(x / GRID) * GRID, y: Math.round(y / GRID) * GRID } : { x, y }

  function addNode(type: NodeType, x: number, y: number): HNode {
    const p = snapPt(x, y)
    const n: HNode = { id: uid(), name: nextName(PREFIX[type], nodes.value.map((x) => x.name)), type, x: p.x, y: p.y, z: defaults.value.z }
    if (type === 'source') n.pressure = 6
    if (type === 'sprinkler') n.k = 80
    if (type === 'hydrant') n.demand = 950
    nodes.value.push(n)
    return n
  }

  function addPipe(from: string, to: string, kind: 'pipe' | 'pump' = 'pipe'): HPipe | null {
    if (from === to) return null
    if (pipes.value.some((p) => (p.from === from && p.to === to) || (p.from === to && p.to === from))) return null
    const p: HPipe = { id: uid(), name: nextName(kind === 'pump' ? 'PM' : 'P', pipes.value.map((x) => x.name)), from, to, dn: defaults.value.dn, c: defaults.value.c }
    if (kind === 'pump') { p.kind = 'pump'; p.pump = { ...DEFAULT_PUMP } }
    pipes.value.push(p)
    return p
  }

  function removeNode(id: string) {
    if (readOnly.value) return
    nodes.value = nodes.value.filter((n) => n.id !== id)
    pipes.value = pipes.value.filter((p) => p.from !== id && p.to !== id)
    if (selected.value?.id === id) selected.value = null
  }
  function removePipe(id: string) {
    if (readOnly.value) return
    pipes.value = pipes.value.filter((p) => p.id !== id)
    if (selected.value?.id === id) selected.value = null
  }
  function clear() {
    if (readOnly.value) return
    nodes.value = []
    pipes.value = []
    selected.value = null
  }
  function fitView() { fitRequest.value++ }

  /** İki dünya noktası arası gerçek mesafe `meters` olacak şekilde planı ölçekle; a noktası yerinde kalır */
  function calibratePlan(a: { x: number; y: number }, b: { x: number; y: number }, meters: number) {
    const bg = background.value
    const d = Math.hypot(b.x - a.x, b.y - a.y)
    if (!bg || readOnly.value || !(meters > 0) || d < 1e-6) return
    const f = (meters * GRID) / d
    bg.scale *= f
    bg.x = a.x + (bg.x - a.x) * f
    bg.y = a.y + (bg.y - a.y) * f
    bg.calibrated = true
  }
  /** Adı olmayan (eski) öğelere otomatik ad ver */
  function ensureNames() {
    for (const n of nodes.value) if (!n.name) n.name = nextName(PREFIX[n.type], nodes.value.map((x) => x.name))
    for (const p of pipes.value) if (!p.name) p.name = nextName(p.kind === 'pump' ? 'PM' : 'P', pipes.value.map((x) => x.name))
  }

  /** 3×3 ızgaralı örnek ağ: pompa, ana hat, 3 açık sprinkler, kapalı sprinkler ve hidrant */
  function loadExample() {
    if (readOnly.value) return
    const M = 20
    const N = (type: NodeType, mx: number, my: number, extra: Partial<HNode> = {}): HNode => ({ id: uid(), type, x: mx * M, y: my * M, z: 0, ...extra })
    const P = N('source', 3, 15, { pressure: 5 })
    const B = [10, 20, 30].map((x) => N('joint', x, 15))
    const U = [10, 20, 30].map((x) => N('joint', x, 10))
    const top = [10, 20, 30].map((x, i) => N('sprinkler', x, 5, { k: 80, open: i === 2 }))
    const bot = [10, 20, 30].map((x, i) => N('sprinkler', x, 20, { k: 80, open: i > 0 }))
    const H = N('hydrant', 36, 15, { demand: 950, open: false })
    const all = [P, ...B, ...U, ...bot, ...top, H]
    const L = (a: HNode, b: HNode, dn: DN): HPipe => ({ id: uid(), from: a.id, to: b.id, dn, c: 120 })
    nodes.value = all
    pipes.value = [
      L(P, B[0], 100), L(B[0], B[1], 100), L(B[1], B[2], 100), L(B[2], H, 65),
      ...[0, 1, 2].flatMap((i) => [L(B[i], U[i], 80), L(U[i], top[i], 50), L(B[i], bot[i], 50)]),
      L(U[0], U[1], 80), L(U[1], U[2], 80)
    ]
    ensureNames()
    design.value = { hazard: 'custom', density: 6.1, area: 36, coverage: 12, hose: 0 }
    selected.value = null
    tool.value = 'select'
    fitView()
  }

  /** Önerilen uzak alanı aç, diğer sprinklerleri kapat */
  function openDesignArea() {
    if (readOnly.value) return 0
    const ids = new Set(autoDesignArea(nodes.value, pipes.value, design.value))
    for (const n of nodes.value) if (n.type === 'sprinkler') n.open = ids.has(n.id)
    return ids.size
  }

  const selectedNode = computed(() => (selected.value?.kind === 'node' ? nodes.value.find((n) => n.id === selected.value!.id) : undefined))
  const selectedPipe = computed(() => (selected.value?.kind === 'pipe' ? pipes.value.find((p) => p.id === selected.value!.id) : undefined))

  const serialized = computed<GridData>(() => ({
    version: 1,
    nodes: nodes.value,
    pipes: pipes.value,
    view: view.value,
    design: design.value,
    ...(background.value ? { background: background.value } : {})
  }))

  /** keepView: canlı güncellemede görünüm ve (hâlâ varsa) seçim korunur */
  function load(data: Partial<GridData> | null | undefined, opts: { keepView?: boolean } = {}) {
    const prevSel = selected.value
    silently(() => {
      nodes.value = data?.nodes ?? []
      pipes.value = data?.pipes ?? []
      if (!opts.keepView) view.value = data?.view ?? { zoom: 1, panX: 0, panY: 0 }
      ensureNames()
      design.value = data?.design ? { ...defaultDesign(), ...data.design } : defaultDesign()
      background.value = data?.background ?? null
    })
    planMode.value = null
    resetHistory()
    tool.value = 'select'
    if (opts.keepView) {
      if (prevSel && !(prevSel.kind === 'node' ? nodes.value : pipes.value).some((x) => x.id === prevSel.id)) selected.value = null
      return
    }
    selected.value = null
    if (nodes.value.length) fitView()
  }

  return {
    nodes, pipes, tool, selected, snap, view, defaults, fitRequest, showLabels, readOnly, design, designEval, openDesignArea, result, background, planMode, calibratePlan,
    selectedNode, selectedPipe, serialized,
    snapPt, addNode, addPipe, removeNode, removePipe, clear, fitView, load, loadExample,
    canUndo, canRedo, undo, redo
  }
})
