import { describe, it, expect } from 'vitest'
import { LOCAL_PANE, isRemotePane, paneFrom, remotePane } from '../../app/lib/sftp/pane'

describe('PaneRef helpers', () => {
  it('builds local and remote panes', () => {
    expect(LOCAL_PANE).toEqual({ kind: 'local' })
    expect(remotePane('s1')).toEqual({ kind: 'remote', sessionId: 's1' })
  })

  it('tells the kinds apart', () => {
    expect(isRemotePane(LOCAL_PANE)).toBe(false)
    expect(isRemotePane(remotePane('s1'))).toBe(true)
  })

  describe('paneFrom (legacy pane + sessionId)', () => {
    it('maps "local" to the local pane regardless of the session id', () => {
      expect(paneFrom('local')).toBe(LOCAL_PANE)
      expect(paneFrom('local', 's1')).toBe(LOCAL_PANE)
      expect(paneFrom('local', null)).toBe(LOCAL_PANE)
    })

    it('maps "remote" with a session id to a remote pane', () => {
      expect(paneFrom('remote', 's1')).toEqual({ kind: 'remote', sessionId: 's1' })
    })

    it('refuses to treat a remote pane without a session as local', () => {
      expect(paneFrom('remote')).toBeNull()
      expect(paneFrom('remote', null)).toBeNull()
      expect(paneFrom('remote', '')).toBeNull()
    })
  })
})
