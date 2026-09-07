import React, { useState, useEffect, useRef } from 'react'
import { TextToSpeech } from '@capacitor-community/text-to-speech';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Send, Camera, Mic, Menu, Plus, MessageSquare, X, Trash2 } from 'lucide-react'
import PuppetAvatar from './PuppetAvatar'
import VoiceMode from './VoiceMode'
import './App.css'

function App() {
  const [sessions, setSessions] = useState(() => {
    const saved = localStorage.getItem('chatSessions')
    if (saved) return JSON.parse(saved)
    return [{ id: Date.now().toString(), title: 'New Chat', messages: [] }]
  })
  const [activeSessionId, setActiveSessionId] = useState(() => sessions[0]?.id || Date.now().toString())
  
  const activeSessionIdRef = useRef(activeSessionId)
  useEffect(() => {
    activeSessionIdRef.current = activeSessionId
  }, [activeSessionId])

  const [isSidebarOpen, setIsSidebarOpen] = useState(false)

  const activeSession = sessions.find(s => s.id === activeSessionId) || sessions[0]
  const messages = activeSession?.messages || []

  const setMessages = (updater) => {
    setSessions(prev => {
      const newSessions = [...prev]
      const idx = newSessions.findIndex(s => s.id === activeSessionIdRef.current)
      if (idx === -1) return newSessions
      
      const oldMessages = newSessions[idx].messages || []
      const newMessages = typeof updater === 'function' ? updater(oldMessages) : updater
      
      let title = newSessions[idx].title
      if (title === 'New Chat') {
        const firstUserMsg = newMessages.find(m => m.sender === 'user')
        if (firstUserMsg) title = firstUserMsg.text.slice(0, 30) + '...'
      }
      
      newSessions[idx] = { ...newSessions[idx], messages: newMessages, title }
      localStorage.setItem('chatSessions', JSON.stringify(newSessions))
      return newSessions
    })
  }

  const startNewChat = () => {
    const newId = Date.now().toString()
    const newSession = { id: newId, title: 'New Chat', messages: [] }
    setSessions(p => {
      const updated = [newSession, ...p]
      localStorage.setItem('chatSessions', JSON.stringify(updated))
      return updated
    })
    setActiveSessionId(newId)
    setIsSidebarOpen(false)
  }

  const deleteChat = (e, id) => {
    e.stopPropagation()
    setSessions(p => {
      const updated = p.filter(s => s.id !== id)
      if (updated.length === 0) {
        const newId = Date.now().toString()
        const fallback = [{ id: newId, title: 'New Chat', messages: [] }]
        localStorage.setItem('chatSessions', JSON.stringify(fallback))
        setActiveSessionId(newId)
        return fallback
      }
      localStorage.setItem('chatSessions', JSON.stringify(updated))
      if (id === activeSessionIdRef.current) {
        setActiveSessionId(updated[0].id)
      }
      return updated
    })
  }

  const switchChat = (id) => {
    setActiveSessionId(id)
    setIsSidebarOpen(false)
  }

  const [inputMessage, setInputMessage] = useState('')
  const [isSpeaking, setIsSpeaking]     = useState(false)
  const [isRecording, setIsRecording]   = useState(false)
  const [emotion, setEmotion]           = useState('neutral')
  const [action, setAction]             = useState('idle')
  const [voiceMode, setVoiceMode]       = useState(false)
  const [selectedImage, setSelectedImage] = useState(null)
  
  const ws            = useRef(null)
  const messagesEnd   = useRef(null)
  const mediaRecorder = useRef(null)
  const audioChunks   = useRef([])
  const fileInputRef  = useRef(null)

  const [isConnected, setIsConnected] = useState(false)

  const connectWS = () => {
    const wsUrl = `wss://nonsterilely-pharmacognostic-coralee.ngrok-free.dev/ws/chat`
    ws.current = new WebSocket(wsUrl)

    ws.current.onopen = () => {
      setIsConnected(true)
      setMessages((p) => {
        if (p.length === 0) {
          return [{ text: 'Connected! How can I assist you today?', sender: 'system' }]
        } else {
          return [...p, { text: '🟢 Reconnected to Aria', sender: 'system' }]
        }
      })
    }

    ws.current.onclose = () => {
      setIsConnected(false)
      // Auto-reconnect after 3 seconds
      setTimeout(() => connectWS(), 3000)
    }

    ws.current.onerror = () => {
      ws.current.close()
    }

    ws.current.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data)
        const targetSessionId = data.chat_session_id || activeSessionIdRef.current
        
        if (data.type === 'text') {
          setSessions(prev => {
            const newSessions = [...prev]
            const idx = newSessions.findIndex(s => s.id === targetSessionId)
            if (idx === -1) return newSessions
            const oldMessages = newSessions[idx].messages || []
            newSessions[idx] = { ...newSessions[idx], messages: [...oldMessages, { text: data.content, sender: 'ai' }] }
            localStorage.setItem('chatSessions', JSON.stringify(newSessions))
            return newSessions
          })
          setIsSpeaking(true)
        } else if (data.type === 'text_stream') {
          setSessions(prev => {
            const newSessions = [...prev]
            const idx = newSessions.findIndex(s => s.id === targetSessionId)
            if (idx === -1) return newSessions
            const oldMessages = newSessions[idx].messages || []
            const newMessages = [...oldMessages]
            const lastMsg = newMessages[newMessages.length - 1]
            
            if (lastMsg && lastMsg.sender === 'ai' && lastMsg.isStreaming) {
              lastMsg.text += data.content
            } else {
              newMessages.push({ text: data.content, sender: 'ai', isStreaming: true })
            }
            newSessions[idx] = { ...newSessions[idx], messages: newMessages }
            localStorage.setItem('chatSessions', JSON.stringify(newSessions))
            return newSessions
          })
          setIsSpeaking(true)
        } else if (data.type === 'text_stream_end') {
          setSessions(prev => {
            const newSessions = [...prev]
            const idx = newSessions.findIndex(s => s.id === targetSessionId)
            if (idx === -1) return newSessions
            const oldMessages = newSessions[idx].messages || []
            const newMessages = [...oldMessages]
            const lastMsg = newMessages[newMessages.length - 1]
            if (lastMsg && lastMsg.sender === 'ai') lastMsg.isStreaming = false
            newSessions[idx] = { ...newSessions[idx], messages: newMessages }
            localStorage.setItem('chatSessions', JSON.stringify(newSessions))
            return newSessions
          })
          setIsSpeaking(false)
        } else if (data.type === 'audio') {
          try {
            const audioBytes = atob(data.content)
            const arrayBuffer = new ArrayBuffer(audioBytes.length)
            const view = new Uint8Array(arrayBuffer)
            for (let i = 0; i < audioBytes.length; i++) view[i] = audioBytes.charCodeAt(i)
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)()
            const decoded = await audioCtx.decodeAudioData(arrayBuffer)
            const source = audioCtx.createBufferSource()
            source.buffer = decoded
            source.connect(audioCtx.destination)
            source.onended = () => {
              setIsSpeaking(false)
              setEmotion('neutral')
              setAction('idle')
              audioCtx.close()
            }
            source.start(0)
          } catch (e) {
            console.error('Audio play failed:', e)
            setIsSpeaking(false)
          }

        } else if (data.type === 'system') {
          setSessions(prev => {
            const newSessions = [...prev]
            const idx = newSessions.findIndex(s => s.id === targetSessionId)
            if (idx === -1) return newSessions
            const oldMessages = newSessions[idx].messages || []
            newSessions[idx] = { ...newSessions[idx], messages: [...oldMessages, { text: data.content, sender: 'system' }] }
            localStorage.setItem('chatSessions', JSON.stringify(newSessions))
            return newSessions
          })
          if (data.content.includes('Actions:')) {
            setAction(data.content.includes('wave') ? 'wave' : 'idle')
          }
          if (data.content.includes('Emotion detected:')) {
            const contentLower = data.content.toLowerCase()
            if (contentLower.includes('happy')) setEmotion('happy')
            else if (contentLower.includes('sad')) setEmotion('sad')
            else if (contentLower.includes('angry')) setEmotion('angry')
            else setEmotion('neutral')
          }
        }
      } catch (e) {
        console.error('Message parse error:', e)
      }
    }

    return () => ws.current?.close()
  }

  useEffect(() => {
    if (!ws.current || ws.current.readyState === WebSocket.CLOSED) {
      connectWS()
    }
    return () => {
      if (ws.current) {
        ws.current.onclose = null // Prevent auto-reconnect on unmount
        ws.current.close()
      }
    }
  }, [])

  useEffect(() => {
    const setupNotifications = async () => {
      const perms = await LocalNotifications.requestPermissions();
      if (perms.display === 'granted') {
        // Cancel old ones so they don't pile up
        await LocalNotifications.cancel({ notifications: [{ id: 1 }, { id: 2 }] });
        
        // Schedule some cute surprise texts for the future!
        await LocalNotifications.schedule({
          notifications: [
            {
              title: "Alia ✨",
              body: "Hey pagal, what are you doing? I miss you!",
              id: 1,
              schedule: { at: new Date(Date.now() + 1000 * 60 * 60 * 2) }, // 2 hours from now
            },
            {
              title: "Alia ✨",
              body: "Wake up!! Aur batao, kaisa gaya din? ❤️",
              id: 2,
              schedule: { at: new Date(Date.now() + 1000 * 60 * 60 * 24) }, // 24 hours from now
            }
          ]
        });
      }
    };
    setupNotifications();
  }, []);

  const scrollToBottom = () => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth' })
  }
  
  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const handleImageSelect = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (event) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        const MAX_WIDTH = 600
        const MAX_HEIGHT = 600
        let width = img.width
        let height = img.height

        if (width > height) {
          if (width > MAX_WIDTH) {
            height = Math.round((height * MAX_WIDTH) / width)
            width = MAX_WIDTH
          }
        } else {
          if (height > MAX_HEIGHT) {
            width = Math.round((width * MAX_HEIGHT) / height)
            height = MAX_HEIGHT
          }
        }

        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, width, height)
        
        // Compress as JPEG
        const dataUrl = canvas.toDataURL('image/jpeg', 0.7)
        const base64 = dataUrl.split(',')[1]
        setSelectedImage(base64)
      }
      img.src = event.target.result
    }
    reader.readAsDataURL(file)
  }

  const sendWsMessage = async (type, content) => {
    if (!ws.current || ws.current.readyState !== WebSocket.OPEN) return
    const payload = { type, content, chat_session_id: activeSessionIdRef.current, companion_name: 'Alia' }
    if (selectedImage) {
      payload.uploaded_image = selectedImage
    }
    ws.current.send(JSON.stringify(payload))
    setSelectedImage(null) // Clear image after sending
  }

  const handleSend = (e) => {
    e.preventDefault()
    if (!inputMessage.trim() && !selectedImage) return
    const textToShow = inputMessage.trim() || '📷 Image uploaded'
    const imageToSave = selectedImage // Capture it before we clear it
    
    setSessions(prev => {
      const newSessions = [...prev]
      const idx = newSessions.findIndex(s => s.id === activeSessionIdRef.current)
      if (idx === -1) return newSessions
      const oldMessages = newSessions[idx].messages || []
      
      const newMessage = { text: textToShow, sender: 'user' }
      if (imageToSave) newMessage.image = imageToSave
      
      newSessions[idx] = { ...newSessions[idx], messages: [...oldMessages, newMessage] }
      localStorage.setItem('chatSessions', JSON.stringify(newSessions))
      return newSessions
    })
    
    sendWsMessage('text', inputMessage)
    setInputMessage('')
  }

  const toggleRecording = async (e) => {
    e.preventDefault()
    ws.current?.send(JSON.stringify({ type: 'interrupt' }))
    if (isRecording) {
      if (mediaRecorder.current) mediaRecorder.current.stop()
      setIsRecording(false)
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaRecorder.current = new MediaRecorder(stream)
      const audioChunks = []

      mediaRecorder.current.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.push(e.data)
      }

      mediaRecorder.current.onstop = () => {
        setIsRecording(false)
        const blob = new Blob(audioChunks, { type: 'audio/webm' })
        
        const reader = new FileReader()
        reader.readAsDataURL(blob)
        reader.onloadend = () => {
          const base64data = reader.result.split(',')[1]
          setMessages((p) => [...p, { text: "🎙️ Audio message sent", sender: 'user' }])
          sendWsMessage('audio', base64data)
        }
        stream.getTracks().forEach(track => track.stop())
      }

      mediaRecorder.current.start()
      setIsRecording(true)
    } catch (err) {
      console.error(err)
      setIsRecording(false)
      alert('Microphone access denied.')
    }
  }

  return (
    <div className="app-container">
      {/* Sidebar Overlay */}
      {isSidebarOpen && (
        <div className="sidebar-overlay" onClick={() => setIsSidebarOpen(false)} />
      )}
      
      {/* Sidebar */}
      <div className={`sidebar ${isSidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <h2>Chats</h2>
          <button className="icon-btn" onClick={() => setIsSidebarOpen(false)}><X size={20}/></button>
        </div>
        <button className="new-chat-btn" onClick={startNewChat}>
          <Plus size={18} /> New Chat
        </button>
        <div className="chat-list">
          {sessions.map(s => (
            <div 
              key={s.id} 
              className={`chat-item ${s.id === activeSessionId ? 'active' : ''}`}
              onClick={() => switchChat(s.id)}
            >
              <MessageSquare size={16} />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</span>
              <button 
                className="icon-btn delete-btn" 
                onClick={(e) => deleteChat(e, s.id)}
                style={{ padding: '4px' }}
              >
                <Trash2 size={16} color="#ef4444" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Fullscreen Voice Mode overlay */}
      {voiceMode && (
        <VoiceMode
          ws={ws}
          isConnected={isConnected}
          onBack={() => setVoiceMode(false)}
          chatSessionId={activeSessionIdRef.current}
        />
      )}

      <header className="header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button className="icon-btn" onClick={() => setIsSidebarOpen(true)}>
            <Menu size={24} color="#2c3e50" />
          </button>
          <h1>Alia</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={() => setVoiceMode(true)}
            style={{
              background: 'linear-gradient(135deg, #a855f7, #6366f1)',
              border: 'none', borderRadius: '20px', color: '#fff',
              padding: '6px 14px', fontSize: '13px', cursor: 'pointer',
              fontWeight: '600'
            }}
          >
            🎙️ Live
          </button>
          <div className="status-indicator">
            {isConnected ? '🟢 Connected' : '🔴 Disconnected'}
          </div>
        </div>
      </header>

      <div className="chat-area">
        {messages.map((msg, idx) => (
          <div key={idx} className={`message ${msg.sender}`}>
            {msg.sender === 'ai' && (
              <div className="ai-icon">✨</div>
            )}
            <div className="bubble">
              {msg.image && (
                <img 
                  src={`data:image/jpeg;base64,${msg.image}`} 
                  alt="Uploaded" 
                  style={{ width: '100%', maxWidth: '200px', borderRadius: '8px', marginBottom: '8px', display: 'block' }}
                />
              )}
              {msg.text}
            </div>
          </div>
        ))}
        <div ref={messagesEnd} />
      </div>

      <div style={{ padding: '0 16px' }}>
        {selectedImage && (
          <div style={{ position: 'relative', display: 'inline-block', marginBottom: '8px' }}>
            <img 
              src={`data:image/jpeg;base64,${selectedImage}`} 
              alt="Preview" 
              style={{ width: '80px', height: '80px', objectFit: 'cover', borderRadius: '12px', border: '2px solid #a855f7' }} 
            />
            <button 
              onClick={() => setSelectedImage(null)}
              style={{ position: 'absolute', top: '-6px', right: '-6px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: '50%', width: '24px', height: '24px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <X size={14} />
            </button>
          </div>
        )}
      </div>

      <form className="input-dock" onSubmit={handleSend}>
        <input 
          type="file" 
          accept="image/*" 
          ref={fileInputRef} 
          style={{ display: 'none' }} 
          onChange={handleImageSelect}
        />
        <button 
          type="button" 
          className="icon-btn camera"
          onClick={() => fileInputRef.current?.click()}
        >
          <Camera size={24} />
        </button>

        <div className="input-wrapper">
          <input
            type="text"
            placeholder="Ask me anything..."
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
          />
          <button type="submit" className="icon-btn send">
            <Send size={20} />
          </button>
        </div>
        
        <button
          type="button"
          className={`icon-btn mic ${isRecording ? 'recording' : ''}`}
          onClick={toggleRecording}
        >
          <Mic size={24} />
        </button>
      </form>
    </div>
  )
}

export default App
