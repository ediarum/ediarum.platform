<script setup lang="ts">
import { inject, onMounted, ref, useTemplateRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NetworkError } from '../api/client'
import { InvalidCredentialsError } from '../auth/api'
import { useAuthStore } from '../auth/store'
import { APPS } from '../config/loadApps'
import { targetAfterLogin } from '../router/targetAfterLogin'
import { strings } from '../strings'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()
const apps = inject(APPS, [])

const email = ref('')
const password = ref('')
const submitting = ref(false)
const error = ref<string | null>(null)
const emailInput = useTemplateRef<HTMLInputElement>('emailInput')

onMounted(() => emailInput.value?.focus())

async function submit(): Promise<void> {
  if (submitting.value) return
  submitting.value = true
  error.value = null
  try {
    await auth.login(email.value, password.value)
  } catch (e) {
    if (e instanceof InvalidCredentialsError) error.value = strings.login.failed
    else if (e instanceof NetworkError) error.value = strings.errors.network
    else {
      console.error('[ediarum.platform] login failed', e)
      error.value = strings.errors.generic
    }
    password.value = ''
    emailInput.value?.focus()
    return
  } finally {
    submitting.value = false
  }
  await router.replace(targetAfterLogin(router, apps, auth.user!, route.query.next))
}
</script>

<template>
  <div class="ep-page ep-login">
    <p class="ep-login__brand">{{ strings.productName }}</p>
    <h1>{{ strings.login.title }}</h1>
    <p v-if="auth.sessionExpired && !error" class="ep-alert" role="status">{{ strings.login.sessionExpired }}</p>
    <form class="ep-form" @submit.prevent="submit">
      <p v-if="error" id="login-error" class="ep-alert" role="alert">{{ error }}</p>
      <div class="ep-field">
        <label for="login-email">{{ strings.login.email }}</label>
        <input
          id="login-email"
          ref="emailInput"
          v-model="email"
          class="ep-input"
          type="email"
          name="email"
          autocomplete="username"
          required
          :aria-invalid="error ? 'true' : undefined"
          :aria-describedby="error ? 'login-error' : undefined"
        />
      </div>
      <div class="ep-field">
        <label for="login-password">{{ strings.login.password }}</label>
        <input
          id="login-password"
          v-model="password"
          class="ep-input"
          type="password"
          name="password"
          autocomplete="current-password"
          required
          :aria-invalid="error ? 'true' : undefined"
        />
      </div>
      <button type="submit" class="ep-button" :disabled="submitting">
        {{ submitting ? strings.login.submitting : strings.login.submit }}
      </button>
    </form>
  </div>
</template>

<style scoped>
.ep-login {
  margin: 0 auto;
  max-width: 24rem;
  padding-top: 12vh;
}

.ep-login__brand {
  margin: 0 0 var(--ep-space-6);
  font-size: 2.25rem;
  font-weight: 700;
  line-height: 1;
  color: var(--ep-color-brand);
}

.ep-login .ep-alert {
  margin-bottom: var(--ep-space-4);
}

.ep-login .ep-form .ep-alert {
  margin-bottom: 0;
}
</style>
