<script setup lang="ts">
import type { Tool } from '~/types/hydraulic'
definePageMeta({ middleware: 'auth' })

const route = useRoute()
const client = useSupabaseClient()
const sim = useSimulator()
const title = ref('Yükleniyor…')
const status = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')
const ready = ref(false)
let timer: ReturnType<typeof setTimeout>

const tools: { id: Tool; label: string; icon: string }[] = [
  { id: 'select', label: 'Seç / Taşı', icon: 'lucide:mouse-pointer-2' },
  { id: 'pipe', label: 'Boru çiz', icon: 'lucide:git-commit-horizontal' },
  { id: 'source', label: 'Su kaynağı / Depo', icon: 'lucide:droplets' },
  { id: 'pump', label: 'Pompa', icon: 'lucide:fan' },
  { id: 'joint', label: 'Bağlantı düğümü', icon: 'lucide:circle-dot' },
  { id: 'sprinkler', label: 'Sprinkler', icon: 'lucide:sprout' },
  { id: 'hydrant', label: 'Hidrant', icon: 'lucide:flame' },
  { id: 'delete', label: 'Sil', icon: 'lucide:eraser' }
]

onMounted(async () => {
  const { data, error } = await client.from('projects').select('title,grid_data').eq('id', route.params.id as string).single()
  if (error || !data) { await navigateTo('/dashboard'); return }
  title.value = data.title
  sim.load(data.grid_data)
  await nextTick()
  ready.value = true
})

async function save() {
  status.value = 'saving'
  const { error } = await client.from('projects')
    .update({ grid_data: sim.serialized, updated_at: new Date().toISOString() }).eq('id', route.params.id as string)
  status.value = error ? 'error' : 'saved'
}
watch(() => sim.serialized, () => {
  if (!ready.value) return
  clearTimeout(timer); timer = setTimeout(save, 1500)
}, { deep: true })
onBeforeUnmount(() => { clearTimeout(timer); if (ready.value && status.value === 'saving') save() })

const slug = () => title.value.toLowerCase().replace(/[^a-z0-9ğüşıöç]+/gi, '-').replace(/^-|-$/g, '') || 'proje'
function exportCsv() { downloadText(`${slug()}-hidrolik.csv`, buildCsv(sim.nodes, sim.pipes, sim.result)) }
async function exportPdf() {
  sim.fitView()
  await nextTick()
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  const img = document.querySelector('canvas')?.toDataURL('image/png') ?? ''
  if (!printHtml(buildReportHtml(title.value, sim.nodes, sim.pipes, sim.result, img, { s: sim.design, ev: sim.designEval }))) alert('Açılır pencere engellendi. Tarayıcıda bu site için izin verin.')
}
function loadExample() { if (!sim.nodes.length || confirm('Mevcut model örnek ağla değiştirilsin mi?')) sim.loadExample() }
function clearAll() { if (confirm('Tüm düğüm ve borular silinsin mi?')) sim.clear() }
const statusText = computed(() => ({ idle: '', saving: 'Kaydediliyor…', saved: 'Kaydedildi', error: 'Kaydedilemedi – tekrar denenecek' }[status.value]))
const r = computed(() => sim.result)
const stats = computed(() => {
  const open = sim.nodes.filter((n) => (n.type === 'sprinkler' || n.type === 'hydrant') && n.open !== false)
  const sp = sim.nodes.filter((n) => n.type === 'sprinkler' && n.open !== false && r.value.nodes[n.id]?.reachable).map((n) => r.value.nodes[n.id].pressure)
  const vmax = Math.max(0, ...Object.values(r.value.pipes).filter((p) => p.kind === 'pipe').map((p) => p.velocity))
  return { open: open.length, minP: sp.length ? Math.min(...sp) : null, vmax }
})
</script>

<template>
  <div class="flex h-screen flex-col">
    <header class="flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
      <NuxtLink to="/dashboard" class="btn" aria-label="Projelere dön"><Icon name="lucide:arrow-left" /></NuxtLink>
      <h1 class="brand truncate text-xl">{{ title }}</h1>
      <span class="text-xs text-slate-500" :class="status === 'error' && 'text-red-600'" aria-live="polite">{{ statusText }}</span>
      <div class="ml-4 flex flex-wrap gap-1">
        <button v-for="t in tools" :key="t.id" class="btn" :class="sim.tool === t.id && 'btn-active'" :title="t.label" :aria-label="t.label" :aria-pressed="sim.tool === t.id" @click="sim.tool = t.id">
          <Icon :name="t.icon" /><span class="hidden xl:inline">{{ t.label }}</span>
        </button>
        <span class="mx-1 w-px bg-slate-200" />
        <button class="btn" @click="sim.fitView()"><Icon name="lucide:maximize" />Sığdır</button>
        <button class="btn" @click="exportPdf" title="Yazdır / PDF olarak kaydet"><Icon name="lucide:file-text" />Rapor (PDF)</button>
        <button class="btn" @click="exportCsv"><Icon name="lucide:table" />CSV</button>
        <button class="btn" @click="loadExample"><Icon name="lucide:network" />Örnek ağ</button>
        <label class="btn cursor-pointer"><input type="checkbox" v-model="sim.showLabels" />Etiketler</label>
        <ThemeToggle />
        <button class="btn" @click="clearAll"><Icon name="lucide:trash-2" />Tuvali temizle</button>
      </div>
    </header>

    <div class="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1fr_320px] lg:grid-rows-[1fr_240px]">
      <div class="relative min-h-[300px] border-r border-slate-200"><HydraulicCanvas /></div>
      <aside class="row-span-2 hidden overflow-auto border-l border-slate-200 bg-white lg:block">
        <div class="border-b border-slate-200 p-3">
          <div class="mb-2 inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium" :class="r.converged ? 'border-green-600 text-green-700' : 'border-red-600 text-red-700'">
            {{ r.converged ? `Çözüldü · ${r.iterations} iterasyon` : 'Yakınsamadı' }}
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div><div class="text-xs text-slate-500">Toplam debi</div><div class="text-2xl font-bold">{{ r.totalFlow.toFixed(0) }} <span class="text-sm font-normal">L/dk</span></div></div>
            <div><div class="text-xs text-slate-500">Açık çıkış</div><div class="text-2xl font-bold">{{ stats.open }}</div></div>
            <div><div class="text-xs text-slate-500">En düşük sprinkler basıncı</div><div class="text-xl font-bold" :class="stats.minP !== null && stats.minP < 0.5 && 'text-red-600'">{{ stats.minP === null ? '—' : stats.minP.toFixed(2) + ' bar' }}</div></div>
            <div><div class="text-xs text-slate-500">En yüksek hız</div><div class="text-xl font-bold" :class="stats.vmax > 6 ? 'text-red-600' : stats.vmax >= 4 ? 'text-amber-600' : ''">{{ stats.vmax.toFixed(2) }} m/s</div></div>
          </div>
          <p v-if="!r.warnings.length && r.converged" class="mt-3 rounded border border-green-600 px-2 py-1 text-xs text-green-700">Basınç ve hız sınırları içinde.</p>
        </div>
        <ul v-if="r.warnings.length" class="space-y-1 border-b border-slate-200 bg-amber-50 p-3 text-xs text-amber-900" role="status">
          <li v-for="(w, i) in r.warnings.slice(0, 8)" :key="i">⚠ {{ w }}</li>
        </ul>
        <DesignPanel />
        <Inspector />
      </aside>
      <div class="min-h-0 border-t border-r border-slate-200 bg-white"><ResultsTables /></div>
    </div>
  </div>
</template>
