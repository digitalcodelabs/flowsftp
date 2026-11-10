import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const invokeMock = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

import { useUpdaterStore } from '../../app/stores/updater'

describe('Updater Store (in-app update check & installation)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    invokeMock.mockReset()
  })

  it('populates update state and shows header badge when a newer version is available', async () => {
    invokeMock.mockResolvedValueOnce({
      updateAvailable: true,
      currentVersion: '0.9.1',
      latestVersion: '0.9.2',
      downloadUrl: 'https://flowsftp.com/storage/releases/FlowSFTP-Windows-x64-v0.9.2.exe',
      notes: '### New in v0.9.2\n- In-app auto-updater',
      pubDate: '2026-11-10T12:00:00Z',
      signature: null,
      platform: 'windows',
      arch: 'x86_64',
    })

    const store = useUpdaterStore()
    const res = await store.checkForUpdates({ silent: false })

    expect(res?.updateAvailable).toBe(true)
    expect(store.updateAvailable).toBe(true)
    expect(store.latestVersion).toBe('0.9.2')
    expect(store.downloadUrl).toBe('https://flowsftp.com/storage/releases/FlowSFTP-Windows-x64-v0.9.2.exe')
    expect(store.releaseNotes).toContain('In-app auto-updater')
    expect(store.showHeaderUpdateBadge).toBe(true)

    // Dismissing hides the header pill until manual check or next version
    store.dismissUpdate()
    expect(store.showHeaderUpdateBadge).toBe(false)
  })

  it('handles up-to-date response (204 No Content mapped by backend)', async () => {
    invokeMock.mockResolvedValueOnce({
      updateAvailable: false,
      currentVersion: '0.9.1',
      latestVersion: '0.9.1',
      downloadUrl: null,
      notes: null,
      pubDate: null,
      signature: null,
      platform: 'windows',
      arch: 'x86_64',
    })

    const store = useUpdaterStore()
    await store.checkForUpdates()

    expect(store.updateAvailable).toBe(false)
    expect(store.showHeaderUpdateBadge).toBe(false)
    expect(store.statusMessage).toContain('up to date')
  })

  it('invokes app_download_and_install_update with downloadUrl and version', async () => {
    invokeMock
      .mockResolvedValueOnce({
        updateAvailable: true,
        currentVersion: '0.9.1',
        latestVersion: '0.9.2',
        downloadUrl: 'https://flowsftp.com/storage/releases/FlowSFTP-Windows-x64-v0.9.2.exe',
        notes: 'Release notes',
        pubDate: '2026-11-10T12:00:00Z',
        signature: null,
        platform: 'windows',
        arch: 'x86_64',
      })
      .mockResolvedValueOnce('C:\\Temp\\FlowSFTP-Windows-x64-v0.9.2.exe')

    const store = useUpdaterStore()
    await store.checkForUpdates()
    const ok = await store.downloadAndInstallUpdate()

    expect(ok).toBe(true)
    expect(invokeMock).toHaveBeenLastCalledWith('app_download_and_install_update', {
      downloadUrl: 'https://flowsftp.com/storage/releases/FlowSFTP-Windows-x64-v0.9.2.exe',
      version: '0.9.2',
    })
  })
})

