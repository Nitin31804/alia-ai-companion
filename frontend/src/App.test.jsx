import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App'


class TestSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSED = 3

  constructor() {
    this.readyState = TestSocket.CONNECTING
    setTimeout(() => {
      this.readyState = TestSocket.OPEN
      this.onopen?.()
    }, 0)
  }

  send(raw) {
    const packet = JSON.parse(raw)
    if (packet.type === 'auth') {
      setTimeout(() => {
        this.onmessage?.({ data: JSON.stringify({ type: 'ready', images: false }) })
      }, 0)
    }
  }

  close() {
    this.readyState = TestSocket.CLOSED
  }
}


describe('Alia workspace', () => {
  beforeEach(() => {
    vi.stubGlobal('WebSocket', TestSocket)
    localStorage.clear()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('loads a private workspace and authenticates the WebSocket', async () => {
    render(<App />)

    expect(await screen.findByText('Hey. How are you, really?')).toBeInTheDocument()
    expect(await screen.findByText('Online')).toBeInTheDocument()
    expect(screen.getByLabelText('Message Alia')).toBeEnabled()
    expect(screen.getByText('Alia is AI and can make mistakes.')).toBeInTheDocument()
  })
})
