<script setup lang="ts">
const { theme, toggle } = useTheme()
</script>

<template>
  <button class="btn" :aria-label="theme === 'dark' ? 'Açık temaya geç' : 'Koyu temaya geç'" :title="theme === 'dark' ? 'Açık tema' : 'Koyu tema'" @click="toggle">
    <Icon v-if="theme === 'dark'" name="lucide:sun" />
    <Icon v-else name="lucide:moon" />
  </button>
</template>
