const apiOrigin = process.env.API_ORIGIN ?? 'http://localhost:3000';
const siteUrl = process.env.NUXT_PUBLIC_SITE_URL ?? 'http://localhost:5173';

export default defineNuxtConfig({
  compatibilityDate: '2026-08-29',
  devServer: {
    port: Number(process.env.PORT) || 5173,
  },
  experimental: {
    typedPages: true,
  },
  devtools: {
    enabled: true,
  },
  typescript: {
    typeCheck: true,
    strict: true,
  },
  hooks: {
    'prepare:types': ({ tsConfig }) => {
      tsConfig.compilerOptions ??= {};
      tsConfig.compilerOptions.rootDir = import.meta.dirname;
    },
  },
  app: {
    head: {
      title: 'Buildr',
      charset: 'utf8',
      viewport: 'width=device-width, initial-scale=1',
      meta: [
        {
          name: 'format-detection',
          content: 'no',
        },
        {
          name: 'viewport',
          content: 'width=device-width, initial-scale=1, maximum-scale=1',
        },
      ],
    },
    pageTransition: {
      name: 'page',
      mode: 'out-in',
    },
    layoutTransition: {
      name: 'layout',
      mode: 'out-in',
    },
  },
  router: {
    options: {
      scrollBehaviorType: 'smooth',
    },
  },
  routeRules: {
    '/api/**': {
      proxy: {
        to: `${apiOrigin}/api/**`,
        fetchOptions: {
          redirect: 'manual',
        },
      },
    },
  },
  runtimeConfig: {
    public: {
      siteUrl,
    },
  },
  css: ['~/assets/css/main.css'],
  modules: [
    '@nuxt/ui',
    '@vueuse/nuxt',
    '@pinia/nuxt',
    '@pinia/colada-nuxt',
    'pinia-plugin-persistedstate/nuxt',
    '@nuxtjs/better-auth',
  ],
  auth: {
    clientOnly: true,
    redirects: {
      login: '/signin',
      guest: '/overview',
      authenticated: '/overview',
      logout: '/signin',
    },
  },
});
