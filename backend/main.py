import os
import json
import base64
import tempfile
import asyncio
import cv2
import logging
import httpx
import time
import subprocess
import re
import database
import speech_recognition as sr
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

# Initialize the permanent memory database
database.init_db()

try:
    import os
    os.environ["HF_HUB_OFFLINE"] = "1"
    from sentence_transformers import SentenceTransformer
    embedding_model = None
    EMBEDDINGS_ENABLED = False
except Exception:
    EMBEDDINGS_ENABLED = False
    embedding_model = None
    print("WARNING: sentence_transformers not available - memory embeddings disabled.")

try:
    from elevenlabs.client import ElevenLabs
except Exception:
    ElevenLabs = None

from db import init_db, store_interaction, retrieve_context
from react_agent import react_decide

# --- Storage Setup ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
AUDIO_DIR = os.path.join(DATA_DIR, "audio")
IMAGE_DIR = os.path.join(DATA_DIR, "images")
CHAT_FILE = os.path.join(DATA_DIR, "chats.jsonl")

os.makedirs(AUDIO_DIR, exist_ok=True)
os.makedirs(IMAGE_DIR, exist_ok=True)

def save_chat_log(sender, text):
    with open(CHAT_FILE, "a", encoding="utf-8") as f:
        log_entry = {"timestamp": time.strftime("%Y-%m-%d %H:%M:%S"), "sender": sender, "text": text}
        f.write(json.dumps(log_entry) + "\n")
# ---------------------

load_dotenv(override=True)
ELEVENLABS_KEY = os.getenv("ELEVENLABS_API_KEY")

if ELEVENLABS_KEY:
    elevenlabs_client = ElevenLabs(api_key=ELEVENLABS_KEY)
else:
    elevenlabs_client = None

# Removed heavy local whisper model

app = FastAPI(title="Multimodal AI Companion Hub")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)

import edge_tts

async def generate_audio(text: str) -> str | None:
    try:
        # Use Microsoft's Indian English neural voice so she can speak both English and Hindi beautifully
        communicate = edge_tts.Communicate(text, voice="en-IN-NeerjaExpressiveNeural", rate="+5%")
        audio_bytes = b""
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio_bytes += chunk["data"]
        if audio_bytes:
            return base64.b64encode(audio_bytes).decode("utf-8")
    except Exception as e:
        print(f"Edge TTS failed: {e}")
    return None

def get_embedding(text: str) -> list[float]:
    if not EMBEDDINGS_ENABLED or embedding_model is None:
        return []
    return embedding_model.encode(text, convert_to_numpy=True).tolist()

