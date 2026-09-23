<script setup lang="ts">
  import type { SubmitHandler } from '@formisch/vue';
  import { Field, Form, useForm } from '@formisch/vue';
  import * as v from 'valibot';

  definePageMeta({ auth: 'guest' });

  const route = useRoute();
  const redirectTarget = computed(() =>
    v.parse(redirectPathSchema('/overview'), route.query.redirect),
  );

  const signinForm = useForm({ schema: signinSchema });
  const signInEmail = useSignIn('email');
  const signInSocial = useSignIn('social');

  const onSubmit: SubmitHandler<typeof signinSchema> = async (output) => {
    await signInEmail.execute(
      {
        email: output.email,
        password: output.password,
      },
      {
        onSuccess: async () => {
          await navigateTo(redirectTarget.value);
        },
      },
    );
  };

  async function onGoogleSignIn(): Promise<void> {
    await signInSocial.execute({
      provider: 'google',
      callbackURL: `${useRequestURL().origin}${redirectTarget.value}`,
    });
  }
</script>

<template>
  <div class="flex min-h-screen items-center justify-center px-4">
    <SpecPanel code="AUTH/SIGNIN">
      <div class="mb-6 space-y-2 text-center">
        <div class="mx-auto flex size-10 items-center justify-center border border-default">
          <UIcon
            name="i-lucide-lock"
            class="size-5"
          />
        </div>

        <h1 class="text-lg font-semibold tracking-tight">Welcome back</h1>
        <p class="text-sm text-muted">Sign in to your account to continue</p>
      </div>

      <UButton
        :loading="signInSocial.status.value === 'pending'"
        color="neutral"
        icon="i-hugeicons-google"
        label="Continue with Google"
        block
        @click="onGoogleSignIn"
      />

      <USeparator
        label="or"
        class="my-4"
      />

      <Form
        :of="signinForm"
        class="space-y-4"
        @submit="onSubmit"
      >
        <Field
          v-slot="field"
          :of="signinForm"
          :path="['email']"
        >
          <UFormField
            :error="field.errors?.[0]"
            label="Email"
            required
          >
            <UInput
              v-model="field.input"
              v-bind="field.props"
              placeholder="you@example.com"
              class="w-full"
              type="email"
            />
          </UFormField>
        </Field>

        <Field
          v-slot="field"
          :of="signinForm"
          :path="['password']"
        >
          <UFormField
            :error="field.errors?.[0]"
            label="Password"
            required
          >
            <template #hint>
              <ULink
                to="/forgot-password"
                class="text-xs"
              >
                Forgot password?
              </ULink>
            </template>

            <UInput
              v-model="field.input"
              v-bind="field.props"
              class="w-full"
              type="password"
            />
          </UFormField>
        </Field>

        <UAlert
          v-if="signInEmail.error.value"
          :title="signInEmail.error.value.message"
          color="error"
          variant="subtle"
        />

        <UButton
          :loading="signinForm.isSubmitting || signInEmail.status.value === 'pending'"
          color="neutral"
          label="Sign in"
          type="submit"
          block
        />
      </Form>

      <p class="mt-6 text-center text-sm text-muted">
        Don't have an account?
        <ULink to="/signup">Sign up</ULink>
      </p>
    </SpecPanel>
  </div>
</template>
