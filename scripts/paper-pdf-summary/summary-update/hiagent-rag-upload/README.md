# 知识库文档上传工具

使用 Playwright 自动化上传 Markdown 文件到知识库，支持跨平台登录状态同步。

## 功能特性

- 🤖 自动上传 Markdown 文件到知识库
- 💾 支持登录状态导出/导入，跨平台使用
- 📦 上传成功后自动导出浏览器登录状态

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
- `--delete`：上传后是否删除本地 md 文件，默认 True（删除），设置 False 保留文件

示例：
```bash
# 上传文件（默认会删除本地 md 文件）
python upload_knowledge.py 'test.md'

# 上传文件但保留本地 md 文件
python upload_knowledge.py 'test.md' --delete=False

# 非无头模式（显示浏览器窗口）
python upload_knowledge.py 'test.md' --headless=False

# 指定工作空间和知识库
python upload_knowledge.py 'test.md' --workspace-id=ws_xxx --knowledge-id=kb_xxx
```

### 登录状态管理

#### 导出登录状态

首次登录成功后，脚本会自动导出登录状态到 `playwright_session_latest.zip`。

手动导出：
```bash
# 导出到自动命名的文件
python session_manager.py export

# 导出到指定文件
python session_manager.py export -o my_session.zip
```

#### 导入登录状态

在另一台电脑或另一个平台使用前，先导入登录状态：

```bash
# 导入登录状态
python session_manager.py import playwright_session_latest.zip
```

导入成功后，直接运行上传脚本即可使用，无需重新登录。

## 工作流程

### 跨平台使用方法

1. **在 A 电脑（已有登录状态）：**
   ```bash
   # 首次上传文件，会自动导出登录状态
   python upload_knowledge.py your_file.md
   
   # 或者手动导出
   python session_manager.py export -o session.zip
   ```

2. **传输到 B 电脑：**
   - 将 `playwright_session_latest.zip` 或 `session.zip` 复制到 B 电脑

3. **在 B 电脑：**
   ```bash
   # 导入登录状态
   python session_manager.py import playwright_session_latest.zip
   
   # 直接上传文件
   python upload_knowledge.py your_file.md
   ```

## 文件说明

| 文件 | 说明 |
|------|------|
| `upload_knowledge.py` | 主脚本，用于上传 Markdown 文件到知识库 |
| `session_manager.py` | 登录状态管理脚本，用于导出/导入浏览器状态 |
| `playwright_user_data/` | 浏览器用户数据目录（包含登录状态） |
| `playwright_session_latest.zip` | 自动导出的登录状态压缩包 |

## 注意事项

1. 导出的登录状态文件包含 Cookie 和会话信息，请妥善保管
2. 某些网站可能会检测到浏览器环境变化，可能需要重新登录
3. 登录状态可能有过期时间，建议定期更新
4. 压缩包已排除缓存文件以减小体积

## 故障排除

### 登录状态导入后无法使用

- 尝试删除 `playwright_user_data` 目录后重新导入
- 确认浏览器版本一致

### 上传失败

- 检查网络连接
- 确认知识库 ID 和工作空间 ID 正确
- 查看 `error_screenshot.png` 了解错误详情
