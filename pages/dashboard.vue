<script setup lang="ts">
definePageMeta({ middleware: 'auth' })
const client = useSupabaseClient()
const user = useSupabaseUser()
const projects = ref<any[]>([])
const loading = ref(true), error = ref('')
const title = ref(''), description = ref('')

async function refresh() {
  loading.value = true
  const { data, error: err } = await client.from('projects').select('id,title,description,updated_at').order('updated_at', { ascending: false })
  if (err) error.value = err.message
  projects.value = data ?? []
  loading.value = false
}
async function create() {
  if (!title.value.trim() || !user.value) return
  const { data, error: err } = await client.from('projects')
    .insert({ title: title.value.trim(), description: description.value.trim() || null, user_id: user.value.id })
    .select('id').single()
  if (err) { error.value = err.message; return }
  navigateTo(`/project/${data.id}`)
}
async function rename(p: any) {
  const t = prompt('Yeni proje adı', p.title)
  if (!t?.trim()) return
  await client.from('projects').update({ title: t.trim(), updated_at: new Date().toISOString() }).eq('id', p.id)
  refresh()
}
async function remove(p: any) {
  if (!confirm(`“${p.title}” silinsin mi? Bu işlem geri alınamaz.`)) return
  await client.from('projects').delete().eq('id', p.id)
  refresh()
}
async function logout() { await client.auth.signOut(); navigateTo('/login') }
const fmt = (d: string) => new Date(d).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' })
onMounted(refresh)
</script>

<template>
  <main class="mx-auto max-w-4xl px-4 py-8">
    <header class="mb-6 flex items-center justify-between">
      <h1 class="brand text-3xl">Proje<b>lerim</b></h1>
      <div class="flex items-center gap-3 text-sm text-slate-600">{{ user?.email }}<button class="btn" @click="logout">Çıkış yap</button></div>
    </header>

    <form class="mb-8 grid gap-2 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-[1fr_1fr_auto]" @submit.prevent="create">
      <input class="input" v-model="title" placeholder="Proje adı" required aria-label="Proje adı" />
      <input class="input" v-model="description" placeholder="Açıklama (isteğe bağlı)" aria-label="Açıklama" />
      <button class="btn btn-primary justify-center">Proje oluştur</button>
    </form>

    <p v-if="error" class="mb-4 text-sm text-red-600" role="alert">{{ error }}</p>
    <p v-if="loading" class="text-slate-500">Yükleniyor…</p>
    <p v-else-if="!projects.length" class="rounded-lg border border-dashed border-slate-300 p-8 text-center text-slate-500">
      Henüz projeniz yok. Yukarıdan bir ad girip ilk hidrolik modelinizi oluşturun.
    </p>
    <ul v-else class="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
      <li v-for="p in projects" :key="p.id" class="flex items-center justify-between gap-3 p-4">
        <NuxtLink :to="`/project/${p.id}`" class="min-w-0 flex-1">
          <div class="truncate font-medium">{{ p.title }}</div>
          <div class="truncate text-sm text-slate-500">{{ p.description || 'Açıklama yok' }} · {{ fmt(p.updated_at) }}</div>
        </NuxtLink>
        <button class="btn" @click="rename(p)">Yeniden adlandır</button>
        <NuxtLink :to="`/project/${p.id}`" class="btn">Aç</NuxtLink>
        <button class="btn" @click="remove(p)">Sil</button>
      </li>
    </ul>
  </main>
</template>
