export default defineNuxtConfig({
  compatibilityDate: '2024-11-01',
  modules: ['@nuxtjs/supabase', '@nuxtjs/tailwindcss', '@pinia/nuxt', '@nuxt/icon'],
  css: ['~/assets/css/main.css'],
  // Route koruması kendi middleware'imizde (middleware/auth.ts)
  supabase: { redirect: false, types: false },
  icon: { serverBundle: 'local', clientBundle: { scan: true } },
  app: {
    head: {
      title: 'FireFlow – Hidrolik Hesap',
      // Kayıtlı temayı ilk boyamadan önce uygula (yanıp sönmeyi önler)
      script: [{ innerHTML: "try{var t=localStorage.getItem('ff-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}", tagPosition: 'head' }],
      meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }]
    }
  }
})
