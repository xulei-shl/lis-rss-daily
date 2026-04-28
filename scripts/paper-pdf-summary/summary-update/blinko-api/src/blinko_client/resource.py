from typing import List, Dict, Any, Optional
from .base import BlinkoBaseClient


class TagClient:
    """Blinko Tag API 客户端"""

    def __init__(self, client: BlinkoBaseClient):
        self._client = client

    def list(self) -> List[Dict[str, Any]]:
        """获取标签列表"""
        return self._client.post("/tag/list", json={})

    def create(self, name: str) -> Dict[str, Any]:
        """创建标签"""
        return self._client.post("/tag/upsert", json={"name": name})

    def delete(self, tag_id: int) -> Dict[str, Any]:
        """删除标签"""
        return self._client.post("/tag/delete", json={"id": tag_id})


class FileClient:
    """Blinko File API 客户端"""

    def __init__(self, client: BlinkoBaseClient):
        self._client = client

    def list(self) -> List[Dict[str, Any]]:
        """获取文件列表"""
        return self._client.post("/file/list", json={})


class ConfigClient:
    """Blinko Config API 客户端"""

    def __init__(self, client: BlinkoBaseClient):
        self._client = client

    def get(self) -> Dict[str, Any]:
        """获取配置"""
        return self._client.get("/config/get")

    def update(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """更新配置"""
        return self._client.post("/config/update", json=config)