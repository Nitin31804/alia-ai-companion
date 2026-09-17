const DB_NAME = 'alia-workspace'

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore('workspace')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('Close other Alia tabs and reload.'))
  })
}

export async function loadWorkspace() {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('workspace', 'readonly')
    const request = tx.objectStore('workspace').get('state')
    tx.oncomplete = () => { db.close(); resolve(request.result) }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

export async function saveWorkspace(state) {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('workspace', 'readwrite')
    tx.objectStore('workspace').put(state, 'state')
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
    tx.onabort = () => { db.close(); reject(tx.error || new Error('Storage unavailable')) }
  })
}

export function newSecret() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), x => x.toString(16).padStart(2, '0')).join('')
}

export function defaultServer() {
  return import.meta.env.VITE_WS_URL || `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/chat`
}

export function validateServer(value) {
  const url = new URL(value.trim())
  if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/ws/chat') {
    throw new Error('Enter a ws:// or wss:// address ending in /ws/chat, without credentials or query parameters.')
  }
  if (location.protocol === 'https:' && url.protocol !== 'wss:') throw new Error('A secure connection (wss://) is required.')
  return url.href
}

export const newSession = server => ({ id: crypto.randomUUID(), server, title: 'New chat', messages: [], draft: '', createdAt: Date.now() })

export function migrateWorkspace(saved) {
  if (saved?.version === 2 && Array.isArray(saved.sessions) && saved.settings && saved.secrets) {
    return { ...saved, sessions: saved.sessions.map(s => ({ ...s, messages: (s.messages || []).map(m => ({ ...m, status: ['pending', 'sent', 'streaming'].includes(m.status) ? 'interrupted' : m.status })) })) }
  }
  const server = defaultServer()
  let legacy = []
  try {
    const parsed = JSON.parse(localStorage.getItem('chatSessions') || '[]')
    if (Array.isArray(parsed)) legacy = parsed.filter(s => typeof s.id === 'string' && Array.isArray(s.messages))
  } catch { /* Corrupt legacy data is left untouched for recovery. */ }
  return {
    version: 2,
    settings: { server, language: 'en-IN', voiceReplies: false, consent: false },
    secrets: { [server]: newSecret() },
    sessions: legacy.length ? legacy.map(s => ({ ...s, server, legacy: true, draft: '', messages: s.messages.map(m => ({ ...m, id: crypto.randomUUID(), status: 'complete', isStreaming: false })) })) : [newSession(server)],
  }
}
