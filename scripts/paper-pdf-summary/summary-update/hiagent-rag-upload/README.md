# 知识库文档上传工具

使用 Playwright 自动化上传 Markdown 文件到知识库，支持跨平台登录状态同步。

## 功能特性

- 自动上传 Markdown 文件到知识库
- 登录状态基于 storage_state (JSON)，天然跨平台，无需 zip 压缩
- 交互式登录：打开浏览器手动登录，按 Enter 保存登录态
- 上传成功后可自动刷新登录状态 JSON

## 环境要求

- Python 3.8+
- Playwright
- Chrome/Chromium 浏览器

## 安装依赖

```bash
pip install -r requirements.txt
playwright install chromium
```

## 配置环境变量

在 `.env` 文件中配置以下内容：

```env
# 工作空间类型（可选，默认 personal）
WorkspaceType=personal

# 工作空间 ID（必填）
WorkspaceID=your_workspace_id

# 知识库 ID（必填）
DatasetID=your_knowledge_id
```

## 使用方法

### 上传文件

```bash
python upload_knowledge.py <markdown_file.md>
```

参数说明：
- `file_path`：要上传的 Markdown 文件路径（必填）
- `--headless`：是否使用无头模式，默认 True
- `--workspace-type`：工作空间类型
- `--workspace-id`：工作空间 ID
- `--knowledge-id`：知识库 ID
- `--delete`：上传后是否删除本地 md 文件，默认 False

示例：
```bash
python upload_knowledge.py 'test.md'
python upload_knowledge.py 'test.md' --headless=False
python upload_knowledge.py 'test.md' --workspace-id=ws_xxx --knowledge-id=kb_xxx
```

### 登录状态管理

#### 交互式登录

首次使用或登录过期时，通过交互式登录创建登录态：

```bash
python session_manager.py login
python session_manager.py login -u https://hiagent.library.sh.cn
```

流程：
1. 打开非 headless 浏览器，导航到目标页面
2. 在浏览器中手动完成登录
3. 回到命令行按 Enter
4. 自动保存登录态到 `playwright_storage_state.json`

#### 导入登录状态

在另一台电脑或另一个平台使用前，先导入登录状态：

```bash
python session_manager.py import playwright_storage_state.json
```

导入成功后，直接运行上传脚本即可使用，无需重新登录。

## 跨平台使用方法

1. **在 A 电脑（登录）：**
   ```bash
   python session_manager.py login
   ```

2. **传输到 B 电脑：**
   - 将 `playwright_storage_state.json` 复制到 B 电脑同目录下

3. **在 B 电脑：**
   ```bash
   # 直接上传文件（自动读取同目录下的 storage_state）
   python upload_knowledge.py your_file.md
   ```

## 文件说明

| 文件 | 说明 |
|------|------|
| `upload_knowledge.py` | 主脚本，用于上传 Markdown 文件到知识库 |
| `session_manager.py` | 登录状态管理脚本，用于导入/交互式登录 |
| `playwright_storage_state.json` | 登录状态 JSON 文件（cookies + localStorage），跨平台可移植 |

## 注意事项

1. `playwright_storage_state.json` 包含登录凭据，请妥善保管
2. 某些网站可能会检测到浏览器环境变化，可能需要重新登录
3. 登录状态可能有过期时间，建议定期更新（可通过 `--auto-export` 自动刷新）

## 故障排除

### 登录状态导入后无法使用

- 确认 JSON 文件格式正确（`python session_manager.py import state.json` 会自动验证）
- 尝试重新登录

### 上传失败

- 检查网络连接
- 确认知识库 ID 和工作空间 ID 正确
- 查看 `error_screenshot.png` 了解错误详情
