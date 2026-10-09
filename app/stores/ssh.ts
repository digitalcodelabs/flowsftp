import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { invoke } from '@tauri-apps/api/core'

export interface SshAuthPassword {
  type: 'Password'
  value: string
}

export interface SshAuthKeyFile {
  type: 'KeyFile'
  value: {
    path: string
    passphrase?: string
  }
}

export interface SshAuthAgent {
  type: 'Agent'
}

export type SshAuthMethod = SshAuthPassword | SshAuthKeyFile | SshAuthAgent

export interface SshConnectConfig {
  host: string
  port: number
  username: string
  auth: SshAuthMethod
  cols?: number
  rows?: number
  term?: string
}

export interface FtpConnectConfig {
  host: string
  port: number
  username: string
  password?: string
  secure: boolean
}

export interface SshSessionItem {
  sessionId: string
  host: string
  port: number
  username: string
  protocol?: 'sftp' | 'ftp' | 'ftps'
  status: 'connecting' | 'connected' | 'disconnected' | 'error'
  error?: string
}

export interface BackendSessionInfo {
  session_id: string
  host: string
  port: number
  username: string
  protocol: string
}

export const useSshStore = defineStore('ssh', () => {
  const sessions = ref<SshSessionItem[]>([])
  const activeSessionId = ref<string | null>(null)
  const ACTIVE_SESSION_STORAGE_KEY = 'termsftp_active_session_id'
  const lastConnectConfigs = ref<Record<string, SshConnectConfig | FtpConnectConfig>>({})

  const activeSession = computed(() =>
    sessions.value.find((s) => s.sessionId === activeSessionId.value)
  )

  async function restoreSessions(): Promise<void> {
    try {
      const backendSessions = await invoke<BackendSessionInfo[]>('ssh_list_sessions')
      if (backendSessions && backendSessions.length > 0) {
        sessions.value = backendSessions.map((s) => ({
          sessionId: s.session_id,
          host: s.host,
          port: s.port,
          username: s.username,
          protocol: (s.protocol as 'sftp' | 'ftp' | 'ftps') || 'sftp',
          status: 'connected' as const,
        }))

        // Restore activeSessionId from localStorage or default to first session
        const savedActive = localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY)
        if (savedActive && sessions.value.some((s) => s.sessionId === savedActive)) {
          activeSessionId.value = savedActive
        } else {
          activeSessionId.value = sessions.value[0].sessionId
          localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, sessions.value[0].sessionId)
        }
      } else {
        sessions.value = []
        activeSessionId.value = null
        localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY)
      }
    } catch (err) {
      console.warn('Failed to restore active sessions from backend:', err)
    }
  }

  async function connect(config: SshConnectConfig): Promise<string> {
    const tempId = `temp-${Date.now()}`
    const item: SshSessionItem = {
      sessionId: tempId,
      host: config.host,
      port: config.port,
      username: config.username,
      protocol: 'sftp',
      status: 'connecting',
    }
    sessions.value.push(item)

    try {
      const sessionId = await invoke<string>('ssh_connect', {
        config: {
          host: config.host,
          port: config.port,
          username: config.username,
          auth: config.auth,
          cols: config.cols ?? 80,
          rows: config.rows ?? 24,
          term: config.term ?? 'xterm-256color',
        },
      })

      // Update session item with actual backend session ID
      item.sessionId = sessionId
      item.status = 'connected'
      activeSessionId.value = sessionId
      localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, sessionId)
      lastConnectConfigs.value[sessionId] = config
      return sessionId
    } catch (err: any) {
      sessions.value = sessions.value.filter((s) => s.sessionId !== tempId)
      const errorMsg = typeof err === 'string' ? err : err?.message || 'Connection failed'
      throw new Error(errorMsg)
    }
  }

  async function connectFtp(config: FtpConnectConfig): Promise<string> {
    const tempId = `temp-${Date.now()}`
    const item: SshSessionItem = {
      sessionId: tempId,
      host: config.host,
      port: config.port,
      username: config.username,
      protocol: config.secure ? 'ftps' : 'ftp',
      status: 'connecting',
    }
    sessions.value.push(item)

    try {
      const sessionId = await invoke<string>('ftp_connect', {
        host: config.host,
        port: config.port,
        username: config.username,
        password: config.password || null,
        secure: config.secure,
      })

      item.sessionId = sessionId
      item.status = 'connected'
      activeSessionId.value = sessionId
      localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, sessionId)
      lastConnectConfigs.value[sessionId] = config
      return sessionId
    } catch (err: any) {
      sessions.value = sessions.value.filter((s) => s.sessionId !== tempId)
      const errorMsg = typeof err === 'string' ? err : err?.message || 'FTP Connection failed'
      throw new Error(errorMsg)
    }
  }

  async function reconnect(oldSessionId: string): Promise<string> {
    const config = lastConnectConfigs.value[oldSessionId]
    if (!config) {
      throw new Error('No connection config available to reconnect')
    }
    await disconnect(oldSessionId)
    if ('auth' in config) {
      const newId = await connect(config)
      return newId
    } else {
      const newId = await connectFtp(config)
      return newId
    }
  }

  async function disconnect(sessionId: string): Promise<void> {
    try {
      await invoke('ssh_disconnect', { sessionId })
    } catch (err) {
      console.warn('Error during disconnect:', err)
    } finally {
      sessions.value = sessions.value.filter((s) => s.sessionId !== sessionId)
      if (activeSessionId.value === sessionId) {
        const nextId = sessions.value.length > 0 ? sessions.value[0].sessionId : null
        activeSessionId.value = nextId
        if (nextId) {
          localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, nextId)
        } else {
          localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY)
        }
      }
    }
  }

  function setActiveSession(sessionId: string) {
    activeSessionId.value = sessionId
    localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, sessionId)
  }

  return {
    sessions,
    activeSessionId,
    activeSession,
    connect,
    connectFtp,
    reconnect,
    disconnect,
    setActiveSession,
    restoreSessions,
  }
})
