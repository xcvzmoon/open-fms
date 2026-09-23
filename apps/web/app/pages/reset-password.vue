<script setup lang="ts">
  import type { SubmitHandler } from '@formisch/vue';
  import { Field, Form, useForm } from '@formisch/vue';
  import * as v from 'valibot';

  definePageMeta({
    auth: 'guest',
  });

  const emailQuerySchema = v.fallback(v.pipe(v.string(), v.email()), '');

  const route = useRoute();
  const resetPasswordForm = useForm({
    schema: resetPasswordSchema,
    initialInput: {
      email: v.parse(emailQuerySchema, route.query.email),
    },
  });
  const resetPassword = useAuthClientAction((client) => client.emailOtp.resetPassword);

  const succeeded = ref<boolean>(false);

  const onSubmit: SubmitHandler<typeof resetPasswordSchema> = async (output) => {
    await resetPassword.execute({
      email: output.email,
      otp: output.otp,
      password: output.password,
    });

    if (resetPassword.error.value) return;
    succeeded.value = true;
  };
</script>

<template>
  <div class="flex min-h-screen items-center justify-center px-4">
    <SpecPanel code="AUTH/RESET">
      <template v-if="succeeded">
        <div class="space-y-2 text-center">
          <div class="mx-auto flex size-10 items-center justify-center border border-default">
            <UIcon
              name="i-lucide-circle-check"
              class="size-5"
            />
          </div>
          <h1 class="text-lg font-semibold tracking-tight">Password reset</h1>
          <p class="text-sm text-muted">
            Your password has been updated. Sign in with your new password.
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
              name="i-lucide-key-round"
              class="size-5"
            />
          </div>
          <h1 class="text-lg font-semibold tracking-tight">Reset password</h1>
          <p class="text-sm text-muted">Enter the code we emailed you and choose a new password</p>
        </div>

        <Form
          :of="resetPasswordForm"
          class="space-y-4"
          @submit="onSubmit"
        >
          <Field
            v-slot="field"
            :of="resetPasswordForm"
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
            :of="resetPasswordForm"
            :path="['otp']"
          >
            <UFormField
              label="Code"
              required
              :error="field.errors?.[0]"
            >
              <UInput
                v-model="field.input"
                v-bind="field.props"
                type="text"
                inputmode="numeric"
                placeholder="123456"
                class="w-full"
              />
            </UFormField>
          </Field>

          <Field
            v-slot="field"
            :of="resetPasswordForm"
            :path="['password']"
          >
            <UFormField
              label="New password"
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
            v-if="resetPassword.error.value"
            color="error"
            variant="subtle"
            :title="resetPassword.error.value.message"
          />

          <UButton
            type="submit"
            label="Reset password"
            color="neutral"
            block
            :loading="resetPasswordForm.isSubmitting || resetPassword.status.value === 'pending'"
          />
        </Form>

        <p class="mt-6 text-center text-sm text-muted">
          Didn't get a code?
          <ULink to="/forgot-password">Request a new one</ULink>
        </p>
      </template>
    </SpecPanel>
  </div>
</template>
