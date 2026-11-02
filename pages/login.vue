<script setup lang="ts">
const client = useSupabaseClient()
const user = useSupabaseUser()
const mode = ref<'in' | 'up'>('in')
const email = ref(''), password = ref(''), fullName = ref('')
const busy = ref(false), error = ref(''), info = ref('')

watchEffect(() => { if (user.value) navigateTo('/dashboard') })

async function submit() {
  busy.value = true; error.value = ''; info.value = ''
  const { error: err, data } = mode.value === 'in'
    ? await client.auth.signInWithPassword({ email: email.value, password: password.value })
    : await client.auth.signUp({ email: email.value, password: password.value, options: { data: { full_name: fullName.value } } })
  busy.value = false
  if (err) { error.value = err.message; return }
  if (mode.value === 'up' && !data.session) info.value = 'Kayıt tamamlandı. E-postanızdaki doğrulama bağlantısına tıklayın.'
}
</script>

<template>
  <main class="mx-auto grid min-h-screen max-w-md content-center px-4">
    <div class="absolute right-4 top-4"><ThemeToggle /></div>
    <h1 class="brand text-4xl">Fire<b>Flow</b></h1>
    <p class="mb-6 mt-1 text-slate-600">Sprinkler ağınızı çizin, basınç ve debiyi anında görün.</p>
    <form class="space-y-3 rounded-lg border border-slate-200 bg-white p-5" @submit.prevent="submit">
      <div v-if="mode === 'up'"><label class="label" for="fn">Ad soyad</label><input id="fn" class="input" v-model="fullName" /></div>
      <div><label class="label" for="em">E-posta</label><input id="em" class="input" type="email" required autocomplete="email" v-model="email" /></div>
      <div><label class="label" for="pw">Şifre</label><input id="pw" class="input" type="password" required minlength="6" :autocomplete="mode === 'in' ? 'current-password' : 'new-password'" v-model="password" /></div>
      <p v-if="error" class="text-sm text-red-600" role="alert">{{ error }}</p>
      <p v-if="info" class="text-sm text-green-700">{{ info }}</p>
      <button class="btn btn-primary w-full justify-center" :disabled="busy">{{ mode === 'in' ? 'Giriş yap' : 'Hesap oluştur' }}</button>
      <button type="button" class="w-full text-center text-sm text-slate-600 underline" @click="mode = mode === 'in' ? 'up' : 'in'">
        {{ mode === 'in' ? 'Hesabın yok mu? Kayıt ol' : 'Zaten hesabın var mı? Giriş yap' }}
      </button>
    </form>
  </main>
</template>
