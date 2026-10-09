import { addCollection, addIcon } from '@iconify/vue'
import catppuccinIcons from '@iconify-json/catppuccin/icons.json'

// Register full Catppuccin icon collection for offline use
try {
  addCollection(catppuccinIcons as any)

  // System and location icons in Catppuccin style
  const httpIcon = (catppuccinIcons as any).icons?.['http']
  if (httpIcon) {
    addIcon('catppuccin:globe', {
      body: httpIcon.body,
      width: 16,
      height: 16,
    })
    addIcon('catppuccin:remote', {
      body: httpIcon.body,
      width: 16,
      height: 16,
    })
  }

  addIcon('catppuccin:server', {
    body: '<g fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2.5" width="12" height="4.5" rx="1.2" stroke="#8aadf4" stroke-width="1.3"/><path d="M4.5 4.75h4" stroke="#cad3f5" stroke-width="1.1"/><circle cx="11.5" cy="4.75" r="0.8" fill="#a6da95"/><rect x="2" y="8.75" width="12" height="4.5" rx="1.2" stroke="#8aadf4" stroke-width="1.3"/><path d="M4.5 11h4" stroke="#cad3f5" stroke-width="1.1"/><circle cx="11.5" cy="11" r="0.8" fill="#8bd5ca"/></g>',
    width: 16,
    height: 16,
  })

  addIcon('catppuccin:network', {
    body: '<g fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="2" width="7" height="4" rx="1" stroke="#8aadf4" stroke-width="1.3"/><path d="M6.8 4h2.2" stroke="#cad3f5" stroke-width="1"/><circle cx="10" cy="4" r="0.6" fill="#a6da95"/><path d="M8 6v3.5m-5 0h10m-8 0v2.5m6-2.5v2.5" stroke="#cad3f5" stroke-width="1.2"/><circle cx="5" cy="13" r="1.3" stroke="#8bd5ca" stroke-width="1.1" fill="#8bd5ca"/><circle cx="11" cy="13" r="1.3" stroke="#c6a0f6" stroke-width="1.1" fill="#c6a0f6"/></g>',
    width: 16,
    height: 16,
  })

  addIcon('catppuccin:connection', {
    body: '<g fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2.5" width="12" height="4.5" rx="1.2" stroke="#8aadf4" stroke-width="1.3"/><path d="M4.5 4.75h4" stroke="#cad3f5" stroke-width="1.1"/><circle cx="11.5" cy="4.75" r="0.8" fill="#a6da95"/><rect x="2" y="8.75" width="12" height="4.5" rx="1.2" stroke="#8aadf4" stroke-width="1.3"/><path d="M4.5 11h4" stroke="#cad3f5" stroke-width="1.1"/><circle cx="11.5" cy="11" r="0.8" fill="#8bd5ca"/></g>',
    width: 16,
    height: 16,
  })

  addIcon('catppuccin:settings', {
    body: '<g fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="2.3" stroke="#8bd5ca" stroke-width="1.3"/><path d="M8 1.8v1.8m0 8.8v1.8M1.8 8h1.8m8.8 0h1.8M3.6 3.6l1.3 1.3m6.2 6.2l1.3 1.3M3.6 12.4l1.3-1.3m6.2-6.2l1.3-1.3" stroke="#cad3f5" stroke-width="1.3"/></g>',
    width: 16,
    height: 16,
  })

  addIcon('catppuccin:disconnect', {
    body: '<g fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 3H3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h3.5" stroke="#ed8796" stroke-width="1.3"/><path d="M10.5 11.5L14 8l-3.5-3.5m-5 3.5h8.5" stroke="#ed8796" stroke-width="1.3"/></g>',
    width: 16,
    height: 16,
  })

  addIcon('catppuccin:laptop', {
    body: '<g fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 3.5h11a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1Z" stroke="#8aadf4" stroke-width="1.1"/><path d="M1 13.5h14l-1.2-2.5H2.2L1 13.5Z" stroke="#cad3f5" stroke-width="1.1"/><path d="M6.5 11h3" stroke="#8aadf4" stroke-width="1"/></g>',
    width: 16,
    height: 16,
  })

  addIcon('catppuccin:computer', {
    body: '<g fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2.5" width="12" height="8.5" rx="1.2" stroke="#8aadf4" stroke-width="1.1"/><path d="M8 11v3m-4.5 0h9" stroke="#cad3f5" stroke-width="1.1"/></g>',
    width: 16,
    height: 16,
  })

  addIcon('catppuccin:download', {
    body: '<g fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 10v2.5a1.5 1.5 0 0 0 1.5 1.5h8a1.5 1.5 0 0 0 1.5-1.5V10" stroke="#cad3f5" stroke-width="1.6"/><path d="M8 2v7.5" stroke="#a6da95" stroke-width="1.8"/><path d="M4.5 6.2L8 9.8l3.5-3.6" stroke="#a6da95" stroke-width="1.8"/></g>',
    width: 16,
    height: 16,
  })

  addIcon('catppuccin:upload', {
    body: '<g fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 10v2.5a1.5 1.5 0 0 0 1.5 1.5h8a1.5 1.5 0 0 0 1.5-1.5V10" stroke="#cad3f5" stroke-width="1.6"/><path d="M8 9.8V2.2" stroke="#8aadf4" stroke-width="1.8"/><path d="M4.5 5.8L8 2.2l3.5 3.6" stroke="#8aadf4" stroke-width="1.8"/></g>',
    width: 16,
    height: 16,
  })

  addIcon('catppuccin:rename', {
    body: '<g fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M10.8 2.2a1.5 1.5 0 0 1 2.1 2.1L4.8 12.4l-3.3.9.9-3.3L10.8 2.2Z" stroke="#c6a0f6" stroke-width="1.3"/><path d="M9.5 3.5l2.1 2.1" stroke="#b4befe" stroke-width="1.2"/><path d="M2.5 14.5h11" stroke="#cad3f5" stroke-width="1.3"/></g>',
    width: 16,
    height: 16,
  })

  addIcon('catppuccin:refresh', {
    body: '<g fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 2.5v3.5h-3.5" stroke="#8bd5ca" stroke-width="1.4"/><path d="M2.5 13.5v-3.5h3.5" stroke="#8bd5ca" stroke-width="1.4"/><path d="M13.2 6A6 6 0 0 0 3.2 4.8L2.5 6" stroke="#8bd5ca" stroke-width="1.4"/><path d="M2.8 10a6 6 0 0 0 10 1.2l.7-1.2" stroke="#8bd5ca" stroke-width="1.4"/></g>',
    width: 16,
    height: 16,
  })

  addIcon('catppuccin:delete', {
    body: '<g fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4.5h12" stroke="#ed8796" stroke-width="1.4"/><path d="M5.5 4.5V3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.5" stroke="#ed8796" stroke-width="1.4"/><path d="M3.5 4.5l.8 9a1.5 1.5 0 0 0 1.5 1.4h4.4a1.5 1.5 0 0 0 1.5-1.4l.8-9" stroke="#ed8796" stroke-width="1.4"/><path d="M6.5 7.5v5m3-5v5" stroke="#f5bde6" stroke-width="1.2"/></g>',
    width: 16,
    height: 16,
  })

  addIcon('catppuccin:trash', {
    body: '<g fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4.5h12" stroke="#ed8796" stroke-width="1.4"/><path d="M5.5 4.5V3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.5" stroke="#ed8796" stroke-width="1.4"/><path d="M3.5 4.5l.8 9a1.5 1.5 0 0 0 1.5 1.4h4.4a1.5 1.5 0 0 0 1.5-1.4l.8-9" stroke="#ed8796" stroke-width="1.4"/><path d="M6.5 7.5v5m3-5v5" stroke="#f5bde6" stroke-width="1.2"/></g>',
    width: 16,
    height: 16,
  })

  addIcon('catppuccin:select-all', {
    body: '<g fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="12" height="12" rx="2" stroke="#8aadf4" stroke-width="1.4"/><path d="M5 8.2l2.2 2.3 4.5-4.5" stroke="#a6da95" stroke-width="1.6"/></g>',
    width: 16,
    height: 16,
  })

  addIcon('catppuccin:copy', {
    body: '<g fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="8.5" height="8.5" rx="1.5" stroke="#b4befe" stroke-width="1.4"/><path d="M3.5 11H3a1.5 1.5 0 0 1-1.5-1.5v-7A1.5 1.5 0 0 1 3 1h7a1.5 1.5 0 0 1 1.5 1.5V3" stroke="#cad3f5" stroke-width="1.3"/></g>',
    width: 16,
    height: 16,
  })

  addIcon('catppuccin:bookmark', {
    body: '<path d="M3.5 2.5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v11.5l-4.5-2.5-4.5 2.5V2.5Z" fill="none" stroke="#eed49f" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>',
    width: 16,
    height: 16,
  })

  addIcon('catppuccin:bookmark-filled', {
    body: '<path d="M3.5 2.5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v11.5l-4.5-2.5-4.5 2.5V2.5Z" fill="#eed49f" stroke="#f5a97f" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>',
    width: 16,
    height: 16,
  })
} catch (err) {
  console.warn('Failed to register Catppuccin icons:', err)
}

