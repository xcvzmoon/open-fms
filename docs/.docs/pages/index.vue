<script setup lang="ts">
import type { DocsConfig } from 'undocs/schema/config';
import { defu } from 'defu';

type LandingConfig = Exclude<DocsConfig['landing'], false | undefined>;

const appConfig = useAppConfig();
const docsConfig = appConfig.docs as DocsConfig;

const landing: LandingConfig & { _github: string } = defu(docsConfig.landing || {}, {
  navigation: false,
  title: docsConfig.name,
  description: docsConfig.description,
  heroTitle: docsConfig.name,
  heroSubtitle: docsConfig.shortDescription,
  heroDescription: docsConfig.description,
  heroLinks: {
    primary: {
      label: 'Get Started',
      icon: 'i-heroicons-rocket-launch',
      to: '/docs',
      order: 0,
    },
    github: {
      label: 'View on GitHub',
      icon: 'i-simple-icons-github',
      color: 'white',
      to: `https://github.com/${docsConfig.github}`,
      target: '_blank',
      order: 100,
    },
  },
  featuresTitle: '',
  features: [],
  _github: docsConfig.github,
});

landing._heroMdTitle =
  landing._heroMdTitle ||
  `[${landing.heroTitle}]{.text-primary} :br [${landing.heroSubtitle}]{.text-4xl}`;

usePageSEO({
  title: `${appConfig.site.name} - ${landing!.heroSubtitle}`,
  ogTitle: landing!.heroSubtitle,
  description: landing!.description,
});

function normalizeHeroLinks(links: LandingConfig['heroLinks']) {
  return Object.entries(links || {})
    .map(([key, link], order) => {
      if (!link) {
        return;
      }
      if (typeof link === 'string') {
        link = { to: link };
      }
      return {
        label: titleCase(key),
        order,
        size: 'lg',
        target: link.to?.startsWith('https') ? '_blank' : undefined,
        ...link,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a!.order - b!.order) as any[];
}

const hero = computed(() => {
  if (!landing!._heroMdTitle) {
    return;
  }
  return {
    title: landing!._heroMdTitle,
    description: landing!._heroDescription,
    links: normalizeHeroLinks(landing!.heroLinks),
    orientation: landing!.heroCode ? 'horizontal' : 'vertical',
    code: landing!.heroCode,
  } as const;
});

const includedFeatures = computed(() => landing.features || []);
</script>

<template>
  <div>
    <UPageHero v-if="hero" :orientation="hero.orientation" class="relative" :links="hero.links">
      <template #top>
        <LandingBackground />
      </template>

      <template #title>
        {{ landing.heroTitle }}<br />
        <span v-if="landing.heroSubtitle" class="text-primary text-4xl">{{
          landing.heroSubtitle
        }}</span>
      </template>

      <template #description>
        {{ landing.heroDescription }}
      </template>

      <template #links>
        <UButton v-for="link in hero.links" :key="link.label" v-bind="link" />
      </template>

      <ProseCodeGroup v-if="hero.code" class="mx-auto" style="max-width: 100%">
        <ProsePre :filename="hero.code.title || 'Terminal'" :code="hero.code.content">
          <!-- eslint-disable-next-line vue/no-v-html -->
          <span v-html="hero.code.contentHighlighted"></span>
        </ProsePre>
      </ProseCodeGroup>
    </UPageHero>

    <section v-if="includedFeatures.length" class="relative mx-auto max-w-6xl px-4 pt-20 pb-24 sm:px-6">
      <div class="mb-4">
        <span class="included-kicker">Included</span>
      </div>
      <h2 class="mb-4 text-4xl font-semibold tracking-tight text-highlighted sm:text-5xl">
        Everything a file service needs
      </h2>
      <p class="mb-10 max-w-3xl text-lg text-toned">
        The pieces most file platforms reach for ship with Open FMS, and every one of them keeps
        quarantine, scanning, and download policy consistent.
      </p>

      <div class="included-grid">
        <article v-for="feature in includedFeatures" :key="feature.title" class="included-card">
          <div class="included-card-title">
            <UIcon v-if="feature.icon" :name="feature.icon" class="size-5 text-primary" />
            <span>{{ feature.title }}</span>
            <span v-if="(feature as any).badge" class="included-card-badge">{{
              (feature as any).badge
            }}</span>
          </div>
          <!-- eslint-disable-next-line vue/no-v-html -->
          <p class="md" v-html="feature.description"></p>
        </article>
      </div>
    </section>

    <PageSponsors v-if="docsConfig.sponsors?.api" />
    <PageContributors v-if="docsConfig.landing?.contributors" />
  </div>
</template>
