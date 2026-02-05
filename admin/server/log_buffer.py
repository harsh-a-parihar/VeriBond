"""In-memory log buffer for admin API: capture pipeline logs for the log panel."""

from __future__ import annotations

import logging
from collections import deque
from threading import Lock

# Bounded buffer: keep last N log lines
LOG_BUFFER_MAX_LINES = 5000

_lines: deque[str] = deque(maxlen=LOG_BUFFER_MAX_LINES)
_lock = Lock()


class BufferHandler(logging.Handler):
    """Logging handler that appends formatted records to the shared buffer."""

    def emit(self, record: logging.LogRecord) -> None:
        try:
            msg = self.format(record)
            with _lock:
                _lines.append(msg)
        except Exception:
            self.handleError(record)


def install_buffer_handler() -> None:
    """Add the buffer handler to the root logger so all pipeline logs are captured."""
    root = logging.getLogger()
    for h in root.handlers:
        if isinstance(h, BufferHandler):
            return
    handler = BufferHandler()
    handler.setFormatter(
        logging.Formatter(
            fmt="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )
    )
    root.addHandler(handler)


def get_logs(tail: int = 500) -> list[str]:
    """Return the last `tail` log lines (newest last)."""
    with _lock:
        if tail >= len(_lines):
            return list(_lines)
        return list(_lines)[-tail:]


def clear_logs() -> None:
    """Clear the log buffer."""
    with _lock:
        _lines.clear()
