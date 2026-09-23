"""Provider boundaries for chat, image understanding, and speech synthesis."""

import base64
import os
import re
from collections.abc import AsyncIterator
from typing import Protocol

import edge_tts
import httpx
from groq import AsyncGroq


class ChatProvider(Protocol):
    async def stream(self, history: list[dict[str, str]]) -> AsyncIterator[str]: ...


class ImageProvider(Protocol):
    async def describe(self, encoded: str, question: str) -> str: ...


class SpeechProvider(Protocol):
    async def synthesize(self, text: str, language: str) -> str: ...


class GroqChatProvider:
    async def stream(self, history: list[dict[str, str]]) -> AsyncIterator[str]:
        key = os.getenv("GROQ_API_KEY")
        if not key:
            raise ValueError("Chat is not configured on this server yet.")
        async with AsyncGroq(api_key=key, timeout=45, max_retries=1) as client:
            stream = await client.chat.completions.create(
                model=os.getenv("GROQ_MODEL", "openai/gpt-oss-120b"),
                messages=history,
                stream=True,
                max_tokens=1024,
                temperature=0.7,
            )
            try:
                async for chunk in stream:
                    if chunk.choices and chunk.choices[0].delta.content:
                        yield chunk.choices[0].delta.content
            finally:
                await stream.close()


class GeminiImageProvider:
    async def describe(self, encoded: str, question: str) -> str:
        try:
            raw = base64.b64decode(encoded, validate=True)
        except (ValueError, TypeError) as exc:
            raise ValueError("Invalid image attachment.") from exc
        if not raw.startswith(b"\xff\xd8\xff"):
            raise ValueError("Please attach a JPEG image.")

        key, model = os.getenv("GEMINI_API_KEY"), os.getenv("GEMINI_MODEL")
        if not key or not model:
            raise ValueError("Image understanding is unavailable. Remove the image and retry.")
        if not re.fullmatch(r"[a-zA-Z0-9._-]+", model):
            raise ValueError("Image model configuration is invalid.")

        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                headers={"x-goog-api-key": key},
                json={
                    "contents": [
                        {
                            "parts": [
                                {
                                    "text": (
                                        "Describe visible details relevant to this question: "
                                        f"{question}"
                                    )
                                },
                                {
                                    "inlineData": {
                                        "mimeType": "image/jpeg",
                                        "data": encoded,
                                    }
                                },
                            ]
                        }
                    ],
                    "generationConfig": {"maxOutputTokens": 600},
                },
            )
            response.raise_for_status()
            candidates = response.json().get("candidates", [])
            description = "".join(
                part.get("text", "")
                for candidate in candidates
                for part in candidate.get("content", {}).get("parts", [])
            )
            if not description:
                raise ValueError("The image could not be inspected. Try another image.")
            return description


class EdgeSpeechProvider:
    voices = {
        "en-IN": "en-IN-NeerjaNeural",
        "en-US": "en-US-AriaNeural",
        "hi-IN": "hi-IN-SwaraNeural",
    }

    async def synthesize(self, text: str, language: str) -> str:
        audio = bytearray()
        clean_text = re.sub(r"[*#_~`]", "", text)
        async for chunk in edge_tts.Communicate(clean_text, self.voices[language]).stream():
            if chunk["type"] == "audio":
                audio.extend(chunk["data"])
        if not audio:
            raise ValueError("No voice audio returned")
        return base64.b64encode(audio).decode("ascii")


chat_provider: ChatProvider = GroqChatProvider()
image_provider: ImageProvider = GeminiImageProvider()
speech_provider: SpeechProvider = EdgeSpeechProvider()


async def stream_reply(history: list[dict[str, str]]) -> AsyncIterator[str]:
    async for chunk in chat_provider.stream(history):
        yield chunk


async def describe_image(encoded: str, question: str) -> str:
    return await image_provider.describe(encoded, question)


async def synthesize(text: str, language: str) -> str:
    return await speech_provider.synthesize(text, language)


def provider_status() -> dict[str, bool | str]:
    return {
        "chat": "groq",
        "chat_configured": bool(os.getenv("GROQ_API_KEY")),
        "image": "gemini",
        "image_configured": bool(os.getenv("GEMINI_API_KEY") and os.getenv("GEMINI_MODEL")),
        "speech_input": "browser_or_device",
        "speech_output": "edge_tts",
    }
