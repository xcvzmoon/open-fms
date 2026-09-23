<script setup lang="ts">
  definePageMeta({
    auth: 'guest',
  });

  type StackRow = {
    no: string;
    layer: string;
    detail: string;
  };

  const stack: StackRow[] = [
    { no: '01', layer: 'Frontend', detail: 'Nuxt 4 with Nuxt UI' },
    { no: '02', layer: 'Backend', detail: 'Nitro, deployable anywhere' },
    { no: '03', layer: 'Database', detail: 'Postgres with Drizzle ORM' },
    { no: '04', layer: 'Auth', detail: 'Better Auth, wired end to end' },
    { no: '05', layer: 'Validation', detail: 'Valibot at every boundary' },
    { no: '06', layer: 'Toolchain', detail: 'Vite+, one CLI for install, dev, check, and test' },
  ];

  const gigetCommand = 'vpx giget@latest gh:xcvzmoon/buildr my-app';
  const { copy, copied } = useClipboard({ source: gigetCommand });
</script>

<template>
  <div class="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-6">
    <nav class="flex items-center justify-between py-6">
      <span class="text-sm font-semibold tracking-tight">Buildr</span>
      <div class="flex items-center gap-1">
        <UButton
          label="Sign in"
          to="/signin"
          color="neutral"
          variant="link"
        />
        <UButton
          label="Sign up"
          to="/signup"
          color="neutral"
        />
      </div>
    </nav>

    <section class="flex-1 py-16">
      <div class="grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-16">
        <div>
          <h1 class="font-mono text-4xl font-semibold tracking-tight text-pretty sm:text-5xl">
            A foundation for full-stack TypeScript.
          </h1>
          <p class="mt-4 max-w-md text-base text-muted">
            Buildr is a monorepo starting point: a Nuxt front end, a Nitro back end, Postgres and
            Drizzle underneath, auth already wired, and one toolchain that formats, lints,
            type-checks, and tests the whole thing.
          </p>

          <div class="mt-8 flex flex-wrap items-center gap-2">
            <UButton
              icon="i-lucide-github"
              to="https://github.com/xcvzmoon/buildr"
              target="_blank"
              color="neutral"
            />

            <UButton
              :label="copied ? 'Copied!' : gigetCommand"
              :trailing-icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
              color="neutral"
              variant="outline"
              @click="copy()"
            />
          </div>
        </div>

        <SpecPanel
          code="BUILDR/STACK"
          class="lg:ml-auto"
        >
          <table class="w-full text-left text-sm">
            <thead>
              <tr class="border-b border-default text-xs text-muted uppercase">
                <th class="pr-4 pb-2 font-medium">#</th>
                <th class="pr-4 pb-2 font-medium">Layer</th>
                <th class="pb-2 font-medium">Detail</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-default">
              <tr
                v-for="row in stack"
                :key="row.no"
              >
                <td class="py-2 pr-4 text-dimmed tabular-nums">{{ row.no }}</td>
                <td class="py-2 pr-4 font-medium">{{ row.layer }}</td>
                <td class="py-2 text-muted">{{ row.detail }}</td>
              </tr>
            </tbody>
          </table>
        </SpecPanel>
      </div>

      <div class="mt-16">
        <p class="font-mono text-[11px] tracking-[0.08em] text-muted uppercase">What's wired in</p>
        <hr class="mt-3 border-default" />

        <dl class="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <div class="relative border border-default p-5">
            <CornerMarks />
            <dt class="font-semibold">One toolchain</dt>
            <dd class="mt-2 text-sm text-muted">
              Vite+ runs installs, dev servers, formatting, linting, type checking, and tests
              through a single <code class="bg-muted px-1 font-mono text-xs">vp</code> command.
            </dd>
          </div>

          <div class="relative border border-default p-5">
            <CornerMarks />
            <dt class="font-semibold">Auth, not a TODO</dt>
            <dd class="mt-2 text-sm text-muted">
              Better Auth wired end to end: email and password, Google sign-in, and email OTP
              password resets.
            </dd>
          </div>

          <div class="relative border border-default p-5">
            <CornerMarks />
            <dt class="font-semibold">A typed boundary</dt>
            <dd class="mt-2 text-sm text-muted">
              Drizzle and Postgres in
              <code class="bg-muted px-1 font-mono text-xs">@buildr/database</code>, shared types in
              <code class="bg-muted px-1 font-mono text-xs">@buildr/shared</code>, and Valibot
              validating every edge in between.
            </dd>
          </div>

          <div class="relative border border-default p-5">
            <CornerMarks />
            <dt class="font-semibold">CI that means it</dt>
            <dd class="mt-2 text-sm text-muted">
              GitHub Actions runs format, lint, and type checks, then a real Postgres-backed test
              suite on every push.
            </dd>
          </div>
        </dl>
      </div>
    </section>
  </div>
</template>
