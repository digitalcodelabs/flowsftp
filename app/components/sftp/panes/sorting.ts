import type { LocalFileEntry, SftpFileEntry } from '../../../stores/sftp'
import { getFileType, formatOwnerGroup } from '../../../utils/formatters'

export type FileSortField = 'name' | 'type' | 'size' | 'modified' | 'permissions' | 'owner'
export type FileSortOrder = 'asc' | 'desc'

export const validSortFields: FileSortField[] = ['name', 'type', 'size', 'modified', 'permissions', 'owner']
export const validSortOrders: FileSortOrder[] = ['asc', 'desc']

export const getStoredSortBy = (key: string, defaultVal: FileSortField): FileSortField => {
  if (typeof window === 'undefined') return defaultVal
  const val = localStorage.getItem(key) as FileSortField
  return validSortFields.includes(val) ? val : defaultVal
}

export const getStoredSortOrder = (key: string, defaultVal: FileSortOrder): FileSortOrder => {
  if (typeof window === 'undefined') return defaultVal
  const val = localStorage.getItem(key) as FileSortOrder
  return validSortOrders.includes(val) ? val : defaultVal
}

export function sortFileList<T extends LocalFileEntry | SftpFileEntry>(
  files: T[],
  sortBy: FileSortField,
  sortOrder: FileSortOrder
): T[] {
  return [...files].sort((a, b) => {
    // 1. Folders always remain grouped at the top ahead of regular files
    if (a.is_dir && !b.is_dir) return -1
    if (!a.is_dir && b.is_dir) return 1

    // 2. Primary field comparison
    let cmp = 0
    switch (sortBy) {
      case 'name':
        cmp = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
        break
      case 'type': {
        const typeA = getFileType(a)
        const typeB = getFileType(b)
        cmp = typeA.localeCompare(typeB, undefined, { numeric: true, sensitivity: 'base' })
        break
      }
      case 'size':
        cmp = (a.size || 0) - (b.size || 0)
        break
      case 'modified':
        cmp = (a.modified || 0) - (b.modified || 0)
        break
      case 'permissions': {
        const permA = ('permissions' in a ? (a.permissions || 0) : 0)
        const permB = ('permissions' in b ? (b.permissions || 0) : 0)
        cmp = permA - permB
        break
      }
      case 'owner': {
        const ownerA = 'owner' in a ? formatOwnerGroup(a as SftpFileEntry) : ''
        const ownerB = 'owner' in b ? formatOwnerGroup(b as SftpFileEntry) : ''
        cmp = ownerA.localeCompare(ownerB, undefined, { numeric: true, sensitivity: 'base' })
        break
      }
      default:
        cmp = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    }

    // 3. Invert direction for descending
    if (sortOrder === 'desc') {
      cmp = -cmp
    }

    // 4. Stable tie-breaker: sort alphabetically by name if field values are identical
    if (cmp === 0) {
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    }

    return cmp
  })
}
