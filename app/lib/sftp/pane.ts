/**
 * Identifies one of the two panes: the local filesystem, or a remote server reached through
 * a specific session.
 *
 * The UI historically addresses a pane as `'local' | 'remote'` plus an optional session id,
 * which lets "remote without a session" be expressed and, in the past, mistaken for local.
 * A PaneRef cannot represent that: a remote pane always carries its session.
 */
export type LocalPane = { readonly kind: 'local' }
export type RemotePane = { readonly kind: 'remote'; readonly sessionId: string }
export type PaneRef = LocalPane | RemotePane

export const LOCAL_PANE: LocalPane = { kind: 'local' }

export function remotePane(sessionId: string): RemotePane {
  return { kind: 'remote', sessionId }
}

export function isRemotePane(pane: PaneRef): pane is RemotePane {
  return pane.kind === 'remote'
}

/**
 * Converts the legacy `pane + sessionId` pair into a PaneRef.
 * Returns null for a remote pane without a session, so callers must decide what that means
 * instead of silently treating it as local.
 */
export function paneFrom(pane: 'local' | 'remote', sessionId?: string | null): PaneRef | null {
  if (pane === 'local') return LOCAL_PANE
  return sessionId ? remotePane(sessionId) : null
}
