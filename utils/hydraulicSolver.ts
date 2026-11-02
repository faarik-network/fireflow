import type { HNode, HPipe, SolveResult, DN, VelocityStatus, PumpCurve } from '~/types/hydraulic'

/** Piksel → metre (grid 20 px = 1 m) */
export const PX_PER_M = 20
/** Nominal çap → iç çap (mm), Sch40 çelik */
export const INNER_D: Record<DN, number> = {
  15: 15.8, // 1/2"  (Tekli sprinkler drop ve test hatları)
  20: 20.9, // 3/4"  (Sprinkler bağlantı kolları)
  25: 26.6, // 1"    (En kritik dallanma ve arm-over çapı)
  32: 35.1, // 1-1/4" (Ara dağıtım hatları)
  40: 40.9, // 1-1/2" (Çoklu sprinkler besleme hatları)
  50: 52.5, // 2"    (Sisteminizdeki mevcut DN50)[cite: 5]
  65: 62.7, // 2-1/2" (Sisteminizdeki mevcut DN65)[cite: 4]
  80: 77.9, // 3"    (Sisteminizdeki mevcut DN80)[cite: 4]
  100: 102.3, // 4"   (Sisteminizdeki mevcut DN100)[cite: 4]
  150: 154.1, // 6"   (Sisteminizdeki mevcut DN150)
};
export const MIN_SPRINKLER_BAR = 0.5
/** 1 m su sütunu = 0.0980665 bar */
export const BAR_PER_M = 0.0980665
export const DEFAULT_PUMP: PumpCurve = { qd: 1900, hd: 7, h0: 9.1 }

const EXP = 1.85

/** Metre başına direnç katsayısı: Δp[bar] = R · L · Q^1.85  (Q: L/min, d: mm) */
export function unitResistance(c: number, dMm: number): number {
  return 6.05e5 / (Math.pow(c, EXP) * Math.pow(dMm, 4.87))
}
export function frictionLoss(q: number, c: number, dMm: number, lengthM: number): number {
  return unitResistance(c, dMm) * Math.pow(Math.abs(q), EXP) * lengthM
}
export function velocity(qLpm: number, dMm: number): number {
  return (21.221 * Math.abs(qLpm)) / (dMm * dMm)
}
export function velocityStatus(v: number): VelocityStatus {
  return v > 6 ? 'danger' : v >= 4 ? 'warn' : 'ok'
}

/**
 * Pompa eğrisi H(Q) = h0 − r·Q^n.
 * 2 nokta (kapalı vana + tasarım): n = 2.
 * 3 nokta (+ q2,h2): n eğriyi tasarım ve aşırı yük noktasından geçirir (EPANET yöntemi); geçersizse n = 2.
 */
export function pumpCoef(pc: PumpCurve): { h0: number; r: number; n: number } {
  const qd = Math.max(pc.qd, 1)
  const h0 = Math.max(pc.h0, pc.hd * 1.001)
  let n = 2
  let r = Math.max((h0 - pc.hd) / (qd * qd), 1e-12)
  if (pc.q2 !== undefined && pc.h2 !== undefined && pc.q2 > qd && pc.h2 < pc.hd && pc.h2 >= 0) {
    const nn = Math.log((h0 - pc.h2) / (h0 - pc.hd)) / Math.log(pc.q2 / qd)
    if (Number.isFinite(nn) && nn >= 1 && nn <= 6) { n = nn; r = (h0 - pc.hd) / Math.pow(qd, n) }
  }
  return { h0, r, n }
}
/** Pompanın verdiği basınç artışı (bar) */
export function pumpGain(pc: PumpCurve, q: number): number {
  const { h0, r, n } = pumpCoef(pc)
  return h0 - r * Math.pow(Math.max(q, 0), n)
}

function gauss(A: number[][], b: number[]): number[] | null {
  const n = b.length
  for (let i = 0; i < n; i++) {
    let p = i
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r
    if (Math.abs(A[p][i]) < 1e-14) return null
    ;[A[i], A[p]] = [A[p], A[i]]
    ;[b[i], b[p]] = [b[p], b[i]]
    for (let r = i + 1; r < n; r++) {
      const f = A[r][i] / A[i][i]
      if (f === 0) continue
      for (let c = i; c < n; c++) A[r][c] -= f * A[i][c]
      b[r] -= f * b[i]
    }
  }
  const x = new Array(n).fill(0)
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i]
    for (let c = i + 1; c < n; c++) s -= A[i][c] * x[c]
    x[i] = s / A[i][i]
  }
  return x
}

