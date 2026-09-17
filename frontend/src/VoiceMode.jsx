import React, { useCallback, useEffect, useRef, useState } from 'react'
import { SpeechRecognition } from '@capacitor-community/speech-recognition'
import { ArrowLeft, Camera, CameraOff, Mic, MicOff, Volume2, Wifi, WifiOff } from 'lucide-react'
import VrmAvatar from './VrmAvatar'
import './VoiceMode.css'

const captureVideoFrame = (video) => {
  if (!video || !video.videoWidth || !video.videoHeight) return null

  const canvas = document.createElement('canvas')
  const maxSize = 900
  const scale = Math.min(1, maxSize / Math.max(video.videoWidth, video.videoHeight))
  canvas.width = Math.round(video.videoWidth * scale)
  canvas.height = Math.round(video.videoHeight * scale)
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.72).split(',')[1]
}

export default function VoiceMode({ socket, isConnected, onBack, chatSessionId, language, onSend, onInterrupt, imagesEnabled }) {
  const [isListening, setIsListening] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [emotion, setEmotion] = useState('neutral')
  const [userSubtitle, setUserSubtitle] = useState('')
  const [aiSubtitle, setAiSubtitle] = useState('')
  const [status, setStatus] = useState('Tap to talk')
  const [isCameraOn, setIsCameraOn] = useState(false)

  const audioQueue = useRef([])
  const currentAudio = useRef(null)
  const isPlayingAudio = useRef(false)
  const playNextAudioRef = useRef(null)
  const webcamStream = useRef(null)
  const videoRef = useRef(null)
  const browserRecognition = useRef(null)
  const recognitionMode = useRef(null)
  const transcriptRef = useRef('')
  const activeTurnId = useRef(null)
  const mounted = useRef(true)
  const sentTranscript = useRef(false)
  const sendUtteranceRef = useRef(null)

  const stopAudio = useCallback(() => {
    audioQueue.current = []
    isPlayingAudio.current = false
    currentAudio.current?.pause()
    currentAudio.current = null
    setIsSpeaking(false)
    setEmotion('neutral')
    setStatus('Tap to talk')
  }, [])

  const playNextAudio = useCallback(async () => {
    if (audioQueue.current.length === 0) {
      isPlayingAudio.current = false
      setIsSpeaking(false)
      setEmotion('neutral')
      setStatus('Tap to talk')
      return
    }

    const nextChunk = audioQueue.current.shift()
    isPlayingAudio.current = true
    setIsSpeaking(true)
    setStatus('Speaking')

    try {
      const audio = new Audio(`data:audio/mp3;base64,${nextChunk.content}`)
      currentAudio.current = audio
      audio.onended = () => playNextAudioRef.current?.()
      audio.onerror = () => playNextAudioRef.current?.()
      await audio.play()
    } catch {
      playNextAudioRef.current?.()
    }
  }, [])

  useEffect(() => {
    playNextAudioRef.current = playNextAudio
  }, [playNextAudio])

  const sendUtterance = (text) => {
    const finalText = text.trim()
    if (!mounted.current || sentTranscript.current) return
    sentTranscript.current = true
    if (!finalText || !isConnected) {
      setStatus(isConnected ? 'Tap to talk' : 'Offline')
      return
    }

    const frame = isCameraOn ? captureVideoFrame(videoRef.current) : null
    setAiSubtitle('')
    const turnId = onSend(finalText, frame, true)
    activeTurnId.current = turnId
    setStatus(turnId ? 'Thinking' : 'Could not send. Check the connection or finish the current reply.')
  }
  useEffect(() => { sendUtteranceRef.current = sendUtterance })

  const stopListening = async () => {
    setIsListening(false)
    setStatus('Thinking')

    if (recognitionMode.current === 'browser') {
      browserRecognition.current?.stop()
      return
    }

    try {
      await SpeechRecognition.stop()
    } catch {
      // The browser fallback does not use the Capacitor stop path.
    }

    sendUtterance(transcriptRef.current)
  }

  const startBrowserRecognition = () => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!Recognition) return false

    const recognition = new Recognition()
    browserRecognition.current = recognition
    recognitionMode.current = 'browser'
    recognition.lang = language
    recognition.interimResults = true
    recognition.continuous = false

    recognition.onstart = () => {
      sentTranscript.current = false
      transcriptRef.current = ''
      setUserSubtitle('')
      setAiSubtitle('')
      setIsListening(true)
      setStatus('Listening')
    }

    recognition.onresult = (event) => {
      let transcript = ''
      for (const result of event.results) transcript += result[0].transcript
      transcriptRef.current = transcript.trim()
      setUserSubtitle(transcriptRef.current)
    }

    recognition.onerror = () => {
      sentTranscript.current = true
      setStatus('Could not hear that')
    }

    recognition.onend = () => {
      setIsListening(false)
      if (mounted.current) sendUtteranceRef.current?.(transcriptRef.current)
    }

    try { recognition.start() } catch { setStatus('Microphone unavailable'); setIsListening(false) }
    return true
  }

  const startCapacitorRecognition = async () => {
    try {
      const { available } = await SpeechRecognition.available()
      if (!available) {
        setStatus('Speech recognition unavailable')
        return
      }

      await SpeechRecognition.requestPermissions()
      if (!mounted.current) return
      sentTranscript.current = false
      transcriptRef.current = ''
      recognitionMode.current = 'capacitor'
      setUserSubtitle('')
      setAiSubtitle('')
      setIsListening(true)
      setStatus('Listening')
      await SpeechRecognition.start({
        language,
        partialResults: true,
        popup: false,
      })
    } catch {
      setIsListening(false)
      setStatus('Microphone unavailable')
    }
  }

  const toggleMic = async () => {
    stopAudio()
    onInterrupt()

    if (isListening) {
      await stopListening()
      return
    }

    if (!startBrowserRecognition()) await startCapacitorRecognition()
  }

  const toggleCamera = async () => {
    if (isCameraOn) {
      webcamStream.current?.getTracks().forEach((track) => track.stop())
      webcamStream.current = null
      if (videoRef.current) videoRef.current.srcObject = null
      setIsCameraOn(false)
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      if (!mounted.current) { stream.getTracks().forEach(track => track.stop()); return }
      webcamStream.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => {})
      }
      setIsCameraOn(true)
    } catch {
      setStatus('Camera unavailable')
    }
  }

  useEffect(() => {
    let partialListener
    let stateListener
    let disposed = false

    SpeechRecognition.addListener('partialResults', (data) => {
      const text = data.matches?.[0]?.trim() || ''
      transcriptRef.current = text
      setUserSubtitle(text)
    }).then((listener) => {
      if (disposed) listener.remove()
      else partialListener = listener
    }).catch(() => {})

    SpeechRecognition.addListener('listeningState', data => {
      if (data.status === 'stopped' && recognitionMode.current === 'capacitor') {
        setIsListening(false)
        sendUtteranceRef.current?.(transcriptRef.current)
      }
    }).then(listener => { if (disposed) listener.remove(); else stateListener = listener }).catch(() => {})

    return () => {
      disposed = true
      partialListener?.remove()
      stateListener?.remove()
    }
  }, [])

  useEffect(() => {
    if (!socket) return undefined

    const handler = (event) => {
      let data
      try { data = JSON.parse(event.data) } catch { return }
      if (data.chat_session_id !== chatSessionId || data.session_id !== activeTurnId.current) return

      if (data.type === 'text_stream') {
        setAiSubtitle((previous) => `${previous}${data.content || ''}`)
        setStatus('Replying')
      }

      if (data.type === 'text_complete') {
        setStatus('Preparing voice')
      }
      if (data.type === 'error' || data.type === 'warning') setStatus(data.content)
      if (data.type === 'text_stream_end' && !isPlayingAudio.current) setStatus(data.status === 'complete' ? 'Tap to talk' : 'Reply stopped. Tap to try again.')

      if (data.type === 'audio_sentence') {
        audioQueue.current.push({ text: data.text, content: data.content })
        if (!isPlayingAudio.current) playNextAudioRef.current?.()
      }
    }

    socket.addEventListener('message', handler)
    return () => socket.removeEventListener('message', handler)
  }, [socket, chatSessionId])

  useEffect(() => {
    // A disconnected transport must stop audio already playing on the device.
    // eslint-disable-next-line react/set-state-in-effect
    if (!isConnected) { stopAudio(); setStatus('Offline. Reconnecting...') }
  }, [isConnected, stopAudio])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      stopAudio()
      webcamStream.current?.getTracks().forEach((track) => track.stop())
      if (browserRecognition.current) browserRecognition.current.onend = null
      browserRecognition.current?.abort?.()
      if (recognitionMode.current === 'capacitor') SpeechRecognition.stop().catch(() => {})
    }
  }, [stopAudio])

  return (
    <div className="voice-mode-screen">
      <header className="voice-topbar">
        <button className="voice-nav-button" type="button" onClick={onBack}>
          <ArrowLeft size={18} />
          Chat
        </button>
        <div className={`voice-online-pill ${isConnected ? 'connected' : 'offline'}`}>
          {isConnected ? <Wifi size={15} /> : <WifiOff size={15} />}
          {isConnected ? 'Online' : 'Offline'}
        </div>
      </header>

      <div className="voice-avatar-area">
        <VrmAvatar isSpeaking={isSpeaking} emotion={emotion} />
      </div>

      <section className="voice-subtitles">
        <div className="voice-ai-line">
          {aiSubtitle || status}
        </div>
        <div className="voice-user-line">
          {userSubtitle || ' '}
        </div>
        <div className="voice-status" role="status">{status}</div>
      </section>

      <div className={`camera-peek ${isCameraOn ? 'visible' : ''}`}>
        <video ref={videoRef} autoPlay muted playsInline />
      </div>

      <div className="voice-controls">
        <button className={`voice-control-button ${isCameraOn ? 'active' : ''}`} type="button" onClick={toggleCamera} aria-label={isCameraOn ? 'Turn camera off' : 'Turn camera on'} title={isCameraOn ? 'Turn camera off' : 'Turn camera on'} disabled={!imagesEnabled} aria-pressed={isCameraOn}>
          {isCameraOn ? <Camera size={22} /> : <CameraOff size={22} />}
        </button>

        <button className={`voice-mic-button ${isListening ? 'listening' : isSpeaking ? 'speaking' : ''}`} type="button" onClick={toggleMic} aria-label={isListening ? 'Stop listening' : 'Start listening'} title={isListening ? 'Stop listening' : 'Start listening'} disabled={!isConnected}>
          {isListening ? <MicOff size={30} /> : <Mic size={30} />}
        </button>

        <button className="voice-control-button" type="button" onClick={() => { stopAudio(); onInterrupt() }} aria-label="Stop audio" title="Stop audio">
          <Volume2 size={22} />
        </button>
      </div>
    </div>
  )
}
