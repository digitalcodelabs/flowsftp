import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const invokeMock = vi.fn()
const listenMock = vi.fn()
const getVersionMock = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}))

vi.mock('@tauri-apps/api/app', () => ({
  getVersion: (...args: unknown[]) => getVersionMock(...args),
}))

import { useUpdaterStore, type UpdateDownloadProgress } from '../../app/stores/updater'

describe('Updater Store (in-app update check & installation)', () => {
  const hadWindow = typeof (globalThis as any).window !== 'undefined'
  const origWindow = (globalThis as any).window

  beforeEach(() => {
    setActivePinia(createPinia())
    invokeMock.mockReset()
    listenMock.mockReset()
    getVersionMock.mockReset()
    if (!hadWindow) {
      delete (globalThis as any).window
    } else if (origWindow) {
      delete origWindow.__TAURI_INTERNALS__
    }
  })

  afterEach(() => {
    vi.useRealTimers()
    if (!hadWindow) {
      delete (globalThis as any).window
    } else if (origWindow) {
      delete origWindow.__TAURI_INTERNALS__
    }
  })

  it('populates update state and shows header badge when a newer version is available', async () => {
    invokeMock.mockResolvedValueOnce({
      updateAvailable: true,
      currentVersion: '1.0.0',
      latestVersion: '1.0.1',
      downloadUrl: 'https://flowsftp.com/storage/releases/FlowSFTP-Windows-x64-v1.0.1.exe',
      notes: '### New in v1.0.1\n- In-app auto-updater',
      pubDate: '2026-11-11T12:00:00Z',
      signature: null,
      platform: 'windows',
      arch: 'x86_64',
    })

    const store = useUpdaterStore()
    const res = await store.checkForUpdates({ silent: false })

    expect(res?.updateAvailable).toBe(true)
    expect(store.updateAvailable).toBe(true)
    expect(store.latestVersion).toBe('1.0.1')
    expect(store.downloadUrl).toBe('https://flowsftp.com/storage/releases/FlowSFTP-Windows-x64-v1.0.1.exe')
    expect(store.releaseNotes).toContain('In-app auto-updater')
    expect(store.showHeaderUpdateBadge).toBe(true)

    // Dismissing hides the header pill until manual check or next version
    store.dismissUpdate()
    expect(store.showHeaderUpdateBadge).toBe(false)
  })

  it('handles up-to-date response (204 No Content mapped by backend)', async () => {
    invokeMock.mockResolvedValueOnce({
      updateAvailable: false,
      currentVersion: '1.0.0',
      latestVersion: '1.0.0',
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
        currentVersion: '1.0.0',
        latestVersion: '1.0.1',
        downloadUrl: 'https://flowsftp.com/storage/releases/FlowSFTP-Windows-x64-v1.0.1.exe',
        notes: 'Release notes',
        pubDate: '2026-11-11T12:00:00Z',
        signature: null,
        platform: 'windows',
        arch: 'x86_64',
      })
      .mockResolvedValueOnce('C:\\Temp\\FlowSFTP-Windows-x64-v1.0.1.exe')

    const store = useUpdaterStore()
    await store.checkForUpdates()
    const ok = await store.downloadAndInstallUpdate()

    expect(ok).toBe(true)
    expect(invokeMock).toHaveBeenLastCalledWith('app_download_and_install_update', {
      downloadUrl: 'https://flowsftp.com/storage/releases/FlowSFTP-Windows-x64-v1.0.1.exe',
      version: '1.0.1',
    })
  })

  it('loads live binary version via getVersion() on store initialization in a Tauri context', async () => {
    ;(globalThis as any).window = { __TAURI_INTERNALS__: {} }
    getVersionMock.mockResolvedValueOnce('1.2.0')

    const store = useUpdaterStore()
    await vi.waitFor(() => {
      expect(store.currentVersion).toBe('1.2.0')
    })
    expect(getVersionMock).toHaveBeenCalledTimes(1)
  })

  it('deduplicates concurrent ensureProgressListener() calls and handles completed phase', async () => {
    ;(globalThis as any).window = { __TAURI_INTERNALS__: {} }
    getVersionMock.mockResolvedValueOnce('1.0.0')

    let capturedHandler: ((event: { payload: UpdateDownloadProgress }) => void) | null = null
    let resolveListen: ((unlisten: () => void) => void) | null = null
    listenMock.mockImplementation(
      (_event: string, cb: (event: { payload: UpdateDownloadProgress }) => void) => {
        capturedHandler = cb
        return new Promise<() => void>((resolve) => {
          resolveListen = resolve
        })
      }
    )

    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'app_check_for_updates') {
        return {
          updateAvailable: true,
          currentVersion: '1.0.0',
          latestVersion: '1.0.1',
          downloadUrl: 'https://flowsftp.com/storage/releases/FlowSFTP-macOS-v1.0.1.dmg',
          notes: 'Notes',
          pubDate: '2026-11-11T00:00:00Z',
          signature: null,
          platform: 'macos',
          arch: 'aarch64',
        }
      }
      return '/tmp/FlowSFTP-macOS-v1.0.1.dmg'
    })

    const store = useUpdaterStore()
    store.downloadUrl = 'https://flowsftp.com/storage/releases/FlowSFTP-macOS-v1.0.1.dmg'
    store.latestVersion = '1.0.1'

    // Start checkForUpdates; while listen() is still pending, trigger downloadAndInstallUpdate too
    const checkPromise = store.checkForUpdates({ silent: true })
    await vi.waitFor(() => {
      expect(listenMock).toHaveBeenCalledTimes(1)
    })

    // Resolve the single in-flight listen() promise
    resolveListen?.(() => {})
    await checkPromise

    // Subsequent call reuses unlistenProgress without attaching a second listener
    await store.downloadAndInstallUpdate()
    expect(listenMock).toHaveBeenCalledTimes(1)

    // Verify progress phases including 'installing' -> 'completed'
    expect(capturedHandler).not.toBeNull()
    capturedHandler!({
      payload: {
        downloadedBytes: 100,
        totalBytes: 100,
        percent: 100,
        phase: 'installing',
        message: 'Opening DMG...',
      },
    })
    expect(store.downloading).toBe(false)
    expect(store.installing).toBe(true)

    capturedHandler!({
      payload: {
        downloadedBytes: 100,
        totalBytes: 100,
        percent: 100,
        phase: 'completed',
        message: 'Installer opened.',
      },
    })
    expect(store.downloading).toBe(false)
    expect(store.installing).toBe(false)
  })

  it('clears downloading immediately and resets installing after 1200ms fallback when installer does not exit', async () => {
    vi.useFakeTimers()
    ;(globalThis as any).window = { __TAURI_INTERNALS__: {} }
    getVersionMock.mockResolvedValueOnce('1.0.0')

    let capturedHandler: ((event: { payload: UpdateDownloadProgress }) => void) | null = null
    listenMock.mockImplementation(
      async (_event: string, cb: (event: { payload: UpdateDownloadProgress }) => void) => {
        capturedHandler = cb
        return () => {}
      }
    )

    invokeMock.mockImplementationOnce(async () => {
      // Simulate backend emitting 'installing' right before returning without exiting (e.g. .dmg / .deb)
      capturedHandler?.({
        payload: {
          downloadedBytes: 500,
          totalBytes: 500,
          percent: 100,
          phase: 'installing',
          message: 'Launching external package installer...',
        },
      })
      return '/tmp/FlowSFTP.deb'
    })

    const store = useUpdaterStore()
    store.downloadUrl = 'https://flowsftp.com/storage/releases/FlowSFTP.deb'
    store.latestVersion = '1.0.1'

    const ok = await store.downloadAndInstallUpdate()
    expect(ok).toBe(true)
    expect(store.downloading).toBe(false)
    expect(store.installing).toBe(true)

    vi.advanceTimersByTime(1199)
    expect(store.installing).toBe(true)

    vi.advanceTimersByTime(1)
    expect(store.installing).toBe(false)
  })
})

