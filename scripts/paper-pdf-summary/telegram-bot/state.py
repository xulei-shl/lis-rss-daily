"""
状态管理模块

管理 Telegram Bot 的状态持久化，包括 update_id 等。
"""

import json
import os
from pathlib import Path
from typing import Optional, Dict, Any
from dataclasses import dataclass, asdict


STATE_DIR = os.getenv("TELEGRAM_STATE_DIR", "/tmp/paper-pdf-summary-telegram")


@dataclass
class BotState:
    """Bot 状态"""
    latest_update_id: int = 0
    user_id: int = 0
    chat_id: Optional[int] = None
    saved_at: str = ""


class StateManager:
    """状态管理器"""

    def __init__(self, user_id: int):
        self.user_id = user_id
        self.state_file = Path(STATE_DIR) / f"bot-state-user-{user_id}.json"
        self._ensure_state_dir()

    def _ensure_state_dir(self):
        """确保状态目录存在"""
        Path(STATE_DIR).mkdir(parents=True, exist_ok=True)

    def load(self) -> BotState:
        """
        加载状态

        Returns:
            BotState 对象
        """
        if not self.state_file.exists():
            return BotState(user_id=self.user_id)

        try:
            data = json.loads(self.state_file.read_text(encoding="utf-8"))
            return BotState(
                latest_update_id=data.get("latest_update_id", 0),
                user_id=data.get("user_id", self.user_id),
                chat_id=data.get("chat_id"),
                saved_at=data.get("saved_at", ""),
            )
        except (json.JSONDecodeError, KeyError) as e:
            print(f"[State] Failed to load state: {e}, starting fresh")
            return BotState(user_id=self.user_id)

    def save(self, state: BotState) -> bool:
        """
        保存状态

        Args:
            state: BotState 对象

        Returns:
            是否成功
        """
        try:
            from datetime import datetime
            state.saved_at = datetime.now().isoformat()
            data = asdict(state)
            self.state_file.write_text(
                json.dumps(data, ensure_ascii=False, indent=2),
                encoding="utf-8"
            )
            return True
        except Exception as e:
            print(f"[State] Failed to save state: {e}")
            return False

    def get_latest_update_id(self) -> int:
        """获取最新的 update_id"""
        state = self.load()
        return state.latest_update_id

    def set_latest_update_id(self, update_id: int) -> bool:
        """设置最新的 update_id"""
        state = self.load()
        state.latest_update_id = update_id
        return self.save(state)

    def set_chat_id(self, chat_id: int) -> bool:
        """设置聊天 ID"""
        state = self.load()
        state.chat_id = chat_id
        return self.save(state)


class ProcessingLock:
    """处理锁，防止并发处理"""

    def __init__(self):
        self.lock_dir = Path(STATE_DIR) / "locks"
        self.lock_dir.mkdir(parents=True, exist_ok=True)

    def is_locked(self) -> bool:
        """检查是否被锁定"""
        lock_file = self.lock_dir / "processing.lock"
        return lock_file.exists()

    def acquire(self) -> bool:
        """
        获取锁

        Returns:
            是否成功获取锁
        """
        if self.is_locked():
            return False

        try:
            lock_file = self.lock_dir / "processing.lock"
            from datetime import datetime
            lock_file.write_text(
                json.dumps({
                    "locked_at": datetime.now().isoformat(),
                    "pid": os.getpid()
                }),
                encoding="utf-8"
            )
            return True
        except Exception as e:
            print(f"[Lock] Failed to acquire lock: {e}")
            return False

    def release(self) -> bool:
        """
        释放锁

        Returns:
            是否成功释放锁
        """
        try:
            lock_file = self.lock_dir / "processing.lock"
            if lock_file.exists():
                lock_file.unlink()
            return True
        except Exception as e:
            print(f"[Lock] Failed to release lock: {e}")
            return False

    def get_lock_info(self) -> Optional[Dict[str, Any]]:
        """获取锁信息"""
        lock_file = self.lock_dir / "processing.lock"
        if not lock_file.exists():
            return None

        try:
            return json.loads(lock_file.read_text(encoding="utf-8"))
        except Exception:
            return None
