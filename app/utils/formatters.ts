import type { LocalFileEntry, SftpFileEntry } from '../stores/sftp'

/**
 * Format raw bytes into human-readable binary unit strings (B, KB, MB, GB, TB).
 */
export const formatBytes = (bytes?: number): string => {
  if (!bytes || bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

/**
 * Format a UNIX timestamp (seconds) into a localized readable date-time string.
 */
export const formatDate = (timestampSec?: number): string => {
  if (!timestampSec) return '-'
  const d = new Date(timestampSec * 1000)
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Get human-friendly file type classification name from entry.
 */
export const getFileType = (entry: LocalFileEntry | SftpFileEntry): string => {
  if (entry.is_dir) return 'Folder'
  if (entry.is_symlink) return 'Symlink'

  const name = entry.name
  const lower = name.toLowerCase()

  if (lower === 'dockerfile') return 'Dockerfile'
  if (lower === 'makefile') return 'Makefile'
  if (lower === 'license' || lower === 'licence') return 'License'
  if (lower === 'readme' || lower.startsWith('readme.')) return 'Readme'
  if (lower.endsWith('.tar.gz')) return 'TAR.GZ Archive'
  if (lower.endsWith('.tar.bz2')) return 'TAR.BZ2 Archive'

  const lastDotIndex = name.lastIndexOf('.')
  if (lastDotIndex <= 0) {
    if (name.startsWith('.')) {
      return name.slice(1).toUpperCase() + ' File'
    }
    return 'File'
  }

  const ext = name.slice(lastDotIndex + 1).toLowerCase()

  const map: Record<string, string> = {
    txt: 'Text Document',
    md: 'Markdown',
    json: 'JSON',
    js: 'JavaScript',
    ts: 'TypeScript',
    vue: 'Vue Component',
    html: 'HTML Document',
    css: 'CSS Stylesheet',
    png: 'PNG Image',
    jpg: 'JPEG Image',
    jpeg: 'JPEG Image',
    svg: 'SVG Vector Image',
    pdf: 'PDF Document',
    zip: 'ZIP Archive',
    tar: 'TAR Archive',
    gz: 'GZ Archive',
    sh: 'Shell Script',
    bash: 'Bash Script',
    ps1: 'PowerShell Script',
    py: 'Python Script',
    rs: 'Rust Source',
    go: 'Go Source',
    java: 'Java Source',
    c: 'C Source',
    cpp: 'C++ Source',
  }

  return map[ext] || `${ext.toUpperCase()} File`
}

/**
 * Format UNIX octal file permissions into symbolic notation (e.g., 'drwxr-xr-x', '-rw-r--r--').
 */
export const formatPermissions = (permissions: number, isDir: boolean, isSymlink?: boolean): string => {
  if (!permissions) {
    return isDir ? 'drwxr-xr-x' : isSymlink ? 'lrwxrwxrwx' : '-rw-r--r--'
  }
  const typeChar = isDir ? 'd' : isSymlink ? 'l' : '-'
  const perm = permissions & 0o777
  const r1 = (perm & 0o400) ? 'r' : '-'
  const w1 = (perm & 0o200) ? 'w' : '-'
  const x1 = (perm & 0o100) ? ((permissions & 0o4000) ? 's' : 'x') : ((permissions & 0o4000) ? 'S' : '-')
  const r2 = (perm & 0o040) ? 'r' : '-'
  const w2 = (perm & 0o020) ? 'w' : '-'
  const x2 = (perm & 0o010) ? ((permissions & 0o2000) ? 's' : 'x') : ((permissions & 0o2000) ? 'S' : '-')
  const r3 = (perm & 0o004) ? 'r' : '-'
  const w3 = (perm & 0o002) ? 'w' : '-'
  const x3 = (perm & 0o001) ? ((permissions & 0o1000) ? 't' : 'x') : ((permissions & 0o1000) ? 'T' : '-')
  return `${typeChar}${r1}${w1}${x1}${r2}${w2}${x2}${r3}${w3}${x3}`
}

/**
 * Format numeric permissions into 4-digit octal notation (e.g. 0755, 0644).
 */
export const formatOctalPermissions = (permissions: number, isDir: boolean): string => {
  const perm = permissions ? (permissions & 0o777) : (isDir ? 0o755 : 0o644)
  return `0${perm.toString(8)}`
}

/**
 * Format owner and group names for SFTP entries.
 */
export const formatOwnerGroup = (file: SftpFileEntry): string => {
  if (file.owner && file.group) {
    return `${file.owner} / ${file.group}`
  }
  if (file.owner) {
    return file.owner
  }
  if (file.group) {
    return file.group
  }
  return '-'
}

/**
 * Split text around query match for search highlighting.
 */
export const highlightMatch = (text: string, query: string): { before: string; match: string; after: string } | null => {
  const q = query.trim().toLowerCase()
  if (!q) return null
  const idx = text.toLowerCase().indexOf(q)
  if (idx === -1) return null
  return {
    before: text.slice(0, idx),
    match: text.slice(idx, idx + q.length),
    after: text.slice(idx + q.length),
  }
}

/**
 * Test whether a filename has an archive file extension.
 */
export const isArchiveFile = (fileName: string): boolean => {
  return /\.(zip|tar|gz|tgz|tar\.gz|tar\.bz2|tbz2|bz2|tar\.xz|txz|xz|7z)$/i.test(fileName)
}

