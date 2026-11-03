<script setup lang="ts">
import type { Tool } from '~/types/hydraulic'
definePageMeta({ middleware: 'auth' })

const route = useRoute()
const client = useSupabaseClient<any>()
const user = useSupabaseUser()
const co = useCompany()
const sim = useSimulator()
const projectId = route.params.id as string
const ownerName = ref('')
const title = ref('Yükleniyor…')
const status = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')
const ready = ref(false)
const dirty = ref(false)
/** Firma projesi: düzenlemek için kilit gerekir */
const lockRequired = ref(false)
/** Rol olarak düzenleyebilir mi (sahip veya aynı firma üyesi) */
const canEdit = ref(false)
/** Başkasının kilidini devralabilir mi (proje sahibi veya OWNER/ADMIN) */
const canForce = ref(false)
const busyBy = ref<string | null>(null)
const hasUpdates = ref(false)
let lastUpdated = ''
let timer: ReturnType<typeof setTimeout>
let pollTimer: ReturnType<typeof setInterval> | undefined

const lock = useProjectLock(projectId, {
  beforeRelease: () => save(),
  onLost: () => { clearTimeout(timer); sim.readOnly = true; busyBy.value = lock.holder.value || null; startPoll() }
})

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

/** Projeyi sunucudan (yeniden) yükle; yükleme otomatik kaydı tetiklemez */
async function loadProject() {
  const { data, error } = await client.from('projects')
    .select('title,grid_data,user_id,company_id,updated_at,owner:profiles!user_id(full_name,email)')
    .eq('id', projectId).single()
  if (error || !data) return null
  ready.value = false
  title.value = data.title
  lastUpdated = data.updated_at
  hasUpdates.value = false
  dirty.value = false
  const o = data.owner as unknown as { full_name: string | null; email: string } | null
  ownerName.value = o?.full_name || o?.email || 'Eski üye'
  sim.load(data.grid_data)
  await nextTick()
  ready.value = true
  return data
}

onMounted(async () => {
  if (!co.loaded.value) await co.refresh()
  sim.readOnly = true
  const data = await loadProject()
  if (!data) { await navigateTo('/dashboard'); return }
  // Düzenleme: proje sahibi veya aynı firmanın herhangi bir üyesi, kilidi tutuyorsa (asıl denetim RLS'te)
  const owner = data.user_id === user.value?.id
  const sameCompany = !!data.company_id && data.company_id === co.company.value?.id
  canEdit.value = owner || sameCompany
  canForce.value = owner || (sameCompany && co.isAdmin.value)
  lockRequired.value = canEdit.value && !!data.company_id
  if (!canEdit.value) return
  if (!lockRequired.value) { sim.readOnly = false; return }
  if (await lock.acquire()) sim.readOnly = false
  else { busyBy.value = lock.holder.value; startPoll() }
  window.addEventListener('pagehide', onPageHide)
})

/** Salt okunur bekleyen kullanıcı: kilit boşaldı mı, proje değişti mi? */
async function poll() {
  const [h, p] = await Promise.all([lock.peek(), client.from('projects').select('updated_at').eq('id', projectId).single()])
  busyBy.value = h
  if (p.data && p.data.updated_at !== lastUpdated) hasUpdates.value = true
}
function startPoll() { stopPoll(); pollTimer = setInterval(poll, 15_000) }
function stopPoll() { clearInterval(pollTimer); pollTimer = undefined }

async function startEditing(force = false) {
  if (force && !confirm(`${busyBy.value ?? 'Diğer kullanıcı'} şu an düzenliyor. Kilidi devralırsanız onun kaydedilmemiş son değişiklikleri kaybolabilir. Devam edilsin mi?`)) return
  if (dirty.value && !confirm('Kaydedilmemiş değişiklikleriniz var; proje sunucudaki son hâliyle yeniden yüklenecek. Devam edilsin mi? (Saklamak için önce “Kopya oluştur”.)')) return
  if (!(await lock.acquire(force))) { busyBy.value = lock.holder.value; return }
  stopPoll()
  busyBy.value = null
  await loadProject()
  sim.readOnly = false
}

function reloadLatest() {
  if (dirty.value && !confirm('Kaydedilmemiş değişiklikleriniz kaybolacak. Devam edilsin mi?')) return
  loadProject()
}

async function save() {
  clearTimeout(timer)
  if (!dirty.value || sim.readOnly) return
  dirty.value = false
  status.value = 'saving'
  const { data, error } = await client.from('projects')
    .update({ grid_data: sim.serialized, updated_at: new Date().toISOString() }).eq('id', projectId).select('updated_at')
  if (error) { dirty.value = true; status.value = 'error'; timer = setTimeout(save, 5000); return }
  // RLS satırı güncellemediyse kilit elimizde değil
  if (!data?.length) { dirty.value = true; status.value = 'error'; lock.lost(); return }
  lastUpdated = data[0].updated_at
  status.value = 'saved'
}
watch(() => sim.serialized, () => {
  if (!ready.value || sim.readOnly) return
  dirty.value = true
  clearTimeout(timer); timer = setTimeout(save, 1500)
}, { deep: true })

