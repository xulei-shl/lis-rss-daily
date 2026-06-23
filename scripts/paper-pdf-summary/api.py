import os
import sys
import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

sys.path.insert(0, str(Path(__file__).parent))

from utils.api_queue import QueueManager
from utils.summary_uploader import upload_all_from_text, load_config, is_all_upload_failed

queue_manager = QueueManager(max_concurrent=1)


class ProcessRequest(BaseModel):
    title: str
    id: Optional[int] = None
    push_wechat: bool = False
    push_hiagent: Optional[bool] = None
    push_memos: Optional[bool] = None
    push_blinko: Optional[bool] = None


class ProcessResponse(BaseModel):
    success: bool
    article_id: Optional[int]
    md_path: Optional[str]
    md_content: Optional[str]
    stages: dict
    reason: Optional[str]


class UploadTextRequest(BaseModel):
    content: str
    title: str
    id: Optional[int] = None
    source_name: Optional[str] = None
    push_wechat: bool = False
    push_hiagent: Optional[bool] = None
    push_memos: Optional[bool] = None
    push_blinko: Optional[bool] = None


class UploadTextResponse(BaseModel):
    success: bool
    article_id: Optional[int]
    title: Optional[str]
    stages: dict
    reason: Optional[str]


class HealthResponse(BaseModel):
    status: str
    queue_size: int


class ErrorResponse(BaseModel):
    error: str
    detail: Optional[str] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    queue_manager._ensure_config()
    yield


app = FastAPI(
    title="Paper PDF Summary API",
    description="论文PDF摘要工作流 API - 支持 PDF下载、总结、并行上传，以及直接文本上传",
    version="1.1.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/process", response_model=ProcessResponse)
async def process(req: ProcessRequest) -> ProcessResponse:
    task_id = await queue_manager.enqueue(req.title, req.id, req.push_wechat, req.push_hiagent, req.push_memos, req.push_blinko)
    result = await queue_manager.get_result(task_id)

    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])

    return ProcessResponse(
        success=result.get("success", False),
        article_id=result.get("article_id"),
        md_path=result.get("md_path"),
        md_content=result.get("md_content"),
        stages=result.get("stages", {}),
        reason=result.get("reason")
    )


@app.post("/upload-text", response_model=UploadTextResponse)
async def upload_text(req: UploadTextRequest) -> UploadTextResponse:
    article_id = req.id or 0
    skip_lis_rss = article_id == 0
    default_push_wechat = os.environ.get('PDF_SUMMARY_PUSH_WECHAT', 'false').lower() in {'1', 'true', 'yes', 'on'}
    final_push_wechat = req.push_wechat or default_push_wechat

    try:
        config = load_config()
        upload_results = await upload_all_from_text(
            md_content=req.content,
            article_id=article_id,
            article_title=req.title,
            source_name=req.source_name,
            config=config,
            skip_lis_rss=skip_lis_rss,
            skip_wechat=not final_push_wechat,
            push_hiagent=req.push_hiagent,
            push_memos=req.push_memos,
            push_blinko=req.push_blinko,
        )

        is_success = not is_all_upload_failed(upload_results)

        return UploadTextResponse(
            success=is_success,
            article_id=req.id,
            title=req.title,
            stages={"upload": upload_results},
            reason=None if is_success else "所有上传任务均失败"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    queue_size = await queue_manager.get_queue_size()
    return HealthResponse(
        status="ok",
        queue_size=queue_size
    )


if __name__ == "__main__":
    uvicorn.run(
        "api:app",
        host="0.0.0.0",
        port=8081,
        reload=False
    )
