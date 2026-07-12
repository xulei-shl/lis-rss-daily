# Paper PDF Summary — Markdown 渲染样式设计可复用指南

> 本文档提取自浏览器扩展 `cn_paper_pdf_summary_crx` 的 Markdown 渲染实现，目标是将其渲染设计（字体 / 字号 / 行距 / 颜色 / 代码块 / 标题层级）与**特殊文本格式清洗逻辑**完整保留，以便在任意 Web 应用中复用以获得一致的良好可读性。

---

## 1. 渲染管线总览

```
原始文本 raw
   │
   ├─ preprocessMarkdown(raw)   ← 结构清洗（详见第 4 节），确保产出标准 Markdown
   │
   ▼
 <div class="prose prose-sm w-full max-w-measure">
   <ReactMarkdown remarkPlugins={[remarkGfm]}>
     {清洗后的内容}
   </ReactMarkdown>
 </div>
```

关键文件：

| 文件 | 职责 |
|------|------|
| `components/MarkdownRenderer.tsx` | 包裹容器 `prose prose-sm w-full max-w-measure`，调用 `preprocessMarkdown` 后交给 react-markdown |
| `assets/globals.css` | 自定义 `.prose` 覆盖规则（第 85–199 行），定义最终渲染样式 |
| `lib/utils.ts` | `preprocessMarkdown()` 文本结构清洗 |
| `tailwind.config.ts` | `max-w-measure = 65ch`、字体/颜色/字号 token |
| `entrypoints/floating/index.html` | Google Fonts 预加载（EB Garamond / IBM Plex Sans / JetBrains Mono） |

技术栈：React 18 + `react-markdown` + `remark-gfm` + Tailwind + `@tailwindcss/typography`。

---

## 2. 特殊文本格式清洗（preprocessMarkdown）

> **目的**：摘要后端产出的原始文本并非严格标准 Markdown。该清洗函数将其转换为标准 MD 语法，是“可读性好”的前提，复用渲染样式时必须一并搬运。

原始实现位于 `lib/utils.ts:8-92`，逻辑如下：

### 2.1 逐行处理规则

1. **首行自动补全 H1**
   - 若第一行非空且不以 `#` 开头 → 自动加 `# ` 前缀作为标题。
   - 已以 `#` 开头 → 原样保留。

2. **中文一级小节 `一、二、三、` → `##`**
   - 正则：`^([一二三四五六七八九十百]+)[、.，,\s]\s*(.*)$`
   - 命中（且不在逻辑图谱块内）→ 输出 `## {数字}、{标题}`。
   - 例：`一、研究背景` → `## 一、研究背景`

3. **「核心逻辑图谱」自动包入 `text` 代码块**
   - 当某小节标题包含 `核心逻辑图谱` 时，开启 `inLogicMap` 状态，下一行起插入 ` ```text ` 围栏。
   - 遇到下一个中文小节（规则 2）时，先闭合 ` ``` ` 再输出新的 `##`。
   - 若文本结束仍在图谱块内 → 末尾自动补 ` ``` `。
   - 图谱首行若以 `Text`/`text` 开头，自动剥离该前缀词。

4. **数字子项 `1. 2.` / `1、` → `###`**
   - 正则：`^(\d+)[.、]\s*(.*)$`
   - 命中（且不在逻辑图谱块内）→ 输出 `### {数字}. {标题}`。
   - 例：`1. 方法概述` → `### 1. 方法概述`

5. **段间补空行**
   - 在非标题、非代码块围栏的连续非空内容之间，插入一个空行，保证段落正确分隔。

### 2.2 清洗函数源码（直接复用）

