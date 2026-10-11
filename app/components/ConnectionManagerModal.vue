<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import {
  KeyRound,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderMinus,
  Pencil,
  Trash2,
  Plus,
  Search,
  X,
  ChevronDown,
  Server,
  Lock,
  ShieldCheck,
  Check,
  CheckCircle2,
  AlertTriangle,
  Layers,
  Terminal,
  Loader2,
  SlidersHorizontal,
} from 'lucide-vue-next'
import { useKeychainStore, type SavedConnectionProfile } from '../stores/keychain'
import { useVaultStore } from '../stores/vault'
import { useSshStore } from '../stores/ssh'

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'connected', sessionId: string): void
}>()

const keychainStore = useKeychainStore()
const vaultStore = useVaultStore()
const sshStore = useSshStore()

const isConnecting = ref(false)
const connectingProfileId = ref<string | null>(null)
const connectingProfileName = ref<string | null>(null)
const isSaving = ref(false)
const isPickingKey = ref(false)
const errorMessage = ref<string | null>(null)
const successMessage = ref<string | null>(null)
let successTimer: any = null
const showSuccess = (msg: string) => {
  successMessage.value = msg
  if (successTimer) clearTimeout(successTimer)
  successTimer = setTimeout(() => {
    successMessage.value = null
  }, 3500)
}

const currentMode = ref<'list' | 'add' | 'edit'>('list')
const editingProfileId = ref<string | null>(null)

// Rename Folder / Group modal state
const showRenameGroupModal = ref(false)
const groupToRename = ref('')
const newGroupName = ref('')
const isRenamingGroup = ref(false)
const renameGroupInputRef = ref<HTMLInputElement | null>(null)

// Ungroup Folder modal state
const showUngroupModal = ref(false)
const groupToUngroup = ref('')
const isUngrouping = ref(false)

// Quick Rename Profile modal state
const showRenameProfileModal = ref(false)
const profileToRename = ref<SavedConnectionProfile | null>(null)
const newProfileName = ref('')
const isRenamingProfile = ref(false)
const renameProfileInputRef = ref<HTMLInputElement | null>(null)

interface ConnectionLogEntry {
  time: string
  message: string
  type: 'info' | 'success' | 'error'
}

const connectionLogs = ref<ConnectionLogEntry[]>([])
const logContainerRef = ref<HTMLElement | null>(null)
let unlistenConnectLog: UnlistenFn | null = null

const addLog = (message: string, type: 'info' | 'success' | 'error' = 'info') => {
  const time = new Date().toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  connectionLogs.value.push({ time, message, type })
  nextTick(() => {
    if (logContainerRef.value) {
      logContainerRef.value.scrollTop = logContainerRef.value.scrollHeight
    }
  })
}

const clearLogs = () => {
  connectionLogs.value = []
}

// Search & Group Filter state
const searchQuery = ref('')
const selectedGroupFilter = ref<string>('all')
const collapsedGroups = ref<Set<string>>(new Set())

// Delete confirmation lightbox modal state
const showDeleteConfirmModal = ref(false)
const profileToDelete = ref<SavedConnectionProfile | null>(null)
const isDeleting = ref(false)

// New / Edit profile form state
const form = ref({
  name: '',
  group: '',
  protocol: 'sftp' as 'sftp' | 'ftp' | 'ftps',
  host: '',
  port: 22,
  username: '',
  authType: 'Password' as 'Password' | 'KeyFile',
  secret: '',
  keyPath: '',
  saveToKeychain: true,
})

const setProtocol = (proto: 'sftp' | 'ftp' | 'ftps') => {
  form.value.protocol = proto
  if (proto === 'sftp') {
    if (form.value.port === 21 || form.value.port === 990) {
      form.value.port = 22
    }
  } else if (proto === 'ftp') {
    if (form.value.port === 22 || form.value.port === 990) {
      form.value.port = 21
    }
    form.value.authType = 'Password'
  } else if (proto === 'ftps') {
    if (form.value.port === 22) {
      form.value.port = 21
    }
    form.value.authType = 'Password'
  }
}

onMounted(async () => {
  keychainStore.loadProfiles()
  vaultStore.init()

  try {
    unlistenConnectLog = await listen<string>('ssh:connect_log', (event) => {
      const msg = event.payload
      let type: 'info' | 'success' | 'error' = 'info'
      const lower = msg.toLowerCase()
      if (lower.includes('fail') || lower.includes('error') || lower.includes('reject') || lower.includes('refus')) {
        type = 'error'
      } else if (lower.includes('success') || lower.includes('verified') || lower.includes('established') || lower.includes('ready')) {
        type = 'success'
      }
      addLog(msg, type)
    })
  } catch (err) {
    console.warn('Failed to listen to ssh:connect_log', err)
  }
})

onUnmounted(() => {
  if (unlistenConnectLog) {
    unlistenConnectLog()
    unlistenConnectLog = null
  }
})

// Password prompt dialog state for connecting to profiles with missing/unsaved secrets
const showPasswordPrompt = ref(false)
const promptProfile = ref<SavedConnectionProfile | null>(null)
const promptPassword = ref('')
const promptSaveKeychain = ref(true)
const promptErrorMessage = ref<string | null>(null)
const promptIsConnecting = ref(false)
const promptPasswordInputRef = ref<HTMLInputElement | null>(null)

watch(showPasswordPrompt, (show) => {
  if (show) {
    const doFocus = () => {
      if (promptPasswordInputRef.value) {
        promptPasswordInputRef.value.focus()
        promptPasswordInputRef.value.select?.()
      }
    }
    nextTick(doFocus)
    setTimeout(doFocus, 30)
    setTimeout(doFocus, 100)
  }
})

// Available groups derived from existing profiles
const availableGroups = computed(() => {
  const set = new Set<string>()
  for (const p of keychainStore.profiles) {
    if (p.group && p.group.trim()) {
      set.add(p.group.trim())
    }
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b))
})

// Custom folder selection dropdown state
const showFolderDropdown = ref(false)

const selectFolder = (grp: string) => {
  form.value.group = grp
  showFolderDropdown.value = false
}

const clearFolder = () => {
  form.value.group = ''
  showFolderDropdown.value = false
}

// Toggle group collapse
const toggleGroupCollapse = (groupName: string) => {
  if (collapsedGroups.value.has(groupName)) {
    collapsedGroups.value.delete(groupName)
  } else {
    collapsedGroups.value.add(groupName)
  }
}

// Grouped and filtered profiles structure
interface GroupSection {
  name: string
  isUngrouped: boolean
  profiles: SavedConnectionProfile[]
}

const filteredGroupSections = computed<GroupSection[]>(() => {
  const q = searchQuery.value.trim().toLowerCase()
  const filter = selectedGroupFilter.value

  let list = keychainStore.profiles
  if (q) {
    list = list.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.host.toLowerCase().includes(q) ||
        p.username.toLowerCase().includes(q) ||
        (p.group && p.group.toLowerCase().includes(q))
    )
  }

  const map = new Map<string, SavedConnectionProfile[]>()
  const ungrouped: SavedConnectionProfile[] = []

  for (const p of list) {
    const grp = p.group?.trim()
    if (!grp) {
      ungrouped.push(p)
    } else {
      if (!map.has(grp)) map.set(grp, [])
      map.get(grp)!.push(p)
    }
  }

  const sections: GroupSection[] = []
  const sortedGroups = Array.from(map.keys()).sort((a, b) => a.localeCompare(b))

  for (const grp of sortedGroups) {
    if (filter === 'all' || filter === grp) {
      sections.push({
        name: grp,
        isUngrouped: false,
        profiles: map.get(grp)!,
      })
    }
  }

  if (ungrouped.length > 0 && (filter === 'all' || filter === '__ungrouped__')) {
    sections.push({
      name: 'Default / Ungrouped',
      isUngrouped: true,
      profiles: ungrouped,
    })
  }

  return sections
})

const totalProfilesCount = computed(() => keychainStore.profiles.length)

const formatErrorMessage = (rawMsg: string, host: string, port: number, username: string): string => {
  if (rawMsg.includes('10061') || rawMsg.includes('ConnectionRefused') || rawMsg.includes('actively refused')) {
    return `Connection actively refused on ${host}:${port}. Verify the host address, port, and that the service is running.`
  } else if (rawMsg.includes('timed out')) {
    return `Connection timed out after 10s. Verify that host ${host} is reachable and not blocked by a firewall.`
  } else if (rawMsg.includes('invalid password') || rawMsg.includes('rejected') || rawMsg.includes('530') || rawMsg.includes('authentication failed')) {
    return `Authentication failed: Invalid credentials for user '${username}'.`
  }
  return rawMsg
}

// Native file picker for SSH Private Key
const handleBrowseKeyFile = async () => {
  try {
    isPickingKey.value = true
    const selected = await invoke<string | null>('pick_key_file')
    if (selected) {
      form.value.keyPath = selected
    }
  } catch (err: any) {
    console.error('Failed to pick key file:', err)
  } finally {
    isPickingKey.value = false
  }
}

// Navigation between modes
const handleStartAdd = () => {
  editingProfileId.value = null
  form.value = {
    name: '',
    group: selectedGroupFilter.value !== 'all' && selectedGroupFilter.value !== '__ungrouped__' ? selectedGroupFilter.value : '',
    protocol: 'sftp',
    host: '',
    port: 22,
    username: '',
    authType: 'Password',
    secret: '',
    keyPath: '',
    saveToKeychain: true,
  }
  errorMessage.value = null
  currentMode.value = 'add'
}

const handleStartEdit = (profile: SavedConnectionProfile) => {
  editingProfileId.value = profile.id
  form.value = {
    name: profile.name,
    group: profile.group || '',
    protocol: profile.protocol || 'sftp',
    host: profile.host,
    port: profile.port,
    username: profile.username,
    authType: (profile.auth_type as 'Password' | 'KeyFile') || 'Password',
    secret: '', // Left blank so existing secret is preserved unless intentionally updated
    keyPath: profile.key_path || '',
    saveToKeychain: profile.has_saved_secret,
  }
  errorMessage.value = null
  currentMode.value = 'edit'
}

