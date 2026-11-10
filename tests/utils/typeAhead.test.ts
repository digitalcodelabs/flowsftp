import { describe, it, expect } from 'vitest'
import { findTypeAheadMatchIndex } from '../../app/components/sftp/composables/useSftpKeyboardNav'

describe('findTypeAheadMatchIndex (File Pane Type-Ahead Jump)', () => {
  const sampleItems = [
    { name: '.ssh' },
    { name: 'Desktop' },
    { name: 'Documents' },
    { name: 'Downloads' },
    { name: 'src' },
    { name: 'styles.css' },
  ]

  it('jumps to the first matching folder or file when nothing is selected', () => {
    expect(findTypeAheadMatchIndex(sampleItems, 'd', null, true)).toBe(1) // Desktop
    expect(findTypeAheadMatchIndex(sampleItems, 's', null, true)).toBe(4) // src
  })

  it('cycles through items starting with the same letter and wraps around', () => {
    // Starting on Desktop (1) -> Documents (2) -> Downloads (3) -> wraps to Desktop (1)
    expect(findTypeAheadMatchIndex(sampleItems, 'd', 1, true)).toBe(2)
    expect(findTypeAheadMatchIndex(sampleItems, 'd', 2, true)).toBe(3)
    expect(findTypeAheadMatchIndex(sampleItems, 'd', 3, true)).toBe(1)
  })

  it('supports multi-character prefix matching without skipping the current item if it matches', () => {
    expect(findTypeAheadMatchIndex(sampleItems, 'do', 1, false)).toBe(2) // Documents
    expect(findTypeAheadMatchIndex(sampleItems, 'dow', 2, false)).toBe(3) // Downloads
    expect(findTypeAheadMatchIndex(sampleItems, 'st', 4, false)).toBe(5) // styles.css
  })

  it('matches dot-prefixed hidden folders/files directly with "." or via fallback without "."', () => {
    expect(findTypeAheadMatchIndex(sampleItems, '.', null, true)).toBe(0) // .ssh
    expect(findTypeAheadMatchIndex([{ name: '.config' }, { name: 'README.md' }], 'c', null, true)).toBe(0)
  })
})
