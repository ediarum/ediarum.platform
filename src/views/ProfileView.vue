<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { NetworkError, ValidationError } from '../api/client'
import { changePassword, fetchProjects, PASSWORD_FIELDS } from '../auth/api'
import { useAuthStore } from '../auth/store'
import { strings } from '../strings'

const auth = useAuthStore()

/** Project names by slug; until they are loaded (or if that fails), the slugs are shown. */
const projectNames = ref<Record<string, string>>({})
onMounted(async () => {
  if (!auth.user || auth.user.projects.length === 0 || auth.user.roles.includes('admin')) return
  try {
    projectNames.value = Object.fromEntries((await fetchProjects()).map((p) => [p.slug, p.name]))
  } catch (e) {
    console.warn('[ediarum.platform] could not load project names', e)
  }
})
const projectsText = computed(() => {
  const user = auth.user
  if (!user) return ''
  if (user.roles.includes('admin')) return strings.profile.allProjects
  if (user.projects.length === 0) return strings.profile.noProjects
  return user.projects.map((slug) => projectNames.value[slug] ?? slug).join(', ')
})

const name = ref(auth.user?.name ?? '')
const nameError = ref<string | null>(null)
const nameFormError = ref<string | null>(null)
const nameSaved = ref(false)
const savingName = ref(false)

async function saveName(): Promise<void> {
  if (savingName.value) return
  nameError.value = nameFormError.value = null
  nameSaved.value = false
  if (name.value.trim() === '') {
    nameError.value = strings.profile.nameRequired
    return
  }
  savingName.value = true
  try {
    await auth.updateProfile(name.value.trim())
    name.value = auth.user?.name ?? name.value
    nameSaved.value = true
  } catch (e) {
    if (e instanceof ValidationError) {
      const { name: messages, ...other } = e.errors
      if (messages) nameError.value = messages.join(' ')
      const rest = Object.values(other).flat()
      if (rest.length > 0 || !messages) nameFormError.value = rest.length > 0 ? rest.join(' ') : e.message
    } else if (e instanceof NetworkError) nameFormError.value = strings.errors.network
    else {
      console.error('[ediarum.platform] name change failed', e)
      nameFormError.value = strings.errors.generic
    }
  } finally {
    savingName.value = false
  }
}

type Field = keyof typeof PASSWORD_FIELDS
const form = reactive<Record<Field, string>>({ current: '', new: '', confirmation: '' })
const fieldErrors = ref<Partial<Record<Field, string>>>({})
const formError = ref<string | null>(null)
const success = ref(false)
const submitting = ref(false)

const fields = [
  { key: 'current' as const, label: strings.profile.currentPassword, autocomplete: 'current-password' },
  { key: 'new' as const, label: strings.profile.newPassword, autocomplete: 'new-password' },
  { key: 'confirmation' as const, label: strings.profile.repeatPassword, autocomplete: 'new-password' },
]

/** Maps Laravel's field-keyed errors to the form; errors for unknown keys go to the form. */
function showValidationErrors(error: ValidationError): void {
  const byBackendName = Object.fromEntries(Object.entries(PASSWORD_FIELDS).map(([k, v]) => [v, k as Field]))
  const other: string[] = []
  for (const [name, messages] of Object.entries(error.errors)) {
    const field = byBackendName[name]
    if (field) fieldErrors.value[field] = messages.join(' ')
    else other.push(...messages)
  }
  if (other.length > 0 || Object.keys(fieldErrors.value).length === 0) {
    formError.value = other.length > 0 ? other.join(' ') : error.message
  }
}

async function submit(): Promise<void> {
  if (submitting.value) return
  fieldErrors.value = {}
  formError.value = null
  success.value = false
  if (form.new !== form.confirmation) {
    fieldErrors.value.confirmation = strings.profile.mismatch
    return
  }
  submitting.value = true
  try {
    await changePassword(form.current, form.new, form.confirmation)
    form.current = form.new = form.confirmation = ''
    success.value = true
  } catch (e) {
    if (e instanceof ValidationError) showValidationErrors(e)
    else if (e instanceof NetworkError) formError.value = strings.errors.network
    else {
      console.error('[ediarum.platform] password change failed', e)
      formError.value = strings.errors.generic
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div v-if="auth.user" class="ep-page">
    <h1>{{ strings.profile.title }}</h1>
    <form id="name-form" class="ep-form" novalidate @submit.prevent="saveName">
      <p v-if="nameSaved" class="ep-alert ep-alert--success" role="status">{{ strings.profile.nameSaved }}</p>
      <p v-if="nameFormError" class="ep-alert" role="alert">{{ nameFormError }}</p>
      <div class="ep-field">
        <label for="profile-name">{{ strings.profile.name }}</label>
        <input
          id="profile-name"
          v-model="name"
          class="ep-input"
          type="text"
          autocomplete="name"
          required
          :aria-invalid="nameError ? 'true' : undefined"
          :aria-describedby="nameError ? 'profile-name-error' : undefined"
        />
        <p v-if="nameError" id="profile-name-error" class="ep-field-error">{{ nameError }}</p>
      </div>
      <button type="submit" class="ep-button" :disabled="savingName">
        {{ savingName ? strings.profile.submitting : strings.profile.saveName }}
      </button>
    </form>

    <dl class="ep-profile__facts">
      <template v-if="auth.user.email">
        <dt>{{ strings.profile.email }}</dt>
        <dd>
          {{ auth.user.email }}
          <span class="ep-profile__hint">{{ strings.profile.emailFixed }}</span>
        </dd>
      </template>
      <dt>{{ strings.profile.roles }}</dt>
      <dd>{{ auth.user.roles.length > 0 ? auth.user.roles.join(', ') : strings.profile.noRoles }}</dd>
      <dt>{{ strings.profile.projects }}</dt>
      <dd>{{ projectsText }}</dd>
    </dl>

    <h2>{{ strings.profile.changePassword }}</h2>
    <form id="password-form" class="ep-form" novalidate @submit.prevent="submit">
      <p v-if="success" class="ep-alert ep-alert--success" role="status">{{ strings.profile.changed }}</p>
      <p v-if="formError" class="ep-alert" role="alert">{{ formError }}</p>
      <div v-for="field in fields" :key="field.key" class="ep-field">
        <label :for="`pw-${field.key}`">{{ field.label }}</label>
        <input
          :id="`pw-${field.key}`"
          v-model="form[field.key]"
          class="ep-input"
          type="password"
          :autocomplete="field.autocomplete"
          required
          :aria-invalid="fieldErrors[field.key] ? 'true' : undefined"
          :aria-describedby="fieldErrors[field.key] ? `pw-${field.key}-error` : undefined"
        />
        <p v-if="fieldErrors[field.key]" :id="`pw-${field.key}-error`" class="ep-field-error">
          {{ fieldErrors[field.key] }}
        </p>
      </div>
      <button type="submit" class="ep-button" :disabled="submitting">
        {{ submitting ? strings.profile.submitting : strings.profile.submit }}
      </button>
    </form>
  </div>
</template>

<style scoped>
.ep-profile__facts {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--ep-space-2) var(--ep-space-6);
  margin: 0;
}

.ep-profile__facts dt {
  color: var(--ep-color-muted);
}

.ep-profile__facts dd {
  margin: 0;
}

.ep-profile__hint {
  display: block;
  color: var(--ep-color-muted);
  font-size: 0.875em;
}
</style>
