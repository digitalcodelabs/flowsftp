import { useSshStore } from '../../stores/ssh'

export function getServerUrlForSession(sessionId?: string): string {
  if (!sessionId) return 'sftp://remote'
  try {
    const sshStore = useSshStore()
    const s = sshStore.sessions.find((sess) => sess.sessionId === sessionId)
    if (s) {
      const proto = s.protocol || 'sftp'
      const portPart = s.port && s.port !== 22 && s.port !== 21 ? `:${s.port}` : ''
      return `${proto}://${s.username}@${s.host}${portPart}`
    }
  } catch {}
  return 'sftp://remote'
}
