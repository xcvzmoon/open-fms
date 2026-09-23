<script setup lang="ts">
  import type { SubmitHandler } from '@formisch/vue';
  import { Field, Form, useForm } from '@formisch/vue';

  definePageMeta({ auth: 'guest' });

  const signupForm = useForm({ schema: signupSchema });
  const signUpEmail = useSignUp('email');
  const signInSocial = useSignIn('social');

  const submitted = ref<boolean>(false);

  const onSubmit: SubmitHandler<typeof signupSchema> = async (output) => {
    await signUpEmail.execute(
      {
        name: output.name,
        email: output.email,
        password: output.password,
      },
      {
        onSuccess: () => {
          submitted.value = true;
        },
      },
    );
  };

  async function onGoogleSignIn(): Promise<void> {
    await signInSocial.execute({
      provider: 'google',
      callbackURL: `${useRequestURL().origin}/overview`,
    });
  }
</script>

<template>
  <div class="flex min-h-screen items-center justify-center px-4">
    <SpecPanel code="AUTH/SIGNUP">
      <template v-if="submitted">
        <div class="space-y-2 text-center">
          <div class="mx-auto flex size-10 items-center justify-center border border-default">
            <UIcon
              name="i-lucide-mail-check"
              class="size-5"
            />
          </div>
          <h1 class="text-lg font-semibold tracking-tight">Check your email</h1>
          <p class="text-sm text-muted">
            We sent a verification link to your email address. Click it to activate your account.
          </p>
        </div>

        <UButton
          label="Back to sign in"
          color="neutral"
          variant="subtle"
          block
          class="mt-6"
          to="/signin"
        />
      </template>

      <template v-else>
        <div class="mb-6 space-y-2 text-center">
          <div class="mx-auto flex size-10 items-center justify-center border border-default">
            <UIcon
              name="i-lucide-user-plus"
              class="size-5"
            />
          </div>
          <h1 class="text-lg font-semibold tracking-tight">Create an account</h1>
          <p class="text-sm text-muted">Get started with your new account</p>
        </div>

        <UButton
          label="Continue with Google"
          icon="i-hugeicons-google"
          color="neutral"
          variant="subtle"
          block
          :loading="signInSocial.status.value === 'pending'"
          @click="onGoogleSignIn"
        />

        <USeparator
          label="or"
          class="my-4"
        />

        <Form
          :of="signupForm"
          class="space-y-4"
          @submit="onSubmit"
        >
          <Field
            v-slot="field"
            :of="signupForm"
            :path="['name']"
          >
            <UFormField
              label="Name"
              required
              :error="field.errors?.[0]"
            >
              <UInput
                v-model="field.input"
                v-bind="field.props"
                type="text"
                placeholder="Jane Doe"
                class="w-full"
              />
            </UFormField>
          </Field>

          <Field
            v-slot="field"
            :of="signupForm"
            :path="['email']"
          >
            <UFormField
              label="Email"
              required
              :error="field.errors?.[0]"
            >
              <UInput
                v-model="field.input"
                v-bind="field.props"
                type="email"
                placeholder="you@example.com"
                class="w-full"
              />
            </UFormField>
          </Field>

          <Field
            v-slot="field"
            :of="signupForm"
            :path="['password']"
          >
            <UFormField
              label="Password"
              required
              :error="field.errors?.[0]"
            >
              <UInput
                v-model="field.input"
                v-bind="field.props"
                type="password"
                class="w-full"
              />
            </UFormField>
          </Field>

          <UAlert
            v-if="signUpEmail.error.value"
            color="error"
            variant="subtle"
            :title="signUpEmail.error.value.message"
          />

          <UButton
            type="submit"
            label="Sign up"
            color="neutral"
            block
            :loading="signupForm.isSubmitting || signUpEmail.status.value === 'pending'"
          />
        </Form>

        <p class="mt-6 text-center text-sm text-muted">
          Already have an account?
          <ULink to="/signin">Sign in</ULink>
        </p>
      </template>
    </SpecPanel>
  </div>
</template>
