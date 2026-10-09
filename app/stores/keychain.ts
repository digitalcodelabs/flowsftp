import { defineStore } from 'pinia'
import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'

export interface SavedConnectionProfile {
  id: string
  name: string
  group?: string
  protocol?: 'sftp' | 'ftp' | 'ftps'
  host: string
  port: number
  username: string
  auth_type: 'Password' | 'KeyFile' | 'Agent'
  key_path?: string
  has_saved_secret: boolean
  default_remote_path?: string
  created_at?: number
}

export const useKeychainStore = defineStore('keychain', () => {
  const profiles = ref<SavedConnectionProfile[]>([])
  const isLoading = ref(false)

  async function loadProfiles() {
    isLoading.value = true
    try {
      profiles.value = await invoke<SavedConnectionProfile[]>('keychain_list_profiles')
    } catch (err) {
      console.error('Failed to load profiles:', err)
    } finally {
      isLoading.value = false
    }
  }

  async function saveProfile(profile: SavedConnectionProfile, secret?: string): Promise<SavedConnectionProfile> {
    const saved = await invoke<SavedConnectionProfile>('keychain_save_profile', {
      profile,
      secret: secret || null,
    })
    await loadProfiles()
    return saved
  }

  async function deleteProfile(id: string): Promise<void> {
    await invoke('keychain_delete_profile', { id })
    profiles.value = profiles.value.filter((p) => p.id !== id)
  }

  async function getSecret(id: string): Promise<string | null> {
    try {
      return await invoke<string | null>('keychain_get_secret', { id })
    } catch (err) {
      console.warn('Failed to retrieve secret from keychain:', err)
      return null
    }
  }

  return {
    profiles,
    isLoading,
    loadProfiles,
    saveProfile,
    deleteProfile,
    getSecret,
  }
})
