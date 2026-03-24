"""
DeepSearch API Service - FastAPI
"""

import os
import sys
import uuid
import json
import base64
import asyncio
import zipfile
from pathlib import Path
from typing import Optional, Dict, Any
from fastapi import FastAPI, HTTPException, BackgroundTasks
from pydantic import BaseModel

sys.path.insert(0, str(Path(__file__).parent.parent))
os.chdir(str(Path(__file__).parent.parent))

app = FastAPI(title="DeepSearch API")

tasks: Dict[str, Dict[str, Any]] = {}


class ProcessRequest(BaseModel):
    input_md: str
    input_type: str = "content"
    rounds: Optional[int] = None
    score_threshold: Optional[float] = None
    semantic_limit: Optional[int] = None
    max_final_articles: Optional[int] = None
    output_dir: Optional[str] = None


class TaskStatus(BaseModel):
    task_id: str
    status: str
    progress: Optional[Dict[str, Any]] = None
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None


async def run_deepsearch_task(
    task_id: str,
    input_md: str,
    input_type: str,
    rounds: Optional[int],
    score_threshold: Optional[float],
    semantic_limit: Optional[int],
    max_final_articles: Optional[int],
    output_dir: Optional[str],
):
    """Run deepsearch in background"""
    tasks[task_id]["status"] = "running"
    tasks[task_id]["progress"] = {"step": "initializing", "current": 0, "total": 100}

    try:
        from deepsearch import runDeepSearch

        if input_type == "file":
            from md_parser import readInputFile
            input_md = readInputFile(input_md)

        tasks[task_id]["progress"] = {"step": "searching", "current": 10, "total": 100}
        
        result = await runDeepSearch({
            "inputMd": input_md,
            "rounds": rounds,
            "scoreThreshold": score_threshold,
            "semanticLimit": semantic_limit,
            "maxFinalArticles": max_final_articles,
            "outputDir": output_dir,
        })

        tasks[task_id]["progress"] = {"step": "completed", "current": 100, "total": 100}
        tasks[task_id]["status"] = "completed"
        tasks[task_id]["result"] = result

    except Exception as e:
        tasks[task_id]["status"] = "failed"
        tasks[task_id]["error"] = str(e)


@app.post("/process", response_model=TaskStatus)
async def process(request: ProcessRequest, background_tasks: BackgroundTasks):
    """Start a deepsearch process"""
    task_id = str(uuid.uuid4())
    
    tasks[task_id] = {
        "status": "pending",
        "progress": {"step": "pending", "current": 0, "total": 100},
    }

    background_tasks.add_task(
        run_deepsearch_task,
        task_id,
        request.input_md,
        request.input_type,
        request.rounds,
        request.score_threshold,
        request.semantic_limit,
        request.max_final_articles,
        request.output_dir,
    )

    return TaskStatus(
        task_id=task_id,
        status="running",
        progress={"step": "starting", "current": 0, "total": 100},
    )


@app.get("/task/{task_id}", response_model=TaskStatus)
async def get_task(task_id: str):
    """Get task status"""
    if task_id not in tasks:
        raise HTTPException(status_code=404, detail="Task not found")
    
    task = tasks[task_id]
    return TaskStatus(
        task_id=task_id,
        status=task["status"],
        progress=task.get("progress"),
        result=task.get("result"),
        error=task.get("error"),
    )


@app.get("/task/{task_id}/download")
async def download_result(task_id: str):
    """Download task result as zip"""
    if task_id not in tasks:
        raise HTTPException(status_code=404, detail="Task not found")
    
    task = tasks[task_id]
    if task["status"] != "completed":
        raise HTTPException(status_code=400, detail="Task not completed")
    
    result = task.get("result", {})
    report_path = result.get("reportPath")
    articles_dir = result.get("articlesDir")
    
    if not report_path or not articles_dir:
        raise HTTPException(status_code=500, detail="Result files not found")
    
    zip_path = f"/tmp/deepsearch_{task_id}.zip"
    
    with zipfile.ZipFile(zip_path, "w") as zf:
        if os.path.exists(report_path):
            zf.write(report_path, Path(report_path).name)
        
        if os.path.exists(articles_dir):
            for root, dirs, files in os.walk(articles_dir):
                for file in files:
                    file_path = os.path.join(root, file)
                    arcname = f"articles/{file}"
                    zf.write(file_path, arcname)
    
    from fastapi.responses import FileResponse
    return FileResponse(zip_path, filename=f"deepsearch_{task_id}.zip", media_type="application/zip")


@app.get("/health")
async def health():
    """Health check"""
    return {"status": "healthy"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8082)