from typing import Optional
from .base import BlinkoBaseClient, load_config, BlinkoConfig
from .note import NoteClient
from .resource import TagClient, FileClient, ConfigClient


class BlinkoClient:
    """Blinko API 统一客户端入口"""

    def __init__(self, config: Optional[BlinkoConfig] = None):
        if config is None:
            config = load_config()
        self._base = BlinkoBaseClient(config)
        self.notes = NoteClient(self._base)
        self.tags = TagClient(self._base)
        self.files = FileClient(self._base)
        self.config = ConfigClient(self._base)