```typescript
// lib/utils.ts
export function preprocessMarkdown(text: string): string {
  if (!text) return ""

  const lines = text.split(/\r?\n/)
  const processedLines: string[] = []
  let inLogicMap = false
  let isFirstLine = true
  let isFirstMapLine = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    if (isFirstLine) {
      if (trimmed) {
        if (!trimmed.startsWith("#")) {
          processedLines.push(`# ${trimmed}`)
        } else {
          processedLines.push(line)
        }
        isFirstLine = false
      }
      continue
    }

    const sectionMatch = trimmed.match(/^([一二三四五六七八九十百]+)[、.，,\s]\s*(.*)$/)
    if (sectionMatch && !inLogicMap) {
      const num = sectionMatch[1]
      const title = sectionMatch[2]

      processedLines.push(`## ${num}、${title}`)

      if (title.includes("核心逻辑图谱")) {
        inLogicMap = true
        isFirstMapLine = true
        processedLines.push("```text")
      }
      continue
    }

    if (inLogicMap) {
      const nextSectionMatch = trimmed.match(/^([一二三四五六七八九十百]+)[、.，,\s]\s*(.*)$/)
      if (nextSectionMatch) {
        const num = nextSectionMatch[1]
        const title = nextSectionMatch[2]
        processedLines.push("```")
        inLogicMap = false
        processedLines.push(`## ${num}、${title}`)
        continue
      }
    }

    const subSectionMatch = trimmed.match(/^(\d+)[.、]\s*(.*)$/)
    if (subSectionMatch && !inLogicMap) {
      const num = subSectionMatch[1]
      const title = subSectionMatch[2]
      processedLines.push(`### ${num}. ${title}`)
      continue
    }

    if (inLogicMap) {
      let outputLine = line
      if (isFirstMapLine && trimmed) {
        outputLine = line.replace(/^[Tt]ext/, "")
        isFirstMapLine = false
      }
      processedLines.push(outputLine)
      continue
    }

    if (trimmed) {
      const lastLine = processedLines.length > 0 ? processedLines[processedLines.length - 1] : ""
      if (lastLine && !lastLine.startsWith("#") && !lastLine.startsWith("```")) {
        processedLines.push("")
      }
    }
    processedLines.push(line)
  }

  if (inLogicMap) {
    processedLines.push("```")
  }

  return processedLines.join("\n")
}
```

### 2.3 清洗前后对照示例

| 原始文本 | 清洗后（标准 MD） |
|----------|------------------|
| `论文摘要` | `# 论文摘要` |
| `一、研究背景` | `## 一、研究背景` |
| `1. 方法概述` | `### 1. 方法概述` |
| `核心逻辑图谱\nText A→B` | `## 核心逻辑图谱\n```text\nA→B\n``` ` |

---

## 3. 颜色系统（OKLCH tokens）

定义于 `assets/globals.css:7-14`，并映射到 typography 变量（`:87-100`）：

| 角色 | OKLCH | 十六进制近似 | 用途 |
|------|-------|--------------|------|
| 背景 paper | `oklch(97.5% 0.008 100)` | `#f7f7f4` | 页面/容器底 |
| 次级背景 paper-2 | `oklch(94.5% 0.010 100)` | `#efefea` | 代码块底、hover |
| 正文 ink | `oklch(19% 0.008 100)` | `#2c2f2c` | 正文、标题、加粗 |
| 次级文字 ink-2 | `oklch(38% 0.006 100)` | `#5c5f59` | 引用、说明 |
| 辅助 muted | `oklch(52% 0.005 100)` | `#858681` | 列表符号、计数器 |
| 强调 accent | `oklch(56% 0.14 164)` | `#10b981` | 翡翠绿：标题、链接 |
| 聚焦 focus | `oklch(66% 0.15 164)` | `#34d399` | focus ring |
| 分割线 rule | `oklch(82% 0.006 100)` | `#d1d3cd` | 边框、hr、表格线 |

typography 变量映射：

```
--tw-prose-body: ink
--tw-prose-headings: ink
--tw-prose-links: accent
--tw-prose-bold: ink
--tw-prose-counters: muted
--tw-prose-bullets: muted
--tw-prose-hr: rule
--tw-prose-quotes: ink-2
--tw-prose-quote-borders: rule
--tw-prose-code: ink
--tw-prose-pre-code: paper-2
--tw-prose-pre-bg: ink
--tw-prose-th-borders: rule
--tw-prose-td-borders: rule
```

