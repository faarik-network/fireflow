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
      meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }]
    }
  },
  nitro: { preset: 'node-server' }
})
