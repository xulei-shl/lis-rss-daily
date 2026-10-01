from contextlib import asynccontextmanager
from pathlib import Path
from typing import List, Optional

import uvicorn
from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from utils.api_queue import QueueManager, build_distribution
from utils.summary_uploader import upload_all_from_text, load_config, get_env_bool

API_VERSION = "2.0"

queue_manager = QueueManager(max_concurrent=1)


class ProcessRequest(BaseModel):
    title: str
    id: Optional[int] = None
    # push_* 均为三态：null 沿用服务端配置，true 强制推送，false 强制跳过
    push_wechat: Optional[bool] = None
    push_hiagent: Optional[bool] = None
    push_memos: Optional[bool] = None
    push_blinko: Optional[bool] = None
    wait: bool = True
    # false 时只回 md_path/md_bytes，不回传摘要正文（长摘要留给文件承载）
    include_summary: bool = True


class ProcessAcceptedResponse(BaseModel):
    task_id: str
    status_url: str


class DistributionResult(BaseModel):
    """推送结果视图：requested 为本次实际尝试的目标，ok/failed/skipped 三段互斥"""
    requested: List[str] = []
    ok: List[str] = []
    failed: List[str] = []
    skipped: List[str] = []
    error: Optional[str] = None


class ProcessResponse(BaseModel):
    """success 仅代表摘要流水线（pdf_download/pdf_validate/pdf_summary）成败，与推送无关"""
    success: bool
    error_code: Optional[str] = None
    reason: Optional[str] = None
    article_id: Optional[int] = None
    md_path: Optional[str] = None
    md_bytes: Optional[int] = None
    md_content: Optional[str] = None
    stages: dict = {}
    distribution: Optional[DistributionResult] = None


class TaskStatusResponse(BaseModel):
    task_id: str
    title: Optional[str] = None
    status: str
    stage: Optional[str] = None
    elapsed_seconds: Optional[float] = None
    queue_wait_seconds: Optional[float] = None
    queued_at: Optional[float] = None
    finished_at: Optional[float] = None
    error_code: Optional[str] = None
    result: Optional[dict] = None


class UploadTextRequest(BaseModel):
    content: str
    title: str
    id: Optional[int] = None
    source_name: Optional[str] = None
    push_wechat: Optional[bool] = None
    push_hiagent: Optional[bool] = None
    push_memos: Optional[bool] = None
    push_blinko: Optional[bool] = None


class UploadTextResponse(BaseModel):
    success: bool
    error_code: Optional[str] = None
    reason: Optional[str] = None
    article_id: Optional[int] = None
    title: Optional[str] = None
    stages: dict = {}
    distribution: DistributionResult


class HealthResponse(BaseModel):
    status: str
    queue_size: int
    api_version: str
    capabilities: List[str]


@asynccontextmanager
async def lifespan(app: FastAPI):
    queue_manager._ensure_config()
    loaded = queue_manager.load_persisted_results()
    if loaded:
        print(f"[启动] 已回载历史任务结果 {loaded} 条")
    yield


