<script setup lang="ts">
import type { RealtimeChannel } from '@supabase/supabase-js'

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
let expiryTimer: ReturnType<typeof setTimeout> | undefined
let liveTimer: ReturnType<typeof setTimeout> | undefined
let channel: RealtimeChannel | undefined

const lock = useProjectLock(projectId, {
  beforeRelease: () => save(),
  onLost: () => { clearTimeout(timer); sim.readOnly = true; busyBy.value = lock.holder.value || null; startPoll() }
})

const showHistory = ref(false)
const history = ref<{ load: () => Promise<void> } | null>(null)

/** Projeyi sunucudan (yeniden) yükle; yükleme otomatik kaydı tetiklemez */
async function loadProject(opts: { keepView?: boolean } = {}) {
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
  sim.load(data.grid_data, opts)
  await nextTick()
  ready.value = true
  return data
}

onMounted(async () => {
  if (!co.loaded.value) await co.refresh()
  sim.readOnly = true
  const data = await loadProject()
  if (!data) { await navigateTo('/dashboard'); return }
  subscribe()
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

/** Salt okunur bekleyen kullanıcı: kilit kimde, proje değişti mi? (Realtime olaylarında ve yedek olarak periyodik) */
async function poll() {
  const [h, p] = await Promise.all([lock.peek(), client.from('projects').select('updated_at').eq('id', projectId).single()])
  if (lock.state.value === 'held') return // bu arada kilidi aldık; eski sonuç busyBy'ı bozmasın
  busyBy.value = h
  if (p.data && p.data.updated_at !== lastUpdated) onProjectChanged()
}
/** Realtime asıl kanal; bağlantı sessizce koparsa diye seyrek yedek kontrol */
function startPoll() { stopPoll(); pollTimer = setInterval(poll, 60_000) }
function stopPoll() { clearInterval(pollTimer); pollTimer = undefined; clearTimeout(expiryTimer) }

/** Kilit satırı değişti (null: silindi) */
function onLockChanged(row: { user_id: string; expires_at: string } | null) {
  if (lock.state.value === 'held') {
    // Kilit bizdeyken başkasına geçtiyse devralınmıştır: kaydetmeyi beklemeden hemen salt okunura geç
    if (row && row.user_id !== user.value?.id) lock.peek().then((n) => lock.lost(n ?? undefined))
    return
  }
  if (!lockRequired.value) return
  // Süresi dolan kilit olay üretmez: dolduğu an kendimiz bakalım (saat farkına 1 sn pay)
  clearTimeout(expiryTimer)
  if (row) expiryTimer = setTimeout(poll, Math.max(0, new Date(row.expires_at).getTime() - Date.now()) + 1000)
  poll()
}

/** Proje başkası tarafından kaydedildi: değişiklik yoksa canlı yükle, varsa kullanıcıya sor */
function onProjectChanged() {
  if (!sim.readOnly) return // düzenleyen biziz; olay kendi kaydımız
  if (dirty.value) { hasUpdates.value = true; return }
  clearTimeout(liveTimer)
  liveTimer = setTimeout(() => { if (sim.readOnly && !dirty.value) loadProject({ keepView: true }) }, 500)
}

function subscribe() {
  const lockTable = { schema: 'public', table: 'project_locks' } as const
  channel = client.channel(`project:${projectId}`)
    .on('postgres_changes', { ...lockTable, event: 'INSERT', filter: `project_id=eq.${projectId}` }, (e) => onLockChanged(e.new as any))
    .on('postgres_changes', { ...lockTable, event: 'UPDATE', filter: `project_id=eq.${projectId}` }, (e) => onLockChanged(e.new as any))
    // DELETE olayları süzülemiyor; yalnızca PK (project_id) gelir
    .on('postgres_changes', { ...lockTable, event: 'DELETE' }, (e) => { if ((e.old as any).project_id === projectId) onLockChanged(null) })
    .on('postgres_changes', { schema: 'public', table: 'projects', event: 'UPDATE', filter: `id=eq.${projectId}` }, (e) => {
      if ((e.new as any).updated_at !== lastUpdated) onProjectChanged()
    })
    // (Yeniden) bağlanınca kaçırılan olayları telafi et
    .subscribe((s) => { if (s === 'SUBSCRIBED' && sim.readOnly) poll() })
}

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
  if (showHistory.value) history.value?.load()
}
watch(() => sim.serialized, () => {
  if (!ready.value || sim.readOnly) return
  dirty.value = true
  clearTimeout(timer); timer = setTimeout(save, 1500)
}, { deep: true })

/** Sürüme dön: önce bekleyen değişiklikleri kaydet; şimdiki hâl de geçmişte kalır */
async function restoreVersion(id: string) {
  if (!confirm('Proje bu sürüme döndürülsün mü? Şimdiki hâl de geçmişte saklanır; istediğinizde ona geri dönebilirsiniz.')) return false
  await save()
  if (dirty.value) { alert('Son değişiklikler kaydedilemedi; geri dönme iptal edildi.'); return false }
  const { error } = await client.rpc('restore_project_version', { p_version: id })
  if (error) { alert(error.message); return false }
  await loadProject()
  return true
}
async function saveNamedVersion(label: string) {
  await save()
  if (dirty.value) { alert('Son değişiklikler kaydedilemedi; sürüm oluşturulmadı.'); return false }
  const { error } = await client.rpc('save_project_version', { p_project: projectId, p_label: label })
  if (error) { alert(error.message); return false }
  return true
}

function onPageHide() { if (lock.state.value === 'held') { save(); client.rpc('release_project_lock', { p_project: projectId }) } }
onBeforeUnmount(async () => {
  clearTimeout(timer); clearTimeout(liveTimer); stopPoll()
  if (channel) client.removeChannel(channel)
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
function loadExample() { if (!sim.nodes.length || confirm('Mevcut model örnek ağla değiştirilsin mi? (Ctrl+Z ile geri alınabilir)')) sim.loadExample() }
function clearAll() { if (confirm('Tüm düğüm ve borular silinsin mi? (Ctrl+Z ile geri alınabilir)')) sim.clear() }
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
      <h1 class="brand min-w-0 truncate text-xl" :title="title">{{ title }}</h1>
      <span class="shrink-0 whitespace-nowrap text-xs text-slate-500" :class="status === 'error' && 'text-red-600'" aria-live="polite">{{ statusText }}</span>
      <span v-if="sim.readOnly" class="shrink-0 whitespace-nowrap rounded-full border border-slate-300 px-2.5 py-0.5 text-xs">Salt okunur · {{ ownerName }}</span>
      <span v-else-if="lock.state.value === 'held'" class="shrink-0 whitespace-nowrap rounded-full border border-green-600 px-2.5 py-0.5 text-xs text-green-700" title="Siz düzenlerken diğer firma üyeleri projeyi salt okunur görür"><Icon name="lucide:lock" class="align-[-2px]" /> Düzenliyorsunuz</span>
      <button v-if="sim.readOnly" class="btn shrink-0" @click="duplicate"><Icon name="lucide:copy" />Kopya oluştur</button>
      <div class="ml-auto flex shrink-0 flex-wrap justify-end gap-1">
        <button v-for="(t, i) in TOOLS" :key="t.id" class="btn relative px-2.5" :class="sim.tool === t.id && 'btn-active'" :title="`${t.label} (${i + 1})`" :aria-label="t.label" :aria-keyshortcuts="String(i + 1)" :aria-pressed="sim.tool === t.id" :disabled="sim.readOnly && t.id !== 'select'" @click="sim.tool = t.id">
          <Icon :name="t.icon" />
          <kbd class="pointer-events-none absolute bottom-0 right-0.5 font-sans text-[9px] leading-none opacity-60">{{ i + 1 }}</kbd>
        </button>
        <span class="mx-1 w-px bg-slate-200" />
        <button class="btn" title="Geri al (Ctrl+Z)" aria-label="Geri al" aria-keyshortcuts="Control+Z" :disabled="sim.readOnly || !sim.canUndo" @click="sim.undo()"><Icon name="lucide:undo-2" /></button>
        <button class="btn" title="Yinele (Ctrl+Y)" aria-label="Yinele" aria-keyshortcuts="Control+Y" :disabled="sim.readOnly || !sim.canRedo" @click="sim.redo()"><Icon name="lucide:redo-2" /></button>
        <button class="btn" :class="showHistory && 'btn-active'" title="Sürüm geçmişi" :aria-pressed="showHistory" @click="showHistory = !showHistory"><Icon name="lucide:history" /><span class="hidden xl:inline">Geçmiş</span></button>
        <span class="mx-1 w-px bg-slate-200" />
        <button class="btn" title="Sığdır" aria-label="Sığdır" @click="sim.fitView()"><Icon name="lucide:maximize" /><span class="hidden 2xl:inline">Sığdır</span></button>
        <button class="btn" title="Rapor: yazdır / PDF olarak kaydet" aria-label="Rapor (PDF)" @click="exportPdf"><Icon name="lucide:file-text" /><span class="hidden 2xl:inline">Rapor (PDF)</span></button>
        <button class="btn" title="CSV indir" aria-label="CSV indir" @click="exportCsv"><Icon name="lucide:table" /><span class="hidden 2xl:inline">CSV</span></button>
        <button class="btn" title="Örnek ağ yükle" aria-label="Örnek ağ yükle" :disabled="sim.readOnly" @click="loadExample"><Icon name="lucide:network" /><span class="hidden 2xl:inline">Örnek ağ</span></button>
        <label class="btn cursor-pointer" title="Tuvaldeki değer etiketleri"><input type="checkbox" v-model="sim.showLabels" /><span class="hidden lg:inline">Etiketler</span></label>
        <ThemeToggle />
        <button class="btn" title="Tuvali temizle" aria-label="Tuvali temizle" :disabled="sim.readOnly" @click="clearAll"><Icon name="lucide:trash-2" /><span class="hidden 2xl:inline">Tuvali temizle</span></button>
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
      <div class="relative min-h-[300px] border-r border-slate-200">
        <HydraulicCanvas />
        <div v-if="showHistory" class="absolute bottom-12 right-2 top-2 z-10 w-80 max-w-[calc(100%-1rem)]">
          <VersionHistory ref="history" :project-id="projectId" :can-edit="!sim.readOnly" :restore="restoreVersion" :save-named="saveNamedVersion" @close="showHistory = false" />
        </div>
      </div>
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
