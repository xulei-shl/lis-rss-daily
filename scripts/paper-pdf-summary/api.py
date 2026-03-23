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

queue_manager = QueueManager(max_concurrent=1)


class ProcessRequest(BaseModel):
    title: str
    id: Optional[int] = None
    push_wechat: bool = False


class ProcessResponse(BaseModel):
    success: bool
    article_id: Optional[int]
    md_path: Optional[str]
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
    description="论文PDF摘要工作流 API - 支持 PDF下载、总结、并行上传",
    version="1.0.0",
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
    task_id = await queue_manager.enqueue(req.title, req.id, req.push_wechat)
    result = await queue_manager.get_result(task_id)

    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])

    return ProcessResponse(
        success=result.get("success", False),
        article_id=result.get("article_id"),
        md_path=result.get("md_path"),
        stages=result.get("stages", {}),
        reason=result.get("reason")
    )


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
