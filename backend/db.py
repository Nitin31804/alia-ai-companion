import os
import logging
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ASCENDING

load_dotenv()

MONGODB_URI = os.getenv("MONGODB_URI")
MONGODB_DB = os.getenv("MONGODB_DB", "ai_companion")
MONGODB_COLLECTION = os.getenv("MONGODB_COLLECTION", "conversations")

client: AsyncIOMotorClient | None = None
collection = None

async def init_db():
    global client, collection
    if not MONGODB_URI:
        logging.warning("MONGODB_URI not set – memory will be disabled.")
        return
    client = AsyncIOMotorClient(MONGODB_URI)
    db = client[MONGODB_DB]
    collection = db[MONGODB_COLLECTION]
    try:
        await collection.create_index([("timestamp", ASCENDING)], name="timestamp_index")
    except Exception as e:
        logging.info(f"Index creation ignored or failed: {e}")

async def store_interaction(user_text: str, ai_text: str, embedding: list[float]):
    if collection is None:
        return
    doc = {
        "user": user_text,
        "assistant": ai_text,
        "embedding": embedding,
        "timestamp": __import__("datetime").datetime.utcnow()
    }
    await collection.insert_one(doc)

async def retrieve_context(query_embedding: list[float], limit: int = 3):
    if collection is None or not query_embedding:
        return []
    # Use $vectorSearch aggregation if supported, otherwise fallback to simple $near
    pipeline = [
        {
            "$search": {
                "knnBeta": {
                    "vector": query_embedding,
                    "path": "embedding",
                    "k": limit
                }
            }
        },
        {"$project": {"assistant": 1, "_id": 0}}
    ]
    try:
        cursor = collection.aggregate(pipeline)
        results = [doc async for doc in cursor]
        return [r["assistant"] for r in results]
    except Exception as e:
        logging.error(f"Vector search failed: {e}")
        return []
