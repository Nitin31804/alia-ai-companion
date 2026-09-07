
import sqlite3
import json

DB_FILE = 'memory.db'

def init_db():
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS chat_history (
            session_id TEXT,
            role TEXT,
            content TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.commit()
    conn.close()

def get_history(session_id, limit=10):
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute('''
        SELECT role, content FROM chat_history 
        WHERE session_id = ? 
        ORDER BY timestamp ASC
    ''', (session_id,))
    rows = c.fetchall()
    conn.close()
    
    # Return the last 'limit' messages
    history = [{'role': r[0], 'content': r[1]} for r in rows]
    return history[-limit:]

def add_message(session_id, role, content):
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute('''
        INSERT INTO chat_history (session_id, role, content)
        VALUES (?, ?, ?)
    ''', (session_id, role, content))
    conn.commit()
    conn.close()

