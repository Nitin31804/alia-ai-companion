import React, { useState, useRef, useEffect } from 'react'
import { TextToSpeech } from '@capacitor-community/text-to-speech'
import { SpeechRecognition } from '@capacitor-community/speech-recognition'
import VrmAvatar from './VrmAvatar'
import './VoiceMode.css'
import { Mic, MicOff } from 'lucide-react'

export default function VoiceMode({ ws, isConnected, onBack, chatSessionId }) {
  const [isListening, setIsListening] = useState(false)
  const [isSpeaking, setIsSpeaking]   = useState(false)
  const [emotion, setEmotion]         = useState('neutral')
  const [action, setAction]           = useState('idle')
  const [userSubtitle, setUserSubtitle] = useState('')
  const [aiSubtitle, setAiSubtitle]     = useState('')
  const [status, setStatus]           = useState('Tap the mic to talk')
  const [isCameraOn, setIsCameraOn]   = useState(false)
  const mediaRecorder = useRef(null)
  const audioChunks   = useRef([])
  const webcamStream  = useRef(null)
  const videoRef      = useRef(null)
  
  const [camPos, setCamPos] = useState({ x: 20, y: window.innerHeight - 300 })
  const isDragging = useRef(false)
  const dragOffset = useRef({ x: 0, y: 0 })

  const handlePointerDown = (e) => {
    isDragging.current = true
    dragOffset.current = {
      x: e.clientX - camPos.x,
      y: e.clientY - camPos.y
    }
    e.target.setPointerCapture(e.pointerId)
  }

  const handlePointerMove = (e) => {
    if (!isDragging.current) return
    setCamPos({
      x: e.clientX - dragOffset.current.x,
      y: e.clientY - dragOffset.current.y
    })
  }

  const handlePointerUp = (e) => {
    isDragging.current = false
    e.target.releasePointerCapture(e.pointerId)
  }
  
  const audioQueue = useRef([])
  const isPlayingAudio = useRef(false)
  const currentAudio = useRef(null)
  const [activeSentence, setActiveSentence] = useState('')

  const stopAudio = async () => {
    audioQueue.current = [] 
    isPlayingAudio.current = false
    if (currentAudio.current) {
      try {
        currentAudio.current.pause()
        currentAudio.current.currentTime = 0
      } catch (e) {}
    }
    setIsSpeaking(false)
    setEmotion('neutral')
    setAction('idle')
    setActiveSentence('')
    setStatus('Tap the mic to talk')
  }

  useEffect(() => {
    return () => stopAudio()
  }, [])

  const playNextAudio = async () => {
    if (audioQueue.current.length === 0) {
      isPlayingAudio.current = false
      setIsSpeaking(false)
      setEmotion('neutral')
      setAction('idle')
      setStatus('Tap the mic to talk')
      setActiveSentence('')
      return
    }

    isPlayingAudio.current = true
    setIsSpeaking(true)
    setStatus('Speaking...')

    const nextChunk = audioQueue.current.shift()
    setActiveSentence(nextChunk.text)

    try {
      // Use bulletproof HTML5 Audio instead of WebAudio Context
      const audio = new Audio("data:audio/mp3;base64," + nextChunk.content)
      currentAudio.current = audio
      
      audio.onended = () => {
        playNextAudio()
      }
      
      audio.onerror = (e) => {
        console.error('HTML5 Audio failed:', e)
        playNextAudio()
      }
      
      await audio.play()
    } catch (e) {
      console.error('Audio play failed:', e)
      playNextAudio() 
    }
  }

  const activeSessionId = useRef('initial')

  // Listen to WebSocket messages
  useEffect(() => {
    if (!ws?.current) return

    const handler = async (event) => {
      const data = JSON.parse(event.data)

      // Ignore messages from older interrupted sessions
      if (data.session_id && data.session_id !== activeSessionId.current) {
        return
      }

      if (data.type === 'text_stream') {
        setAiSubtitle(prev => prev + data.content)
        if (!isPlayingAudio.current) setStatus('Thinking...')
      }

      if (data.type === 'audio_sentence') {
        audioQueue.current.push({ text: data.text, content: data.content })
        if (!isPlayingAudio.current) {
          playNextAudio()
        }
      }

      // Keep compatibility with normal text messages if they happen
      if (data.type === 'text') {
        setAiSubtitle(data.content)
      }
      if (data.type === 'audio') {
        audioQueue.current.push({ text: data.content, content: data.content })
        if (!isPlayingAudio.current) playNextAudio()
      }
    }

    ws.current.addEventListener('message', handler)
    return () => ws.current?.removeEventListener('message', handler)
  }, [ws])

  const toggleMic = async () => {
    // Instantly stop the AI from speaking when we tap the mic
    stopAudio()
    ws.current?.send(JSON.stringify({ type: 'interrupt' }))
    
    if (isListening) {
      SpeechRecognition.stop()
      setIsListening(false)
      setStatus('Thinking...')
      
      // Grab camera frame if on
      let frameB64 = null
      if (isCameraOn && videoRef.current) {
        const canvas = document.createElement('canvas')
        const MAX_WIDTH = 600
        const MAX_HEIGHT = 600
        let width = videoRef.current.videoWidth
        let height = videoRef.current.videoHeight

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
        ctx.drawImage(videoRef.current, 0, 0, width, height)
        const dataUrl = canvas.toDataURL('image/jpeg', 0.6)
        frameB64 = dataUrl.split(',')[1]
      }

      // Send to backend
      const newSessionId = Date.now().toString()
      // Prevent sending empty text if Android cut off early or they double-tapped
      if (!userSubtitle || userSubtitle.trim() === '...' || userSubtitle.trim() === '') {
        setStatus('Tap the mic to talk')
        return
      }
      
      activeSessionId.current = newSessionId
      const payload = {
        type: 'text', // Send as standard text now since it's already transcribed!
        content: userSubtitle, // The final transcription
        session_id: newSessionId,
        chat_session_id: chatSessionId,
        companion_name: 'Alia',
        voice_mode: true
      }
      if (frameB64) {
        payload.webcam_frame = frameB64
      }
      ws.current?.send(JSON.stringify(payload))
      return
    }

    try {
      const { available } = await SpeechRecognition.available()
      if (!available) {
        alert('Speech recognition is not available on this device.')
        return
      }

      await SpeechRecognition.requestPermissions()

      setIsListening(true)
      setStatus('Listening...')
      setUserSubtitle('...')
      setAiSubtitle('')

      SpeechRecognition.start({
        language: 'en-IN',
        partialResults: true,
        popup: false,
      })

    } catch (err) {
      console.error('Error starting speech recognition:', err)
      setStatus('Microphone access denied or error')
      setIsListening(false)
    }
  }

  // Handle when speech recognition automatically stops (user stops speaking)
  useEffect(() => {
    const startListener = SpeechRecognition.addListener('partialResults', (data) => {
      if (data.matches && data.matches.length > 0) {
        setUserSubtitle(data.matches[0])
      }
    })

    // There is no explicit 'end' event in Capacitor SpeechRecognition that passes the final result easily without a wrapper, but usually iOS/Android stop when done.
    // Wait, the plugin might need a specific handling.
    // Let's implement it robustly.
    return () => {
      startListener.then(l => l.remove())
    }
  }, [])

  const toggleCamera = async () => {
    if (isCameraOn) {
      webcamStream.current?.getTracks().forEach(t => t.stop())
      webcamStream.current = null
      if (videoRef.current) videoRef.current.srcObject = null
      setIsCameraOn(false)
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        webcamStream.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => {})
        }
        setIsCameraOn(true)
      } catch (err) {
        alert('Rear camera access denied.')
      }
    }
  }

  const activeSentenceRef = useRef(null)

  useEffect(() => {
    if (activeSentenceRef.current) {
      activeSentenceRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [activeSentence])

  const renderAiSubtitle = () => {
    if (!activeSentence || !aiSubtitle.includes(activeSentence)) return aiSubtitle
    const activeIdx = aiSubtitle.indexOf(activeSentence)
    const before = aiSubtitle.slice(0, activeIdx)
    const active = aiSubtitle.slice(activeIdx, activeIdx + activeSentence.length)
    const after = aiSubtitle.slice(activeIdx + activeSentence.length)
    return (
      <>
        <span>{before}</span>
        <span ref={activeSentenceRef} className="active-sentence">{active}</span>
        <span>{after}</span>
      </>
    )
  }

  return (
    <div className="voice-mode-screen">
      {/* Back Button */}
      <button className="voice-back-btn" onClick={onBack}>← Chat</button>

      {/* Connection Badge */}
      <div className={`voice-status-badge ${isConnected ? 'connected' : 'disconnected'}`}>
        {isConnected ? '🟢 Online' : '🔴 Offline'}
      </div>

      {/* 3D Avatar Area */}
      <div className="voice-avatar-area">
        <VrmAvatar isSpeaking={isSpeaking} emotion={emotion} />
      </div>

      {/* Cinematic Vignette Overlay */}
      <div className="vignette" />

      {/* Modern Glassmorphism UI Bottom Bar */}
      <div style={{ position: 'absolute', bottom: '40px', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 10 }}>
        
        {/* AI Subtitle Glass Bubble */}
        <div 
          className="glass-panel"
          style={{ 
            padding: '16px 28px', 
            borderRadius: '24px', 
            maxWidth: '85%', 
            marginBottom: '24px', 
            textAlign: 'center', 
            minHeight: '40px', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            opacity: aiSubtitle ? 1 : 0,
            transform: aiSubtitle ? 'translateY(0)' : 'translateY(10px)',
            transition: 'all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
          }}>
          <p style={{ margin: 0, fontSize: '18px', color: '#ffffff', fontWeight: '500', lineHeight: '1.4', textShadow: '0 2px 4px rgba(0,0,0,0.3)' }}>
            {aiSubtitle}
          </p>
        </div>

        {/* User Subtitle (Soft & Elegant) */}
        <div style={{ 
            color: 'rgba(255,255,255,0.7)', 
            textShadow: '0 2px 4px rgba(0,0,0,0.8)', 
            marginBottom: '20px', 
            fontSize: '15px', 
            fontWeight: '400',
            letterSpacing: '0.5px'
          }}>
          {userSubtitle}
        </div>
        
        {/* Status Text */}
        <p style={{ 
          color: 'rgba(255,255,255,0.6)', 
          marginTop: '16px', 
          fontSize: '13px', 
          textTransform: 'uppercase', 
          letterSpacing: '1.5px',
          fontWeight: '600',
          textShadow: '0 2px 4px rgba(0,0,0,0.8)' 
        }}>
          {status}
        </p>
      </div>
      
      {/* Camera Preview */}
      <div 
        style={{ 
          position: 'absolute', 
          top: `${camPos.y}px`, 
          left: `${camPos.x}px`,
          touchAction: 'none',
          zIndex: 1000
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <video 
          ref={videoRef} 
          autoPlay 
          playsInline 
          muted 
          style={{ width: '100px', height: '140px', objectFit: 'cover', borderRadius: '12px', border: '2px solid rgba(255,255,255,0.2)', display: isCameraOn ? 'block' : 'none', background: '#000', pointerEvents: 'none' }} 
        />
        <button 
          onClick={toggleCamera}
          onPointerDown={(e) => e.stopPropagation()} // Prevent dragging when clicking button
          style={{ position: 'absolute', bottom: isCameraOn ? '-40px' : '0px', left: isCameraOn ? '10px' : '0px', background: isCameraOn ? '#a855f7' : 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', borderRadius: '20px', padding: '8px 16px', fontWeight: 'bold', pointerEvents: 'auto' }}
        >
          {isCameraOn ? '📷 On' : '📷 Off'}
        </button>
      </div>

      {/* Pulsating Microphone Button */}
      <button 
        onClick={toggleMic}
        className={isListening ? 'mic-listening' : (isPlayingAudio.current ? 'mic-speaking' : '')}
        style={{
          position: 'absolute', bottom: '110px',
          width: '76px', height: '76px', borderRadius: '50%',
          background: isListening ? 'linear-gradient(135deg, #ff4757, #ff6b81)' : 'rgba(255,255,255,0.95)',
          border: 'none',
          boxShadow: '0 10px 30px rgba(0,0,0,0.3)',
          display: 'flex', justifyContent: 'center', alignItems: 'center',
          cursor: 'pointer', transition: 'all 0.3s ease',
          zIndex: 20
        }}
      >
        {isListening ? 
          <MicOff size={32} color="#ffffff" /> : 
          <Mic size={32} color={isPlayingAudio.current ? "#ff6b81" : "#2c3e50"} />
        }
      </button>

    </div>
  )
}