function onPageHide() { if (lock.state.value === 'held') { save(); client.rpc('release_project_lock', { p_project: projectId }) } }
onBeforeUnmount(async () => {
  clearTimeout(timer); stopPoll()
  if (import.meta.client) window.removeEventListener('pagehide', onPageHide)
  if (lock.state.value === 'held') await lock.release() // önce kaydeder
  else await save()
  sim.readOnly = false
})

/** Salt okunur projenin kendi kopyasını oluştur */
async function duplicate() {
  if (!user.value) return
  const { data, error } = await client.from('projects')
    .insert({ title: `${title.value} (kopya)`, user_id: user.value.id, grid_data: sim.serialized })
    .select('id').single()
  if (error) { alert(error.message); return }
  await navigateTo(`/project/${data.id}`, { external: true })
}

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
const statusText = computed(() => ({ idle: '', saving: 'Kaydediliyor…', saved: 'Kaydedildi', error: lock.state.value === 'lost' ? 'Kaydedilemedi' : 'Kaydedilemedi – tekrar denenecek' }[status.value]))
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
      <span v-if="sim.readOnly" class="rounded-full border border-slate-300 px-2.5 py-0.5 text-xs">Salt okunur · {{ ownerName }}</span>
      <span v-else-if="lock.state.value === 'held'" class="rounded-full border border-green-600 px-2.5 py-0.5 text-xs text-green-700" title="Siz düzenlerken diğer firma üyeleri projeyi salt okunur görür"><Icon name="lucide:lock" class="align-[-2px]" /> Düzenliyorsunuz</span>
      <button v-if="sim.readOnly" class="btn" @click="duplicate"><Icon name="lucide:copy" />Kopya oluştur</button>
      <div class="ml-4 flex flex-wrap gap-1">
        <button v-for="t in tools" :key="t.id" class="btn" :class="sim.tool === t.id && 'btn-active'" :title="t.label" :aria-label="t.label" :aria-pressed="sim.tool === t.id" :disabled="sim.readOnly && t.id !== 'select'" @click="sim.tool = t.id">
          <Icon :name="t.icon" /><span class="hidden xl:inline">{{ t.label }}</span>
        </button>
        <span class="mx-1 w-px bg-slate-200" />
        <button class="btn" @click="sim.fitView()"><Icon name="lucide:maximize" />Sığdır</button>
        <button class="btn" @click="exportPdf" title="Yazdır / PDF olarak kaydet"><Icon name="lucide:file-text" />Rapor (PDF)</button>
        <button class="btn" @click="exportCsv"><Icon name="lucide:table" />CSV</button>
        <button class="btn" :disabled="sim.readOnly" @click="loadExample"><Icon name="lucide:network" />Örnek ağ</button>
        <label class="btn cursor-pointer"><input type="checkbox" v-model="sim.showLabels" />Etiketler</label>
        <ThemeToggle />
        <button class="btn" :disabled="sim.readOnly" @click="clearAll"><Icon name="lucide:trash-2" />Tuvali temizle</button>
      </div>
    </header>

    <div v-if="sim.readOnly && lockRequired" class="flex flex-wrap items-center gap-2 border-b border-amber-300 bg-amber-50 px-3 py-1.5 text-sm text-amber-900" role="status">
      <Icon name="lucide:lock" />
      <template v-if="lock.state.value === 'lost'">
        Düzenleme kilidi {{ busyBy ? `${busyBy} tarafından` : '' }} alındı; proje artık salt okunur.
        <b v-if="dirty">Kaydedilmemiş değişiklikleriniz var — saklamak için “Kopya oluştur”.</b>
      </template>
      <template v-else-if="lock.state.value === 'idle'">Uzun süre işlem yapılmadığı için düzenleme kilidi bırakıldı.</template>
      <template v-if="busyBy && lock.state.value !== 'lost'"><b>{{ busyBy }}</b> şu an düzenliyor; siz salt okunur görüntülüyorsunuz.</template>
      <template v-else-if="!busyBy">Proje şu an kimse tarafından düzenlenmiyor.</template>
      <span class="ml-auto flex gap-1">
        <button v-if="hasUpdates" class="btn" @click="reloadLatest"><Icon name="lucide:refresh-cw" />Yeni değişiklikleri yükle</button>
        <button v-if="!busyBy" class="btn btn-primary" @click="startEditing()"><Icon name="lucide:pencil" />Düzenlemeye başla</button>
        <button v-else-if="canForce" class="btn" @click="startEditing(true)"><Icon name="lucide:key-round" />Kilidi devral</button>
      </span>
    </div>

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
        <fieldset :disabled="sim.readOnly" class="contents">
          <DesignPanel />
          <Inspector />
        </fieldset>
      </aside>
      <div class="min-h-0 border-t border-r border-slate-200 bg-white"><ResultsTables /></div>
    </div>
  </div>
</template>
