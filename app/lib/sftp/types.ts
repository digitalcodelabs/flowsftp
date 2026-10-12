/** Shared data shapes for the SFTP feature. Pure types: no runtime dependencies. */
import type { ConflictDecision } from '../../utils/conflict'

export interface SftpFileEntry {
  name: string
  path: string
  is_dir: boolean
  is_symlink: boolean
  symlink_target?: string | null
  size: number
  modified: number
  permissions: number
  owner?: string | null
  group?: string | null
}

export interface LocalFileEntry {
  name: string
  path: string
  is_dir: boolean
  is_symlink: boolean
  symlink_target?: string | null
  size: number
  modified: number
}

export interface FileClipboardItem {
  files: (LocalFileEntry | SftpFileEntry)[]
  sourcePane: 'local' | 'remote'
  mode: 'copy' | 'cut'
  sessionId?: string | null
}

export interface LocalCrawlTask {
  local_path: string
  remote_path: string
  file_name: string
  size: number
}

export interface LocalCrawlDirectory {
  local_path: string
  remote_path: string
  dir_name: string
}

export interface LocalCrawlIgnored {
  local_path: string
  remote_path: string
  item_name: string
  is_dir: boolean
  matched_pattern: string
}

export interface LocalCrawlResult {
  files: LocalCrawlTask[]
  directories: LocalCrawlDirectory[]
  ignored: LocalCrawlIgnored[]
}

export interface ActiveFolderTransferInfo {
  id: string
  folderName: string
  totalFiles: number
  totalFolders: number
  completedFiles: number
  isScanning: boolean
  isStopping: boolean
  isComplete?: boolean
}

export type ActiveFolderUploadInfo = ActiveFolderTransferInfo
export type ActiveFolderDownloadInfo = ActiveFolderTransferInfo

export interface CrawlProgressPayload {
  scan_type: 'upload' | 'download'
  files: number
  directories: number
}

export interface RemoteCrawlTask {
  remote_path: string
  local_path: string
  file_name: string
  size: number
}

export type TransferPriority = 'Lowest' | 'Low' | 'Normal' | 'High' | 'Highest'

export interface TransferItem {
  transfer_id: string
  file_name: string
  direction: 'upload' | 'download'
  bytes_transferred: number
  total_bytes: number
  speed_bytes_per_sec: number
  is_complete: boolean
  is_dir?: boolean
  error?: string
  local_path?: string
  remote_path?: string
  session_id?: string
  src_session_id?: string
  server_url?: string
  priority?: TransferPriority
  started_at?: number
  completed_at?: number
  status?: 'queued' | 'transferring' | 'paused' | 'failed' | 'completed'
}

export interface FileConflictInfo {
  exists: boolean
  size: number
  modified: number
}

export interface ConflictDialogState {
  show: boolean
  fileName: string
  direction: 'download' | 'upload' | 'transfer'
  source: { size: number; modified: number; path: string }
  destination: { size: number; modified: number; path: string }
  resolveDecision?: (decision: ConflictDecision) => void
}

export interface CacheEntry<T> {
  timestamp: number
  canonical: string
  entries: T[]
}

export interface GitRepoStatus {
  is_repo: boolean
  root?: string | null
  branch?: string | null
  files: Record<string, string>
}

export interface FetchDirOptions {
  force?: boolean
  background?: boolean
}
