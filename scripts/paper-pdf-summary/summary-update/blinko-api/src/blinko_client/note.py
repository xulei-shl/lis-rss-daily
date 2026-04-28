from typing import Optional, List, Dict, Any
from .base import BlinkoBaseClient


class NoteClient:
    """Blinko Note API 客户端"""

    def __init__(self, client: BlinkoBaseClient):
        self._client = client

    def upsert(
        self,
        content: str,
        note_type: int = 0,
        id: Optional[int] = None,
        tags: Optional[List[str]] = None,
        is_archived: bool = False,
        is_share: bool = False,
        is_top: bool = False,
    ) -> Dict[str, Any]:
        """
        创建或更新笔记

        Args:
            content: 笔记内容 (支持 Markdown)
            note_type: 笔记类型 (0: flash, 1: normal, 2: daily)
            id: 笔记 ID (用于更新)
            tags: 标签列表
            is_archived: 是否归档
            is_share: 是否分享
            is_top: 是否置顶
        """
        data = {
            "content": content,
            "type": note_type,
            "isArchived": is_archived,
            "isShare": is_share,
            "isTop": is_top,
        }

        if id is not None:
            data["id"] = id

        if tags is not None:
            data["tags"] = tags

        return self._client.post("/note/upsert", json=data)

    def list(
        self,
        page: int = 1,
        size: int = 30,
        tag_id: Optional[int] = None,
        note_type: int = -1,
        is_archived: bool = False,
        is_recycle: bool = False,
        search_text: str = "",
        order_by: str = "desc",
    ) -> List[Dict[str, Any]]:
        """
        获取笔记列表

        Args:
            page: 页码
            size: 每页数量
            tag_id: 标签 ID
            note_type: 笔记类型 (-1: all, 0: flash, 1: normal, 2: daily)
            is_archived: 是否归档
            is_recycle: 是否回收站
            search_text: 搜索文本
            order_by: 排序方式 (asc/desc)
        """
        data = {
            "page": page,
            "size": size,
            "type": note_type,
            "isArchived": is_archived,
            "isRecycle": is_recycle,
            "searchText": search_text,
            "orderBy": order_by,
        }

        if tag_id is not None:
            data["tagId"] = tag_id

        return self._client.post("/note/list", json=data)

    def get_detail(self, note_id: int) -> Dict[str, Any]:
        """获取笔记详情"""
        return self._client.post("/note/detail", json={"id": note_id})

    def delete(self, note_id: int) -> Dict[str, Any]:
        """删除笔记"""
        return self._client.post("/note/batch-delete", json={"ids": [note_id]})

    def batch_delete(self, note_ids: List[int]) -> Dict[str, Any]:
        """批量删除笔记"""
        return self._client.post("/note/batch-delete", json={"ids": note_ids})

    def batch_trash(self, note_ids: List[int]) -> Dict[str, Any]:
        """批量移动到回收站"""
        return self._client.post("/note/batch-trash", json={"ids": note_ids})

    def restore(self, note_id: int) -> Dict[str, Any]:
        """恢复笔记"""
        return self.upsert(content="", id=note_id, is_archived=False)

    def share(
        self,
        note_id: int,
        is_share: bool = True,
        share_password: Optional[str] = None,
    ) -> Dict[str, Any]:
        """分享笔记"""
        data = {
            "id": note_id,
            "isShare": is_share,
        }
        if share_password:
            data["sharePassword"] = share_password
        return self._client.post("/note/share", json=data)
