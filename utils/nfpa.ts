import type { HNode, HPipe, SolveResult, DesignSettings, HazardClass } from '~/types/hydraulic'
import { solveNetwork, supplyPressure, PX_PER_M, MIN_SPRINKLER_BAR } from './hydraulicSolver'

/**
 * NFPA 13 yoğunluk/alan eğrilerinden sık kullanılan tasarım noktaları (SI'ya çevrilmiş) ve hortum payları.
 * Yaklaşık başlangıç değerleridir; geçerli baskıdan doğrulanmalıdır. “Özel” ile değiştirilebilir.
 */
export const HAZARDS: Record<Exclude<HazardClass, 'off' | 'custom'>, { label: string; density: number; area: number; coverage: number; hose: number }> = {
  light: { label: 'Hafif tehlike', density: 4.1, area: 139, coverage: 20, hose: 379 },
  oh1: { label: 'Orta tehlike – Grup 1', density: 6.1, area: 139, coverage: 12, hose: 946 },
  oh2: { label: 'Orta tehlike – Grup 2', density: 8.1, area: 139, coverage: 12, hose: 946 },
  eh1: { label: 'Çok tehlikeli – Grup 1', density: 12.2, area: 232, coverage: 9, hose: 1893 },
  eh2: { label: 'Çok tehlikeli – Grup 2', density: 16.3, area: 232, coverage: 9, hose: 1893 }
}

export function defaultDesign(): DesignSettings {
  const h = HAZARDS.oh1
  return { hazard: 'oh1', density: h.density, area: h.area, coverage: h.coverage, hose: h.hose }
}
export function applyHazard(d: DesignSettings, k: HazardClass) {
  d.hazard = k
  if (k !== 'off' && k !== 'custom') {
    const h = HAZARDS[k]
    d.density = h.density; d.area = h.area; d.coverage = h.coverage; d.hose = h.hose
  }
}

export interface DesignEval {
  openCount: number
  openArea: number
  areaOk: boolean
  minDensity: number | null
  densityOk: boolean
  failing: string[] // yoğunluğu sağlamayan sprinkler adları
  sprinklerFlow: number
  hydrantFlow: number
  hoseExtra: number // hortum payından, açık hidrantların karşılamadığı kısım
  totalDemand: number
}

const nm = (x: { id: string; name?: string }) => x.name ?? x.id.slice(0, 4)

export function evaluateDesign(nodes: HNode[], res: SolveResult, d: DesignSettings): DesignEval {
  let openArea = 0, sprinklerFlow = 0, hydrantFlow = 0, openCount = 0
  let minDensity: number | null = null
  const failing: string[] = []
  for (const n of nodes) {
    const r = res.nodes[n.id]
    if (!r?.reachable || n.open === false) continue
    if (n.type === 'hydrant') hydrantFlow += r.flow
    if (n.type !== 'sprinkler') continue
    const a = n.area ?? d.coverage
    const dens = r.flow / a
    openCount++; openArea += a; sprinklerFlow += r.flow
    minDensity = minDensity === null ? dens : Math.min(minDensity, dens)
    if (dens < d.density - 1e-9) failing.push(nm(n))
  }
  const hoseExtra = Math.max(0, d.hose - hydrantFlow)
  return {
    openCount, openArea, areaOk: openArea >= d.area * 0.999,
    minDensity, densityOk: openCount > 0 && failing.length === 0, failing,
    sprinklerFlow, hydrantFlow, hoseExtra, totalDemand: sprinklerFlow + hydrantFlow + hoseExtra
  }
}

/**
 * Yaklaşık uzak alan seçimi: kaynağa boru boyu olarak en uzak sprinkleri bul, ona en yakın komşularla
 * tasarım alanı dolana kadar genişlet. Yalnızca başlangıç önerisidir; hidrolik olarak en elverişsiz alanı
 * doğrulamak tasarımcının sorumluluğundadır.
 */
