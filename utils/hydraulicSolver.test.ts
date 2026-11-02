// Çalıştır: npx tsx utils/hydraulicSolver.test.ts
import { solveNetwork, PX_PER_M as m, frictionLoss, INNER_D, BAR_PER_M, pumpGain, DEFAULT_PUMP, supplyPressure } from './hydraulicSolver'
import type { HNode, HPipe } from '../types/hydraulic'
import { evaluateDesign, autoDesignArea, requiredSourcePressure, applyHazard, defaultDesign } from './nfpa'

let fail = 0
const check = (name: string, got: number, exp: number, tol = 1e-3) => {
  const ok = Math.abs(got - exp) <= tol
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}: ${got.toFixed(5)} (beklenen ${exp.toFixed(5)})`)
  if (!ok) fail++
}

// 1) Düz hat, kot yok
{
  const nodes: HNode[] = [
    { id: 'S', type: 'source', x: 0, y: 0, pressure: 6 },
    { id: 'J', type: 'joint', x: 20 * m, y: 0 },
    { id: 'A', type: 'sprinkler', x: 40 * m, y: 0, k: 80 }
  ]
  const pipes: HPipe[] = [
    { id: 'p1', from: 'S', to: 'J', dn: 100, c: 120 },
    { id: 'p2', from: 'J', to: 'A', dn: 80, c: 120 }
  ]
  const r = solveNetwork(nodes, pipes)
  const q = r.nodes.A.flow
  const loss = frictionLoss(q, 120, INNER_D[100], 20) + frictionLoss(q, 120, INNER_D[80], 20)
  check('düz hat basınç', r.nodes.A.pressure, 6 - loss)
}

// 2) Kot: sprinkler 10 m yukarıda → 10 m statik basınç kaybı + 3B boru boyu
{
  const nodes: HNode[] = [
    { id: 'S', type: 'source', x: 0, y: 0, z: 0, pressure: 6 },
    { id: 'A', type: 'sprinkler', x: 20 * m, y: 0, z: 10, k: 80 }
  ]
  const pipes: HPipe[] = [{ id: 'p1', from: 'S', to: 'A', dn: 80, c: 120 }]
  const r = solveNetwork(nodes, pipes)
  const L = Math.hypot(20, 10)
  const exp = 6 - frictionLoss(r.nodes.A.flow, 120, INNER_D[80], L) - 10 * BAR_PER_M
  check('kot: basınç', r.nodes.A.pressure, exp)
  const flat = solveNetwork([{ ...nodes[0] }, { ...nodes[1], z: 0 }], pipes)
  check('kot: yukarıdaki sprinkler daha az debi', Number(r.nodes.A.flow < flat.nodes.A.flow), 1, 0)
}

// 3) Pompa: depo (0 bar, z=0) → pompa → boru → sprinkler (z=5)
{
  const nodes: HNode[] = [
    { id: 'S', type: 'source', x: 0, y: 0, z: 0, pressure: 0 },
    { id: 'M', type: 'joint', x: 2 * m, y: 0, z: 0 },
    { id: 'A', type: 'sprinkler', x: 12 * m, y: 0, z: 5, k: 80 }
  ]
  const pipes: HPipe[] = [
    { id: 'pump', from: 'S', to: 'M', dn: 100, c: 120, kind: 'pump', pump: { ...DEFAULT_PUMP } },
    { id: 'p2', from: 'M', to: 'A', dn: 80, c: 120 }
  ]
  const r = solveNetwork(nodes, pipes)
  const q = r.pipes.pump.flow
  const L = Math.hypot(10, 5)
  const pA = pumpGain(DEFAULT_PUMP, q) - frictionLoss(q, 120, INNER_D[80], L) - 5 * BAR_PER_M
  check('pompa: yakınsadı', Number(r.converged), 1, 0)
  check('pompa: sprinkler basıncı (eğri ile tutarlı)', r.nodes.A.pressure, pA)
  check('pompa: q = K√P', r.nodes.A.flow, 80 * Math.sqrt(r.nodes.A.pressure), 0.05)
  check('pompa: debi = sprinkler debisi', q, r.nodes.A.flow, 0.05)
}

// 4) Çek valf: pompa ters yönde besleniyor → akış yok
{
  const nodes: HNode[] = [
    { id: 'S', type: 'source', x: 0, y: 0, pressure: 3 },
    { id: 'A', type: 'sprinkler', x: 5 * m, y: 0, k: 80 }
  ]
  const pipes: HPipe[] = [{ id: 'pump', from: 'A', to: 'S', dn: 100, c: 120, kind: 'pump', pump: { ...DEFAULT_PUMP } }]
  const r = solveNetwork(nodes, pipes)
  console.log('ters pompa:', r.converged, r.warnings)
}
// 5) Kapalı sprinkler debi vermez, açık olan alır
{
  const nodes: HNode[] = [
    { id: 'S', type: 'source', x: 0, y: 0, pressure: 5 },
    { id: 'A', type: 'sprinkler', x: 5 * m, y: 0, k: 80, open: false },
    { id: 'B', type: 'sprinkler', x: 5 * m, y: 5 * m, k: 80 }
  ]
  const pipes: HPipe[] = [{ id: 'p1', from: 'S', to: 'A', dn: 80, c: 120 }, { id: 'p2', from: 'A', to: 'B', dn: 80, c: 120 }]
  const r = solveNetwork(nodes, pipes)
  check('kapalı sprinkler debisi', r.nodes.A.flow, 0, 1e-9)
  check('açık sprinkler debisi > 0', Number(r.nodes.B.flow > 100), 1, 0)
}
// 6) 3 noktalı pompa eğrisi: eğri üç noktadan geçer ve ağ çözümü tutarlı
{
  const pc = { qd: 1900, hd: 7, h0: 9.1, q2: 2850, h2: 4.9 }
  check('3 nokta: Q=0', pumpGain(pc, 0), 9.1, 1e-9)
  check('3 nokta: tasarım', pumpGain(pc, 1900), 7, 1e-9)
  check('3 nokta: %150', pumpGain(pc, 2850), 4.9, 1e-9)
  const nodes: HNode[] = [
    { id: 'S', type: 'source', x: 0, y: 0, pressure: 0 },
    { id: 'A', type: 'sprinkler', x: 4 * m, y: 0, k: 80 }
  ]
  const pipes: HPipe[] = [{ id: 'pump', from: 'S', to: 'A', dn: 100, c: 120, kind: 'pump', pump: pc }]
  const r = solveNetwork(nodes, pipes)
  check('3 nokta: sprinkler basıncı = pompa basıncı', r.nodes.A.pressure, pumpGain(pc, r.pipes.pump.flow), 1e-3)
}

// 7) NFPA 13 yoğunluk/alan
{
  const mk = (): HNode[] => [
    { id: 'S', type: 'source', x: 0, y: 0, pressure: 5 },
    { id: 'A', name: 'A', type: 'sprinkler', x: 10 * m, y: 0, k: 80 },
    { id: 'B', name: 'B', type: 'sprinkler', x: 20 * m, y: 0, k: 80 },
    { id: 'C', name: 'C', type: 'sprinkler', x: 30 * m, y: 0, k: 80, open: false }
  ]
  const pipes: HPipe[] = [
    { id: 'p1', from: 'S', to: 'A', dn: 100, c: 120 }, { id: 'p2', from: 'A', to: 'B', dn: 100, c: 120 }, { id: 'p3', from: 'B', to: 'C', dn: 100, c: 120 }
  ]
  const d = defaultDesign(); applyHazard(d, 'custom'); d.density = 6.1; d.area = 24; d.coverage = 12; d.hose = 0
  const nodes = mk(); const r = solveNetwork(nodes, pipes)
  const ev = evaluateDesign(nodes, r, d)
  check('nfpa: açık alan', ev.openArea, 24, 1e-9)
  check('nfpa: yoğunluk sağlandı', Number(ev.densityOk && ev.areaOk), 1, 0)
  d.density = 30
  check('nfpa: aşırı yoğunluk gereksinimi başarısız', Number(evaluateDesign(nodes, r, d).densityOk), 0, 0)
  d.density = 6.1; d.area = 36
  check('nfpa: alan yetersiz', Number(evaluateDesign(nodes, r, d).areaOk), 0, 0)
  d.area = 24
  const ids = autoDesignArea(mk(), pipes, d)
  check('nfpa: uzak alan en uzak sprinklerden başlar (C,B)', Number(ids[0] === 'C' && ids[1] === 'B' && ids.length === 2), 1, 0)
  // talep noktası: 12 m² × 6,1 = 73,2 L/dk → (73,2/80)² ≈ 0,837 bar + kayıp
  const one: HNode[] = [{ id: 'S', type: 'source', x: 0, y: 0, pressure: 5 }, { id: 'A', type: 'sprinkler', x: 5 * m, y: 0, k: 80 }]
  d.area = 12
  const dpt = requiredSourcePressure(one, [{ id: 'p', from: 'S', to: 'A', dn: 100, c: 120 }], d)
  check('nfpa: gereken kaynak basıncı', dpt.required ?? -1, (73.2 / 80) ** 2, 0.02)
}
// 8) Şebeke test eğrisi: P(Q) = Ps − (Ps−Pr)(Q/Qt)^1.85
{
  const nodes: HNode[] = [
    { id: 'S', type: 'source', x: 0, y: 0, pressure: 6, supply: { flow: 1900, residual: 4 } },
    { id: 'A', type: 'sprinkler', x: 5 * m, y: 0, k: 400 }
  ]
  const pipes: HPipe[] = [{ id: 'p', from: 'S', to: 'A', dn: 150, c: 120 }]
  const r = solveNetwork(nodes, pipes)
  const q = r.nodes.S.flow
  check('şebeke: kaynak basıncı eğriye uyar', r.nodes.S.pressure, supplyPressure(nodes[0], q), 1e-3)
  check('şebeke: kaynak debisi = sprinkler debisi', q, r.nodes.A.flow, 0.05)
  check('şebeke: yük altında basınç statikten düşük', Number(r.nodes.S.pressure < 6), 1, 0)
  // Q = test debisinde artık basınç = 4 bar
  check('şebeke: test noktası', supplyPressure(nodes[0], 1900), 4, 1e-9)
  const d = defaultDesign(); applyHazard(d, 'custom'); d.density = 6.1; d.coverage = 12; d.area = 12
  const dpt = requiredSourcePressure([nodes[0], { ...nodes[1], k: 80 }], pipes, d)
  check('şebeke: talep noktasında mevcut < statik', Number((dpt.available ?? 99) < 6 && dpt.flow! > 0), 1, 0)
}
if (fail) { console.error(`${fail} test başarısız`); process.exit(1) }
console.log('Tüm testler geçti')
