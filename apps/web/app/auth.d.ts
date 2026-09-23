import '#nuxt-better-auth';

declare module '#nuxt-better-auth' {
  interface AuthSocialProviderRegistry {
    ids: 'google';
  }
}
