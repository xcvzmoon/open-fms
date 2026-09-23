<script setup lang="ts">
  definePageMeta({
    auth: 'user',
    layout: 'authenticated',
  });

  const { user } = useUserSession();
</script>

<template>
  <div
    v-if="user"
    class="space-y-4"
  >
    <div class="border-b border-default pb-3">
      <p class="font-mono text-[11px] tracking-[0.08em] text-muted uppercase">Overview</p>
      <h1 class="text-2xl font-semibold tracking-tight">Session active</h1>
    </div>
    <p class="text-sm text-muted">Signed in as {{ user.email }}</p>
  </div>
</template>