---

## 4. 字体

通过 Google Fonts 预加载（`entrypoints/floating/index.html:9-11`）：

```
https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400..600;1,400..600
&family=IBM+Plex+Sans:wght@400;500;600
&family=JetBrains+Mono:wght@400;500&display=swap
```

| 角色 | 字体 | 字重 | 用途 |
|------|------|------|------|
| Display（标题） | EB Garamond | 400–600 | h1–h6 |
| Body（正文） | IBM Plex Sans | 400/500/600 | 段落、列表、表格 |
| Mono（代码） | JetBrains Mono | 400/500 | 行内 code、pre 块 |

离线 fallback：Display→`ui-serif, Georgia, serif`；Body→`ui-sans-serif, system-ui, sans-serif`；Mono→`ui-monospace, monospace`。

---

## 5. 字号 / 行高 / 间距 明细

数值取自 `assets/globals.css:85-199` 与 `tailwind.config.ts` 的 token 定义。

| 元素 | 字号 | 行高 | 字重 | 字体 | 颜色 | 上下边距 |
|------|------|------|------|------|------|----------|
| 容器 `.prose` | `0.875rem`(14px) | `1.75` | — | IBM Plex Sans | ink | `max-width:65ch` |
| h1 | `1.375rem`(22px) | — | 600 | EB Garamond *italic* | accent | top `2.5rem` / bottom `1rem` |
| h2 | `1.0625rem`(17px) | — | 600 | EB Garamond *italic* | accent | top `1.5rem` / bottom `0.75rem` |
| h3 | `0.9375rem`(15px) | — | 600 | EB Garamond normal | accent 70%+ink | top `1.5rem` / bottom `0.5rem` |
| h4–h6 | typography 默认 | — | 600 | EB Garamond normal | — | — |
| p | 继承 14px | — | — | — | ink | top/bottom `0.75rem` |
| ul / ol | 继承 | — | — | — | — | `padding-left:1.5rem` |
| li | 继承 | — | — | — | — | top/bottom `0.25rem` |
| table | `0.75rem`(12px) | — | — | tabular-nums | — | — |
| 行内 `code` | `0.85em` | — | — | JetBrains Mono | accent 80%+ink | `padding:0.15em 0.35em` |
| `pre` 代码块 | `0.75rem`(12px) | `1.5` | — | JetBrains Mono | accent 30%+ink-2 | `padding:0.75rem` |
| blockquote | 继承 | — | *italic* | — | ink-2 | — |

---

## 6. 代码块与行内代码样式

### 6.1 行内 `code`（`globals.css:166-174`）

```css
.prose :not(pre) > code {
  font-family: var(--font-mono);
  font-size: 0.85em;
  background-color: color-mix(in oklch, var(--color-accent) 5%, var(--color-paper-2));
  color: color-mix(in oklch, var(--color-accent) 80%, var(--color-ink));
  padding: 0.15em 0.35em;
  border-radius: 3px;
  border: 1px solid color-mix(in oklch, var(--color-accent) 15%, var(--color-rule));
}
```

### 6.2 `pre` 块（`globals.css:176-193`）

```css
.prose pre {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  line-height: 1.5;
  border-radius: var(--radius);            /* 0.25rem = 4px */
  background-color: color-mix(in oklch, var(--color-accent) 4%, var(--color-paper-2)) !important;
  color: color-mix(in oklch, var(--color-accent) 30%, var(--color-ink-2)) !important;
  border: 1px solid color-mix(in oklch, var(--color-accent) 20%, var(--color-rule)) !important;
  padding: var(--space-sm);                 /* 0.75rem */
  overflow-x: auto;
}
.prose pre code {
  background-color: transparent !important;
  color: inherit !important;
  padding: 0 !important;
  font-size: inherit !important;
}
```

