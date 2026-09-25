import asyncio
import hashlib
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import main
import storage
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect


async def reply(history):
    yield 'Hello '
    yield 'there.'


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.sockets = []
        self.env = patch.dict(
            os.environ,
            {
                'ALIA_DB_PATH': str(Path(self.temp.name) / 'test.db'),
                'ALIA_RETENTION_DAYS': '30',
                'APP_ENV': 'development',
            },
        )
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
        body = self.client.get('/health').json()
        self.assertEqual(body['status'], 'ok')
        self.assertEqual(body['retention_days'], 30)
        self.assertEqual(body['providers']['chat'], 'groq')

    def test_allowed_origins_are_normalized_and_validated(self):
        origins = main.parse_origins(
            ' Example.B4A.run/,https://ALIA.EXAMPLE.COM/,http://127.0.0.1:5173 '
        )
        self.assertEqual(
            origins,
            {
                'https://example.b4a.run',
                'https://alia.example.com',
                'http://127.0.0.1:5173',
            },
        )
        for value in ('ftp://example.com', 'https://example.com/path', 'https://user@example.com'):
            with self.subTest(value=value), self.assertRaises(RuntimeError):
                main.parse_origins(value)

    def test_current_https_host_is_allowed_without_weakening_cross_origin_checks(self):
        with patch.object(main, 'ORIGINS', {'https://configured.example.com'}):
            self.assertTrue(
                main.origin_is_allowed('https://configured.example.com', 'different.example.com')
            )
            self.assertTrue(
                main.origin_is_allowed('https://rotating.b4a.run', 'rotating.b4a.run:443')
            )
            self.assertFalse(
                main.origin_is_allowed('https://attacker.example.com', 'rotating.b4a.run')
            )
            self.assertFalse(main.origin_is_allowed('null', 'rotating.b4a.run'))

    def test_embedded_frontend_has_security_headers(self):
        static_dir = Path(self.temp.name) / 'static'
        static_dir.mkdir()
        (static_dir / 'index.html').write_text('<h1>Alia</h1>', encoding='utf-8')
        with patch.object(main, 'STATIC_DIR', static_dir):
            response = self.client.get('/')
        self.assertEqual(response.status_code, 200)
        self.assertIn('<h1>Alia</h1>', response.text)
        self.assertEqual(response.headers['x-frame-options'], 'DENY')
        self.assertIn("connect-src 'self'", response.headers['content-security-policy'])

    def test_metrics_and_emotion_are_emitted(self):
        async def supportive_reply(history):
            yield 'I am glad this is going well.'

        with patch.object(main, 'stream_reply', supportive_reply):
            socket = self.connect()
            socket.send_json(self.message(speech_recognition_ms=250))
            events = self.collect(socket)

        self.assertTrue(any(event.get('type') == 'emotion' and event.get('value') == 'happy' for event in events))
        metrics = self.client.get('/metrics').text
        self.assertIn('alia_chat_turns_total', metrics)
        self.assertIn('alia_speech_recognition_seconds_count', metrics)

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

    def test_retention_removes_expired_turns(self):
        with storage.connection() as db:
            db.execute(
                "INSERT INTO turns(owner,chat,request,user,assistant,created_at) VALUES (?,?,?,?,?,?)",
                ('owner', 'old-chat', 'old-turn', 'old', 'old', '2000-01-01 00:00:00'),
            )
        with patch.dict(os.environ, {'ALIA_RETENTION_DAYS': '1'}):
            storage.init_db()
        with storage.connection() as db:
            count = db.execute("SELECT COUNT(*) FROM turns WHERE chat='old-chat'").fetchone()[0]
        self.assertEqual(count, 0)


if __name__ == '__main__':
    unittest.main()