const handleCancelForm = () => {
  editingProfileId.value = null
  errorMessage.value = null
  currentMode.value = 'list'
}

const doConnect = async (profile: SavedConnectionProfile, authPayload: any) => {
  if (profile.protocol === 'ftp' || profile.protocol === 'ftps') {
    const password = authPayload?.type === 'Password' ? authPayload.value : (authPayload?.Password || '')
    addLog(`Connecting via ${profile.protocol.toUpperCase()} to ${profile.host}:${profile.port}...`, 'info')
    const sessionId = await sshStore.connectFtp({
      host: profile.host,
      port: profile.port,
      username: profile.username,
      password: password || undefined,
      secure: profile.protocol === 'ftps',
    })

    addLog('FTP session ready. Launching...', 'success')
    emit('connected', sessionId)
    emit('close')
    return
  }

  addLog(`Connecting via SSH to ${profile.host}:${profile.port}...`, 'info')
  const sessionId = await sshStore.connect({
    host: profile.host,
    port: profile.port,
    username: profile.username,
    auth: authPayload,
  })

  addLog('SSH session established. Launching...', 'success')
  emit('connected', sessionId)
  emit('close')
}

const handleQuickConnect = async (profile: SavedConnectionProfile) => {
  if (isConnecting.value) return
  errorMessage.value = null
  connectionLogs.value = []
  connectingProfileId.value = profile.id
  connectingProfileName.value = profile.name
  isConnecting.value = true

  addLog(`Initiating connection to "${profile.name}" (${profile.username}@${profile.host}:${profile.port})...`, 'info')

  try {
    if (profile.auth_type === 'Password') {
      let secret: string | null = null
      if (profile.has_saved_secret) {
        addLog('Checking encrypted vault for saved credentials...', 'info')
        secret = await vaultStore.getSecret(profile.id)
        if (!secret) {
          secret = await keychainStore.getSecret(profile.id)
        }
      }
      if (!secret) {
        addLog('No saved password found. Waiting for password input...', 'info')
        promptProfile.value = profile
        promptPassword.value = ''
        promptSaveKeychain.value = true
        promptErrorMessage.value = null
        showPasswordPrompt.value = true
        isConnecting.value = false
        connectingProfileId.value = null
        return
      }
      addLog('Credentials found. Connecting...', 'info')
      await doConnect(profile, { type: 'Password', value: secret })
    } else {
      let passphrase: string | undefined
      if (profile.has_saved_secret) {
        addLog('Checking encrypted vault for key passphrase...', 'info')
        passphrase = (await vaultStore.getSecret(profile.id)) || (await keychainStore.getSecret(profile.id)) || undefined
      }
      await doConnect(profile, {
        type: 'KeyFile',
        value: {
          path: profile.key_path || '',
          passphrase,
        },
      })
    }
  } catch (err: any) {
    console.error('Quick connect failed:', err)
    const formatted = formatErrorMessage(err?.message || String(err), profile.host, profile.port, profile.username)
    errorMessage.value = formatted
    addLog(`Error: ${formatted}`, 'error')
  } finally {
    isConnecting.value = false
    connectingProfileId.value = null
  }
}

const handlePromptSubmit = async () => {
  if (!promptProfile.value) return
  if (!promptPassword.value) {
    promptErrorMessage.value = 'Please enter a password'
    return
  }

  promptIsConnecting.value = true
  promptErrorMessage.value = null
  isConnecting.value = true
  connectingProfileId.value = promptProfile.value.id
  connectingProfileName.value = promptProfile.value.name
  connectionLogs.value = []

  const profile = promptProfile.value
  const password = promptPassword.value
  addLog(`Starting connection to "${profile.name}" (${profile.username}@${profile.host}:${profile.port})...`, 'info')

  try {
    if (promptSaveKeychain.value) {
      addLog('Saving credentials to encrypted vault...', 'info')
      await keychainStore.saveProfile(profile, password)
      await vaultStore.saveSecret(profile.id, password)
    }

    await doConnect(profile, { type: 'Password', value: password })
    showPasswordPrompt.value = false
  } catch (err: any) {
    const formatted = formatErrorMessage(err?.message || String(err), profile.host, profile.port, profile.username)
    promptErrorMessage.value = formatted
    addLog(`Error: ${formatted}`, 'error')
  } finally {
    promptIsConnecting.value = false
    isConnecting.value = false
    connectingProfileId.value = null
  }
}

// Save profile with or without immediate connection
const saveProfileData = async (shouldConnect: boolean) => {
  errorMessage.value = null
  isConnecting.value = shouldConnect
  isSaving.value = !shouldConnect
  if (shouldConnect) {
    connectionLogs.value = []
  }

  try {
    const host = form.value.host.trim()
    if (!host) throw new Error('Please enter a host or IP address')
    const username = form.value.username.trim()
    if (!username) throw new Error('Please enter an SSH username')
    const port = Number(form.value.port) || 22

    const isEdit = currentMode.value === 'edit' && !!editingProfileId.value
    const existingProfile = isEdit ? keychainStore.profiles.find((p) => p.id === editingProfileId.value) : null

    if (form.value.authType === 'Password') {
      if (!isEdit && !form.value.secret && shouldConnect) {
        throw new Error('Please enter an SSH password')
      }
    } else if (form.value.authType === 'KeyFile') {
      if (!form.value.keyPath.trim()) {
        throw new Error('Please specify or browse for your private key file')
      }
    }

    const profileId = editingProfileId.value || `prof-${Date.now()}`
    const profileName = form.value.name.trim() || `${username}@${host}`
    const profileGroup = form.value.group.trim() || undefined

    if (shouldConnect) {
      connectingProfileId.value = profileId
      connectingProfileName.value = profileName
      addLog(`Initiating connection to "${profileName}" (${host}:${port})...`, 'info')
    }

    const hasNewSecret = !!form.value.secret.trim()
    const willHaveSecret = hasNewSecret ? form.value.saveToKeychain : (existingProfile?.has_saved_secret ?? false)

    const profileToSave: SavedConnectionProfile = {
      id: profileId,
      name: profileName,
      group: profileGroup,
      protocol: form.value.protocol,
      host,
      port,
      username,
      auth_type: form.value.protocol === 'sftp' ? form.value.authType : 'Password',
      key_path: form.value.protocol === 'sftp' && form.value.authType === 'KeyFile' ? form.value.keyPath.trim() : undefined,
      has_saved_secret: willHaveSecret,
      created_at: existingProfile?.created_at || Math.floor(Date.now() / 1000),
    }

    if (hasNewSecret && form.value.saveToKeychain) {
      await keychainStore.saveProfile(profileToSave, form.value.secret)
      await vaultStore.saveSecret(profileToSave.id, form.value.secret)
    } else {
      await keychainStore.saveProfile(profileToSave)
    }

    if (!shouldConnect) {
      currentMode.value = 'list'
      editingProfileId.value = null
      showSuccess(isEdit ? `Profile "${profileToSave.name}" updated successfully` : `Profile "${profileToSave.name}" saved successfully`)
      return
    }

    let secretToUse = form.value.secret
    if (!secretToUse && existingProfile?.has_saved_secret) {
      secretToUse = (await vaultStore.getSecret(profileId)) || (await keychainStore.getSecret(profileId)) || ''
    }

    if (form.value.authType === 'Password' && !secretToUse) {
      currentMode.value = 'list'
      await handleQuickConnect(profileToSave)
      return
    }

    const authPayload =
      form.value.authType === 'Password'
        ? { type: 'Password' as const, value: secretToUse }
        : {
            type: 'KeyFile' as const,
            value: {
              path: form.value.keyPath.trim(),
              passphrase: secretToUse || undefined,
            },
          }

    await doConnect(profileToSave, authPayload)
  } catch (err: any) {
    console.error('Save failed:', err)
    const formatted = formatErrorMessage(
      err?.message || String(err),
      form.value.host,
      Number(form.value.port) || 22,
      form.value.username
    )
    errorMessage.value = formatted
    if (shouldConnect) {
      addLog(`Error: ${formatted}`, 'error')
    }
  } finally {
    isConnecting.value = false
    isSaving.value = false
    connectingProfileId.value = null
  }
}

// Lightbox modal delete triggers
const openDeleteConfirm = (profile: SavedConnectionProfile) => {
  profileToDelete.value = profile
  showDeleteConfirmModal.value = true
}

const closeDeleteConfirm = () => {
  if (isDeleting.value) return
  showDeleteConfirmModal.value = false
  profileToDelete.value = null
}

const executeDeleteProfile = async () => {
  if (!profileToDelete.value) return
  isDeleting.value = true
  try {
    const id = profileToDelete.value.id
    await keychainStore.deleteProfile(id)
    await vaultStore.deleteSecret(id)
    showDeleteConfirmModal.value = false
    profileToDelete.value = null
    showSuccess('Profile deleted')
  } catch (err: any) {
    console.error('Failed to delete profile:', err)
  } finally {
    isDeleting.value = false
  }
}

// Rename Folder / Group handlers
const openRenameGroupModal = (groupName: string) => {
  groupToRename.value = groupName
  newGroupName.value = groupName
  errorMessage.value = null
  showRenameGroupModal.value = true
  nextTick(() => {
    setTimeout(() => {
      if (renameGroupInputRef.value) {
        renameGroupInputRef.value.focus()
        renameGroupInputRef.value.select()
      }
    }, 50)
  })
}

const closeRenameGroupModal = () => {
  if (isRenamingGroup.value) return
  showRenameGroupModal.value = false
  groupToRename.value = ''
  newGroupName.value = ''
}

const executeRenameGroup = async () => {
  const trimmed = newGroupName.value.trim()
  if (!trimmed) {
    errorMessage.value = 'Please enter a folder name'
    return
  }
  if (trimmed === groupToRename.value) {
    closeRenameGroupModal()
    return
  }

  isRenamingGroup.value = true
  errorMessage.value = null
  try {
    const oldName = groupToRename.value
    await keychainStore.renameGroup(oldName, trimmed)
    if (selectedGroupFilter.value === oldName) {
      selectedGroupFilter.value = trimmed
    }
    if (form.value.group === oldName) {
      form.value.group = trimmed
    }
    showRenameGroupModal.value = false
    groupToRename.value = ''
    newGroupName.value = ''
    showSuccess(`Folder renamed to "${trimmed}"`)
  } catch (err: any) {
    errorMessage.value = err?.message || String(err)
  } finally {
    isRenamingGroup.value = false
  }
}

