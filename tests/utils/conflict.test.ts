import { describe, it, expect } from 'vitest'
import {
  getPreCheckAction,
  getExistingAction,
  resolveDecision,
  isPathUnderRoots,
  canSkipConflictCheck,
} from '../../app/utils/conflict'

describe('getPreCheckAction', () => {
  it('overwrites immediately after "Overwrite All"', () => {
    expect(getPreCheckAction('ask', 'overwrite')).toBe('overwrite')
    expect(getPreCheckAction('skip', 'overwrite')).toBe('overwrite')
  })

  it('overwrites immediately when the policy is overwrite and nothing sticky is set', () => {
    expect(getPreCheckAction('overwrite', null)).toBe('overwrite')
  })

  it('still has to look at the destination after "Skip All"', () => {
    // New files must be transferred even though existing ones are skipped.
    expect(getPreCheckAction('ask', 'skip')).toBeNull()
    expect(getPreCheckAction('overwrite', 'skip')).toBeNull()
  })

  it('has to ask when nothing is decided yet', () => {
    expect(getPreCheckAction('ask', null)).toBeNull()
    expect(getPreCheckAction('skip', null)).toBeNull()
  })
})

describe('getExistingAction', () => {
  it('skips silently after "Skip All"', () => {
    expect(getExistingAction('ask', 'skip')).toBe('skip')
  })

  it('skips silently when the policy is skip', () => {
    expect(getExistingAction('skip', null)).toBe('skip')
  })

  it('asks the user otherwise', () => {
    expect(getExistingAction('ask', null)).toBe('ask')
  })
})

describe('resolveDecision', () => {
  it('"Overwrite" only affects the current file', () => {
    expect(resolveDecision('overwrite')).toEqual({ action: 'overwrite', batchOverride: null })
  })

  it('"Skip" only affects the current file', () => {
    expect(resolveDecision('skip')).toEqual({ action: 'skip', batchOverride: null })
  })

  it('"Overwrite All" sticks for the rest of the batch', () => {
    expect(resolveDecision('overwrite-all')).toEqual({ action: 'overwrite', batchOverride: 'overwrite' })
  })

  it('"Skip All" sticks for the rest of the batch', () => {
    expect(resolveDecision('skip-all')).toEqual({ action: 'skip', batchOverride: 'skip' })
  })
})

describe('isPathUnderRoots', () => {
  it('matches the root itself and its descendants', () => {
    const roots = ['/srv/www/app']
    expect(isPathUnderRoots('/srv/www/app', roots)).toBe(true)
    expect(isPathUnderRoots('/srv/www/app/index.html', roots)).toBe(true)
    expect(isPathUnderRoots('/srv/www/app/a/b/c.txt', roots)).toBe(true)
  })

  it('does not match siblings that merely share a name prefix', () => {
    const roots = ['/srv/www/app']
    expect(isPathUnderRoots('/srv/www/app-old/index.html', roots)).toBe(false)
    expect(isPathUnderRoots('/srv/www/application', roots)).toBe(false)
  })

  it('handles Windows style separators', () => {
    const roots = ['C:\\Users\\me\\out']
    expect(isPathUnderRoots('C:\\Users\\me\\out\\file.txt', roots)).toBe(true)
    expect(isPathUnderRoots('C:\\Users\\me\\output\\file.txt', roots)).toBe(false)
  })

  it('works with any iterable, such as a Set', () => {
    expect(isPathUnderRoots('/a/b/c', new Set(['/x', '/a/b']))).toBe(true)
    expect(isPathUnderRoots('/a/b/c', new Set())).toBe(false)
  })
})

describe('canSkipConflictCheck', () => {
  it('skips for children of a brand-new folder', () => {
    expect(canSkipConflictCheck({ isChildOfBrandNew: true, policy: 'ask', batchOverride: null })).toBe(true)
  })

  it('skips when the policy is overwrite', () => {
    expect(canSkipConflictCheck({ isChildOfBrandNew: false, policy: 'overwrite', batchOverride: null })).toBe(true)
  })

  it('skips after "Overwrite All"', () => {
    expect(canSkipConflictCheck({ isChildOfBrandNew: false, policy: 'ask', batchOverride: 'overwrite' })).toBe(true)
  })

  it('does not skip for existing folders when asking or skipping', () => {
    expect(canSkipConflictCheck({ isChildOfBrandNew: false, policy: 'ask', batchOverride: null })).toBe(false)
    expect(canSkipConflictCheck({ isChildOfBrandNew: false, policy: 'skip', batchOverride: null })).toBe(false)
    expect(canSkipConflictCheck({ isChildOfBrandNew: false, policy: 'ask', batchOverride: 'skip' })).toBe(false)
  })
})
