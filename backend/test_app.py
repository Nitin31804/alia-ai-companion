import asyncio
import hashlib
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

import main
import storage


async def reply(history):
    yield 'Hello '
    yield 'there.'


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.sockets = []
        self.env = patch.dict(os.environ, {'ALIA_DB_PATH': str(Path(self.temp.name) / 'test.db'), 'APP_ENV': 'development'})
        self.env.start()
        self.token = patch.object(main, 'BETA_TOKEN', '')
        self.token.start()
        main.limits = main.Limits()
        self.client = TestClient(main.app)
        self.client.__enter__()

    def tearDown(self):
        for context in reversed(self.sockets):
            context.__exit__(None, None, None)
        self.client.__exit__(None, None, None)
        self.token.stop()
        self.env.stop()
        self.temp.cleanup()

    def connect(self, secret='a' * 64):
        context = self.client.websocket_connect('/ws/chat', headers={'origin': 'http://127.0.0.1:5173'})
        socket = context.__enter__()
        self.sockets.append(context)
        socket.send_json({'client_secret': secret})
        self.assertEqual(socket.receive_json()['type'], 'ready')
        return socket

    def message(self, **changes):
        return {'type': 'text', 'chat_session_id': 'chat-one', 'session_id': 'turn-one', 'content': 'Hi', **changes}

    def collect(self, socket):
        events = []
        while True:
            event = socket.receive_json()
            events.append(event)
            if event['type'] == 'text_stream_end':
                return events

    def test_health(self):
        self.assertEqual(self.client.get('/health').json()['status'], 'ok')

    def test_stream_ids_and_retry_are_idempotent(self):
        with patch.object(main, 'stream_reply', reply):
            socket = self.connect()
            socket.send_json(self.message())
            events = self.collect(socket)
            self.assertEqual(events[-1]['status'], 'complete')
            self.assertTrue(all(e['chat_session_id'] == 'chat-one' and e['session_id'] == 'turn-one' for e in events))
            socket.send_json(self.message())
            self.collect(socket)
        owner = hashlib.sha256(('a' * 64).encode()).hexdigest()
        self.assertEqual(len(storage.history(owner, 'chat-one')), 2)

    def test_errors_complete_without_persisting_failed_turn(self):
        async def fail(history):
            yield 'Partial'
            raise ValueError('Please retry.')
        with patch.object(main, 'stream_reply', fail):
            socket = self.connect()
            socket.send_json(self.message())
            events = self.collect(socket)
            self.assertEqual(events[-1]['status'], 'error')
            self.assertEqual(events[-2]['type'], 'error')
        owner = hashlib.sha256(('a' * 64).encode()).hexdigest()
        self.assertEqual(storage.history(owner, 'chat-one'), [])

    def test_voice_failure_preserves_successful_text(self):
        async def no_voice(*args):
            raise RuntimeError('provider down')
        with patch.object(main, 'stream_reply', reply), patch.object(main, 'synthesize', no_voice):
            socket = self.connect()
            socket.send_json(self.message(voice_mode=True))
            events = self.collect(socket)
            self.assertEqual(events[-1]['status'], 'complete')
            self.assertTrue(any(e['type'] == 'warning' for e in events))

    def test_owner_isolation_and_deletion(self):
        with patch.object(main, 'stream_reply', reply):
            socket = self.connect()
            socket.send_json(self.message())
            self.collect(socket)
            other = self.connect('b' * 64)
            other.send_json(self.message(type='delete_chat', content=''))
            self.assertEqual(other.receive_json()['type'], 'chat_deleted')
            owner = hashlib.sha256(('a' * 64).encode()).hexdigest()
            self.assertEqual(len(storage.history(owner, 'chat-one')), 2)
            self.assertEqual(storage.history(hashlib.sha256(('b' * 64).encode()).hexdigest(), 'chat-one'), [])
            socket.send_json(self.message(type='delete_chat', content=''))
            self.assertEqual(socket.receive_json()['type'], 'chat_deleted')
            self.assertEqual(storage.history(owner, 'chat-one'), [])

    def test_interrupt_emits_terminal_event(self):
        async def slow(history):
            yield 'Starting'
            await asyncio.sleep(30)
        with patch.object(main, 'stream_reply', slow):
            socket = self.connect()
            socket.send_json(self.message())
            self.assertEqual(socket.receive_json()['type'], 'accepted')
            self.assertEqual(socket.receive_json()['type'], 'text_stream')
            socket.send_json(self.message(type='interrupt'))
            self.assertEqual(socket.receive_json()['status'], 'cancelled')

    def test_origin_and_beta_access_rejected(self):
        with self.assertRaises(WebSocketDisconnect):
            with self.client.websocket_connect('/ws/chat', headers={'origin': 'https://untrusted.example'}):
                pass
        with patch.object(main, 'BETA_TOKEN', 'secret-beta-code'):
            with self.client.websocket_connect('/ws/chat', headers={'origin': 'http://127.0.0.1:5173'}) as socket:
                socket.send_json({'client_secret': 'a' * 64, 'access_token': 'wrong'})
                self.assertEqual(socket.receive_json()['type'], 'auth_error')
                with self.assertRaises(WebSocketDisconnect):
                    socket.receive_json()

    def test_invalid_payload_and_message_limit(self):
        socket = self.connect()
        socket.send_json(self.message(content='x' * 12001))
        self.assertEqual(socket.receive_json()['type'], 'protocol_error')
        owner = hashlib.sha256(('a' * 64).encode()).hexdigest()
        for _ in range(15):
            main.limits.allow(('chat', owner), 15)
        socket.send_json(self.message())
        events = self.collect(socket)
        self.assertEqual(events[0]['type'], 'error')
        self.assertEqual(events[-1]['status'], 'error')


if __name__ == '__main__':
    unittest.main()
