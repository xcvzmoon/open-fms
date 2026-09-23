<script setup lang="ts">
  import type { SubmitHandler } from '@formisch/vue';
  import { Field, Form, useForm } from '@formisch/vue';

  definePageMeta({
    auth: 'guest',
  });

  const forgotPasswordForm = useForm({ schema: forgotPasswordSchema });
  const sendVerificationOtp = useAuthClientAction((client) => client.emailOtp.sendVerificationOtp);

  const onSubmit: SubmitHandler<typeof forgotPasswordSchema> = async (output) => {
    await sendVerificationOtp.execute({ email: output.email, type: 'forget-password' });
    if (sendVerificationOtp.error.value) return;
    await navigateTo({ path: '/reset-password', query: { email: output.email } });
  };
</script>

<template>
  <div class="flex min-h-screen items-center justify-center px-4">
    <SpecPanel code="AUTH/RECOVER">
      <div class="mb-6 space-y-2 text-center">
        <div class="mx-auto flex size-10 items-center justify-center border border-default">
          <UIcon
            name="i-lucide-key-round"
            class="size-5"
          />
        </div>
        <h1 class="text-lg font-semibold tracking-tight">Forgot password</h1>
        <p class="text-sm text-muted">We'll email you a code to reset your password</p>
      </div>

      <Form
        :of="forgotPasswordForm"
        class="space-y-4"
        @submit="onSubmit"
      >
        <Field
          v-slot="field"
          :of="forgotPasswordForm"
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

        <UAlert
          v-if="sendVerificationOtp.error.value"
          color="error"
          variant="subtle"
          :title="sendVerificationOtp.error.value.message"
        />

        <UButton
          type="submit"
          label="Send reset code"
          color="neutral"
          block
          :loading="
            forgotPasswordForm.isSubmitting || sendVerificationOtp.status.value === 'pending'
          "
        />
      </Form>

      <p class="mt-6 text-center text-sm text-muted">
        Remembered your password?
        <ULink to="/signin">Sign in</ULink>
      </p>
    </SpecPanel>
  </div>
</template>