interface Link {
  p: HPipe
  pump: boolean
  length: number
  d: number
  R: number
  h0: number
  r: number
  n: number
  qd: number
}

/** Bağın "yük düşümü" y(Q) = H_from − H_to  (pompa için negatif: yük kazandırır) */
function linkY(g: Link, q: number): number {
  if (g.pump) return g.r * Math.pow(Math.max(q, 0), g.n) - g.h0
  return g.R * Math.pow(Math.abs(q), EXP - 1) * q
}
function linkDy(g: Link, q: number): number {
  const aq = Math.max(Math.abs(q), 1e-3)
  return g.pump ? g.n * g.r * Math.pow(aq, g.n - 1) : EXP * g.R * Math.pow(aq, EXP - 1)
}

/**
 * Düğüm tabanlı Newton-Raphson çözücü. Bilinmeyen: toplam yük H = P + z·ρg (bar cinsinden).
 * - Kaynak: sabit basınç (kendi kotunda) → H = P + z·ρg
 * - Sprinkler: q = K·√P, P = H − z·ρg   | Hidrant: sabit debi | Joint: 0
 * - Boru: Hazen-Williams, boy = √(plan² + Δz²)
 * - Pompa: from→to yönlü, tek yön (çek valf), H_to − H_from = h0 − r·Q²
 */