// Ungroup Folder handlers
const openUngroupModal = (groupName: string) => {
  groupToUngroup.value = groupName
  showUngroupModal.value = true
}

const closeUngroupModal = () => {
  if (isUngrouping.value) return
  showUngroupModal.value = false
  groupToUngroup.value = ''
}

const executeUngroup = async () => {
  if (!groupToUngroup.value) return
  isUngrouping.value = true
  errorMessage.value = null
  try {
    const oldName = groupToUngroup.value
    await keychainStore.renameGroup(oldName, '')
    if (selectedGroupFilter.value === oldName) {
      selectedGroupFilter.value = 'all'
    }
    if (form.value.group === oldName) {
      form.value.group = ''
    }
    showUngroupModal.value = false
    groupToUngroup.value = ''
    showSuccess(`Profiles moved to Ungrouped`)
  } catch (err: any) {
    errorMessage.value = err?.message || String(err)
  } finally {
    isUngrouping.value = false
  }
}

// Quick Rename Profile handlers
const openRenameProfileModal = (profile: SavedConnectionProfile) => {
  profileToRename.value = profile
  newProfileName.value = profile.name
  errorMessage.value = null
  showRenameProfileModal.value = true
  nextTick(() => {
    setTimeout(() => {
      if (renameProfileInputRef.value) {
        renameProfileInputRef.value.focus()
        renameProfileInputRef.value.select()
      }
    }, 50)
  })
}

const closeRenameProfileModal = () => {
  if (isRenamingProfile.value) return
  showRenameProfileModal.value = false
  profileToRename.value = null
  newProfileName.value = ''
}

const executeRenameProfile = async () => {
  if (!profileToRename.value) return
  const trimmed = newProfileName.value.trim()
  if (!trimmed) {
    errorMessage.value = 'Please enter a profile name'
    return
  }
  if (trimmed === profileToRename.value.name) {
    closeRenameProfileModal()
    return
  }

  isRenamingProfile.value = true
  errorMessage.value = null
  try {
    await keychainStore.renameProfile(profileToRename.value.id, trimmed)
    showRenameProfileModal.value = false
    profileToRename.value = null
    newProfileName.value = ''
    showSuccess(`Profile renamed to "${trimmed}"`)
  } catch (err: any) {
    errorMessage.value = err?.message || String(err)
  } finally {
    isRenamingProfile.value = false
  }
}

const profilesInRenamingGroupCount = computed(() => {
  if (!groupToRename.value) return 0
  return keychainStore.profiles.filter((p) => p.group === groupToRename.value).length
})

const profilesInUngroupingCount = computed(() => {
  if (!groupToUngroup.value) return 0
  return keychainStore.profiles.filter((p) => p.group === groupToUngroup.value).length
})