export function autoDesignArea(nodes: HNode[], pipes: HPipe[], d: DesignSettings): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const edges = pipes.filter((p) => byId.has(p.from) && byId.has(p.to)).map((p) => {
    const a = byId.get(p.from)!, b = byId.get(p.to)!
    const plan = Math.hypot(a.x - b.x, a.y - b.y) / PX_PER_M
    return { a: p.from, b: p.to, w: Math.hypot(plan, (a.z ?? 0) - (b.z ?? 0)), pump: p.kind === 'pump' }
  })
  const dist = new Map<string, number>()
  nodes.filter((n) => n.type === 'source').forEach((n) => dist.set(n.id, 0))
  const done = new Set<string>()
  for (;;) {
    let cur = '', best = Infinity
    for (const [id, dv] of dist) if (!done.has(id) && dv < best) { best = dv; cur = id }
    if (!cur) break
    done.add(cur)
    for (const e of edges) {
      let o = ''
      if (e.a === cur) o = e.b
      else if (e.b === cur && !e.pump) o = e.a
      else continue
      const nd = best + e.w
      if (nd < (dist.get(o) ?? Infinity)) dist.set(o, nd)
    }
  }
  const sp = nodes.filter((n) => n.type === 'sprinkler' && dist.has(n.id))
  if (!sp.length) return []
  const far = sp.reduce((m, n) => (dist.get(n.id)! > dist.get(m.id)! ? n : m))
  const sorted = [...sp].sort((p, q) => Math.hypot(p.x - far.x, p.y - far.y) - Math.hypot(q.x - far.x, q.y - far.y))
  const ids: string[] = []
  let area = 0
  for (const n of sorted) {
    if (area >= d.area) break
    ids.push(n.id); area += n.area ?? d.coverage
  }
  return ids
}

export interface DemandPoint { required: number | null; available: number | null; flow?: number; note?: string }

/** Pompasız sistemde yoğunluk (ve min. 0,5 bar) için gereken en düşük kaynak basıncı (ikiye bölme). */
export function requiredSourcePressure(nodes: HNode[], pipes: HPipe[], d: DesignSettings): DemandPoint {
  const sources = nodes.filter((n) => n.type === 'source')
  if (!sources.length) return { required: null, available: null, note: 'Su kaynağı yok.' }
  if (pipes.some((p) => p.kind === 'pump'))
    return { required: null, available: null, note: 'Pompalı sistemde çözüm zaten pompa eğrisi üzerindeki çalışma noktasıdır; sonuçlar talep noktasını gösterir.' }
  const available = Math.max(...sources.map((s) => s.pressure ?? 0))
  if (!nodes.some((n) => n.type === 'sprinkler' && n.open !== false)) return { required: null, available, note: 'Açık sprinkler yok.' }

  const ok = (P: number) => {
    const ns = nodes.map((n) => (n.type === 'source' ? { ...n, pressure: P, supply: undefined } : n))
    const r = solveNetwork(ns, pipes)
    if (!evaluateDesign(ns, r, d).densityOk) return false
    return ns.every((n) => !(n.type === 'sprinkler' && n.open !== false && r.nodes[n.id]?.reachable) || r.nodes[n.id].pressure >= MIN_SPRINKLER_BAR)
  }
  let hi = Math.max(60, available * 2)
  if (!ok(hi)) return { required: null, available, note: 'Bu boru çaplarıyla yoğunluk hiçbir kaynak basıncında sağlanamıyor; çapları büyütün.' }
  if (ok(0)) return { required: 0, available }
  let lo = 0
  for (let i = 0; i < 26; i++) { const mid = (lo + hi) / 2; ok(mid) ? (hi = mid) : (lo = mid) }
  // Şebeke test eğrisi varsa, talep debisinde kaynağın gerçekten verebildiği basıncı karşılaştır
  const sup = sources.find((s) => s.supply)
  if (sup) {
    const ns = nodes.map((n) => (n.type === 'source' ? { ...n, pressure: hi, supply: undefined } : n))
    const q = solveNetwork(ns, pipes).totalFlow
    return { required: hi, available: supplyPressure(sup, q), flow: q }
  }
  return { required: hi, available }
}
