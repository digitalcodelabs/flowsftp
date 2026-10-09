<script setup lang="ts">
import { ref, watch, nextTick, onMounted } from 'vue'
import { ShieldCheck, KeyRound, AlertTriangle } from 'lucide-vue-next'
import { useVaultStore } from '../stores/vault'

const vaultStore = useVaultStore()

const password = ref('')
const confirmPassword = ref('')
const oldPassword = ref('')
const errorMessage = ref<string | null>(null)
const isSubmitting = ref(false)
const showResetConfirm = ref(false)

const handleResetVault = async () => {
  isSubmitting.value = true
  try {
    await vaultStore.resetVault()
    showResetConfirm.value = false
    vaultStore.modalMode = 'setup'
    password.value = ''
    confirmPassword.value = ''
    oldPassword.value = ''
    errorMessage.value = null
  } catch (err: any) {
    errorMessage.value = err?.message || 'Failed to reset vault'
  } finally {
    isSubmitting.value = false
  }
}

const passwordInputRef = ref<HTMLInputElement | null>(null)
const oldPasswordInputRef = ref<HTMLInputElement | null>(null)

const focusPasswordInput = () => {
  const doFocus = () => {
    const target = vaultStore.modalMode === 'change' ? oldPasswordInputRef.value : passwordInputRef.value
    if (target) {
      target.focus()
      target.select?.()
    }
  }
  nextTick(doFocus)
  setTimeout(doFocus, 30)
  setTimeout(doFocus, 100)
}

watch(
  () => vaultStore.showModal,
  (show) => {
    if (show) {
      password.value = ''
      confirmPassword.value = ''
      oldPassword.value = ''
      errorMessage.value = null
      isSubmitting.value = false
      showResetConfirm.value = false
      focusPasswordInput()
    }
  }
)

watch(
  () => vaultStore.modalMode,
  () => {
    if (vaultStore.showModal) {
      focusPasswordInput()
    }
  }
)

onMounted(() => {
  if (vaultStore.showModal) {
    focusPasswordInput()
  }
})

const handleCancel = () => {
  vaultStore.resolvePrompt(false)
}

const handleSubmit = async () => {
  errorMessage.value = null

  if (vaultStore.modalMode === 'setup') {
    if (!password.value || password.value.length < 4) {
      errorMessage.value = 'Master password must be at least 4 characters long'
      return
    }
    if (password.value !== confirmPassword.value) {
      errorMessage.value = 'Passwords do not match'
      return
    }

    isSubmitting.value = true
    try {
      await vaultStore.setupMasterPassword(password.value)
      vaultStore.resolvePrompt(true)
    } catch (err: any) {
      errorMessage.value = err?.message || 'Failed to setup master password'
    } finally {
      isSubmitting.value = false
    }
  } else if (vaultStore.modalMode === 'unlock') {
    if (!password.value) {
      errorMessage.value = 'Please enter your master password'
      return
    }

    isSubmitting.value = true
    try {
      const ok = await vaultStore.unlock(password.value)
      if (ok) {
        vaultStore.resolvePrompt(true)
      } else {
        errorMessage.value = 'Incorrect master password'
      }
    } catch (err: any) {
      errorMessage.value = err?.message || 'Failed to unlock vault'
    } finally {
      isSubmitting.value = false
    }
  } else if (vaultStore.modalMode === 'change') {
    if (!oldPassword.value) {
      errorMessage.value = 'Please enter your current master password'
      return
    }
    if (!password.value || password.value.length < 4) {
      errorMessage.value = 'New master password must be at least 4 characters long'
      return
    }
    if (password.value !== confirmPassword.value) {
      errorMessage.value = 'New passwords do not match'
      return
    }

    isSubmitting.value = true
    try {
      const ok = await vaultStore.changeMasterPassword(oldPassword.value, password.value)
      if (ok) {
        vaultStore.resolvePrompt(true)
      } else {
        errorMessage.value = 'Incorrect current master password'
      }
    } catch (err: any) {
      errorMessage.value = err?.message || 'Failed to change master password'
    } finally {
      isSubmitting.value = false
    }
  }
}
</script>

