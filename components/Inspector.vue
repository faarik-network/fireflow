<script setup lang="ts">
import { pumpCoef, pumpGain, DEFAULT_PUMP } from '~/utils/hydraulicSolver'
const sim = useSimulator();
const DNS = [15, 20, 25, 32, 40, 50, 65, 80, 100, 150] as const;
const CS = [100, 120, 140] as const
const num = (e: Event) => Number((e.target as HTMLInputElement).value)

const pump = computed(() => (sim.selectedPipe?.kind === 'pump' ? (sim.selectedPipe.pump ??= { ...DEFAULT_PUMP }) : null))
const op = computed(() => (sim.selectedPipe ? sim.result.pipes[sim.selectedPipe.id] : undefined))

// Pompa eğrisi grafiği (SVG)
const W = 270, Ht = 130, M = { l: 34, r: 8, t: 8, b: 22 }
const curve = computed(() => {
  if (!pump.value) return null
  const { h0, r, n } = pumpCoef(pump.value)
  const qmax = Math.pow(h0 / r, 1 / n)
  const sx = (q: number) => M.l + (q / qmax) * (W - M.l - M.r)
  const sy = (h: number) => Ht - M.b - (h / h0) * (Ht - M.t - M.b)
  const pts = Array.from({ length: 31 }, (_, i) => { const q = (qmax * i) / 30; return `${sx(q).toFixed(1)},${sy(pumpGain(pump.value!, q)).toFixed(1)}` })
  const opPt = op.value && op.value.flow > 0 ? { x: sx(op.value.flow), y: sy(pumpGain(pump.value, op.value.flow)) } : null
  return { d: 'M' + pts.join(' L'), qmax, h0, opPt, design: { x: sx(pump.value.qd), y: sy(pump.value.hd) }, sy, sx }
})
const three = computed({
  get: () => pump.value?.q2 !== undefined,
  set: (v: boolean) => {
    if (!pump.value) return
    if (v) { pump.value.q2 = Math.round(pump.value.qd * 1.5); pump.value.h2 = Math.round(pump.value.hd * 0.7 * 100) / 100 }
    else { delete pump.value.q2; delete pump.value.h2 }
  }
})
const supplyOn = computed({
  get: () => !!sim.selectedNode?.supply,
  set: (v: boolean) => {
    const n = sim.selectedNode
    if (!n) return
    if (v) n.supply = { flow: 1900, residual: Math.round((n.pressure ?? 0) * 0.7 * 10) / 10 }
    else delete n.supply
  }
})
const supplyWarn = computed(() => {
  const n = sim.selectedNode
  if (!n?.supply) return ''
  if (!(n.supply.flow > 0)) return 'Test debisi 0’dan büyük olmalı.'
  if (!(n.supply.residual >= 0 && n.supply.residual < (n.pressure ?? 0))) return 'Artık basınç, statik basıncın altında olmalı (aksi halde sabit basınç kullanılır).'
  return ''
})
// Şebeke eğrisi grafiği: P(Q) = Ps − (Ps−Pr)(Q/Qt)^1.85
const supplyCurve = computed(() => {
  const n = sim.selectedNode
  if (!n?.supply || supplyWarn.value) return null
  const ps = n.pressure ?? 0, qt = n.supply.flow
  const qmax = qt * 1.6
  const sx = (q: number) => M.l + (q / qmax) * (W - M.l - M.r)
  const sy = (p: number) => Ht - M.b - (Math.max(p, 0) / ps) * (Ht - M.t - M.b)
  const pts = Array.from({ length: 31 }, (_, i) => { const q = (qmax * i) / 30; return `${sx(q).toFixed(1)},${sy(supplyPressure(n, q)).toFixed(1)}` })
  const res = sim.result.nodes[n.id]
  return {
    d: 'M' + pts.join(' L'), qmax, ps,
    test: { x: sx(qt), y: sy(n.supply.residual) },
    op: res && res.flow > 0 ? { x: sx(res.flow), y: sy(res.pressure) } : null
  }
})
const curveWarn = computed(() => {
  if (!pump.value) return ''
  if (pump.value.h0 < pump.value.hd * 1.001) return 'Kapalı vana basıncı, tasarım basıncından büyük olmalı.'
  if (pump.value.h0 > pump.value.hd * 1.4) return 'NFPA 20: kapalı vana basıncı tasarımın %140’ını aşmamalı.'
  if (pump.value.q2 !== undefined && !(pump.value.h2! < pump.value.hd && pump.value.q2 > pump.value.qd)) return '3 nokta: aşırı yük debisi tasarımdan büyük, basıncı küçük olmalı.'
  if (pumpGain(pump.value, pump.value.qd * 1.5) < pump.value.hd * 0.65) return 'NFPA 20: %150 debide basınç, tasarımın %65’inin altına düşüyor.'
  return ''
})
</script>

