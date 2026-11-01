<script setup lang="ts">
definePageMeta({ middleware: () => navigateTo(useSupabaseUser().value ? '/dashboard' : '/login') })
</script>
<template><div /></template>