设计特色：代码块背景是「accent 低饱和混入纸色」的柔和翡翠灰绿，而非纯灰底，是该风格辨识度之一。

---

## 7. 纯 Web 应用复用（独立 CSS，无需 Tailwind）

保留 `react-markdown + remark-gfm` 渲染，并在包裹层应用以下独立 CSS（等价还原 `.prose` 覆盖，已提供可直接使用的十六进制近似；现代浏览器也可把 accent/ink 等换回 `oklch()` + `color-mix()` 原值）。

```css
:root{
  --paper:#f7f7f4; --paper-2:#efefea; --ink:#2c2f2c; --ink-2:#5c5f59;
  --muted:#858681; --accent:#10b981; --rule:#d1d3cd;
  --font-body:"IBM Plex Sans", system-ui, sans-serif;
  --font-display:"EB Garamond", Georgia, serif;
  --font-mono:"JetBrains Mono", monospace;
}
.md{
  max-width:65ch;                 /* 行宽上限，可读性核心 */
  font-family:var(--font-body);
  font-size:14px;
  line-height:1.75;
  color:var(--ink);
}
.md h1,.md h2{ font-family:var(--font-display); font-style:italic; font-weight:600; color:var(--accent); }
.md h1{ font-size:22px; margin:2.5rem 0 1rem; }
.md h2{ font-size:17px; margin:1.5rem 0 .75rem; }
.md h3,.md h4,.md h5,.md h6{ font-family:var(--font-display); font-weight:600; }
.md h3{ font-size:15px; margin:1.5rem 0 .5rem; color:color-mix(in oklch,var(--accent) 70%,var(--ink)); }
.md p{ margin:.75rem 0; }
.md ul,.md ol{ padding-left:1.5rem; }
.md li{ margin:.25rem 0; }
.md table{ font-size:12px; font-variant-numeric:tabular-nums; }
.md :not(pre)>code{
  font-family:var(--font-mono); font-size:.85em;
  background:#eef3f0; color:#0d7a5f;
  padding:.15em .35em; border-radius:3px; border:1px solid #d4e6df;
}
.md pre{
  font-family:var(--font-mono); font-size:12px; line-height:1.5;
  border-radius:4px; background:#eef3f0; color:#3f6b5f;
  border:1px solid #d4e6df; padding:.75rem; overflow-x:auto;
}
.md pre code{ background:transparent; color:inherit; padding:0; }
.md blockquote{ font-style:italic; color:var(--ink-2); }
.md a{ color:var(--accent); }
```

配套渲染（`React` 示例）：

```tsx
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { preprocessMarkdown } from "./utils"

export function MarkdownView({ raw }: { raw: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {preprocessMarkdown(raw)}
      </ReactMarkdown>
    </div>
  )
}
```

---

## 8. 复用注意事项

1. **行宽是可读性核心**：`max-width:65ch` 不可省略，过宽会显著降低长文阅读舒适度。
2. **标题斜体衬线体**是该设计辨识度来源（h1/h2 用 EB Garamond italic + accent 绿）。中文标题用斜体衬线可能不够友好，可按需在 `.md h1,.md h2` 加 `:not(:lang(zh))` 或针对中文回退为 `font-style:normal`。
3. **清洗逻辑与样式解耦**：`preprocessMarkdown` 仅负责结构标准化，与视觉样式无关；只有当你的摘要同样来自该后端、且文本带有「一、」「1.」「核心逻辑图谱」等非标准格式时，才需要搬运它以保证标准 MD 渲染。
4. **字体依赖 CDN**：Google Fonts 需在线，离线自动 fallback 到系统字体（已在 font stack 中配置）。
5. **OKLCH / color-mix**：原实现使用 OKLCH 与 `color-mix()`（现代浏览器原生支持）；若需兼容旧浏览器，使用本文提供的十六进制近似即可。

---

*生成依据：本仓库 `components/MarkdownRenderer.tsx`、`assets/globals.css`、`lib/utils.ts`、`tailwind.config.ts`、`entrypoints/floating/index.html`。*
