import { defineStore } from 'pinia'
import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'

interface VaultEntry {
  iv: string
  ciphertext: string
}

interface VaultFileStructure {
  version: number
  salt: string
  iterations: number
  check: VaultEntry
  entries: Record<string, VaultEntry>
}

const VERIFY_TOKEN = 'FLOWSFTP_MASTER_VAULT_V1'
const ITERATIONS = 100_000

function bufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function base64ToBuffer(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

export const useVaultStore = defineStore('vault', () => {
  const isInitialized = ref(false)
  const isUnlocked = ref(false)
  const vaultData = ref<VaultFileStructure | null>(null)
  const cachedKey = ref<CryptoKey | null>(null)

  // Dialog state for unlocking or setting up
  const showModal = ref(false)
  const modalMode = ref<'unlock' | 'setup' | 'change'>('unlock')
  const pendingResolve = ref<((success: boolean) => void) | null>(null)

  async function deriveKey(password: string, salt: Uint8Array, iterations = ITERATIONS): Promise<CryptoKey> {
    const enc = new TextEncoder()
    const passwordKey = await window.crypto.subtle.importKey(
      'raw',
      enc.encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    )

    return await window.crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt,
        iterations,
        hash: 'SHA-256',
      },
      passwordKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    )
  }

  async function encryptText(text: string, key: CryptoKey): Promise<VaultEntry> {
    const iv = window.crypto.getRandomValues(new Uint8Array(12))
    const enc = new TextEncoder()
    const ciphertext = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      enc.encode(text)
    )
    return {
      iv: bufferToBase64(iv),
      ciphertext: bufferToBase64(ciphertext),
    }
  }

  async function decryptText(entry: VaultEntry, key: CryptoKey): Promise<string> {
    const iv = base64ToBuffer(entry.iv)
    const ciphertext = base64ToBuffer(entry.ciphertext)
    const decrypted = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    )
    const dec = new TextDecoder()
    return dec.decode(decrypted)
  }

  async function init() {
    try {
      const raw = await invoke<string | null>('vault_load_file')
      if (raw) {
        const parsed: VaultFileStructure = JSON.parse(raw)
        if (parsed.version && parsed.salt && parsed.check) {
          vaultData.value = parsed
          isInitialized.value = true
          return
        }
      }
      vaultData.value = null
      isInitialized.value = false
    } catch (err) {
      console.warn('Failed to load vault file:', err)
      vaultData.value = null
      isInitialized.value = false
    }
  }

  async function persistVault() {
    if (!vaultData.value) return
    const json = JSON.stringify(vaultData.value, null, 2)
    await invoke('vault_save_file', { content: json })
  }

  async function setupMasterPassword(password: string): Promise<boolean> {
    const salt = window.crypto.getRandomValues(new Uint8Array(16))
    const key = await deriveKey(password, salt)
    const checkEntry = await encryptText(VERIFY_TOKEN, key)

    vaultData.value = {
      version: 1,
      salt: bufferToBase64(salt),
      iterations: ITERATIONS,
      check: checkEntry,
      entries: {},
    }

    await persistVault()
    cachedKey.value = key
    isInitialized.value = true
    isUnlocked.value = true
    return true
  }

  async function unlock(password: string): Promise<boolean> {
    if (!vaultData.value) {
      await init()
    }
    if (!vaultData.value) {
      throw new Error('Vault is not initialized. Please set a master password first.')
    }

    const salt = base64ToBuffer(vaultData.value.salt)
    const key = await deriveKey(password, salt, vaultData.value.iterations || ITERATIONS)

    try {
      const check = await decryptText(vaultData.value.check, key)
      if (check === VERIFY_TOKEN) {
        cachedKey.value = key
        isUnlocked.value = true
        return true
      }
      return false
    } catch (e) {
      return false
    }
  }

  function lock() {
    cachedKey.value = null
    isUnlocked.value = false
  }

  async function changeMasterPassword(oldPassword: string, newPassword: string): Promise<boolean> {
    const ok = await unlock(oldPassword)
    if (!ok || !cachedKey.value || !vaultData.value) {
      return false
    }

    // Decrypt all existing entries with the old key
    const decryptedEntries: Record<string, string> = {}
    for (const [id, entry] of Object.entries(vaultData.value.entries || {})) {
      try {
        decryptedEntries[id] = await decryptText(entry, cachedKey.value)
      } catch (err) {
        console.warn(`Failed to decrypt entry ${id} during password change:`, err)
      }
    }

    // Derive new key with fresh salt
    const newSalt = window.crypto.getRandomValues(new Uint8Array(16))
    const newKey = await deriveKey(newPassword, newSalt)
    const newCheck = await encryptText(VERIFY_TOKEN, newKey)

    // Re-encrypt all entries with new key
    const reEncryptedEntries: Record<string, VaultEntry> = {}
    for (const [id, plaintext] of Object.entries(decryptedEntries)) {
      reEncryptedEntries[id] = await encryptText(plaintext, newKey)
    }

    vaultData.value = {
      version: 1,
      salt: bufferToBase64(newSalt),
      iterations: ITERATIONS,
      check: newCheck,
      entries: reEncryptedEntries,
    }

    await persistVault()
    cachedKey.value = newKey
    isUnlocked.value = true
    return true
  }

  async function saveSecret(profileId: string, secret: string) {
    if (!isUnlocked.value || !cachedKey.value) {
      const unlocked = await promptUnlock()
      if (!unlocked || !cachedKey.value) {
        throw new Error('Master password vault is locked. Cannot save password.')
      }
    }

    if (!vaultData.value) {
      throw new Error('Vault is not initialized')
    }

    const entry = await encryptText(secret, cachedKey.value)
    if (!vaultData.value.entries) {
      vaultData.value.entries = {}
    }
    vaultData.value.entries[profileId] = entry
    await persistVault()
  }

  async function getSecret(profileId: string): Promise<string | null> {
    if (!isInitialized.value) {
      await init()
    }
    if (!isInitialized.value || !vaultData.value?.entries?.[profileId]) {
      return null
    }

    if (!isUnlocked.value || !cachedKey.value) {
      const unlocked = await promptUnlock()
      if (!unlocked || !cachedKey.value) {
        return null
      }
    }

    const entry = vaultData.value?.entries?.[profileId]
    if (!entry || !cachedKey.value) return null

    try {
      return await decryptText(entry, cachedKey.value)
    } catch (err) {
      console.warn('Failed to decrypt secret for profile:', profileId, err)
      return null
    }
  }

  async function deleteSecret(profileId: string) {
    if (!vaultData.value?.entries?.[profileId]) return
    delete vaultData.value.entries[profileId]
    await persistVault()
  }

  function promptUnlock(): Promise<boolean> {
    if (!isInitialized.value) {
      modalMode.value = 'setup'
    } else {
      modalMode.value = 'unlock'
    }
    showModal.value = true

    return new Promise((resolve) => {
      pendingResolve.value = resolve
    })
  }

  function resolvePrompt(success: boolean) {
    showModal.value = false
    if (pendingResolve.value) {
      pendingResolve.value(success)
      pendingResolve.value = null
    }
  }

  async function resetVault(): Promise<boolean> {
    try {
      await invoke('vault_delete_file')
      vaultData.value = null
      cachedKey.value = null
      isInitialized.value = false
      isUnlocked.value = false
      return true
    } catch (err) {
      console.error('Failed to reset vault:', err)
      return false
    }
  }

  return {
    isInitialized,
    isUnlocked,
    showModal,
    modalMode,
    init,
    setupMasterPassword,
    unlock,
    lock,
    changeMasterPassword,
    resetVault,
    saveSecret,
    getSecret,
    deleteSecret,
    promptUnlock,
    resolvePrompt,
  }
})
