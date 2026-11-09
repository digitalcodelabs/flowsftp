import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import type { SavedConnectionProfile } from '../../app/stores/keychain'

const invokeMock = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

import { useVaultStore } from '../../app/stores/vault'

describe('Vault encrypted backup export & import', () => {
  let vaultFileDisk: string | null = null
  let savedProfilesDisk: SavedConnectionProfile[] = []
  let lastExportedJson: string | null = null

  beforeEach(() => {
    setActivePinia(createPinia())
    vaultFileDisk = null
    savedProfilesDisk = []
    lastExportedJson = null
    invokeMock.mockReset()

    invokeMock.mockImplementation(async (cmd: string, args: any) => {
      switch (cmd) {
        case 'vault_load_file':
          return vaultFileDisk
        case 'vault_save_file':
          vaultFileDisk = args.content
          return undefined
        case 'vault_delete_file':
          vaultFileDisk = null
          return undefined
        case 'keychain_list_profiles':
          return savedProfilesDisk
        case 'keychain_import_profiles': {
          const incoming: SavedConnectionProfile[] = args.profiles
          if (args.replaceExisting) {
            savedProfilesDisk = [...incoming]
          } else {
            for (const p of incoming) {
              const idx = savedProfilesDisk.findIndex((x) => x.id === p.id)
              if (idx >= 0) savedProfilesDisk[idx] = p
              else savedProfilesDisk.push(p)
            }
          }
          return incoming.length
        }
        case 'save_file_dialog':
          lastExportedJson = args.content
          return '/tmp/flowsftp-backup.flowsftp.json'
        default:
          return undefined
      }
    })
  })

  it('encrypts and decrypts backup payloads with AES-256-GCM and rejects wrong passwords', async () => {
    const store = useVaultStore()
    const sampleProfile: SavedConnectionProfile = {
      id: 'prof-prod',
      name: 'Production',
      group: 'Infra',
      protocol: 'sftp',
      host: '10.0.0.50',
      port: 22,
      username: 'deploy',
      auth_type: 'Password',
      has_saved_secret: true,
    }

    const encryptedJson = await store.encryptBackupPayload(
      {
        version: 1,
        exportedAt: '2026-11-09T20:00:00.000Z',
        profiles: [sampleProfile],
        secrets: { 'prof-prod': 's3cr3t-pass!' },
        localBookmarks: ['/home/dev'],
        remoteBookmarks: ['/var/www'],
      },
      'strong-backup-key'
    )

    // Ensure no plaintext leaked into serialized backup JSON
    expect(encryptedJson).not.toContain('s3cr3t-pass!')
    expect(encryptedJson).not.toContain('10.0.0.50')

    await expect(store.decryptBackupPayload(encryptedJson, 'wrong-password')).rejects.toThrow(
      /Incorrect backup password/
    )

    const decrypted = await store.decryptBackupPayload(encryptedJson, 'strong-backup-key')
    expect(decrypted.profiles).toHaveLength(1)
    expect(decrypted.profiles[0]!.host).toBe('10.0.0.50')
    expect(decrypted.secrets['prof-prod']).toBe('s3cr3t-pass!')
    expect(decrypted.localBookmarks).toEqual(['/home/dev'])
    expect(decrypted.remoteBookmarks).toEqual(['/var/www'])
  })

  it('exports profiles + vault secrets and restores them onto a fresh machine', async () => {
    const sourceVault = useVaultStore()
    await sourceVault.setupMasterPassword('master-1234')
    await sourceVault.saveSecret('prof-1', 'prod-db-password')

    savedProfilesDisk = [
      {
        id: 'prof-1',
        name: 'DB Primary',
        group: 'Production',
        protocol: 'sftp',
        host: 'db.example.com',
        port: 2222,
        username: 'postgres',
        auth_type: 'Password',
        has_saved_secret: true,
      },
      {
        id: 'prof-2',
        name: 'Bastion Agent',
        protocol: 'sftp',
        host: 'bastion.example.com',
        port: 22,
        username: 'ops',
        auth_type: 'Agent',
        has_saved_secret: false,
      },
    ]

    const exportRes = await sourceVault.exportEncryptedBackup('portable-pass')
    expect(exportRes.profileCount).toBe(2)
    expect(exportRes.secretCount).toBe(1)
    expect(lastExportedJson).toBeTruthy()

    // Simulate brand-new machine with empty disk & fresh Pinia instance
    const backupBlob = lastExportedJson!
    vaultFileDisk = null
    savedProfilesDisk = []
    setActivePinia(createPinia())
    const targetVault = useVaultStore()

    const importRes = await targetVault.importEncryptedBackup(backupBlob, 'portable-pass', false)
    expect(importRes.profileCount).toBe(2)
    expect(importRes.secretCount).toBe(1)
    expect(savedProfilesDisk).toHaveLength(2)
    expect(savedProfilesDisk[0]!.has_saved_secret).toBe(true)
    expect(savedProfilesDisk[1]!.has_saved_secret).toBe(false)

    // Fresh vault was initialized automatically and secret is retrievable
    expect(targetVault.isInitialized).toBe(true)
    expect(await targetVault.getSecret('prof-1')).toBe('prod-db-password')
  })
})