function solveCore(nodes: HNode[], pipes: HPipe[], opts: { maxIter: number; tol: number }): SolveResult {
  const warnings: string[] = []
  const result: SolveResult = { converged: false, iterations: 0, totalFlow: 0, nodes: {}, pipes: {}, warnings }

  const byId = new Map(nodes.map((n) => [n.id, n]))
  const z = (n: HNode) => n.z ?? 0
  const sources = nodes.filter((n) => n.type === 'source')

  const geo: Link[] = pipes
    .filter((p) => byId.has(p.from) && byId.has(p.to) && p.from !== p.to)
    .map((p) => {
      const a = byId.get(p.from)!, b = byId.get(p.to)!
      const plan = Math.hypot(a.x - b.x, a.y - b.y) / PX_PER_M
      const length = Math.max(Math.hypot(plan, z(a) - z(b)), 0.01)
      const d = INNER_D[p.dn] ?? 100
      const isPump = p.kind === 'pump'
      const pc = pumpCoef(p.pump ?? DEFAULT_PUMP)
      return { p, pump: isPump, length, d, R: p.fixedR ?? unitResistance(p.c, d) * length, h0: pc.h0, r: pc.r, n: pc.n, qd: p.pump?.qd ?? DEFAULT_PUMP.qd }
    })

  // Kaynaktan erişilebilirlik (BFS)
  const adj = new Map<string, number[]>()
  geo.forEach((g, i) => {
    for (const id of [g.p.from, g.p.to]) {
      if (!adj.has(id)) adj.set(id, [])
      adj.get(id)!.push(i)
    }
  })
  const reach = new Set<string>(sources.map((s) => s.id))
  const queue = [...reach]
  while (queue.length) {
    const id = queue.shift()!
    for (const pi of adj.get(id) ?? []) {
      const g = geo[pi]
      if (g.pump && g.p.from !== id) continue // pompa yalnızca from → to yönünde besler
      const other = g.p.from === id ? g.p.to : g.p.from
      if (!reach.has(other)) { reach.add(other); queue.push(other) }
    }
  }
  if (!sources.length) warnings.push('Ağda su kaynağı yok.')
  else nodes.filter((n) => !reach.has(n.id) && n.type !== 'source')
    .forEach((n) => warnings.push(`Düğüm ${nm(n)} kaynağa bağlı değil.`))

  const free = nodes.filter((n) => reach.has(n.id) && n.type !== 'source')
  const idx = new Map(free.map((n, i) => [n.id, i]))
  const active = geo.map((g, i) => ({ g, i })).filter(({ g }) => reach.has(g.p.from) && reach.has(g.p.to))

  // Toplam yük (bar)
  const H = new Map<string, number>()
  const srcHead = Math.max(0, ...sources.map((s) => (s.pressure ?? 0) + z(s) * BAR_PER_M))
  const pumpBoost = Math.max(0, ...active.filter(({ g }) => g.pump).map(({ g }) => g.h0))
  nodes.forEach((n) =>
    H.set(n.id, n.type === 'source' ? (n.pressure ?? 0) + z(n) * BAR_PER_M : reach.has(n.id) ? srcHead + pumpBoost : 0)
  )

  const Q = new Map<number, number>()
  active.forEach(({ i, g }) => Q.set(i, g.pump ? Math.max(g.qd * 0.5, 10) : 10))

  const press = (n: HNode, head: number) => head - z(n) * BAR_PER_M
  const emitter = (n: HNode, head: number) => {
    if (n.open === false) return { q: 0, dq: 0 }
    if (n.type === 'sprinkler') {
      const k = n.k ?? 80
      const pp = Math.max(press(n, head), 0)
      return { q: k * Math.sqrt(pp), dq: k / (2 * Math.sqrt(Math.max(pp, 1e-3))) }
    }
    if (n.type === 'hydrant') return { q: n.demand ?? 0, dq: 0 }
    return { q: 0, dq: 0 }
  }

  let iter = 0
  let converged = free.length === 0
  while (free.length && iter < opts.maxIter) {
    iter++
    const m = free.length
    const A = Array.from({ length: m }, () => new Array(m).fill(0))
    const b = new Array(m).fill(0)

    for (const { g, i } of active) {
      const q = Q.get(i)!
      const y = linkY(g, q)
      const p = 1 / linkDy(g, q)
      const c = q - p * y
      const fi = idx.get(g.p.from), ti = idx.get(g.p.to)
      if (fi !== undefined) {
        A[fi][fi] += p
        b[fi] -= c
        if (ti !== undefined) A[fi][ti] -= p
        else b[fi] += p * H.get(g.p.to)!
      }
      if (ti !== undefined) {
        A[ti][ti] += p
        b[ti] += c
        if (fi !== undefined) A[ti][fi] -= p
        else b[ti] += p * H.get(g.p.from)!
      }
    }
    free.forEach((n, r) => {
      const h = H.get(n.id)!
      const e = emitter(n, h)
      A[r][r] += e.dq
      b[r] += -e.q + e.dq * h
    })

    const sol = gauss(A, b)
    if (!sol) { warnings.push('Matris tekil: ağ topolojisini kontrol edin.'); break }

    let maxDh = 0
    free.forEach((n, r) => {
      const old = H.get(n.id)!
      const next = old + 0.8 * (sol[r] - old)
      maxDh = Math.max(maxDh, Math.abs(next - old))
      H.set(n.id, next)
    })
    for (const { g, i } of active) {
      const q = Q.get(i)!
      const y = linkY(g, q)
      const p = 1 / linkDy(g, q)
      let nq = q + p * (H.get(g.p.from)! - H.get(g.p.to)! - y)
      if (g.pump && nq < 1e-3) nq = 1e-3 // çek valf: ters akış yok
      Q.set(i, nq)
    }
    if (maxDh < opts.tol) { converged = true; break }
  }

  // Nihai debileri son yüklerden türet (tutarlılık)
  for (const { g, i } of active) {
    const dh = H.get(g.p.from)! - H.get(g.p.to)!
    let q: number
    if (g.pump) {
      const arg = (dh + g.h0) / g.r
      q = arg > 0 ? Math.pow(arg, 1 / g.n) : 0
    } else q = Math.sign(dh) * Math.pow(Math.abs(dh) / g.R, 1 / EXP)
    Q.set(i, Number.isFinite(q) ? q : 0)
  }

  let total = 0
  for (const n of nodes) {
    const ok = reach.has(n.id)
    const head = ok ? H.get(n.id)! : 0
    const pr = ok ? press(n, head) : 0
    let flow = 0
    if (ok && n.type !== 'source') flow = emitter(n, head).q
    if (n.type === 'sprinkler' && n.open !== false && ok && pr < MIN_SPRINKLER_BAR) {
      warnings.push(`Sprinkler ${nm(n)}: ${pr.toFixed(2)} bar < ${MIN_SPRINKLER_BAR} bar minimum.`)
    }
    if (ok && n.type !== 'source') total += flow
    result.nodes[n.id] = { pressure: pr, flow, reachable: ok }
  }
  sources.forEach((s) => (result.nodes[s.id].flow = total / sources.length))

  geo.forEach((g, i) => {
    const q = Q.get(i) ?? 0
    if (g.pump) {
      const gain = g.h0 - g.r * Math.pow(q, g.n)
      result.pipes[g.p.id] = { kind: 'pump', flow: q, velocity: 0, lossBar: -gain, length: 0, innerD: 0, status: 'ok' }
      if (q > 1.5 * g.qd) warnings.push(`Pompa ${nm(g.p)}: debi tasarımın %150'sini aşıyor (${q.toFixed(0)} L/dk).`)
      if (q <= 1e-2 && active.some((a) => a.i === i)) warnings.push(`Pompa ${nm(g.p)}: akış yok (çek valf kapalı).`)
      return
    }
    if (g.p.fixedR !== undefined) {
      result.pipes[g.p.id] = { kind: 'pipe', flow: q, velocity: 0, lossBar: g.R * Math.pow(Math.abs(q), EXP), length: 0, innerD: 0, status: 'ok' }
      return
    }
    const v = velocity(q, g.d)
    result.pipes[g.p.id] = {
      kind: 'pipe', flow: q, velocity: v, lossBar: frictionLoss(q, g.p.c, g.d, g.length),
      length: g.length, innerD: g.d, status: velocityStatus(v)
    }
    if (v > 6) warnings.push(`Boru ${nm(g.p)}: hız ${v.toFixed(1)} m/s > 6 m/s.`)
  })

  result.totalFlow = total
  result.converged = converged
  result.iterations = iter
  if (!converged && free.length) warnings.push('Çözücü yakınsamadı.')
  return result
}