const handleFormSubmit = () => {
  if (currentMode.value === 'edit') {
    // In edit mode, submitting the form (e.g. Enter key) saves changes without forcing connection
    saveProfileData(false)
  } else {
    // In add mode, Save & Connect
    saveProfileData(true)
  }
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 select-none">
    <div
      class="w-full max-w-xl rounded-2xl border shadow-2xl overflow-hidden flex flex-col max-h-[88vh] animate-in fade-in zoom-in-95 duration-150 transition-colors duration-150"
      :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
    >
      <!-- Modal Header -->
      <div
        class="flex items-center justify-between px-5 py-3.5 border-b shrink-0 transition-colors duration-150"
        :style="{ backgroundColor: 'var(--color-bg-header)', borderColor: 'var(--color-border)' }"
      >
        <div class="flex items-center space-x-2.5">
          <div
            class="w-7 h-7 rounded-lg border flex items-center justify-center"
            :style="{ backgroundColor: 'var(--color-bg-hover)', borderColor: 'var(--color-border)', color: 'var(--color-accent)' }"
          >
            <Server class="w-4 h-4" />
          </div>
          <div>
            <h3 class="text-sm font-semibold" :style="{ color: 'var(--color-text-main)' }">Saved Connections & Keychain Vault</h3>
            <p class="text-[11px]" :style="{ color: 'var(--color-text-muted)' }">Manage, organize by folders, and connect to remote servers</p>
          </div>
        </div>
        <button
          @click="emit('close')"
          :disabled="isConnecting"
          :class="[
            'p-1.5 rounded-lg transition hover:opacity-80',
            isConnecting ? 'opacity-40 cursor-not-allowed pointer-events-none' : ''
          ]"
          :style="{ color: 'var(--color-text-muted)' }"
          title="Close"
        >
          <X class="w-4 h-4" />
        </button>
      </div>

      <!-- Mode Switcher Tabs -->
      <div
        class="flex items-center justify-between border-b px-5 pt-2 shrink-0 transition-colors duration-150"
        :style="{ backgroundColor: 'var(--color-bg-header)', borderColor: 'var(--color-border)' }"
      >
        <div class="flex space-x-4">
          <button
            @click="currentMode = 'list'"
            class="pb-2 text-xs font-medium border-b-2 transition-colors flex items-center space-x-1.5"
            :style="currentMode === 'list'
              ? { borderColor: 'var(--color-accent)', color: 'var(--color-accent)', fontWeight: '600' }
              : { borderColor: 'transparent', color: 'var(--color-text-muted)' }"
          >
            <Server class="w-3.5 h-3.5" />
            <span>Saved Profiles</span>
            <span
              class="px-1.5 py-0.5 rounded-full text-[10px]"
              :style="{ backgroundColor: 'var(--color-bg-hover)', color: 'var(--color-text-main)' }"
            >
              {{ totalProfilesCount }}
            </span>
          </button>

          <button
            v-if="currentMode === 'edit'"
            class="pb-2 text-xs font-semibold border-b-2 border-amber-400 text-amber-300 flex items-center space-x-1.5"
          >
            <Pencil class="w-3.5 h-3.5" />
            <span>Edit Profile</span>
          </button>

          <button
            @click="handleStartAdd"
            class="pb-2 text-xs font-medium border-b-2 transition-colors flex items-center space-x-1.5"
            :style="currentMode === 'add'
              ? { borderColor: 'var(--color-accent)', color: 'var(--color-accent)', fontWeight: '600' }
              : { borderColor: 'transparent', color: 'var(--color-text-muted)' }"
          >
            <Plus class="w-3.5 h-3.5" />
            <span>Add Connection</span>
          </button>
        </div>

        <div v-if="currentMode === 'list'" class="pb-2">
          <button
            @click="handleStartAdd"
            :disabled="isConnecting"
            :class="[
              'px-2.5 py-1 text-xs rounded-lg font-medium shadow-sm transition flex items-center space-x-1 btn-accent',
              isConnecting ? 'opacity-40 cursor-not-allowed pointer-events-none' : ''
            ]"
          >
            <Plus class="w-3.5 h-3.5" />
            <span>New Profile</span>
          </button>
        </div>
      </div>

      <!-- Error Toast -->
      <div v-if="errorMessage" class="mx-5 mt-3 p-3 rounded-lg bg-red-950/60 border border-red-800/50 text-red-300 text-xs shrink-0 flex items-start space-x-2">
        <AlertTriangle class="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
        <span class="flex-1">{{ errorMessage }}</span>
      </div>

      <!-- Success Toast -->
      <div v-if="successMessage" class="mx-5 mt-3 p-2.5 rounded-lg bg-emerald-950/70 border border-emerald-700/60 text-emerald-300 text-xs shrink-0 flex items-center justify-between animate-in fade-in slide-in-from-top-1 duration-150">
        <div class="flex items-center space-x-2">
          <CheckCircle2 class="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{{ successMessage }}</span>
        </div>
        <button type="button" @click="successMessage = null" class="p-0.5 text-emerald-400 hover:text-white transition" title="Dismiss">
          <X class="w-3.5 h-3.5" />
        </button>
      </div>

      <!-- ================= LIST MODE: Saved Profiles ================= -->
      <div v-if="currentMode === 'list'" class="p-5 flex-1 flex flex-col min-h-0 overflow-hidden">
        <!-- Search & Filter Controls -->
        <div v-if="totalProfilesCount > 0" class="mb-3 space-y-2 shrink-0">
          <div class="relative">
            <Search class="w-3.5 h-3.5 absolute left-2.5 top-2.5" :style="{ color: 'var(--color-text-muted)' }" />
            <input
              v-model="searchQuery"
              type="text"
              placeholder="Search by profile name, host, user, or folder..."
              class="w-full pl-8 pr-7 py-1.5 rounded-lg border text-xs focus:outline-none transition input-theme"
            />
            <button
              v-if="searchQuery"
              @click="searchQuery = ''"
              class="absolute right-2.5 top-2 hover:opacity-80"
              :style="{ color: 'var(--color-text-muted)' }"
            >
              <X class="w-3.5 h-3.5" />
            </button>
          </div>

          <!-- Group Filter Pills -->
          <div v-if="availableGroups.length > 0" class="flex items-center space-x-1.5 overflow-x-auto pb-1 text-xs">
            <span class="text-[11px] font-medium mr-0.5 shrink-0" :style="{ color: 'var(--color-text-muted)' }">Folder:</span>
            <button
              @click="selectedGroupFilter = 'all'"
              class="px-2.5 py-1 rounded-md text-[11px] font-medium transition shrink-0 flex items-center space-x-1 border"
              :style="selectedGroupFilter === 'all'
                ? { backgroundColor: 'var(--color-bg-hover)', color: 'var(--color-accent)', borderColor: 'var(--color-accent)' }
                : { backgroundColor: 'var(--color-bg-pane)', color: 'var(--color-text-muted)', borderColor: 'var(--color-border)' }"
            >
              <Layers class="w-3 h-3" />
              <span>All ({{ totalProfilesCount }})</span>
            </button>

            <button
              v-for="grp in availableGroups"
              :key="grp"
              @click="selectedGroupFilter = grp"
              class="px-2.5 py-1 rounded-md text-[11px] font-medium transition shrink-0 flex items-center space-x-1 border"
              :style="selectedGroupFilter === grp
                ? { backgroundColor: 'var(--color-bg-hover)', color: 'var(--color-accent)', borderColor: 'var(--color-accent)' }
                : { backgroundColor: 'var(--color-bg-pane)', color: 'var(--color-text-muted)', borderColor: 'var(--color-border)' }"
            >
              <Folder class="w-3 h-3" :style="{ color: 'var(--color-accent)' }" />
              <span>{{ grp }}</span>
            </button>

            <button
              @click="selectedGroupFilter = '__ungrouped__'"
              class="px-2.5 py-1 rounded-md text-[11px] font-medium transition shrink-0 flex items-center space-x-1 border"
              :style="selectedGroupFilter === '__ungrouped__'
                ? { backgroundColor: 'var(--color-bg-hover)', color: 'var(--color-accent)', borderColor: 'var(--color-accent)' }
                : { backgroundColor: 'var(--color-bg-pane)', color: 'var(--color-text-muted)', borderColor: 'var(--color-border)' }"
            >
              <FolderOpen class="w-3 h-3" :style="{ color: 'var(--color-text-muted)' }" />
              <span>Ungrouped</span>
            </button>
          </div>
        </div>

        <!-- Live Connection Progress Log Box -->
        <div
          v-if="connectionLogs.length > 0 || isConnecting"
          class="mb-3 rounded-xl border shadow-sm overflow-hidden shrink-0 transition-all duration-200"
          :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
        >
          <!-- Log Header -->
          <div
            class="flex items-center justify-between px-3 py-1.5 border-b text-[11px]"
            :style="{ backgroundColor: 'var(--color-bg-header)', borderColor: 'var(--color-border)' }"
          >
            <div class="flex items-center space-x-2">
              <span class="relative flex h-2 w-2">
                <span v-if="isConnecting" class="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" :style="{ backgroundColor: 'var(--color-accent)' }"></span>
                <span class="relative inline-flex rounded-full h-2 w-2" :style="{ backgroundColor: isConnecting ? 'var(--color-accent)' : 'var(--color-border)' }"></span>
              </span>
              <span class="font-mono font-semibold flex items-center space-x-1.5" :style="{ color: 'var(--color-accent)' }">
                <Terminal class="w-3.5 h-3.5" :style="{ color: 'var(--color-accent)' }" />
                <span>{{ isConnecting ? `Connecting: ${connectingProfileName || 'Remote Server'}...` : 'Connection Log' }}</span>
              </span>
            </div>
            <div class="flex items-center space-x-2">
              <span v-if="isConnecting" class="text-[10px] font-mono animate-pulse" :style="{ color: 'var(--color-accent)' }">Authenticating...</span>
              <button
                v-if="!isConnecting"
                type="button"
                @click="clearLogs"
                class="text-[10px] font-medium px-1.5 py-0.5 rounded transition hover:opacity-80"
                :style="{ color: 'var(--color-text-muted)' }"
              >
                Clear
              </button>
            </div>
          </div>

          <!-- Log Content Console -->
          <div
            ref="logContainerRef"
            class="p-2.5 max-h-32 overflow-y-auto font-mono text-[11px] space-y-1 select-text"
            :style="{
              backgroundColor: 'var(--color-terminal-bg)',
              color: 'var(--color-terminal-fg)'
            }"
          >
            <div
              v-for="(log, idx) in connectionLogs"
              :key="idx"
              :class="[
                'flex items-start space-x-2 leading-tight',
                log.type === 'error' ? 'text-red-600 dark:text-rose-400 font-semibold' : log.type === 'success' ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : ''
              ]"
              :style="log.type !== 'error' && log.type !== 'success' ? { color: 'var(--color-terminal-fg)' } : undefined"
            >
              <span class="select-none text-[10px] shrink-0 font-mono opacity-70" :style="{ color: 'var(--color-text-muted)' }">[{{ log.time }}]</span>
              <span class="break-all">{{ log.message }}</span>
            </div>
            <div v-if="isConnecting" class="flex items-center space-x-2 text-[10px] pt-0.5" :style="{ color: 'var(--color-accent)' }">
              <Loader2 class="w-3 h-3 animate-spin shrink-0" :style="{ color: 'var(--color-accent)' }" />
              <span class="animate-pulse">Negotiating handshake & authenticating...</span>
            </div>
          </div>
        </div>

        <!-- Empty State -->
        <div v-if="totalProfilesCount === 0" class="text-center py-12 flex-1 flex flex-col items-center justify-center">
          <div
            class="w-12 h-12 rounded-2xl border flex items-center justify-center mb-3 shadow-inner"
            :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)' }"
          >
            <Folder class="w-6 h-6" :style="{ color: 'var(--color-text-muted)' }" />
          </div>
          <p class="text-xs mb-1 font-medium" :style="{ color: 'var(--color-text-main)' }">No saved connection profiles yet.</p>
          <p class="text-[11px] mb-4 max-w-xs" :style="{ color: 'var(--color-text-muted)' }">
            Save your servers, group them into folders, and protect credentials with your master password vault.
          </p>
          <button
            @click="handleStartAdd"
            class="px-3.5 py-1.5 rounded-lg text-white text-xs font-semibold shadow-md transition flex items-center space-x-1.5 btn-accent"
          >
            <Plus class="w-3.5 h-3.5" />
            <span>Create Your First Connection</span>
          </button>
        </div>

        <!-- No search matches -->
        <div v-else-if="filteredGroupSections.length === 0" class="text-center py-8 text-xs text-slate-400">
          No connection profiles match "{{ searchQuery }}".
        </div>

        <!-- Grouped Folder List -->
        <div v-else class="flex-1 overflow-y-auto space-y-3 pr-1">
          <div
            v-for="section in filteredGroupSections"
            :key="section.name"
            class="rounded-xl border overflow-hidden shadow-sm"
            :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)' }"
          >
            <!-- Collapsible Folder Header -->
            <div
              @click="toggleGroupCollapse(section.name)"
              class="flex items-center justify-between px-3.5 py-2 cursor-pointer border-b transition group"
              :style="{ backgroundColor: 'var(--color-bg-header)', borderColor: 'var(--color-border)' }"
            >
              <div class="flex items-center space-x-2">
                <ChevronDown
                  class="w-3.5 h-3.5 transform transition-transform duration-150"
                  :class="{ '-rotate-90': collapsedGroups.has(section.name) }"
                  :style="{ color: 'var(--color-text-muted)' }"
                />
                <FolderOpen v-if="!collapsedGroups.has(section.name)" class="w-4 h-4 shrink-0" :style="{ color: 'var(--color-accent)' }" />
                <Folder v-else class="w-4 h-4 shrink-0" :style="{ color: 'var(--color-accent)' }" />
                <span class="text-xs font-semibold" :style="{ color: 'var(--color-text-main)' }">{{ section.name }}</span>
                <span
                  class="px-1.5 py-0.2 rounded-full text-[10px] border font-mono"
                  :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }"
                >
                  {{ section.profiles.length }}
                </span>
              </div>

              <!-- Folder Actions -->
              <div class="flex items-center space-x-1.5">
                <template v-if="!section.isUngrouped">
                  <button
                    type="button"
                    @click.stop="openRenameGroupModal(section.name)"
                    class="px-1.5 py-0.5 rounded text-[10px] font-medium flex items-center space-x-1 transition hover:text-amber-300 hover:bg-white/5"
                    :style="{ color: 'var(--color-text-muted)' }"
                    title="Rename Folder"
                  >
                    <Pencil class="w-3 h-3" />
                    <span>Rename</span>
                  </button>
                  <button
                    type="button"
                    @click.stop="openUngroupModal(section.name)"
                    class="px-1.5 py-0.5 rounded text-[10px] font-medium flex items-center space-x-1 transition hover:text-rose-400 hover:bg-white/5"
                    :style="{ color: 'var(--color-text-muted)' }"
                    title="Move all profiles in this folder to Ungrouped"
                  >
                    <FolderMinus class="w-3 h-3" />
                    <span>Ungroup</span>
                  </button>
                </template>
                <span class="text-[11px] opacity-0 group-hover:opacity-100 transition ml-1" :style="{ color: 'var(--color-text-muted)' }">
                  {{ collapsedGroups.has(section.name) ? 'Expand' : 'Collapse' }}
                </span>
              </div>
            </div>

            <!-- Profiles inside Folder -->
            <div v-show="!collapsedGroups.has(section.name)" class="p-2 space-y-1.5">
              <div
                v-for="prof in section.profiles"
                :key="prof.id"
                class="flex items-center justify-between p-2.5 rounded-lg border transition group"
                :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
              >
                <!-- Profile details -->
                <div class="flex flex-col min-w-0 flex-1 mr-3">
                  <div class="flex items-center space-x-1.5">
                    <span
                      @dblclick="openRenameProfileModal(prof)"
                      class="text-xs font-semibold truncate cursor-pointer hover:underline"
                      :style="{ color: 'var(--color-text-main)' }"
                      title="Double-click to quick rename profile"
                    >
                      {{ prof.name }}
                    </span>
                    <button
                      type="button"
                      @click.stop="openRenameProfileModal(prof)"
                      class="p-0.5 rounded opacity-0 group-hover:opacity-70 hover:!opacity-100 hover:text-amber-300 transition shrink-0"
                      :style="{ color: 'var(--color-text-muted)' }"
                      title="Rename Profile"
                    >
                      <Pencil class="w-3 h-3" />
                    </button>
                    <span
                      :class="[
                        'px-1.5 py-0.5 rounded text-[9px] font-mono uppercase tracking-wider font-semibold border',
                        prof.protocol === 'ftp'
                          ? 'bg-amber-950/70 text-amber-300 border-amber-800/60'
                          : prof.protocol === 'ftps'
                          ? 'bg-emerald-950/70 text-emerald-300 border-emerald-800/60'
                          : ''
                      ]"
                      :style="prof.protocol !== 'ftp' && prof.protocol !== 'ftps' ? { backgroundColor: 'var(--color-bg-pane)', color: 'var(--color-accent)', borderColor: 'var(--color-border)' } : undefined"
                    >
                      {{ prof.protocol?.toUpperCase() || 'SFTP' }}
                    </span>
                    <span
                      v-if="prof.auth_type === 'KeyFile'"
                      class="px-1.5 py-0.5 rounded text-[10px] flex items-center space-x-1 border"
                      :style="{ backgroundColor: 'var(--color-bg-pane)', color: 'var(--color-accent-secondary)', borderColor: 'var(--color-border)' }"
                      title="SSH Private Key"
                    >
                      <KeyRound class="w-3 h-3" />
                      <span>Key</span>
                    </span>
                    <span
                      v-if="prof.has_saved_secret"
                      class="px-1.5 py-0.5 rounded text-[10px] flex items-center space-x-1 border"
                      :style="{ backgroundColor: 'var(--color-bg-pane)', color: 'var(--color-accent)', borderColor: 'var(--color-border)' }"
                      title="Password secured in Encrypted Vault"
                    >
                      <ShieldCheck class="w-3 h-3" />
                      <span>Vault</span>
                    </span>
                  </div>
                  <span class="text-[11px] font-mono mt-0.5 truncate flex items-center" :style="{ color: 'var(--color-text-muted)' }">
                    <Server class="w-3 h-3 mr-1 shrink-0" :style="{ color: 'var(--color-text-muted)' }" />
                    <span>{{ prof.username }}@{{ prof.host }}:{{ prof.port }}</span>
                    <span v-if="prof.auth_type === 'KeyFile' && prof.key_path" class="ml-1.5" :style="{ color: 'var(--color-text-muted)' }">
                      ({{ prof.key_path.split(/[\\/]/).pop() }})
                    </span>
                  </span>
                </div>

                <!-- Actions -->
                <div class="flex items-center space-x-1.5">
                  <button
                    @click="handleQuickConnect(prof)"
                    :disabled="isConnecting"
                    :class="[
                      'px-3 py-1 rounded-md text-xs font-medium shadow-sm flex items-center space-x-1.5 transition select-none',
                      connectingProfileId === prof.id
                        ? 'cursor-wait ring-1 ring-white/50 opacity-90'
                        : isConnecting
                        ? 'opacity-50 cursor-not-allowed border'
                        : 'btn-accent'
                    ]"
                    :style="isConnecting && connectingProfileId !== prof.id ? { backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' } : undefined"
                  >
                    <Loader2 v-if="connectingProfileId === prof.id" class="w-3 h-3 animate-spin text-white" />
                    <Terminal v-else class="w-3 h-3" />
                    <span>{{ connectingProfileId === prof.id ? 'Connecting...' : 'Connect' }}</span>
                  </button>
                  <button
                    @click="openRenameProfileModal(prof)"
                    :disabled="isConnecting"
                    class="p-1.5 rounded-md transition hover:text-amber-300"
                    :style="{ color: 'var(--color-text-muted)' }"
                    title="Rename Profile"
                  >
                    <Pencil class="w-3.5 h-3.5" />
                  </button>
                  <button
                    @click="handleStartEdit(prof)"
                    :disabled="isConnecting"
                    class="p-1.5 rounded-md transition hover:text-sky-300"
                    :style="{ color: 'var(--color-text-muted)' }"
                    title="Edit Connection Details (Host, Port, Credentials)"
                  >
                    <SlidersHorizontal class="w-3.5 h-3.5" />
                  </button>
                  <button
                    @click="openDeleteConfirm(prof)"
                    :disabled="isConnecting"
                    class="p-1.5 rounded-md transition hover:text-rose-400"
                    :style="{ color: 'var(--color-text-muted)' }"
                    title="Delete Profile"
                  >
                    <Trash2 class="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ================= ADD / EDIT MODE: Form ================= -->
      <form
        v-else
        @submit.prevent="handleFormSubmit"
        class="p-5 flex-1 flex flex-col min-h-0 overflow-y-auto space-y-3.5"
      >
        <div class="flex items-center justify-between pb-1 border-b" :style="{ borderColor: 'var(--color-border)' }">
          <div class="flex items-center space-x-1.5 text-xs font-semibold" :style="{ color: 'var(--color-text-main)' }">
            <Pencil v-if="currentMode === 'edit'" class="w-3.5 h-3.5 text-amber-400" />
            <Plus v-else class="w-3.5 h-3.5" :style="{ color: 'var(--color-accent)' }" />
            <span>{{ currentMode === 'edit' ? 'Edit Connection Profile' : 'Create New Connection Profile' }}</span>
          </div>
          <span v-if="currentMode === 'edit'" class="text-[11px] text-amber-400 font-mono">
            Editing: {{ form.name || 'Unnamed' }}
          </span>
        </div>

        <!-- Name & Group in Grid -->
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-[11px] font-medium uppercase tracking-wider mb-1" :style="{ color: 'var(--color-text-muted)' }">
              Profile Name
            </label>
            <input
              v-model="form.name"
              type="text"
              placeholder="e.g. Production Web Server"
              class="w-full px-3 py-1.5 rounded-lg border text-xs focus:outline-none input-theme"
              :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)', color: 'var(--color-text-main)' }"
            />
          </div>

          <div class="relative">
            <label class="block text-[11px] font-medium uppercase tracking-wider mb-1" :style="{ color: 'var(--color-text-muted)' }">
              Folder / Group
            </label>
            <div class="relative flex items-center">
              <Folder class="w-3.5 h-3.5 absolute left-2.5 pointer-events-none" :style="{ color: 'var(--color-text-muted)' }" />
              <input
                v-model="form.group"
                type="text"
                placeholder="e.g. Work, Clients, Staging"
                @focus="showFolderDropdown = true"
                class="w-full pl-8 pr-7 py-1.5 rounded-lg border text-xs placeholder-slate-600 focus:outline-none transition input-theme"
                :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)', color: 'var(--color-text-main)' }"
              />
              <button
                type="button"
                @click="showFolderDropdown = !showFolderDropdown"
                class="absolute right-2 p-0.5 transition"
                :style="{ color: 'var(--color-text-muted)' }"
                tabindex="-1"
                title="Toggle folder list"
              >
                <ChevronDown
                  class="w-3.5 h-3.5 transition-transform duration-150"
                  :class="{ 'rotate-180': showFolderDropdown }"
                />
              </button>
            </div>

            <!-- Backdrop overlay to close folder dropdown on click outside -->
            <div
              v-if="showFolderDropdown"
              class="fixed inset-0 z-30"
              @click="showFolderDropdown = false"
            />

            <!-- Custom Folder Dropdown Menu -->
            <div
              v-if="showFolderDropdown"
              class="absolute left-0 right-0 top-full mt-1 border rounded-xl shadow-2xl z-40 p-1.5 max-h-48 overflow-y-auto space-y-0.5 animate-in fade-in zoom-in-95 duration-100"
              :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
            >
              <div class="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider flex items-center justify-between" :style="{ color: 'var(--color-text-muted)' }">
                <span>Select or type folder</span>
                <span class="font-normal">({{ availableGroups.length }})</span>
              </div>

              <!-- None / Ungrouped option -->
              <div
                @click="clearFolder"
                class="px-2.5 py-1.5 rounded-lg text-xs cursor-pointer flex items-center justify-between transition"
                :style="!form.group ? { backgroundColor: 'var(--color-bg-pane)', color: 'var(--color-accent)', fontWeight: 600 } : { color: 'var(--color-text-muted)' }"
              >
                <div class="flex items-center space-x-2">
                  <FolderOpen class="w-3.5 h-3.5" :style="{ color: !form.group ? 'var(--color-accent)' : 'var(--color-text-muted)' }" />
                  <span>None (Ungrouped)</span>
                </div>
                <Check v-if="!form.group" class="w-3 h-3" :style="{ color: 'var(--color-accent)' }" />
              </div>

              <!-- Existing Folders -->
              <div
                v-for="grp in availableGroups"
                :key="grp"
                class="px-2.5 py-1.5 rounded-lg text-xs flex items-center justify-between transition group/folder"
                :style="form.group === grp ? { backgroundColor: 'var(--color-bg-pane)', color: 'var(--color-accent)', fontWeight: 600 } : { color: 'var(--color-text-main)' }"
              >
                <div @click="selectFolder(grp)" class="flex items-center space-x-2 truncate flex-1 cursor-pointer">
                  <Folder class="w-3.5 h-3.5 shrink-0" :style="{ color: 'var(--color-accent)' }" />
                  <span class="truncate">{{ grp }}</span>
                </div>
                <div class="flex items-center space-x-1 shrink-0 ml-2">
                  <button
                    type="button"
                    @click.stop="openRenameGroupModal(grp)"
                    class="p-0.5 rounded opacity-0 group-hover/folder:opacity-80 hover:!opacity-100 hover:text-amber-300 transition"
                    :style="{ color: 'var(--color-text-muted)' }"
                    title="Rename this folder"
                  >
                    <Pencil class="w-3 h-3" />
                  </button>
                  <Check v-if="form.group === grp" class="w-3 h-3" :style="{ color: 'var(--color-accent)' }" />
                </div>
              </div>

              <!-- If user is typing a new group name that isn't in availableGroups -->
              <div
                v-if="form.group && !availableGroups.includes(form.group.trim())"
                @click="showFolderDropdown = false"
                class="px-2.5 py-1.5 rounded-lg text-xs text-amber-300/90 bg-amber-950/30 border border-amber-800/40 cursor-pointer flex items-center space-x-2 mt-1"
              >
                <FolderPlus class="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span class="truncate">Create new folder: "<strong>{{ form.group }}</strong>"</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Protocol Selector (SFTP / FTP / FTPS) -->
        <div>
          <label class="block text-[11px] font-medium uppercase tracking-wider mb-1" :style="{ color: 'var(--color-text-muted)' }">Protocol</label>
          <div class="grid grid-cols-3 gap-2">
            <button
              type="button"
              @click="setProtocol('sftp')"
              :class="[
                'py-1.5 text-xs rounded-lg border font-medium transition-colors flex items-center justify-center space-x-1.5',
                form.protocol === 'sftp' ? 'font-semibold shadow-sm' : ''
              ]"
              :style="form.protocol === 'sftp' ? { backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-accent)', color: 'var(--color-accent)' } : { backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }"
            >
              <Terminal class="w-3.5 h-3.5" :style="{ color: form.protocol === 'sftp' ? 'var(--color-accent)' : 'var(--color-text-muted)' }" />
              <span>SFTP (SSH)</span>
            </button>
            <button
              type="button"
              @click="setProtocol('ftp')"
              :class="[
                'py-1.5 text-xs rounded-lg border font-medium transition-colors flex items-center justify-center space-x-1.5',
                form.protocol === 'ftp'
                  ? 'bg-amber-950/70 border-amber-500/60 text-amber-300 font-semibold shadow-sm'
                  : ''
              ]"
              :style="form.protocol !== 'ftp' ? { backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' } : undefined"
            >
              <Server class="w-3.5 h-3.5 text-amber-400" />
              <span>FTP (Plain)</span>
            </button>
            <button
              type="button"
              @click="setProtocol('ftps')"
              :class="[
                'py-1.5 text-xs rounded-lg border font-medium transition-colors flex items-center justify-center space-x-1.5',
                form.protocol === 'ftps'
                  ? 'bg-emerald-950/70 border-emerald-500/60 text-emerald-300 font-semibold shadow-sm'
                  : ''
              ]"
              :style="form.protocol !== 'ftps' ? { backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' } : undefined"
            >
              <ShieldCheck class="w-3.5 h-3.5 text-emerald-400" />
              <span>FTPS (TLS)</span>
            </button>
          </div>
        </div>

        <!-- Host & Port in Grid -->
        <div class="grid grid-cols-3 gap-3">
          <div class="col-span-2">
            <label class="block text-[11px] font-medium uppercase tracking-wider mb-1" :style="{ color: 'var(--color-text-muted)' }">
              Host / IP Address
            </label>
            <input
              v-model="form.host"
              type="text"
              required
              placeholder="192.168.1.50 or server.com"
              class="w-full px-3 py-1.5 rounded-lg border text-xs focus:outline-none input-theme"
              :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)', color: 'var(--color-text-main)' }"
            />
          </div>
          <div>
            <label class="block text-[11px] font-medium uppercase tracking-wider mb-1" :style="{ color: 'var(--color-text-muted)' }">Port</label>
            <input
              v-model="form.port"
              type="number"
              required
              class="w-full px-3 py-1.5 rounded-lg border text-xs focus:outline-none input-theme"
              :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)', color: 'var(--color-text-main)' }"
            />
          </div>
        </div>

        <!-- Username -->
        <div>
          <label class="block text-[11px] font-medium uppercase tracking-wider mb-1" :style="{ color: 'var(--color-text-muted)' }">Username</label>
          <input
            v-model="form.username"
            type="text"
            required
            :placeholder="form.protocol === 'sftp' ? 'e.g. root, ubuntu' : 'e.g. anonymous or ftpuser'"
            class="w-full px-3 py-1.5 rounded-lg border text-xs focus:outline-none input-theme"
            :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)', color: 'var(--color-text-main)' }"
          />
        </div>

        <!-- Auth Method Selector (Only for SFTP/SSH) -->
        <div v-if="form.protocol === 'sftp'">
          <label class="block text-[11px] font-medium uppercase tracking-wider mb-1" :style="{ color: 'var(--color-text-muted)' }">Auth Method</label>
          <div class="grid grid-cols-2 gap-2">
            <button
              type="button"
              @click="form.authType = 'Password'"
              :class="[
                'py-1.5 text-xs rounded-lg border font-medium transition-colors flex items-center justify-center space-x-1.5',
                form.authType === 'Password' ? 'font-semibold shadow-sm' : ''
              ]"
              :style="form.authType === 'Password' ? { backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-accent)', color: 'var(--color-accent)' } : { backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }"
            >
              <Lock class="w-3.5 h-3.5" />
              <span>Password</span>
            </button>
            <button
              type="button"
              @click="form.authType = 'KeyFile'"
              :class="[
                'py-1.5 text-xs rounded-lg border font-medium transition-colors flex items-center justify-center space-x-1.5',
                form.authType === 'KeyFile' ? 'font-semibold shadow-sm' : ''
              ]"
              :style="form.authType === 'KeyFile' ? { backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-accent)', color: 'var(--color-accent)' } : { backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }"
            >
              <KeyRound class="w-3.5 h-3.5" />
              <span>Private Key</span>
            </button>
          </div>
        </div>

        <!-- Password Auth Fields -->
        <div v-if="form.authType === 'Password'">
          <div class="flex items-center justify-between mb-1">
            <label class="block text-[11px] font-medium uppercase tracking-wider" :style="{ color: 'var(--color-text-muted)' }">
              Password
            </label>
            <span v-if="currentMode === 'edit'" class="text-[10px] italic" :style="{ color: 'var(--color-text-muted)' }">
              (Leave blank to keep current saved password)
            </span>
          </div>
          <input
            v-model="form.secret"
            type="password"
            :placeholder="currentMode === 'edit' ? 'Enter new password or leave blank to keep existing' : 'Enter password'"
            class="w-full px-3 py-1.5 rounded-lg border text-xs focus:outline-none input-theme"
            :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)', color: 'var(--color-text-main)' }"
          />
        </div>

        <!-- Key File Auth Fields with Browse Button -->
        <div v-else class="space-y-3">
          <div>
            <label class="block text-[11px] font-medium uppercase tracking-wider mb-1" :style="{ color: 'var(--color-text-muted)' }">
              Private Key File
            </label>
            <div class="flex items-center space-x-2">
              <input
                v-model="form.keyPath"
                type="text"
                placeholder="C:/Users/name/.ssh/id_rsa or key.ppk"
                class="flex-1 px-3 py-1.5 rounded-lg border text-xs font-mono focus:outline-none input-theme"
                :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)', color: 'var(--color-text-main)' }"
              />
              <button
                type="button"
                @click="handleBrowseKeyFile"
                :disabled="isPickingKey"
                class="px-3 py-1.5 rounded-lg border text-xs font-medium flex items-center space-x-1.5 shrink-0 transition btn-theme-card"
                :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-main)' }"
                title="Browse file system for PuTTY (.ppk) or OpenSSH private key"
              >
                <FolderOpen class="w-3.5 h-3.5" :style="{ color: 'var(--color-text-muted)' }" />
                <span>{{ isPickingKey ? 'Browsing...' : 'Browse...' }}</span>
              </button>
            </div>
            <p class="text-[10px] mt-1" :style="{ color: 'var(--color-text-muted)' }">
              Supports PuTTY (<strong>.ppk</strong> v2 &amp; v3) and OpenSSH keys (e.g. id_ed25519, id_rsa, .pem, .key)
            </p>
          </div>

          <div>
            <div class="flex items-center justify-between mb-1">
              <label class="block text-[11px] font-medium uppercase tracking-wider" :style="{ color: 'var(--color-text-muted)' }">
                Passphrase (Optional)
              </label>
              <span v-if="currentMode === 'edit'" class="text-[10px] italic" :style="{ color: 'var(--color-text-muted)' }">
                (Leave blank to keep current passphrase)
              </span>
            </div>
            <input
              v-model="form.secret"
              type="password"
              placeholder="Key passphrase if private key is encrypted"
              class="w-full px-3 py-1.5 rounded-lg border text-xs focus:outline-none input-theme"
              :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)', color: 'var(--color-text-main)' }"
            />
          </div>
        </div>

        <!-- Keychain Save Checkbox -->
        <div class="flex items-center space-x-2 pt-1">
          <input
            v-model="form.saveToKeychain"
            id="keychainCheck"
            type="checkbox"
            class="rounded focus:ring-0"
            :style="{ accentColor: 'var(--color-accent)' }"
          />
          <label for="keychainCheck" class="text-xs cursor-pointer flex items-center space-x-1.5" :style="{ color: 'var(--color-text-main)' }">
            <ShieldCheck class="w-3.5 h-3.5" :style="{ color: 'var(--color-accent)' }" />
            <span>Save password in Encrypted Vault (Master Password protected)</span>
          </label>
        </div>

        <!-- Connection Progress in Form Mode -->
        <div
          v-if="connectionLogs.length > 0 || isConnecting"
          class="rounded-xl border shadow-sm overflow-hidden shrink-0"
          :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
        >
          <div
            class="flex items-center justify-between px-3 py-1.5 border-b text-[11px]"
            :style="{ backgroundColor: 'var(--color-bg-header)', borderColor: 'var(--color-border)' }"
          >
            <div class="flex items-center space-x-2">
              <span class="relative flex h-2 w-2">
                <span v-if="isConnecting" class="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" :style="{ backgroundColor: 'var(--color-accent)' }"></span>
                <span class="relative inline-flex rounded-full h-2 w-2" :style="{ backgroundColor: isConnecting ? 'var(--color-accent)' : 'var(--color-text-muted)' }"></span>
              </span>
              <span class="font-mono font-semibold" :style="{ color: 'var(--color-accent)' }">Connecting to {{ form.host || 'server' }}...</span>
            </div>
            <span v-if="isConnecting" class="text-[10px] font-mono animate-pulse" :style="{ color: 'var(--color-accent)' }">Authenticating...</span>
          </div>
          <div
            class="p-2.5 max-h-24 overflow-y-auto font-mono text-[10px] space-y-1 select-text"
            :style="{
              backgroundColor: 'var(--color-terminal-bg)',
              color: 'var(--color-terminal-fg)'
            }"
          >
            <div
              v-for="(log, idx) in connectionLogs"
              :key="idx"
              :class="[
                'flex items-start space-x-2 leading-tight',
                log.type === 'error' ? 'text-red-600 dark:text-rose-400 font-semibold' : log.type === 'success' ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : ''
              ]"
              :style="log.type !== 'error' && log.type !== 'success' ? { color: 'var(--color-terminal-fg)' } : undefined"
            >
              <span class="select-none text-[9px] shrink-0 font-mono opacity-70" :style="{ color: 'var(--color-text-muted)' }">[{{ log.time }}]</span>
              <span class="break-all">{{ log.message }}</span>
            </div>
          </div>
        </div>

        <!-- Action Buttons in Form -->
        <div class="flex items-center justify-between pt-3 border-t mt-auto" :style="{ borderColor: 'var(--color-border)' }">
          <button
            type="button"
            @click="handleCancelForm"
            class="px-3 py-1.5 rounded-lg text-xs transition"
            :style="{ color: 'var(--color-text-muted)' }"
          >
            Cancel
          </button>

          <div class="flex items-center space-x-2">
            <!-- Edit Mode: Save Changes is primary, Update & Connect is secondary -->
            <template v-if="currentMode === 'edit'">
              <button
                type="button"
                @click="saveProfileData(true)"
                :disabled="isConnecting || isSaving"
                class="px-3.5 py-1.5 rounded-lg border text-xs font-medium shadow-sm transition flex items-center space-x-1.5 btn-theme-card"
                :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-main)' }"
                title="Save changes and connect immediately"
              >
                <Loader2 v-if="isConnecting" class="w-3.5 h-3.5 animate-spin text-white" />
                <Terminal v-else class="w-3.5 h-3.5" :style="{ color: 'var(--color-text-muted)' }" />
                <span>{{ isConnecting ? 'Connecting...' : 'Update & Connect' }}</span>
              </button>

              <button
                type="submit"
                :disabled="isSaving || isConnecting"
                class="px-4 py-1.5 rounded-lg text-white text-xs font-semibold shadow-md flex items-center space-x-1.5 transition btn-accent"
                title="Save profile changes (Enter)"
              >
                <span v-if="isSaving" class="animate-spin w-3 h-3 border-2 border-white/30 border-t-white rounded-full mr-1" />
                <Check v-else class="w-3.5 h-3.5" />
                <span>Save Changes</span>
              </button>
            </template>

            <!-- Add Mode: Save & Connect is primary, Save Only is secondary -->
            <template v-else>
              <button
                type="button"
                @click="saveProfileData(false)"
                :disabled="isSaving || isConnecting"
                class="px-3.5 py-1.5 rounded-lg border text-xs font-medium shadow-sm transition flex items-center space-x-1.5 btn-theme-card"
                :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-main)' }"
              >
                <span v-if="isSaving" class="animate-spin w-3 h-3 border-2 border-white/30 border-t-white rounded-full mr-1" />
                <Check v-else class="w-3.5 h-3.5" :style="{ color: 'var(--color-text-muted)' }" />
                <span>Save Profile Only</span>
              </button>

              <button
                type="submit"
                :disabled="isConnecting || isSaving"
                class="px-4 py-1.5 rounded-lg disabled:opacity-50 text-white text-xs font-semibold shadow-md flex items-center space-x-1.5 transition btn-accent"
              >
                <Loader2 v-if="isConnecting" class="w-3.5 h-3.5 animate-spin text-white" />
                <Terminal v-else class="w-3.5 h-3.5" />
                <span>{{ isConnecting ? 'Connecting...' : 'Save & Connect' }}</span>
              </button>
            </template>
          </div>
        </div>
      </form>
    </div>

    <!-- Password Prompt Dialog when secret is not in Keychain/Vault -->
    <div
      v-if="showPasswordPrompt"
      class="fixed inset-0 z-60 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
      @click.self="showPasswordPrompt = false"
      @keydown.esc.stop="showPasswordPrompt = false"
    >
      <div
        class="w-full max-w-sm border rounded-2xl shadow-2xl p-5 space-y-4 animate-in fade-in zoom-in-95 duration-150"
        :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
      >
        <div class="flex items-center space-x-3">
          <div
            class="w-9 h-9 rounded-xl border flex items-center justify-center text-base"
            :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)', color: 'var(--color-accent)' }"
          >
            <KeyRound class="w-4 h-4" />
          </div>
          <div>
            <h4 class="text-sm font-semibold" :style="{ color: 'var(--color-text-main)' }">
              Enter Password ({{ promptProfile?.protocol?.toUpperCase() || 'SFTP' }})
            </h4>
            <p class="text-[11px] font-mono truncate max-w-[240px]" :style="{ color: 'var(--color-text-muted)' }">
              {{ promptProfile?.username }}@{{ promptProfile?.host }}
            </p>
          </div>
        </div>

        <div v-if="promptErrorMessage" class="p-2.5 rounded-lg bg-red-950/60 border border-red-800/60 text-red-300 text-xs flex items-center space-x-1.5">
          <AlertTriangle class="w-3.5 h-3.5 text-red-400 shrink-0" />
          <span>{{ promptErrorMessage }}</span>
        </div>

        <!-- Live Auth Progress in Password Prompt Modal -->
        <div
          v-if="connectionLogs.length > 0 || promptIsConnecting"
          class="rounded-xl border shadow-sm overflow-hidden shrink-0"
          :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
        >
          <div
            class="flex items-center justify-between px-2.5 py-1 border-b text-[10px]"
            :style="{ backgroundColor: 'var(--color-bg-header)', borderColor: 'var(--color-border)' }"
          >
            <div class="flex items-center space-x-1.5">
              <span class="relative flex h-1.5 w-1.5">
                <span v-if="promptIsConnecting" class="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" :style="{ backgroundColor: 'var(--color-accent)' }"></span>
                <span class="relative inline-flex rounded-full h-1.5 w-1.5" :style="{ backgroundColor: promptIsConnecting ? 'var(--color-accent)' : 'var(--color-text-muted)' }"></span>
              </span>
              <span class="font-mono font-medium" :style="{ color: 'var(--color-accent)' }">Authentication Status</span>
            </div>
            <span v-if="promptIsConnecting" class="text-[9px] font-mono animate-pulse" :style="{ color: 'var(--color-accent)' }">Connecting...</span>
          </div>
          <div
            class="p-2 max-h-24 overflow-y-auto font-mono text-[10px] space-y-1 select-text"
            :style="{
              backgroundColor: 'var(--color-terminal-bg)',
              color: 'var(--color-terminal-fg)'
            }"
          >
            <div
              v-for="(log, idx) in connectionLogs"
              :key="idx"
              :class="[
                'flex items-start space-x-1.5 leading-tight',
                log.type === 'error' ? 'text-red-600 dark:text-rose-400 font-semibold' : log.type === 'success' ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : ''
              ]"
              :style="log.type !== 'error' && log.type !== 'success' ? { color: 'var(--color-terminal-fg)' } : undefined"
            >
              <span class="select-none text-[9px] shrink-0 font-mono opacity-70" :style="{ color: 'var(--color-text-muted)' }">[{{ log.time }}]</span>
              <span class="break-all">{{ log.message }}</span>
            </div>
            <div v-if="promptIsConnecting" class="flex items-center space-x-1.5 text-[10px] pt-0.5" :style="{ color: 'var(--color-accent)' }">
              <Loader2 class="w-2.5 h-2.5 animate-spin shrink-0" :style="{ color: 'var(--color-accent)' }" />
              <span class="animate-pulse">Validating credentials...</span>
            </div>
          </div>
        </div>

        <form @submit.prevent="handlePromptSubmit" class="space-y-3">
          <div>
            <label class="block text-[11px] font-medium mb-1" :style="{ color: 'var(--color-text-muted)' }">Password</label>
            <input
              ref="promptPasswordInputRef"
              v-model="promptPassword"
              type="password"
              placeholder="Enter password"
              class="w-full px-3 py-1.5 rounded-lg border text-xs focus:outline-none input-theme"
              :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)', color: 'var(--color-text-main)' }"
            />
          </div>

          <div class="flex items-center space-x-2 pt-1">
            <input
              v-model="promptSaveKeychain"
              id="promptSaveKeychain"
              type="checkbox"
              class="rounded focus:ring-0"
              :style="{ accentColor: 'var(--color-accent)' }"
            />
            <label for="promptSaveKeychain" class="text-xs cursor-pointer flex items-center space-x-1.5" :style="{ color: 'var(--color-text-main)' }">
              <ShieldCheck class="w-3.5 h-3.5" :style="{ color: 'var(--color-accent)' }" />
              <span>Remember password in Encrypted Vault</span>
            </label>
          </div>

          <div class="flex items-center justify-end space-x-2 pt-2">
            <button
              type="button"
              @click="showPasswordPrompt = false"
              class="px-3 py-1.5 rounded-lg text-xs transition"
              :style="{ color: 'var(--color-text-muted)' }"
            >
              Cancel
            </button>
            <button
              type="submit"
              :disabled="promptIsConnecting"
              class="px-4 py-1.5 rounded-lg disabled:opacity-50 text-white text-xs font-semibold shadow flex items-center space-x-1.5 btn-accent"
            >
              <Loader2 v-if="promptIsConnecting" class="w-3.5 h-3.5 animate-spin text-white" />
              <Terminal v-else class="w-3.5 h-3.5" />
              <span>{{ promptIsConnecting ? 'Connecting...' : 'Connect' }}</span>
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- Custom Delete Confirmation Lightbox Modal -->
    <div
      v-if="showDeleteConfirmModal"
      class="fixed inset-0 z-70 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-150 select-none"
      @click.self="closeDeleteConfirm"
    >
      <div
        class="w-full max-w-sm border border-rose-500/30 rounded-2xl shadow-2xl p-5 space-y-4 animate-in fade-in zoom-in-95 duration-150"
        :style="{ backgroundColor: 'var(--color-bg-card)' }"
      >
        <div class="flex items-start space-x-3">
          <div class="w-10 h-10 rounded-xl bg-rose-950/60 border border-rose-500/30 flex items-center justify-center text-rose-400 shrink-0 shadow-inner">
            <Trash2 class="w-5 h-5" />
          </div>
          <div class="flex-1 min-w-0">
            <h4 class="text-sm font-semibold" :style="{ color: 'var(--color-text-main)' }">Delete Connection Profile?</h4>
            <p class="text-xs mt-1 leading-relaxed" :style="{ color: 'var(--color-text-muted)' }">
              Are you sure you want to remove <span class="font-semibold text-rose-300">"{{ profileToDelete?.name }}"</span>?
            </p>
          </div>
        </div>

        <div
          class="p-3 rounded-xl border space-y-1.5 text-xs"
          :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)' }"
        >
          <div class="flex items-center font-mono truncate" :style="{ color: 'var(--color-text-main)' }">
            <Server class="w-3.5 h-3.5 mr-2 shrink-0" :style="{ color: 'var(--color-text-muted)' }" />
            <span class="truncate">{{ profileToDelete?.username }}@{{ profileToDelete?.host }}:{{ profileToDelete?.port }}</span>
          </div>
          <div v-if="profileToDelete?.group" class="flex items-center" :style="{ color: 'var(--color-text-muted)' }">
            <Folder class="w-3.5 h-3.5 mr-2 shrink-0" :style="{ color: 'var(--color-text-muted)' }" />
            <span>Folder: {{ profileToDelete?.group }}</span>
          </div>
          <div v-if="profileToDelete?.has_saved_secret" class="flex items-start text-amber-400/90 text-[11px] pt-1.5 border-t" :style="{ borderColor: 'var(--color-border)' }">
            <AlertTriangle class="w-3.5 h-3.5 mr-1.5 shrink-0 mt-0.5 text-amber-400" />
            <span>Encrypted vault credentials for this profile will also be removed.</span>
          </div>
        </div>

        <div class="flex items-center justify-end space-x-2 pt-1">
          <button
            type="button"
            @click="closeDeleteConfirm"
            :disabled="isDeleting"
            class="px-3.5 py-1.5 rounded-lg text-xs font-medium border transition btn-theme-card"
            :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }"
          >
            Cancel
          </button>
          <button
            type="button"
            @click="executeDeleteProfile"
            :disabled="isDeleting"
            class="px-4 py-1.5 rounded-lg text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 disabled:opacity-50 shadow-md shadow-rose-950/50 flex items-center space-x-1.5 transition"
          >
            <span v-if="isDeleting" class="animate-spin w-3 h-3 border-2 border-white/30 border-t-white rounded-full mr-1" />
            <Trash2 v-else class="w-3.5 h-3.5" />
            <span>{{ isDeleting ? 'Deleting...' : 'Delete Profile' }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Rename Folder / Group Modal -->
    <div
      v-if="showRenameGroupModal"
      class="fixed inset-0 z-70 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-150 select-none"
      @click.self="closeRenameGroupModal"
      @keydown.esc="closeRenameGroupModal"
    >
      <div
        class="w-full max-w-sm border rounded-2xl shadow-2xl p-5 space-y-4 animate-in fade-in zoom-in-95 duration-150"
        :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
      >
        <div class="flex items-start space-x-3">
          <div
            class="w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 shadow-inner"
            :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)', color: 'var(--color-accent)' }"
          >
            <Folder class="w-5 h-5" />
          </div>
          <div class="flex-1 min-w-0">
            <h4 class="text-sm font-semibold" :style="{ color: 'var(--color-text-main)' }">Rename Folder</h4>
            <p class="text-xs mt-0.5" :style="{ color: 'var(--color-text-muted)' }">
              Rename folder <span class="font-semibold text-amber-300">"{{ groupToRename }}"</span>
            </p>
          </div>
        </div>

        <form @submit.prevent="executeRenameGroup" class="space-y-3">
          <div>
            <label class="block text-[11px] font-medium uppercase tracking-wider mb-1" :style="{ color: 'var(--color-text-muted)' }">
              New Folder Name
            </label>
            <input
              ref="renameGroupInputRef"
              v-model="newGroupName"
              type="text"
              required
              placeholder="e.g. Work, Staging, Clients"
              class="w-full px-3 py-1.5 rounded-lg border text-xs focus:outline-none input-theme"
              :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)', color: 'var(--color-text-main)' }"
            />
          </div>

          <div
            class="p-2.5 rounded-xl border text-[11px] space-y-1"
            :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }"
          >
            <div class="flex items-center space-x-1.5">
              <Layers class="w-3.5 h-3.5 shrink-0" :style="{ color: 'var(--color-accent)' }" />
              <span>Will update {{ profilesInRenamingGroupCount }} connection profile(s) in this folder.</span>
            </div>
            <div
              v-if="newGroupName.trim() && newGroupName.trim() !== groupToRename && availableGroups.includes(newGroupName.trim())"
              class="flex items-center space-x-1.5 text-amber-300 pt-1"
            >
              <AlertTriangle class="w-3.5 h-3.5 shrink-0" />
              <span>Folder "{{ newGroupName.trim() }}" already exists. Profiles will be merged.</span>
            </div>
          </div>

          <div class="flex items-center justify-end space-x-2 pt-2">
            <button
              type="button"
              @click="closeRenameGroupModal"
              :disabled="isRenamingGroup"
              class="px-3.5 py-1.5 rounded-lg text-xs font-medium border transition btn-theme-card"
              :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }"
            >
              Cancel
            </button>
            <button
              type="submit"
              :disabled="isRenamingGroup || !newGroupName.trim()"
              class="px-4 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-50 shadow-md flex items-center space-x-1.5 transition btn-accent"
            >
              <span v-if="isRenamingGroup" class="animate-spin w-3 h-3 border-2 border-white/30 border-t-white rounded-full mr-1" />
              <Check v-else class="w-3.5 h-3.5" />
              <span>{{ isRenamingGroup ? 'Renaming...' : 'Save Folder Name' }}</span>
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- Ungroup Folder Confirmation Modal -->
    <div
      v-if="showUngroupModal"
      class="fixed inset-0 z-70 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-150 select-none"
      @click.self="closeUngroupModal"
      @keydown.esc="closeUngroupModal"
    >
      <div
        class="w-full max-w-sm border rounded-2xl shadow-2xl p-5 space-y-4 animate-in fade-in zoom-in-95 duration-150"
        :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
      >
        <div class="flex items-start space-x-3">
          <div
            class="w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 shadow-inner"
            :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)', color: 'var(--color-accent)' }"
          >
            <FolderMinus class="w-5 h-5" />
          </div>
          <div class="flex-1 min-w-0">
            <h4 class="text-sm font-semibold" :style="{ color: 'var(--color-text-main)' }">Ungroup Folder?</h4>
            <p class="text-xs mt-0.5 leading-relaxed" :style="{ color: 'var(--color-text-muted)' }">
              Move all profiles from <span class="font-semibold text-amber-300">"{{ groupToUngroup }}"</span> to Default / Ungrouped?
            </p>
          </div>
        </div>

        <p class="text-xs" :style="{ color: 'var(--color-text-muted)' }">
          Your {{ profilesInUngroupingCount }} profile(s) will <span class="font-medium text-emerald-400">not</span> be deleted. They will simply be moved out of this folder.
        </p>

        <div class="flex items-center justify-end space-x-2 pt-2">
          <button
            type="button"
            @click="closeUngroupModal"
            :disabled="isUngrouping"
            class="px-3.5 py-1.5 rounded-lg text-xs font-medium border transition btn-theme-card"
            :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }"
          >
            Cancel
          </button>
          <button
            type="button"
            @click="executeUngroup"
            :disabled="isUngrouping"
            class="px-4 py-1.5 rounded-lg text-xs font-semibold text-white bg-amber-600 hover:bg-amber-500 disabled:opacity-50 shadow-md flex items-center space-x-1.5 transition"
          >
            <span v-if="isUngrouping" class="animate-spin w-3 h-3 border-2 border-white/30 border-t-white rounded-full mr-1" />
            <FolderMinus v-else class="w-3.5 h-3.5" />
            <span>{{ isUngrouping ? 'Ungrouping...' : 'Ungroup Folder' }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Quick Rename Profile Modal -->
    <div
      v-if="showRenameProfileModal"
      class="fixed inset-0 z-70 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-150 select-none"
      @click.self="closeRenameProfileModal"
      @keydown.esc="closeRenameProfileModal"
    >
      <div
        class="w-full max-w-sm border rounded-2xl shadow-2xl p-5 space-y-4 animate-in fade-in zoom-in-95 duration-150"
        :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
      >
        <div class="flex items-start space-x-3">
          <div
            class="w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 shadow-inner"
            :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)', color: 'var(--color-accent)' }"
          >
            <Pencil class="w-5 h-5" />
          </div>
          <div class="flex-1 min-w-0">
            <h4 class="text-sm font-semibold" :style="{ color: 'var(--color-text-main)' }">Rename Connection Profile</h4>
            <p class="text-xs mt-0.5 font-mono truncate" :style="{ color: 'var(--color-text-muted)' }">
              {{ profileToRename?.username }}@{{ profileToRename?.host }}:{{ profileToRename?.port }}
            </p>
          </div>
        </div>

        <form @submit.prevent="executeRenameProfile" class="space-y-3">
          <div>
            <label class="block text-[11px] font-medium uppercase tracking-wider mb-1" :style="{ color: 'var(--color-text-muted)' }">
              Profile Name
            </label>
            <input
              ref="renameProfileInputRef"
              v-model="newProfileName"
              type="text"
              required
              placeholder="e.g. Production Web Server"
              class="w-full px-3 py-1.5 rounded-lg border text-xs focus:outline-none input-theme"
              :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)', color: 'var(--color-text-main)' }"
            />
          </div>

          <div class="flex items-center justify-end space-x-2 pt-2">
            <button
              type="button"
              @click="closeRenameProfileModal"
              :disabled="isRenamingProfile"
              class="px-3.5 py-1.5 rounded-lg text-xs font-medium border transition btn-theme-card"
              :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }"
            >
              Cancel
            </button>
            <button
              type="submit"
              :disabled="isRenamingProfile || !newProfileName.trim()"
              class="px-4 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-50 shadow-md flex items-center space-x-1.5 transition btn-accent"
            >
              <span v-if="isRenamingProfile" class="animate-spin w-3 h-3 border-2 border-white/30 border-t-white rounded-full mr-1" />
              <Check v-else class="w-3.5 h-3.5" />
              <span>{{ isRenamingProfile ? 'Saving...' : 'Rename Profile' }}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