<template>
  <div class="space-y-4 p-3 text-sm">
    <section>
      <h3 class="mb-2 font-semibold">Yeni öğe varsayılanı</h3>
      <div class="grid grid-cols-3 gap-2">
        <div><label class="label">Çap</label>
          <select class="input" v-model.number="sim.defaults.dn"><option v-for="d in DNS" :key="d" :value="d">DN{{ d }}</option></select></div>
        <div><label class="label">C faktörü</label>
          <select class="input" v-model.number="sim.defaults.c"><option v-for="c in CS" :key="c" :value="c">{{ c }}</option></select></div>
        <div><label class="label">Kot (m)</label>
          <input class="input" type="number" step="0.5" v-model.number="sim.defaults.z" /></div>
      </div>
      <label class="mt-2 flex items-center gap-2 text-xs"><input type="checkbox" v-model="sim.snap" /> Izgaraya yapış (1 kare = 1 m)</label>
    </section>

    <section v-if="sim.selectedPipe && pump">
      <h3 class="mb-2 font-semibold">Seçili pompa</h3>
      <div class="mb-2"><label class="label">Ad</label><input class="input" v-model="sim.selectedPipe.name" /></div>
      <div class="grid grid-cols-3 gap-2">
        <div><label class="label">Tasarım debisi (L/dk)</label><input class="input" type="number" min="1" step="50" v-model.number="pump.qd" /></div>
        <div><label class="label">Tasarım basıncı (bar)</label><input class="input" type="number" min="0.1" step="0.1" v-model.number="pump.hd" /></div>
        <div><label class="label">Kapalı vana (bar)</label><input class="input" type="number" min="0.1" step="0.1" v-model.number="pump.h0" /></div>
      </div>
      <label class="mt-2 flex items-center gap-2 text-xs"><input type="checkbox" v-model="three" /> 3 noktalı eğri (aşırı yük noktası)</label>
      <div v-if="three && pump.q2 !== undefined" class="mt-2 grid grid-cols-2 gap-2">
        <div><label class="label">Aşırı yük debisi (L/dk)</label><input class="input" type="number" min="1" step="50" v-model.number="pump.q2" /></div>
        <div><label class="label">Aşırı yük basıncı (bar)</label><input class="input" type="number" min="0" step="0.1" v-model.number="pump.h2" /></div>
      </div>
      <p v-if="curveWarn" class="mt-1 text-xs text-amber-700">{{ curveWarn }}</p>
      <svg v-if="curve" :viewBox="`0 0 ${W} ${Ht}`" class="mt-2 w-full rounded border border-slate-200 bg-white" role="img" aria-label="Pompa eğrisi">
        <line :x1="M.l" :y1="Ht - M.b" :x2="W - M.r" :y2="Ht - M.b" stroke="#94A3B8" />
        <line :x1="M.l" :y1="M.t" :x2="M.l" :y2="Ht - M.b" stroke="#94A3B8" />
        <path :d="curve.d" fill="none" stroke="#1D4ED8" stroke-width="2" />
        <circle :cx="curve.design.x" :cy="curve.design.y" r="3.5" fill="#fff" stroke="#3B5568" stroke-width="1.5" />
        <circle v-if="curve.opPt" :cx="curve.opPt.x" :cy="curve.opPt.y" r="4.5" fill="#D6402B" />
        <text :x="M.l - 4" :y="M.t + 8" text-anchor="end" font-size="9" fill="#8CA0B0">{{ curve.h0.toFixed(1) }}</text>
        <text :x="M.l - 4" :y="Ht - M.b" text-anchor="end" font-size="9" fill="#8CA0B0">0</text>
        <text :x="W - M.r" :y="Ht - 8" text-anchor="end" font-size="9" fill="#8CA0B0">{{ curve.qmax.toFixed(0) }} L/dk</text>
        <text :x="M.l + 4" :y="Ht - 8" font-size="9" fill="#8CA0B0">bar</text>
      </svg>
      <p class="mt-1 text-xs text-slate-500">
        <span style="color:#D6402B">●</span> çalışma noktası
        <template v-if="op && op.flow > 0">: {{ op.flow.toFixed(0) }} L/dk, +{{ (-op.lossBar).toFixed(2) }} bar</template>
        · <span style="color:#3B5568">○</span> tasarım noktası
      </p>
    </section>

    <section v-else-if="sim.selectedPipe">
      <h3 class="mb-2 font-semibold">Seçili boru</h3>
      <div class="mb-2"><label class="label">Ad</label><input class="input" v-model="sim.selectedPipe.name" /></div>
      <div class="grid grid-cols-2 gap-2">
        <div><label class="label">Çap</label>
          <select class="input" v-model.number="sim.selectedPipe.dn"><option v-for="d in DNS" :key="d" :value="d">DN{{ d }}</option></select></div>
        <div><label class="label">C faktörü</label>
          <select class="input" v-model.number="sim.selectedPipe.c"><option v-for="c in CS" :key="c" :value="c">{{ c }}</option></select></div>
      </div>
    </section>

    <section v-else-if="sim.selectedNode">
      <h3 class="mb-2 font-semibold">Seçili düğüm</h3>
      <div class="space-y-2">
        <div><label class="label">Ad</label><input class="input" v-model="sim.selectedNode.name" /></div>
        <div><label class="label">Kot (m)</label>
          <input class="input" type="number" step="0.5" :value="sim.selectedNode.z ?? 0" @input="sim.selectedNode!.z = num($event)" /></div>
        <label v-if="sim.selectedNode.type === 'sprinkler' || sim.selectedNode.type === 'hydrant'" class="flex items-center gap-2">
          <input type="checkbox" :checked="sim.selectedNode.open !== false" @change="sim.selectedNode!.open = ($event.target as HTMLInputElement).checked" /> Açık (su veriyor)
        </label>
        <template v-if="sim.selectedNode.type === 'source'">
          <div><label class="label">Statik basınç (bar) – depo için 0</label>
            <input class="input" type="number" min="0" step="0.1" :value="sim.selectedNode.pressure" @input="sim.selectedNode!.pressure = num($event)" /></div>
          <label class="flex items-center gap-2 text-xs"><input type="checkbox" v-model="supplyOn" /> Şebeke testi (basınç–debi eğrisi)</label>
          <div v-if="supplyOn && sim.selectedNode.supply" class="grid grid-cols-2 gap-2">
            <div><label class="label">Test debisi (L/dk)</label><input class="input" type="number" min="1" step="50" v-model.number="sim.selectedNode.supply.flow" /></div>
            <div><label class="label">Artık basınç (bar)</label><input class="input" type="number" min="0" step="0.1" v-model.number="sim.selectedNode.supply.residual" /></div>
          </div>
          <p v-if="supplyWarn" class="text-xs text-amber-700">{{ supplyWarn }}</p>
          <svg v-if="supplyCurve" :viewBox="`0 0 ${W} ${Ht}`" class="w-full rounded border border-slate-200 bg-white" role="img" aria-label="Şebeke basınç–debi eğrisi">
            <line :x1="M.l" :y1="Ht - M.b" :x2="W - M.r" :y2="Ht - M.b" stroke="#94A3B8" />
            <line :x1="M.l" :y1="M.t" :x2="M.l" :y2="Ht - M.b" stroke="#94A3B8" />
            <path :d="supplyCurve.d" fill="none" stroke="#2FBF71" stroke-width="2" />
            <circle :cx="supplyCurve.test.x" :cy="supplyCurve.test.y" r="3.5" fill="none" stroke="#8CA0B0" stroke-width="1.5" />
            <circle v-if="supplyCurve.op" :cx="supplyCurve.op.x" :cy="supplyCurve.op.y" r="4.5" fill="#D6402B" />
            <text :x="M.l - 4" :y="M.t + 8" text-anchor="end" font-size="9" fill="#8CA0B0">{{ supplyCurve.ps.toFixed(1) }}</text>
            <text :x="M.l - 4" :y="Ht - M.b" text-anchor="end" font-size="9" fill="#8CA0B0">0</text>
            <text :x="W - M.r" :y="Ht - 8" text-anchor="end" font-size="9" fill="#8CA0B0">{{ supplyCurve.qmax.toFixed(0) }} L/dk</text>
            <text :x="M.l + 4" :y="Ht - 8" font-size="9" fill="#8CA0B0">bar</text>
          </svg>
          <p v-if="supplyCurve" class="text-xs text-slate-500"><span style="color:#D6402B">●</span> çalışma noktası · <span>○</span> test noktası</p>
        </template>
        <div v-else-if="sim.selectedNode.type === 'sprinkler'"><label class="label">K faktörü (L/dk/√bar)</label>
          <input class="input" type="number" min="1" step="1" :value="sim.selectedNode.k" @input="sim.selectedNode!.k = num($event)" /></div>
        <div v-else-if="sim.selectedNode.type === 'hydrant'"><label class="label">Sabit debi (L/dk)</label>
          <input class="input" type="number" min="0" step="50" :value="sim.selectedNode.demand" @input="sim.selectedNode!.demand = num($event)" /></div>
        <div v-if="sim.selectedNode.type === 'sprinkler'"><label class="label">Koruma alanı (m²) – boş: {{ sim.design.coverage }}</label>
          <input class="input" type="number" min="1" step="0.5" :value="sim.selectedNode.area ?? ''" @input="sim.selectedNode!.area = num($event) || undefined" /></div>
      </div>
    </section>
    <p v-else class="text-slate-500">Özelliklerini düzenlemek için bir boru, pompa veya düğüm seçin.</p>
  </div>
</template>