const SPECIAL_FILES: Record<string, string> = {
  'package.json': 'package-json',
  'package-lock.json': 'package-json',
  'cargo.toml': 'cargo',
  'cargo.lock': 'cargo-lock',
  'dockerfile': 'docker',
  'docker-compose.yml': 'docker-compose',
  'docker-compose.yaml': 'docker-compose',
  '.dockerignore': 'docker-ignore',
  '.gitignore': 'git',
  '.gitattributes': 'git',
  '.gitmodules': 'git',
  '.env': 'env',
  '.env.local': 'env',
  '.env.development': 'env',
  '.env.production': 'env',
  '.env.example': 'env',
  'tsconfig.json': 'typescript-config',
  'jsconfig.json': 'javascript-config',
  'readme.md': 'markdown',
  'readme': 'markdown',
  'license': 'license',
  'license.md': 'license',
  'license.txt': 'license',
  'licence': 'license',
  'makefile': 'makefile',
  'justfile': 'makefile',
  'tauri.conf.json': 'tauri',
  'nuxt.config.ts': 'nuxt',
  'nuxt.config.js': 'nuxt',
  'tailwind.config.js': 'tailwind',
  'tailwind.config.ts': 'tailwind',
  'vite.config.ts': 'vite',
  'vite.config.js': 'vite',
  'next.config.js': 'next',
  'next.config.mjs': 'next',
  '.editorconfig': 'editorconfig',
  'robots.txt': 'text',
  '.prettierrc': 'config',
  '.eslintrc': 'config',
}

