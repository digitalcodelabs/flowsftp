export type CompareStatus =
  | 'identical'
  | 'local_only'
  | 'remote_only'
  | 'size_different'
  | 'local_newer'
  | 'remote_newer'

export interface ComparisonItemInfo {
  status: CompareStatus
  counterpartSize?: number
  counterpartModified?: number
}

export interface ComparisonStats {
  identical: number
  localOnly: number
  remoteOnly: number
  sizeDifferent: number
  localNewer: number
  remoteNewer: number
  totalDiffs: number
}

export interface ComparisonResult {
  localMap: Map<string, ComparisonItemInfo>
  remoteMap: Map<string, ComparisonItemInfo>
  stats: ComparisonStats
}

export type CompareCriteria = 'size_and_time' | 'size_only'