/**
 * Şebeke test eğrisi olan kaynak: sabit basınçlı (Ps) gizli bir düğüm + R·Q^1.85 kayıplı gizli bağlantı ile
 * modellenir; kaynak düğümü serbest düğüm olur ve artık basıncı çözülür.
 */
export function solveNetwork(nodes: HNode[], pipes: HPipe[], opts = { maxIter: 150, tol: 1e-6 }): SolveResult {
  const valid = (n: HNode) => n.type === 'source' && !!n.supply && n.supply.flow > 0 && n.supply.residual >= 0 && n.supply.residual < (n.pressure ?? 0)
  const sup = nodes.filter(valid)
  if (!sup.length) return solveCore(nodes, pipes, opts)
  const vNodes: HNode[] = [], vPipes: HPipe[] = []
  const base = nodes.map((n) => (valid(n) ? { ...n, type: 'joint' as const } : n))
  for (const s of sup) {
    const ps = s.pressure ?? 0
    const { flow, residual } = s.supply!
    vNodes.push({ id: `${s.id}#sup`, type: 'source', x: s.x, y: s.y, z: s.z, pressure: ps })
    vPipes.push({ id: `${s.id}#lnk`, from: `${s.id}#sup`, to: s.id, dn: 100, c: 120, fixedR: (ps - residual) / Math.pow(flow, EXP) })
  }
  const r = solveCore([...base, ...vNodes], [...pipes, ...vPipes], opts)
  for (const s of sup) {
    const q = Math.abs(r.pipes[`${s.id}#lnk`]?.flow ?? 0)
    if (r.nodes[s.id]) r.nodes[s.id].flow = q
    if (q > s.supply!.flow * 1.0001) r.warnings.push(`Kaynak ${nm(s)}: debi test debisini (${s.supply!.flow.toFixed(0)} L/dk) aşıyor; eğri ekstrapole ediliyor.`)
    delete r.pipes[`${s.id}#lnk`]
    delete r.nodes[`${s.id}#sup`]
  }
  return r
}

/** Kaynağın verdiği basınç (bar) – Q debisinde */
export function supplyPressure(n: HNode, q: number): number {
  const ps = n.pressure ?? 0
  if (!n.supply || !(n.supply.flow > 0) || !(n.supply.residual < ps)) return ps
  return ps - (ps - n.supply.residual) * Math.pow(Math.max(q, 0) / n.supply.flow, EXP)
}

const nm = (x: { id: string; name?: string }) => x.name ?? x.id.slice(0, 4)
