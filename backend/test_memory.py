"""
Quick memory verification script.
Run this AFTER the backend is running and a few messages have been exchanged.

Usage:
    python test_memory.py
"""

import asyncio
import os
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv()

MONGODB_URI        = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
MONGODB_DB         = os.getenv("MONGODB_DB", "ai_companion")
MONGODB_COLLECTION = os.getenv("MONGODB_COLLECTION", "conversations")


async def main():
    print(f"Connecting to MongoDB at {MONGODB_URI} ...")
    client = AsyncIOMotorClient(MONGODB_URI)
    collection = client[MONGODB_DB][MONGODB_COLLECTION]

    count = await collection.count_documents({})
    print(f"Total interactions stored: {count}")

    if count == 0:
        print("No documents found – try chatting with the assistant first, then re-run this script.")
        return

    print("\nLast 5 interactions:")
    cursor = collection.find({}, {"user": 1, "assistant": 1, "timestamp": 1, "_id": 0}) \
                       .sort("timestamp", -1).limit(5)
    async for doc in cursor:
        print(f"\n[{doc.get('timestamp', 'N/A')}]")
        print(f"  YOU : {doc.get('user', '')[:100]}")
        print(f"  AI  : {doc.get('assistant', '')[:100]}")


if __name__ == "__main__":
    asyncio.run(main())
