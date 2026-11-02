<script setup lang="ts">
import type { DesignSettings, HazardClass } from '~/types/hydraulic'
import type { DemandPoint } from '~/utils/nfpa'

const sim = useSimulator()
const dp = ref<DemandPoint | null>(null)
const busy = ref(false)
const msg = ref('')
watch(() => sim.serialized, () => { dp.value = null; msg.value = '' }, { deep: true })

const ev = computed(() => sim.designEval)
const d = computed(() => sim.design)

function pick(e: Event) { applyHazard(sim.design, (e.target as HTMLSelectElement).value as HazardClass) }
function setField(k: keyof Pick<DesignSettings, 'density' | 'area' | 'coverage' | 'hose'>, e: Event) {
  sim.design[k] = Number((e.target as HTMLInputElement).value)
  if (sim.design.hazard !== 'off') sim.design.hazard = 'custom'
}
function autoArea() {
  const n = sim.openDesignArea()
  msg.value = n ? `${n} sprinkler uzak alan olarak açıldı, diğerleri kapatıldı. Hidrolik olarak en elverişsiz alan olduğunu doğrulayın.` : 'Kaynağa bağlı sprinkler yok.'
}
async function calc() {
  busy.value = true
  await nextTick(); await new Promise((r) => setTimeout(r, 20))
  dp.value = requiredSourcePressure(sim.nodes, sim.pipes, sim.design)
  busy.value = false
}
const f = (v: number, n = 1) => v.toFixed(n)
</script>

<template>
  <section class="space-y-3 border-b border-slate-200 p-3 text-sm">
    <h3 class="font-semibold">NFPA 13 tasarım kriteri</h3>
    <div>
      <label class="label" for="hz">Tehlike sınıfı</label>
      <select id="hz" class="input" :value="d.hazard" @change="pick">
        <option value="off">Kontrol yok</option>
        <option v-for="(h, k) in HAZARDS" :key="k" :value="k">{{ h.label }}</option>
        <option value="custom">Özel</option>
      </select>
    </div>
    <template v-if="d.hazard !== 'off'">
      <div class="grid grid-cols-2 gap-2">
        <div><label class="label">Yoğunluk (mm/dk)</label><input class="input" type="number" min="0" step="0.1" :value="d.density" @input="setField('density', $event)" /></div>
        <div><label class="label">Tasarım alanı (m²)</label><input class="input" type="number" min="1" step="1" :value="d.area" @input="setField('area', $event)" /></div>
        <div><label class="label">Sprinkler alanı (m²)</label><input class="input" type="number" min="1" step="0.5" :value="d.coverage" @input="setField('coverage', $event)" /></div>
        <div><label class="label">Hortum payı (L/dk)</label><input class="input" type="number" min="0" step="10" :value="d.hose" @input="setField('hose', $event)" /></div>
      </div>
      <div class="flex flex-wrap gap-2">
        <button class="btn" @click="autoArea"><Icon name="lucide:crosshair" />Uzak alanı aç</button>
        <button class="btn" :disabled="busy" @click="calc"><Icon name="lucide:gauge" />Talep noktası</button>
      </div>
      <p v-if="msg" class="text-xs text-slate-500">{{ msg }}</p>

      <ul v-if="ev" class="space-y-1.5" role="status">
        <li :class="ev.areaOk ? 'text-green-700' : 'text-red-600'">
          {{ ev.areaOk ? '✓' : '✗' }} Açık alan {{ f(ev.openArea, 0) }} m² / gereken {{ f(d.area, 0) }} m² ({{ ev.openCount }} sprinkler)
        </li>
        <li :class="ev.densityOk ? 'text-green-700' : 'text-red-600'">
          {{ ev.densityOk ? '✓' : '✗' }} En düşük yoğunluk {{ ev.minDensity === null ? '—' : f(ev.minDensity, 2) }} mm/dk / gereken {{ f(d.density) }}
          <span v-if="ev.failing.length" class="block text-xs">Yetersiz: {{ ev.failing.slice(0, 8).join(', ') }}{{ ev.failing.length > 8 ? '…' : '' }}</span>
        </li>
        <li class="text-slate-600">
          Talep: sprinkler {{ f(ev.sprinklerFlow, 0) }} + hortum {{ f(ev.hydrantFlow + ev.hoseExtra, 0) }} =
          <b class="text-slate-900">{{ f(ev.totalDemand, 0) }} L/dk</b>
        </li>
      </ul>

      <div v-if="dp" class="rounded border border-slate-300 p-2 text-xs">
        <template v-if="dp.required !== null">
          Gereken kaynak basıncı <b>{{ f(dp.required, 2) }} bar</b>, mevcut {{ f(dp.available ?? 0, 2) }} bar<template v-if="dp.flow"> ({{ f(dp.flow, 0) }} L/dk’da şebeke eğrisinden)</template> →
          <b :class="(dp.available ?? 0) >= dp.required ? 'text-green-700' : 'text-red-600'">
            {{ (dp.available ?? 0) >= dp.required ? 'marj +' : 'eksik ' }}{{ f(Math.abs((dp.available ?? 0) - dp.required), 2) }} bar
          </b>
        </template>
        <template v-else>{{ dp.note }}</template>
      </div>
      <p class="text-xs text-slate-500">Hazır değerler NFPA 13 tipik tasarım noktalarıdır; geçerli baskıdan doğrulayın.</p>
    </template>
  </section>
</template>