app = FastAPI(
    title="Paper PDF Summary API",
    description=(
        "论文PDF摘要工作流 API。契约约定：success 只表示摘要流水线成败，"
        "推送结果见 distribution；失败原因见 error_code（稳定枚举）而非 reason 文案。"
    ),
    version=API_VERSION,
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

CAPABILITIES = [
    "async_task",          # wait=false + /process/status/{task_id} 轮询
    "error_code",          # 稳定错误码枚举
    "distribution_view",   # ok/failed/skipped 三段式推送结果
    "include_meta",        # 状态轮询轻量视图（?include=meta）
    "include_summary",     # 可关闭摘要正文内联（走 md_path 落盘留存）
    "persistent_results",  # 结果落盘，跨服务重启可查
]


def _md_bytes(md_path: Optional[str]) -> Optional[int]:
    """摘要文件字节数（UTF-8），供调用方判断是否值得内联正文"""
    if not md_path:
        return None
    try:
        return Path(md_path).stat().st_size
    except OSError:
        return None


@app.post("/process", response_model=None)
async def process(req: ProcessRequest, response: Response):
    """
    提交论文处理任务（默认阻塞等待完成；wait=false 时异步提交立即返回 task_id）。

    - success 只反映摘要流水线；推送结果见 distribution
    - 业务失败（PDF 拿不到、标题不匹配、摘要生成失败）返回 200 + success=false + error_code
    - 相同标题（忽略大小写/首尾空白）的在途任务不重复执行，
      复用现有 task_id 并在响应头 X-Deduplicated: true 标注
    """
    task_id, is_duplicate = await queue_manager.enqueue(
        req.title, req.id, req.push_wechat, req.push_hiagent, req.push_memos, req.push_blinko
    )

    response.headers["X-Queue-Size"] = str(await queue_manager.get_queue_size())
    response.headers["X-Deduplicated"] = "true" if is_duplicate else "false"

    # wait=false：异步模式，立即返回 task_id，由调用方轮询状态
    if not req.wait:
        return ProcessAcceptedResponse(task_id=task_id, status_url=f"/process/status/{task_id}")

    # 默认阻塞模式：等待工作流完成后一次性返回结果
    result = await queue_manager.get_result(task_id)

    if result is None:
        raise HTTPException(status_code=404, detail="Task not found or expired")

    md_content = result.get("md_content") if req.include_summary else None

    return ProcessResponse(
        success=result.get("success", False),
        error_code=result.get("error_code"),
        reason=result.get("reason"),
        article_id=result.get("article_id"),
        md_path=result.get("md_path"),
        md_bytes=_md_bytes(result.get("md_path")),
        md_content=md_content,
        stages=result.get("stages", {}),
        distribution=result.get("distribution"),
    )


@app.get("/process/status/{task_id}", response_model=TaskStatusResponse)
async def process_status(task_id: str, include: str = "full") -> TaskStatusResponse:
    """
    查询异步提交的任务状态（心跳/进度轮询端点）。

    status: queued（排队中）→ running（处理中）→ completed / failed
            completed 表示任务执行终结，业务成败看 result.success 与 error_code
    stage:  pdf_download → pdf_validate → pdf_summary → pdf_summary_check → upload

    include=meta 时只返回轻量进度视图（不含 result / 摘要正文），适合高频轮询
    """
    include_result = include != "meta"
    snapshot = await queue_manager.get_task_status(task_id, include_result=include_result)

    if snapshot is None:
        raise HTTPException(status_code=404, detail="Task not found or expired")

    return TaskStatusResponse(**snapshot)


@app.post("/upload-text", response_model=UploadTextResponse)
async def upload_text(req: UploadTextRequest) -> UploadTextResponse:
    """直接上传文本到各推送目标，不经过 PDF 下载与摘要生成"""
    article_id = req.id or 0
    skip_lis_rss = article_id == 0

    env_default_push_wechat = get_env_bool('PDF_SUMMARY_PUSH_WECHAT', False)
    final_push_wechat = env_default_push_wechat if req.push_wechat is None else bool(req.push_wechat)

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
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    distribution = build_distribution(upload_results)

    # 本端点只做推送：至少一个目标成功即视为成功，全部失败才报错
    is_success = bool(distribution["ok"])

    return UploadTextResponse(
        success=is_success,
        error_code=None if is_success else "distribution_failed",
        reason=None if is_success else "所有上传任务均失败",
        article_id=req.id,
        title=req.title,
        stages={"upload": upload_results},
        distribution=distribution,
    )


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        queue_size=await queue_manager.get_queue_size(),
        api_version=API_VERSION,
        capabilities=CAPABILITIES,
    )


if __name__ == "__main__":
    uvicorn.run(
        "api:app",
        host="0.0.0.0",
        port=8081,
        reload=False
    )