<template>
  <div
    v-if="vaultStore.showModal"
    class="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 select-none"
    @click.self="handleCancel"
    @keydown.esc.stop="handleCancel"
  >
    <div
      class="w-full max-w-sm rounded-2xl border shadow-2xl p-5 space-y-4 animate-in fade-in zoom-in-95 duration-100"
      :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
    >
      <!-- Header -->
      <div class="flex items-center space-x-3">
        <div
          class="w-10 h-10 rounded-xl border flex items-center justify-center flex-shrink-0"
          :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)', color: 'var(--color-accent)' }"
        >
          <ShieldCheck class="w-5 h-5" />
        </div>
        <div>
          <h3 class="text-sm font-semibold" :style="{ color: 'var(--color-text-main)' }">
            {{
              vaultStore.modalMode === 'setup'
                ? 'Create Master Password'
                : vaultStore.modalMode === 'change'
                ? 'Change Master Password'
                : 'Unlock Password Vault'
            }}
          </h3>
          <p class="text-[11px] mt-0.5" :style="{ color: 'var(--color-text-muted)' }">
            {{
              vaultStore.modalMode === 'setup'
                ? 'Set a master password to encrypt and protect your saved connection credentials in a local JSON vault.'
                : vaultStore.modalMode === 'change'
                ? 'Update your master password. All saved credentials will be re-encrypted.'
                : 'Enter your master password to unlock your saved connection passwords.'
            }}
          </p>
        </div>
      </div>

      <!-- Inputs -->
      <form @submit.prevent="handleSubmit" class="space-y-3">
        <!-- Old password if changing -->
        <div v-if="vaultStore.modalMode === 'change'" class="space-y-1">
          <label class="block text-[11px] font-medium" :style="{ color: 'var(--color-text-muted)' }">Current Master Password</label>
          <input
            ref="oldPasswordInputRef"
            v-model="oldPassword"
            type="password"
            placeholder="Current master password"
            class="w-full px-3 py-1.5 rounded-lg border text-xs placeholder-slate-600 focus:outline-none font-mono input-theme"
            :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)', color: 'var(--color-text-main)' }"
          />
        </div>

        <!-- Password input -->
        <div class="space-y-1">
          <label class="block text-[11px] font-medium" :style="{ color: 'var(--color-text-muted)' }">
            {{ vaultStore.modalMode === 'change' ? 'New Master Password' : 'Master Password' }}
          </label>
          <input
            ref="passwordInputRef"
            v-model="password"
            type="password"
            :placeholder="vaultStore.modalMode === 'setup' ? 'Choose a strong master password' : 'Enter master password'"
            class="w-full px-3 py-1.5 rounded-lg border text-xs placeholder-slate-600 focus:outline-none font-mono input-theme"
            :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)', color: 'var(--color-text-main)' }"
          />
        </div>

        <!-- Confirm password if setup or change -->
        <div v-if="vaultStore.modalMode === 'setup' || vaultStore.modalMode === 'change'" class="space-y-1">
          <label class="block text-[11px] font-medium" :style="{ color: 'var(--color-text-muted)' }">Confirm Password</label>
          <input
            v-model="confirmPassword"
            type="password"
            placeholder="Re-enter password"
            class="w-full px-3 py-1.5 rounded-lg border text-xs placeholder-slate-600 focus:outline-none font-mono input-theme"
            :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)', color: 'var(--color-text-main)' }"
          />
        </div>

        <!-- Error Message -->
        <div v-if="errorMessage" class="p-2.5 rounded-lg bg-red-950/60 border border-red-800/60 text-red-300 text-xs flex items-center space-x-2">
          <AlertTriangle class="w-3.5 h-3.5 text-red-400 shrink-0" />
          <span class="flex-1">{{ errorMessage }}</span>
        </div>

        <!-- Reset Vault Confirmation Panel -->
        <div
          v-if="showResetConfirm"
          class="p-3 rounded-lg bg-amber-950/40 border border-amber-800/60 text-xs space-y-2 animate-fadeIn"
        >
          <div class="flex items-center space-x-2 text-amber-300 font-medium">
            <AlertTriangle class="w-4 h-4 text-amber-400 shrink-0" />
            <span>Reset Master Password Vault?</span>
          </div>
          <p class="text-[11px] text-amber-200/80 leading-relaxed">
            All stored passwords inside the encrypted vault (<code class="font-mono">vault.json</code>) will be permanently cleared. Your server connection profiles (hosts, ports, usernames, groups, SSH key paths) will remain completely intact.
          </p>
          <div class="flex items-center justify-end space-x-2 pt-1">
            <button
              type="button"
              @click="showResetConfirm = false"
              class="px-2.5 py-1 rounded text-[11px] border btn-theme-card"
              :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }"
            >
              Back
            </button>
            <button
              type="button"
              @click="handleResetVault"
              :disabled="isSubmitting"
              class="px-2.5 py-1 rounded text-[11px] bg-red-600 hover:bg-red-700 text-white font-medium transition"
            >
              Confirm &amp; Reset
            </button>
          </div>
        </div>

        <!-- Actions -->
        <div class="flex items-center justify-between pt-1">
          <div>
            <button
              v-if="vaultStore.modalMode === 'unlock' && !showResetConfirm"
              type="button"
              @click="showResetConfirm = true"
              class="text-[11px] text-red-400 hover:text-red-300 transition underline underline-offset-2"
            >
              Forgot master password?
            </button>
          </div>
          <div class="flex items-center space-x-2">
            <button
              type="button"
              @click="handleCancel"
              class="px-3 py-1.5 rounded-lg border text-xs font-medium transition btn-theme-card"
              :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }"
            >
              Cancel
            </button>
            <button
              type="submit"
              :disabled="isSubmitting || showResetConfirm"
              class="px-3.5 py-1.5 rounded-lg text-white text-xs font-medium shadow-sm transition disabled:opacity-50 flex items-center space-x-1 btn-accent"
            >
              <span v-if="isSubmitting" class="animate-spin w-3 h-3 border border-white border-t-transparent rounded-full mr-1" />
              <span>
                {{
                  vaultStore.modalMode === 'setup'
                    ? 'Set Master Password'
                    : vaultStore.modalMode === 'change'
                    ? 'Save New Password'
                    : 'Unlock Vault'
                }}
              </span>
            </button>
          </div>
        </div>
      </form>
    </div>
  </div>
</template>
