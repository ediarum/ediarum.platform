import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import * as authApi from './api'

export const useAuthStore = defineStore('platform-auth', () => {
  const user = ref<authApi.AccountUser | null>(null)
  const isLoggedIn = computed(() => user.value !== null)
  /** Set when a 401 ended the session, so the login page can say why the user is there. */
  const sessionExpired = ref(false)

  /** Startup check. A 401 simply means "logged out". */
  async function init(): Promise<void> {
    user.value = await authApi.fetchCurrentUser()
  }

  async function login(email: string, password: string): Promise<void> {
    user.value = await authApi.login(email, password)
    sessionExpired.value = false
  }

  /** Logs out on the server; the local session is cleared even if that request fails. */
  async function logout(): Promise<void> {
    try {
      await authApi.logout()
    } finally {
      user.value = null
      sessionExpired.value = false
    }
  }

  async function updateProfile(name: string): Promise<void> {
    user.value = await authApi.updateProfile(name)
  }

  function clear(): void {
    user.value = null
  }

  return { user, isLoggedIn, sessionExpired, init, login, logout, updateProfile, clear }
})
