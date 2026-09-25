import React, { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUp, Check, Copy, Download, ImagePlus, LoaderCircle, Menu, MessageSquare, Mic, MicOff, Pencil, Plus, Radio, RefreshCw, Search, Settings, ShieldCheck, Square, Trash2, Volume2, VolumeX, Wifi, WifiOff, X } from 'lucide-react'
import { defaultServer, loadWorkspace, migrateWorkspace, newSecret, newSession, saveWorkspace, validateServer } from './storage'
import './App.css'

const VoiceMode = lazy(() => import('./VoiceMode'))
const uid = () => crypto.randomUUID()
function IconButton({ label, Icon, onClick, extra }) {
  return <button type="button" className="icon-button" aria-label={label} title={label} onClick={onClick} {...extra}><Icon size={18} /></button>
}

async function normalizeImage(file) {
  if (!file.type.startsWith('image/') || file.size > 10 * 1024 * 1024) throw new Error('Choose an image smaller than 10 MB.')
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, 960 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.78).split(',')[1]
  } finally { bitmap.close() }
}

export default function App() {
  const [workspace, setWorkspace] = useState(null)
  const [loadError, setLoadError] = useState('')
  useEffect(() => {
    let mounted = true
    loadWorkspace().then(async saved => {
      const state = migrateWorkspace(saved)
      await saveWorkspace(state)
      if (!saved) { try { localStorage.removeItem('chatSessions') } catch { /* Migration is already saved. */ } }
      if (mounted) setWorkspace(state)
    }).catch(() => { if (mounted) setLoadError('Your browser could not open local storage. Allow site storage, then reload. Existing chats have not been cleared.') })
    return () => { mounted = false }
  }, [])
  if (loadError) return <div className="boot-state"><h1>Alia</h1><p role="alert">{loadError}</p><button onClick={() => location.reload()}>Reload</button></div>
  if (!workspace) return <div className="boot-state"><LoaderCircle className="spin" /><p>Opening Alia...</p></div>
  return <Workspace initial={workspace} />
}

