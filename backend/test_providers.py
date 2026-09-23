import os
import unittest
from unittest.mock import patch

import providers


class ProviderTests(unittest.IsolatedAsyncioTestCase):
    async def test_image_provider_rejects_non_jpeg_without_network(self):
        with self.assertRaisesRegex(ValueError, 'JPEG'):
            await providers.GeminiImageProvider().describe('aGVsbG8=', 'What is this?')

    def test_status_reports_only_configured_capabilities(self):
        with patch.dict(os.environ, {'GROQ_API_KEY': '', 'GEMINI_API_KEY': '', 'GEMINI_MODEL': ''}):
            status = providers.provider_status()
        self.assertEqual(status['chat'], 'groq')
        self.assertFalse(status['chat_configured'])
        self.assertFalse(status['image_configured'])
        self.assertEqual(status['speech_input'], 'browser_or_device')


if __name__ == '__main__':
    unittest.main()