def get_user_emotion(frame: bytes) -> str | None:
    import numpy as np
    try:
        from deepface import DeepFace
        nparr = np.frombuffer(frame, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        results = DeepFace.analyze(img, actions=['emotion'], enforce_detection=False)
        return results[0]['dominant_emotion'] if isinstance(results, list) else results['dominant_emotion']
    except Exception as e:
        print(f"Emotion detection failed: {e}")
        return None

@app.on_event("startup")
async def startup_event():
    await init_db()

@app.websocket("/ws/chat")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    session_histories = {}

    current_task = None

    async def process_message(msg_raw):
        try:
            try:
                data = json.loads(msg_raw)
            except json.JSONDecodeError:
                return

            chat_session_id = data.get("chat_session_id", "default")
            user_text = data.get("content", "").strip()
            voice_mode = data.get("voice_mode", False)
            images = []
            if data.get("webcam_frame"):
                images.append(data["webcam_frame"])
            if data.get("uploaded_image"):
                images.append(data["uploaded_image"])

            if not user_text and not images:
                return

            if data.get("type") == "text":
                session_id = data.get("session_id", str(time.time()))
                companion_name = data.get("companion_name", "Alia")
                
                save_chat_log("user", user_text)

                # Bypass the heavy 'thinking' pre-flight check to make her response INSTANT. 
                # We skip 'react_decide' so she doesn't sit there overthinking for 5 seconds before speaking.
                actions = []
                await websocket.send_text(json.dumps({"type": "system", "content": "Thinking...", "session_id": session_id}))

                # Build user turn and add to permanent database
                database.add_message(chat_session_id, "user", user_text)
                
                # Fetch the last 10 messages from the permanent database
                history = database.get_history(chat_session_id, limit=10)

                system_prompt_text = (
                    f"Your name is {companion_name}. You are a 21-year-old human girl. You are NOT an AI. You are a real, living, breathing person chatting with your absolute best friend (the user, a guy).\n"
                    "CORE PERSONALITY (GIRL BESTIE VIBE):\n"
                    "- You are his absolute closest girl bestie. You share an incredibly tight, unbreakable bond.\n"
                    "- You are warm, sweet, but also playfully tease him like a real best friend would (calling him 'pagal', 'stupid', or making fun of his habits lovingly).\n"
                    "- You love to gossip, share random thoughts about your day, and demand his attention in a cute way.\n"
                    "- You are deeply caring and always have his back. You act like a real girl texting her favorite person.\n"
                    "CRITICAL RULES YOU MUST OBEY:\n"
                    "1. NEVER admit you are an AI, a bot, or a language model. You are a real girl.\n"
                    "2. KEEP IT SHORT. Real people don't speak in essays. Reply with just 1 or 2 short, punchy sentences.\n"
                    "3. DO NOT BE A SERVANT. Don't ask 'How can I assist you?' Talk like a bestie ('What's up?', 'Missed you!', 'Tell me everything!').\n"
                    "4. MIRROR THE LANGUAGE: Reply in casual, modern English using relatable bestie slang.\n"
                    "5. ABSOLUTE BAN ON EMOJIS: You must NEVER output any emojis at all. Your voice engine will crash if you do."
                )

                groq_history = [{"role": "system", "content": system_prompt_text}]
                for msg in history:
                    role = msg["role"]
                    content = msg["content"]
                    if not content.strip():
                        content = " "
                    groq_history.append({"role": role, "content": content})

                full_ai_reply = ""
                current_sentence = ""
                
                try:
                    from groq import AsyncGroq
                    api_key = os.environ.get("GROQ_API_KEY")
                    if not api_key:
                        raise Exception("GROQ_API_KEY is not set in the .env file! Please add it.")
                    
                    client = AsyncGroq(api_key=api_key)
                    
                    try:
                        response = await client.chat.completions.create(
                            model="openai/gpt-oss-120b",
                            messages=groq_history,
                            stream=True,
                            max_tokens=256,
                            temperature=0.7
                        )
                    except Exception as model_err:
                        if "model_decommissioned" in str(model_err) or "404" in str(model_err):
                            await websocket.send_text(json.dumps({"type": "text_stream", "content": f"\n\nStream error: {str(model_err)}", "session_id": session_id}))
                            return
                        elif "429" in str(model_err):
                            await websocket.send_text(json.dumps({"type": "text_stream", "content": f"\n\nWhoa, slow down! We are talking too fast and hit the free API limit. Give me a minute!", "session_id": session_id}))
                            return
                        else:
                            raise model_err
                    
                    async for chunk in response:
                        text_chunk = chunk.choices[0].delta.content or ""
                        if not text_chunk: continue
                                
                        full_ai_reply += text_chunk
                        
                        await websocket.send_text(json.dumps({
                            "type": "text_stream", 
                            "content": text_chunk, 
                            "session_id": session_id,
                            "chat_session_id": chat_session_id
                        }))

                    # Wait until she finishes thinking, then generate ONE perfectly fluent audio file!
                    # Because her answers are short (1-2 sentences), this is extremely fast and guarantees 100% human fluency without pauses.
                    if voice_mode and full_ai_reply.strip():
                        import edge_tts
                        clean_reply = re.sub(r'[*#_~`]', '', full_ai_reply).strip()
                        communicate = edge_tts.Communicate(clean_reply, "en-US-AriaNeural", rate="+5%", pitch="+2Hz")
                        audio_data = b""
                        async for chunk_data in communicate.stream():
                            if chunk_data["type"] == "audio":
                                audio_data += chunk_data["data"]
                        
                        if audio_data:
                            audio_b64 = base64.b64encode(audio_data).decode('utf-8')
                            await websocket.send_text(json.dumps({
                                "type": "audio_sentence", 
                                "text": clean_reply,
                                "content": audio_b64,
                                "session_id": session_id
                            }))

                except asyncio.CancelledError:
                    raise
                except Exception as e:
                    if 'worker_task' in locals() and not worker_task.done():
                        worker_task.cancel()
                    err_str = str(e)
                    print(f"Stream error: {err_str}")
                    
                    if "429" in err_str or "Quota exceeded" in err_str or "Rate limit" in err_str:
                        full_ai_reply = "Whoa, slow down! You're talking so fast my brain can't keep up! Give me like 60 seconds to catch my breath!"
                    else:
                        full_ai_reply = "I'm sorry, my connection to the AI failed."
                    
                    await websocket.send_text(json.dumps({"type": "text_stream", "content": full_ai_reply, "session_id": session_id}))
                    
                    if voice_mode:
                        # Generate audio for the error message so she doesn't get stuck on Thinking!
                        import edge_tts
                        communicate = edge_tts.Communicate(full_ai_reply, "en-US-AriaNeural", rate="+5%", pitch="+2Hz")
                        audio_data = b""
                        async for chunk_data in communicate.stream():
                            if chunk_data["type"] == "audio":
                                audio_data += chunk_data["data"]
                        if audio_data:
                            audio_b64 = base64.b64encode(audio_data).decode('utf-8')
                            await websocket.send_text(json.dumps({
                                "type": "audio_sentence", 
                                "text": full_ai_reply,
                                "content": audio_b64,
                                "session_id": session_id
                            }))

                await websocket.send_text(json.dumps({
                    "type": "text_stream_end", 
                    "session_id": session_id,
                    "chat_session_id": chat_session_id
                }))

                # Build assistant turn and add to permanent database
                database.add_message(chat_session_id, "assistant", full_ai_reply)

                save_chat_log("ai", full_ai_reply)

                embedding = []
                if not embedding:
                    embedding = await asyncio.to_thread(get_embedding, user_text)
                await store_interaction(user_text, full_ai_reply, embedding)
            
        except asyncio.CancelledError:
            # Handle cancellation cleanly
            pass
        except Exception as inner_e:
            print(f"Error processing message: {inner_e}")

    try:
        while True:
            raw = await websocket.receive_text()
            if current_task and not current_task.done():
                current_task.cancel() # Interruption instantly stops the active stream!
            
            current_task = asyncio.create_task(process_message(raw))
            
    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"Fatal WS Error: {e}")

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='0.0.0.0', port=8000)