function Workspace({ initial }) {
  const [data, setData] = useState(initial)
  const dataRef = useRef(initial)
  const [activeId, setActiveId] = useState(initial.sessions.find(s => s.server === initial.settings.server)?.id)
  const [sidebar, setSidebar] = useState(false)
  const [query, setQuery] = useState('')
  const [connection, setConnection] = useState('connecting')
  const [socket, setSocket] = useState(null)
  const [reconnect, setReconnect] = useState(0)
  const [notice, setNotice] = useState('')
  const [storageError, setStorageError] = useState('')
  const [busy, setBusy] = useState(null)
  const busyRef = useRef(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsDraft, setSettingsDraft] = useState(data.settings)
  const [accessCode, setAccessCode] = useState('')
  const [token, setToken] = useState('')
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [renameTarget, setRenameTarget] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [live, setLive] = useState(false)
  const [dictating, setDictating] = useState(false)
  const [imagesEnabled, setImagesEnabled] = useState(false)
  const [consent, setConsent] = useState(data.settings.consent)
  const [copied, setCopied] = useState(null)
  const socketRef = useRef(null)
  const audio = useRef(null)
  const recognition = useRef(null)
  const liveRef = useRef(false)
  const fileInput = useRef(null)
  const feed = useRef(null)
  const shouldScroll = useRef(true)
  const saveQueue = useRef(Promise.resolve())
  const deleteTimer = useRef(null)
  const connected = connection === 'connected'
  const sessions = data.sessions.filter(s => s.server === data.settings.server)
  const active = sessions.find(s => s.id === activeId) || sessions[0]
  const activeRef = useRef(active)
  useEffect(() => { activeRef.current = active }, [active])
  useEffect(() => { liveRef.current = live }, [live])

  const update = useCallback(fn => {
    const next = fn(dataRef.current)
    dataRef.current = next
    setData(next)
    saveQueue.current = saveQueue.current.catch(() => {}).then(() => saveWorkspace(next)).then(() => setStorageError('')).catch(() => setStorageError('Changes are not saved on this device. Free some storage and export your chats before closing.'))
  }, [])

  const changeSession = useCallback((id, fn) => update(previous => ({ ...previous, sessions: previous.sessions.map(s => s.id === id ? fn(s) : s) })), [update])
  const setTurn = useCallback(turn => { busyRef.current = turn; setBusy(turn) }, [])

  const interruptLocal = useCallback(() => {
    const turn = busyRef.current
    if (!turn) return
    changeSession(turn.chat_session_id, s => ({ ...s, messages: s.messages.map(m => m.turnId === turn.session_id && ['pending', 'sent', 'streaming'].includes(m.status) ? { ...m, status: 'interrupted' } : m) }))
    setTurn(null)
  }, [changeSession, setTurn])

  useEffect(() => {
    let disposed = false
    let timer, authTimer, attempt = 0
    function connect() {
      if (disposed) return
      setConnection('connecting')
      let current
      try { current = new WebSocket(validateServer(data.settings.server)) }
      catch (error) { setNotice(error.message); setConnection('offline'); return }
      socketRef.current = current
      setSocket(current)
      authTimer = setTimeout(() => current.close(), 60000)
      current.onopen = () => current.send(JSON.stringify({ type: 'auth', client_secret: dataRef.current.secrets[data.settings.server], access_token: token }))
      current.onmessage = event => {
        if (disposed || socketRef.current !== current) return
        let packet
        try { packet = JSON.parse(event.data) } catch { setNotice('An unreadable server response was received.'); return }
        const { type, chat_session_id: chatId, session_id: turnId } = packet
        if (type === 'ready') { clearTimeout(authTimer); attempt = 0; setConnection('connected'); setImagesEnabled(packet.images); return }
        if (['auth_error', 'protocol_error', 'delete_error'].includes(type)) { setNotice(packet.content); clearTimeout(deleteTimer.current); return }
        if (type === 'chat_deleted') {
          clearTimeout(deleteTimer.current)
          update(previous => {
            let remaining = previous.sessions.filter(s => s.id !== chatId)
            if (!remaining.some(s => s.server === previous.settings.server)) remaining = [newSession(previous.settings.server), ...remaining]
            return { ...previous, sessions: remaining }
          })
          setDeleteTarget(null)
          setNotice('Conversation deleted from this browser and the active server database.')
          return
        }
        if (!chatId || !turnId) return
        if (type === 'text_stream') changeSession(chatId, s => {
          const existing = s.messages.find(m => m.turnId === turnId && m.sender === 'ai')
          return { ...s, messages: existing ? s.messages.map(m => m.id === existing.id ? { ...m, text: m.text + packet.content, status: 'streaming' } : m) : [...s.messages, { id: uid(), turnId, sender: 'ai', text: packet.content, status: 'streaming', createdAt: Date.now() }] }
        })
        if (type === 'accepted') changeSession(chatId, s => ({ ...s, messages: s.messages.map(m => m.turnId === turnId && m.sender === 'user' ? { ...m, status: 'sent' } : m) }))
        if (type === 'error') {
          setNotice(packet.content)
          changeSession(chatId, s => ({ ...s, messages: s.messages.map(m => m.turnId === turnId ? { ...m, status: 'failed', error: packet.content } : m) }))
        }
        if (type === 'warning') setNotice(packet.content)
        if (type === 'text_complete') changeSession(chatId, s => ({ ...s, messages: s.messages.map(m => m.turnId === turnId ? { ...m, status: 'complete' } : m) }))
        if (type === 'text_stream_end') {
          changeSession(chatId, s => ({ ...s, messages: s.messages.map(m => m.turnId === turnId ? { ...m, status: packet.status === 'error' ? 'failed' : packet.status === 'cancelled' ? 'interrupted' : 'complete' } : m) }))
          if (busyRef.current?.session_id === turnId) setTurn(null)
        }
        if (type === 'audio_sentence' && !liveRef.current && dataRef.current.settings.voiceReplies && activeRef.current?.id === chatId) {
          audio.current?.pause()
          audio.current = new Audio(`data:audio/mp3;base64,${packet.content}`)
          audio.current.play().catch(() => setNotice('Audio playback was blocked. Try Live mode.'))
        }
      }
      current.onerror = () => current.close()
      current.onclose = event => {
        clearTimeout(authTimer)
        if (disposed) return
        interruptLocal()
        setConnection('offline')
        if (event.code !== 1008) timer = setTimeout(connect, Math.min(1000 * 2 ** attempt++, 15000))
      }
    }
    connect()
    return () => {
      disposed = true
      clearTimeout(timer)
      clearTimeout(authTimer)
      interruptLocal()
      const current = socketRef.current
      if (current) { current.onclose = null; current.close() }
    }
  }, [data.settings.server, token, reconnect, changeSession, interruptLocal, setTurn, update])

  useEffect(() => {
    if (shouldScroll.current && feed.current) feed.current.scrollTop = feed.current.scrollHeight
  }, [active?.messages, active?.id])

  useEffect(() => () => {
    audio.current?.pause()
    if (recognition.current) { recognition.current.onend = null; recognition.current.abort() }
    clearTimeout(deleteTimer.current)
  }, [])

  const send = useCallback((text, image, voice = false, retryMessage = null, telemetry = null) => {
    const session = activeRef.current
    if (!session || (!text.trim() && !image)) return null
    if (!dataRef.current.settings.consent) { setSettingsOpen(true); setNotice('Please review and accept data processing before sending.'); return null }
    if (busyRef.current) { setNotice('Wait for the current reply, or stop it first.'); return null }
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN || !connected) { setNotice('You are offline. Your draft is kept here; reconnect to send it.'); return null }
    const turnId = retryMessage?.turnId || uid()
    const payload = { type: 'text', content: text.trim(), uploaded_image: image || null, chat_session_id: session.id, session_id: turnId, voice_mode: voice || dataRef.current.settings.voiceReplies, language: dataRef.current.settings.language, speech_recognition_ms: telemetry?.speechRecognitionMs ?? null }
    try { socketRef.current.send(JSON.stringify(payload)) } catch { setNotice('Message was not sent. Your draft is still here.'); return null }
    setTurn(payload)
    shouldScroll.current = true
    changeSession(session.id, s => ({ ...s, draft: '', attachment: null, title: s.title === 'New chat' ? (text.trim().slice(0, 40) || 'Image conversation') : s.title, messages: retryMessage ? s.messages.filter(m => !(m.turnId === turnId && m.sender === 'ai')).map(m => m.id === retryMessage.id ? { ...m, status: 'pending', error: undefined } : m) : [...s.messages, { id: uid(), turnId, sender: 'user', text: text.trim() || 'Image attached', image, status: 'pending', createdAt: Date.now() }] }))
    setNotice('')
    return turnId
  }, [connected, changeSession, setTurn])

  const stop = useCallback(() => {
    audio.current?.pause()
    const turn = busyRef.current
    if (turn && socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify({ type: 'interrupt', chat_session_id: turn.chat_session_id, session_id: turn.session_id }))
  }, [])

  function exportChats() {
    const content = { exportedAt: new Date().toISOString(), conversations: dataRef.current.sessions.filter(s => s.server === dataRef.current.settings.server).map(({ id, title, messages, createdAt }) => ({ id, title, messages, createdAt })) }
    const url = URL.createObjectURL(new Blob([JSON.stringify(content, null, 2)], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url; anchor.download = 'alia-conversations.json'; anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  function applySettings(event) {
    event.preventDefault()
    try {
      const server = validateServer(settingsDraft.server)
      const changed = server !== data.settings.server
      stop()
      update(previous => ({ ...previous, settings: { ...settingsDraft, server, consent }, secrets: { ...previous.secrets, [server]: previous.secrets[server] || newSecret() }, sessions: previous.sessions.some(s => s.server === server) ? previous.sessions : [newSession(server), ...previous.sessions] }))
      setToken(accessCode)
      if (changed) setActiveId(null)
      setSettingsOpen(false)
      setNotice('Settings saved.')
      if (!changed && token === accessCode && !connected) setReconnect(n => n + 1)
    } catch (error) { setNotice(error.message) }
  }

  function dictate() {
    if (dictating) { recognition.current?.stop(); return }
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!Recognition) { setNotice('Dictation is unavailable in this browser. You can still type a message.'); return }
    if (!data.settings.consent) { openSettings(); return }
    const sessionId = active.id
    const prefix = active.draft || ''
    const recorder = new Recognition()
    recognition.current = recorder
    recorder.lang = data.settings.language
    recorder.interimResults = true
    recorder.onstart = () => setDictating(true)
    recorder.onresult = event => changeSession(sessionId, s => ({ ...s, draft: `${prefix} ${Array.from(event.results, r => r[0].transcript).join(' ')}`.trim().slice(0, 12000) }))
    recorder.onend = () => setDictating(false)
    recorder.onerror = () => setNotice('Microphone access or speech recognition failed. Please try again.')
    try { recorder.start() } catch { setNotice('Microphone is unavailable.'); setDictating(false) }
  }

  function openSettings() { setSettingsDraft(data.settings); setConsent(data.settings.consent); setAccessCode(token); setSettingsOpen(true) }
  function openLive() { if (!data.settings.consent) { openSettings(); return }; audio.current?.pause(); recognition.current?.abort(); setLive(true) }

  return <div className="app-shell">
    {sidebar && <button className="sidebar-scrim" aria-label="Close sidebar" onClick={() => setSidebar(false)} />}
    <aside className={`sidebar ${sidebar ? 'open' : ''}`}>
      <div className="sidebar-top"><div className="wordmark">alia<span> / companion</span></div><IconButton label={'Close sidebar'} Icon={X} onClick={() => setSidebar(false)} extra={{ className: 'icon-button mobile-only' }} /></div>
      <button className="primary-action" onClick={() => { const s = newSession(data.settings.server); update(p => ({ ...p, sessions: [s, ...p.sessions] })); setActiveId(s.id); setSidebar(false); shouldScroll.current = true }}><Plus size={18} /> New conversation</button>
      <label className="search-field"><Search size={17} /><input aria-label="Search conversations" placeholder="Search conversations" value={query} onChange={e => setQuery(e.target.value)} /></label>
      <div className="session-list">{sessions.filter(s => `${s.title} ${s.messages.map(m => m.text).join(' ')}`.toLowerCase().includes(query.toLowerCase())).map(s => <div key={s.id} className={`session-item ${active?.id === s.id ? 'active' : ''}`}>
        <button className="session-select" onClick={() => { setActiveId(s.id); setSidebar(false); shouldScroll.current = true }}><MessageSquare size={16} /><span>{s.title}</span></button>
        <IconButton label={'Rename conversation'} Icon={Pencil} onClick={() => { setRenameTarget(s); setRenameValue(s.title) }} />
        <IconButton label={'Delete conversation'} Icon={Trash2} onClick={() => setDeleteTarget(s)} />
      </div>)}</div>
      <div className="sidebar-footer"><span className="beta-label">PRIVATE BETA</span><div><IconButton label={'Export conversations'} Icon={Download} onClick={exportChats} /><IconButton label={'Settings and privacy'} Icon={Settings} onClick={openSettings} /></div></div>
    </aside>
    <main className="main-panel">
      <header className="topbar"><div className="topbar-start"><IconButton label={'Open conversations'} Icon={Menu} onClick={() => setSidebar(true)} extra={{ className: 'icon-button mobile-only' }} /><div className="brand-mark"><img src="/elara_new.jpg" alt="" /><div><span>Alia</span><small>AI companion</small></div></div></div>
        <div className="topbar-actions"><IconButton label={data.settings.voiceReplies ? 'Mute voice replies' : 'Enable voice replies'} Icon={data.settings.voiceReplies ? Volume2 : VolumeX} onClick={() => { audio.current?.pause(); update(p => ({ ...p, settings: { ...p.settings, voiceReplies: !p.settings.voiceReplies } })) }} extra={{ 'aria-pressed': data.settings.voiceReplies }} /><IconButton label={'Open live mode'} Icon={Radio} onClick={openLive} /><IconButton label={'Settings and privacy'} Icon={Settings} onClick={openSettings} /><button className={`connection-pill ${connected ? 'connected' : connection === 'connecting' ? 'connecting' : 'disconnected'}`} title={connected ? 'Connected' : 'Reconnect'} aria-label={connected ? 'Connected' : 'Reconnect'} onClick={() => { stop(); setReconnect(n => n + 1) }}>{connection === 'connecting' ? <LoaderCircle className="spin" size={16} /> : connected ? <Wifi size={16} /> : <WifiOff size={16} />}<span>{connected ? 'Online' : connection === 'connecting' ? 'Connecting' : 'Offline'}</span></button></div>
      </header>
      <section className="conversation-panel">
        <div className="conversation-header"><div><span className="eyebrow">Your space</span><h1>{active?.title || 'New conversation'}</h1></div><span className="assistant-state" role="status">{busy ? <><LoaderCircle className="spin" size={14} /> Replying</> : 'Ready when you are'}</span></div>
        <div className="message-feed" ref={feed} role="log" aria-label="Conversation" onScroll={() => { const el = feed.current; shouldScroll.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100 }}>
          {!active?.messages.length ? <div className="empty-state"><img src="/elara_new.jpg" alt="Alia avatar" /><span className="eyebrow">A little room to think</span><h2>Hey. How are you, really?</h2><p>Big ideas, small wins, or a day you need to talk through.</p><div className="starter-list">{['Help me untangle a thought', 'Let\'s plan something good', 'I just want to talk'].map(text => <button key={text} onClick={() => changeSession(active.id, s => ({ ...s, draft: text }))}>{text}<ArrowUp size={15} /></button>)}</div></div> : active.messages.map(message => <article className={`message-row ${message.sender}`} key={message.id}>
            {message.sender === 'ai' && <img className="message-avatar" src="/elara_new.jpg" alt="Alia" />}
            <div className="message-content"><div className="message-bubble">{message.image && <img className="message-image" src={`data:image/jpeg;base64,${message.image}`} alt="Attached image" />}<span>{message.text}</span>{message.status === 'streaming' && <span className="cursor-dot" />}</div>
              <div className="message-meta"><time>{new Date(message.createdAt || active.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>{message.sender === 'user' && <span>{message.status === 'pending' ? 'Sending' : message.status === 'failed' ? 'Reply failed' : message.status === 'interrupted' ? 'Interrupted' : 'Sent'}</span>}
                <IconButton label={copied === message.id ? 'Copied' : 'Copy message'} Icon={copied === message.id ? Check : Copy} onClick={async () => { try { await navigator.clipboard.writeText(message.text); setCopied(message.id) } catch { setNotice('Clipboard is unavailable in this browser.') } }} />
                {message.sender === 'user' && ['failed', 'interrupted'].includes(message.status) && message.turnId && <IconButton label={'Retry message'} Icon={RefreshCw} onClick={() => send(message.text, message.image, false, message)} extra={{ disabled: !!busy || !connected }} />}
              </div>{message.error && message.sender === 'user' && <p className="message-error">{message.error}</p>}</div>
          </article>)}
        </div>
      </section>
      <div className="composer-shell">
        {(notice || storageError) && <div className="notice" role="status"><span>{storageError || notice}</span><IconButton label={'Dismiss notice'} Icon={X} onClick={() => setNotice('')} extra={{ disabled: !!storageError }} /></div>}
        {active?.attachment && <div className="attachment-preview"><img src={`data:image/jpeg;base64,${active.attachment}`} alt="Selected attachment" /><IconButton label={'Remove attachment'} Icon={X} onClick={() => changeSession(active.id, s => ({ ...s, attachment: null }))} /></div>}
        <form className="composer" onSubmit={e => { e.preventDefault(); send(active?.draft || '', active?.attachment) }}>
          <input ref={fileInput} type="file" accept="image/*" hidden onChange={async e => { const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; const id = active.id; try { const image = await normalizeImage(file); changeSession(id, s => ({ ...s, attachment: image })) } catch (error) { setNotice(error.message) } }} />
          <IconButton label={imagesEnabled ? 'Attach image' : 'Image understanding is unavailable on this server'} Icon={ImagePlus} onClick={() => fileInput.current.click()} extra={{ disabled: !imagesEnabled }} />
          <textarea aria-label="Message Alia" rows={2} maxLength={12000} value={active?.draft || ''} placeholder="What's on your mind?" onChange={e => changeSession(active.id, s => ({ ...s, draft: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(active?.draft || '', active?.attachment) } }} />
          <IconButton label={dictating ? 'Stop dictation' : 'Dictate message'} Icon={dictating ? MicOff : Mic} onClick={dictate} extra={{ 'aria-pressed': dictating }} />
          {busy ? <IconButton label={'Stop reply'} Icon={Square} onClick={stop} extra={{ className: 'send-button' }} /> : <button className="send-button" type="submit" aria-label="Send message" title="Send message" disabled={!active?.draft?.trim() && !active?.attachment}><ArrowUp size={22} /></button>}
        </form>
        <div className="composer-footer"><span>Alia is AI and can make mistakes.</span><button onClick={openSettings}>Privacy & settings</button></div>
      </div>
    </main>
    {settingsOpen && <Modal title="Make it your space" onClose={() => setSettingsOpen(false)}><form className="settings-form" onSubmit={applySettings}>
      <label>Speech language<select value={settingsDraft.language} onChange={e => setSettingsDraft(s => ({ ...s, language: e.target.value }))}><option value="en-IN">English (India)</option><option value="en-US">English (US)</option><option value="hi-IN">Hindi</option></select></label>
      <label className="check-row"><input type="checkbox" checked={settingsDraft.voiceReplies} onChange={e => setSettingsDraft(s => ({ ...s, voiceReplies: e.target.checked }))} /> Read replies aloud</label>
      <label>Beta access code<input type="password" autoComplete="off" value={accessCode} onChange={e => setAccessCode(e.target.value)} placeholder="Only needed for a protected beta" /></label>
      <details><summary>Connection</summary><label>Server address<input type="url" required value={settingsDraft.server} onChange={e => setSettingsDraft(s => ({ ...s, server: e.target.value }))} /></label><button type="button" className="text-button" onClick={() => setSettingsDraft(s => ({ ...s, server: defaultServer() }))}>Use default server</button></details>
      <div className="privacy-copy"><ShieldCheck size={20} /><h3>Your conversations & data</h3><p>Messages go to the selected server and Groq to create replies. Attached images and camera captures go to Google when image understanding is enabled. Spoken replies use Microsoft's speech service; dictation may use your browser or device speech provider.</p><p>Chats and attachments are saved in this browser. Completed text conversations and image descriptions are also stored on the server. Delete a conversation to remove it from this browser and the active server database. Provider retention and backups are separate.</p><p>This beta uses a private browser identity, without account recovery or cross-device sync. Clearing site data removes access to your server history. Export first.</p></div>
      <label className="check-row"><input required type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /> I agree to this data processing.</label>
      {notice && <p className="message-error" role="alert">{notice}</p>}
      <div className="modal-actions"><button type="button" className="secondary-action" onClick={exportChats}><Download size={16} /> Export chats</button><button className="primary-action" type="submit">Save settings</button></div>
    </form></Modal>}
    {deleteTarget && <Modal title="Delete conversation?" onClose={() => setDeleteTarget(null)}><p>“{deleteTarget.title}” will be removed from this browser and the active server database. This cannot be undone. Provider records and backups are separate.</p><div className="modal-actions"><button className="secondary-action" onClick={() => setDeleteTarget(null)}>Keep conversation</button><button className="primary-action destructive" disabled={!connected} onClick={() => { if (socketRef.current?.readyState !== WebSocket.OPEN) return; socketRef.current.send(JSON.stringify({ type: 'delete_chat', chat_session_id: deleteTarget.id, session_id: uid() })); clearTimeout(deleteTimer.current); deleteTimer.current = setTimeout(() => setNotice('Deletion was not confirmed. Reconnect and retry; the local chat is still here.'), 10000) }}>Delete conversation</button></div>{!connected && <p>Reconnect to delete this conversation from the server.</p>}</Modal>}
    {renameTarget && <Modal title="Rename conversation" onClose={() => setRenameTarget(null)}><form className="settings-form" onSubmit={e => { e.preventDefault(); changeSession(renameTarget.id, s => ({ ...s, title: renameValue.trim() || 'New chat' })); setRenameTarget(null) }}><input aria-label="Conversation name" value={renameValue} maxLength={80} onChange={e => setRenameValue(e.target.value)} /><button className="primary-action">Save name</button></form></Modal>}
    {live && <Suspense fallback={<div className="live-loading" role="status"><LoaderCircle className="spin" /><p>Opening live mode...</p><button onClick={() => setLive(false)}>Back to chat</button></div>}><VoiceMode socket={socket} isConnected={connected} onBack={() => { stop(); setLive(false) }} chatSessionId={active?.id} language={data.settings.language} onSend={send} onInterrupt={stop} imagesEnabled={imagesEnabled} /></Suspense>}
  </div>
}

function Modal({ title, onClose, children }) {
  const dialog = useRef(null)
  useEffect(() => { const el = dialog.current; el.showModal(); return () => el.close() }, [])
  return <dialog ref={dialog} className="modal" onCancel={e => { e.preventDefault(); onClose() }} aria-labelledby="modal-title"><div className="modal-heading"><h2 id="modal-title">{title}</h2><IconButton label={'Close dialog'} Icon={X} onClick={onClose} /></div>{children}</dialog>
}
