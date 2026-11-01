import type { Config } from 'tailwindcss'

// slate ve white, CSS değişkenlerine bağlı: tüm arayüz tek yerden temalanır (assets/css/main.css)
const c = (n: string) => `rgb(var(--${n}) / <alpha-value>)`

export default <Partial<Config>>{
  theme: {
    extend: {
      colors: {
        white: c('c-white'),
        slate: { 50: c('s50'), 100: c('s100'), 200: c('s200'), 300: c('s300'), 400: c('s400'), 500: c('s500'), 600: c('s600'), 700: c('s700'), 800: c('s800'), 900: c('s900') }
      }
    }
  }
}