const SPECIAL_FOLDERS: Record<string, string> = {
  'src': 'folder-src',
  'source': 'folder-src',
  'sources': 'folder-src',
  'dist': 'folder-dist',
  'build': 'folder-dist',
  'out': 'folder-dist',
  '.output': 'folder-dist',
  'target': 'folder-dist',
  'node_modules': 'folder-node',
  '.git': 'folder-git',
  '.github': 'folder-github',
  'docs': 'folder-docs',
  'doc': 'folder-docs',
  'documentation': 'folder-docs',
  'config': 'folder-config',
  'configs': 'folder-config',
  '.config': 'folder-config',
  'public': 'folder-public',
  'static': 'folder-public',
  'assets': 'folder-assets',
  'components': 'folder-components',
  'images': 'folder-images',
  'img': 'folder-images',
  'icons': 'folder-images',
  'download': 'folder-download',
  'downloads': 'folder-download',
  'db': 'folder-database',
  'database': 'folder-database',
  'docker': 'folder-docker',
  '.docker': 'folder-docker',
  'tests': 'folder-tests',
  'test': 'folder-tests',
  '__tests__': 'folder-tests',
  'spec': 'folder-tests',
  'api': 'folder-api',
  'apis': 'folder-api',
  'routes': 'folder-api',
  'server': 'folder-server',
  'app': 'folder-app',
  'scripts': 'folder-scripts',
  'shared': 'folder-shared',
  'temp': 'folder-temp',
  'tmp': 'folder-temp',
  'cache': 'folder-temp',
  '.vscode': 'folder-vscode',
}

