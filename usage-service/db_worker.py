#!/usr/bin/python3
"""SQLite adapter used by the Node API; Python 3.6 standard library only."""

import json
import re
import sqlite3
import sys
import time


def emit(value):
    sys.stdout.write(json.dumps(dict(value, ok=True), separators=(',', ':')))


def main():
    database_path = sys.argv[1]
    operation = sys.argv[2]
    payload = json.load(sys.stdin)
    connection = sqlite3.connect(database_path, timeout=5)
    connection.execute('PRAGMA busy_timeout=5000')

    if operation == 'init':
        connection.execute('PRAGMA journal_mode=WAL')
        connection.execute('''CREATE TABLE IF NOT EXISTS daily_counts (
            day TEXT PRIMARY KEY CHECK(length(day) = 10),
            count INTEGER NOT NULL CHECK(count >= 0)
        )''')
        connection.execute('''CREATE TABLE IF NOT EXISTS consumed_challenges (
            token_hash TEXT PRIMARY KEY CHECK(length(token_hash) = 64),
            expires_at INTEGER NOT NULL
        )''')
        connection.commit()
        emit({})
    elif operation == 'chart':
        today = payload.get('today', '')
        cutoff = payload.get('cutoff', '')
        if not re.match(r'^\d{4}-\d{2}-\d{2}$', today) or not re.match(r'^\d{4}-\d{2}-\d{2}$', cutoff):
            raise ValueError('invalid chart range')
        now = int(time.time())
        connection.execute('DELETE FROM consumed_challenges WHERE expires_at < ?', (now,))
        connection.commit()
        summary = connection.execute(
            'SELECT COALESCE(SUM(count), 0), COALESCE(MIN(day), "") FROM daily_counts'
        ).fetchone()
        rows = connection.execute(
            'SELECT day, count FROM daily_counts WHERE day >= ? AND day <= ? ORDER BY day',
            (cutoff, today)
        ).fetchall()
        emit({
            'summary': {'total': summary[0], 'first_day': summary[1]},
            'days': [{'day': row[0], 'count': row[1]} for row in reversed(rows)]
        })
    elif operation == 'record':
        token_hash = payload.get('tokenHash', '')
        day = payload.get('day', '')
        expires = payload.get('expires')
        now = payload.get('now')
        if (not re.match(r'^[a-f0-9]{64}$', token_hash)
                or not re.match(r'^\d{4}-\d{2}-\d{2}$', day)
                or not isinstance(expires, int) or not isinstance(now, int)):
            raise ValueError('invalid database arguments')
        connection.execute('BEGIN IMMEDIATE')
        connection.execute('DELETE FROM consumed_challenges WHERE expires_at < ?', (now,))
        cursor = connection.execute(
            'INSERT OR IGNORE INTO consumed_challenges(token_hash, expires_at) VALUES(?, ?)',
            (token_hash, expires)
        )
        accepted = cursor.rowcount == 1
        if accepted:
            connection.execute(
                'INSERT INTO daily_counts(day, count) VALUES(?, 1) '
                'ON CONFLICT(day) DO UPDATE SET count = count + 1', (day,)
            )
        connection.commit()
        emit({'accepted': accepted})
    elif operation == 'cleanup':
        now = payload.get('now')
        if not isinstance(now, int):
            raise ValueError('invalid cleanup arguments')
        connection.execute('DELETE FROM consumed_challenges WHERE expires_at < ?', (now,))
        connection.commit()
        emit({})
    else:
        raise ValueError('unsupported database operation')

    connection.close()


try:
    main()
except Exception:
    try:
        connection.rollback()
        connection.close()
    except Exception:
        pass
    sys.stdout.write('{"ok":false}')
