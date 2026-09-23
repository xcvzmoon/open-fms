<script setup lang="ts">
  defineProps<{
    code: string;
  }>();
</script>

<template>
  <div class="relative w-full max-w-sm">
    <CornerMarks />

    <div class="border border-default bg-default">
      <div
        class="flex items-center justify-between border-b border-default bg-muted/50 px-4 py-2.5"
      >
        <span class="font-mono text-[11px] tracking-[0.08em] text-muted uppercase">{{ code }}</span>
        <span
          class="flex items-center gap-1.5 font-mono text-[11px] tracking-[0.08em] text-muted uppercase"
        >
          <span class="size-1 rounded-full bg-current" />
          Ready
        </span>
      </div>

      <div class="p-6">
        <slot />
      </div>
    </div>
  </div>
</template>