const EXTENSION_ICONS: Record<string, string> = {
  // TypeScript & JavaScript
  'ts': 'typescript',
  'tsx': 'typescript-react',
  'd.ts': 'typescript-def',
  'js': 'javascript',
  'mjs': 'javascript',
  'cjs': 'javascript',
  'jsx': 'javascript-react',
  'vue': 'vue',
  'svelte': 'svelte',
  'json': 'json',
  'jsonc': 'json',
  'json5': 'json',

  // Systems & Backend
  'rs': 'rust',
  'py': 'python',
  'pyw': 'python',
  'pyc': 'python-compiled',
  'go': 'go',
  'c': 'c',
  'h': 'c',
  'cpp': 'cpp',
  'hpp': 'cpp',
  'cc': 'cpp',
  'cxx': 'cpp',
  'cs': 'csharp',
  'java': 'java',
  'jar': 'java',
  'class': 'java',
  'kt': 'kotlin',
  'kts': 'kotlin',
  'swift': 'swift',
  'php': 'php',
  'rb': 'ruby',
  'dart': 'dart',
  'lua': 'lua',
  'r': 'r',
  'zig': 'zig',
  'nim': 'nim',
  'ex': 'elixir',
  'exs': 'elixir',
  'erl': 'erlang',
  'hrl': 'erlang',
  'clj': 'clojure',
  'scala': 'scala',

  // Web & Styles
  'html': 'html',
  'htm': 'html',
  'css': 'css',
  'scss': 'sass',
  'sass': 'sass',
  'less': 'less',
  'postcss': 'postcss',

  // Config & Data
  'yaml': 'yaml',
  'yml': 'yaml',
  'toml': 'toml',
  'xml': 'xml',
  'sql': 'database',
  'sqlite': 'database',
  'db': 'database',
  'ini': 'config',
  'conf': 'config',
  'cfg': 'config',

  // Documents
  'md': 'markdown',
  'markdown': 'markdown',
  'mdx': 'markdown-mdx',
  'txt': 'text',
  'text': 'text',
  'log': 'log',
  'pdf': 'pdf',

  // Shell & Scripts
  'sh': 'bash',
  'bash': 'bash',
  'zsh': 'bash',
  'ps1': 'powershell',
  'psm1': 'powershell',
  'bat': 'batch',
  'cmd': 'batch',

  // Media
  'svg': 'svg',
  'png': 'image',
  'jpg': 'image',
  'jpeg': 'image',
  'gif': 'image',
  'webp': 'image',
  'ico': 'image',
  'bmp': 'image',
  'tiff': 'image',
  'mp4': 'video',
  'mkv': 'video',
  'webm': 'video',
  'avi': 'video',
  'mov': 'video',
  'mp3': 'audio',
  'wav': 'audio',
  'ogg': 'audio',
  'flac': 'audio',
  'm4a': 'audio',

  // Archives & Binaries
  'zip': 'zip',
  'tar': 'zip',
  'gz': 'zip',
  'tgz': 'zip',
  'bz2': 'zip',
  'xz': 'zip',
  '7z': 'zip',
  'rar': 'zip',
  'iso': 'binary',
  'bin': 'binary',
  'exe': 'binary',
  'dll': 'binary',
  'so': 'binary',
  'dylib': 'binary',
}

/**
 * Returns the Catppuccin icon identifier (e.g. "catppuccin:typescript", "catppuccin:folder-src")
 */
export function getFileIconName(filename: string, isDir: boolean, isOpen: boolean = false): string {
  if (isDir) {
    const cleanName = filename.toLowerCase().trim()
    const special = SPECIAL_FOLDERS[cleanName]
    if (special) {
      return `catppuccin:${special}${isOpen ? '-open' : ''}`
    }
    return isOpen ? 'catppuccin:folder-open' : 'catppuccin:folder'
  }

  const lowerName = filename.toLowerCase().trim()

  // 1. Check exact filename match
  if (SPECIAL_FILES[lowerName]) {
    return `catppuccin:${SPECIAL_FILES[lowerName]}`
  }

  // 2. Check compound extensions (e.g. .d.ts, .tar.gz)
  if (lowerName.endsWith('.d.ts')) {
    return 'catppuccin:typescript-def'
  }
  if (lowerName.endsWith('.tar.gz') || lowerName.endsWith('.tar.bz2') || lowerName.endsWith('.tar.xz')) {
    return 'catppuccin:zip'
  }

  // 3. Check regular extension
  const dotIndex = lowerName.lastIndexOf('.')
  if (dotIndex !== -1 && dotIndex < lowerName.length - 1) {
    const ext = lowerName.slice(dotIndex + 1)
    if (EXTENSION_ICONS[ext]) {
      return `catppuccin:${EXTENSION_ICONS[ext]}`
    }
  }

  // 4. Default fallback file icon
  return 'catppuccin:file'
}
