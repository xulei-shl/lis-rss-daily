import { processPdfViaYuanbao, processUrlViaYuanbao } from "./yuanbao"

export interface HiagentResult {
  success: boolean
  md_content?: string
  title?: string
  id?: string
  error?: string
}

export interface PdfFallbackOptions {
  prompt?: string
  onFallback?: () => void
}

// Runs INSIDE the HiAgent page (injected via chrome.scripting.executeScript)
// IMPORTANT: ALL code must be self-contained — no external function references.
// Bundler minifies external names, which breaks serialize-and-inject.
export const HIAGENT_AUTOMATION = async (params: {
  mode?: "pdf" | "url"
  storageKey?: string
  url?: string
}): Promise<{ success: boolean; content?: string; error?: string }> => {
  try {
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

    const ERROR_KEYWORDS = ["无法访问", "无法生成", "抱歉，", "出错了", "请求异常，请稍后重试", "请求异常"]

    const RESULT_SELECTORS = [
      ".message-content",
      ".markdown-body",
      '[class*="message"][class*="content"]',
      ".react-markdown",
      ".prose",
      '[class*="chat-message"]',
      '[class*="ai-response"]',
      '[class*="assistant-message"]',
      '[class*="msg-item"]',
      ".message-text",
      ".msg-content",
    ]

    const mode = params.mode || "pdf"
    const COPY_ICON_SEL = "svg.hiagent-icon-copy-areality, svg.copy-icon"

    // --- Wait for page and click "新增会话" (shared) ---
    await delay(2000)

    let newSessionBtn: HTMLElement | null = null
    for (let i = 0; i < 15; i++) {
      const allButtons = document.querySelectorAll<HTMLElement>("button")
      for (const btn of allButtons) {
        if ((btn.innerText || btn.textContent || "").includes("新增会话")) {
          newSessionBtn = btn
          break
        }
      }
      if (newSessionBtn) break
      await delay(1000)
    }

    if (newSessionBtn) {
      newSessionBtn.click()
      await delay(5000)
    }

    // --- Mode-specific input ---
    if (mode === "url" && params.url) {
      // URL mode: find textarea and type URL
      let textarea: HTMLTextAreaElement | null = null
      for (let i = 0; i < 15; i++) {
        textarea = document.querySelector<HTMLTextAreaElement>(
          'textarea.arco-textarea.textarea, div.h-flex textarea, textarea[class*="textarea"]',
        )
        if (textarea) break
        await delay(1000)
      }
      if (!textarea) throw new Error("未找到文本输入框")

      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, "value",
      )?.set
      nativeSetter?.call(textarea, params.url)
      textarea.dispatchEvent(new Event("input", { bubbles: true }))
      await delay(500)
    } else {
      // PDF mode: read storage and upload file
      const stored = await chrome.storage.local.get(params.storageKey)
      const entry = stored[params.storageKey!]
      if (!entry) throw new Error("PDF 数据未找到")

      const uint8 = new Uint8Array(entry.data)
      const file = new File([uint8], entry.filename, { type: "application/pdf" })

      let uploadInput: HTMLInputElement | null = null
      for (let i = 0; i < 15; i++) {
        uploadInput = document.querySelector('input[type="file"]') as HTMLInputElement
        if (uploadInput) break
        await delay(1000)
      }
      if (!uploadInput) throw new Error("未找到文件上传控件（页面可能未完全加载）")

      const dt = new DataTransfer()
      dt.items.add(file)
      uploadInput.files = dt.files
      uploadInput.dispatchEvent(new Event("change", { bubbles: true }))
      await delay(2000)
    }

    // --- Find and click send button ---
    const isEnabled = (el: Element) => {
      const btn = el as HTMLButtonElement
      const classList = Array.from(btn.classList)
      return !btn.disabled &&
        !classList.some((c) => c.startsWith("disabled") || c === "disabled") &&
        btn.getAttribute("aria-disabled") !== "true"
    }

    function findSendButton(): HTMLElement | null {
      const ps = document.querySelector<HTMLElement>('.send-button-nkISIzC:not(.disabled-aewpicp)')
      if (ps && isEnabled(ps)) return ps

      const cc = document.querySelectorAll<HTMLElement>(
        '[class*="send-button"]:not([class*="disabled"]), [class*="send_btn"], [class*="btn-send"], [class*="submit-btn"]',
      )
      for (const btn of cc) { if (isEnabled(btn)) return btn }

      const ab = document.querySelectorAll<HTMLElement>(
        'button, [role="button"], .send-btn, [class*="send"], [class*="Send"]',
      )
      for (const btn of ab) {
        const text = (btn.innerText || "").trim().toLowerCase()
        if (isEnabled(btn) && (text === "发送" || text === "send" || text === "上传" || text === "submit")) return btn
      }
      for (const btn of ab) {
        const label = (btn.getAttribute("aria-label") || "").toLowerCase()
        if (isEnabled(btn) && (label.includes("发送") || label.includes("send") || label.includes("submit"))) return btn
      }

      const containers = document.querySelectorAll<HTMLElement>(
        '[class*="input-area"], [class*="chat-input"], [class*="footer"], [class*="toolbar"], [class*="bottom"]',
      )
      for (const c of containers) {
        const btns = c.querySelectorAll<HTMLElement>("button:not([disabled])")
        for (const btn of btns) { if (isEnabled(btn)) return btn }
      }
      return null
    }

    let sendBtn: HTMLElement | null = null
    for (let i = 0; i < 10; i++) {
      sendBtn = findSendButton()
      if (sendBtn) break
      await delay(1000)
    }
    if (!sendBtn) throw new Error("未找到发送按钮（请检查 HiAgent URL 是否正确）")
    sendBtn.click()

    // --- 6. Wait for visible copy icon (aligned with Python) ---
    const baselineCopyCount = document.querySelectorAll<HTMLElement>(COPY_ICON_SEL).length

    const isVisible = (el: HTMLElement) => {
      if (!el) return false
      const style = window.getComputedStyle(el)
      return style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0"
    }

    let copyIcon: HTMLElement | null = null
    let ready = false
    for (let i = 0; i < 180; i++) {
      const icons = document.querySelectorAll<HTMLElement>(COPY_ICON_SEL)
      if (icons.length > baselineCopyCount) {
        const ni = icons[icons.length - 1]
        if (isVisible(ni)) { copyIcon = ni; ready = true; break }
      }
      await delay(1000)
    }
    if (!ready) throw new Error("等待结果超时（AI 生成超过 3 分钟或页面结构不兼容）")

    // --- 7. Extract result (clipboard if focused, else DOM) ---
    let result = ""
    const baselineLen = (document.body?.innerText || "").length

    // navigator.clipboard.readText() requires document focus; skip if backgrounded
    if (document.hasFocus()) {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (!copyIcon) break
        copyIcon.scrollIntoView({ behavior: "instant", block: "center" })
        await delay(200)
        let clipBefore = ""
        try { clipBefore = await navigator.clipboard.readText() } catch {}
        copyIcon.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
        await delay(500)
        try {
          const clipAfter = await navigator.clipboard.readText()
          if (clipAfter && clipAfter !== clipBefore && clipAfter.length > 100) {
            result = clipAfter; break
          }
        } catch {}
      }
    }

    if (!result || result.length < 100) {
      for (const sel of RESULT_SELECTORS) {
        const nodes = document.querySelectorAll<HTMLElement>(sel)
        if (nodes.length > 0) {
          const text = (nodes[nodes.length - 1].innerText || "").trim()
          if (text.length >= 100) { result = text; break }
        }
      }
    }

    if ((!result || result.length < 100) && copyIcon) {
      let parent = copyIcon.parentElement
      for (let depth = 0; parent && depth < 10; depth++) {
        const dt = (parent.innerText || "").trim()
        if (dt.length >= 100) {
          const ae = parent.querySelector<HTMLElement>(".message-actions, [class*='actions']")
          const clean = ae ? dt.replace(ae.innerText || "", "").trim() : dt
          if (clean.length >= 100) { result = clean; break }
        }
        parent = parent.parentElement
      }
    }

    if (!result || result.length < 100) {
      const fullText = (document.body?.innerText || "").trim()
      const newText = fullText.slice(baselineLen).trim()
      if (newText.length >= 100) result = newText
      else if (fullText.length >= 100) result = fullText
    }

    if (ERROR_KEYWORDS.some((kw) => result.includes(kw))) {
      throw new Error("检测到错误内容，AI 无法正常处理")
    }
    if (!result || result.length < 50) {
      throw new Error("摘要内容过短或为空")
    }

    return { success: true, content: result }
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) }
  }
}

export async function processPdfViaHiagent(
  file: File,
  title: string,
  id?: string,
): Promise<{ md_content: string; title: string; id?: string }> {
  const arrayBuffer = await file.arrayBuffer()
  const bytes = Array.from(new Uint8Array(arrayBuffer))

  const storageKey = `pdf_upload_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  await chrome.storage.local.set({
    [storageKey]: { data: bytes, filename: file.name },
  })

  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: "process-pdf", storageKey, title, id, filename: file.name },
      (response: HiagentResult) => {
        chrome.storage.local.remove(storageKey).catch(() => {})
        if (response?.success && response.md_content) {
          resolve({
            md_content: response.md_content,
            title: response.title || title,
            id: response.id || id,
          })
        } else {
          reject(new Error(response?.error || "PDF 处理失败"))
        }
      },
    )
  })
}

export async function processUrlViaHiagent(
  url: string,
  id?: string,
): Promise<{ md_content: string; title: string; id?: string }> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: "process-url", url, id },
      (response: HiagentResult) => {
        if (response?.success && response.md_content) {
          resolve({
            md_content: response.md_content,
            title: response.title || url,
            id: response.id || id,
          })
        } else {
          reject(new Error(response?.error || "URL 处理失败"))
        }
      },
    )
  })
}

export async function processUrlWithFallback(
  url: string,
  id?: string,
  options?: PdfFallbackOptions,
): Promise<{ md_content: string; title: string; id?: string }> {
  const hiagentError = await processUrlViaHiagent(url, id).catch((err: Error) => err)

  if (!(hiagentError instanceof Error)) {
    return hiagentError
  }

  options?.onFallback?.()

  const yuanbaoError = await processUrlViaYuanbao(url, id, options?.prompt).catch((err: Error) => err)

  if (!(yuanbaoError instanceof Error)) {
    return yuanbaoError
  }

  throw new Error(`HiAgent: ${hiagentError.message}；元宝：${yuanbaoError.message}`)
}

export async function processPdfWithFallback(
  file: File,
  title: string,
  id?: string,
  options?: PdfFallbackOptions,
): Promise<{ md_content: string; title: string; id?: string }> {
  const hiagentError = await processPdfViaHiagent(file, title, id).catch((err: Error) => err)

  if (!(hiagentError instanceof Error)) {
    return hiagentError
  }

  options?.onFallback?.()

  const yuanbaoError = await processPdfViaYuanbao(file, title, id, options?.prompt).catch((err: Error) => err)

  if (!(yuanbaoError instanceof Error)) {
    return yuanbaoError
  }

  throw new Error(`HiAgent: ${hiagentError.message}；元宝：${yuanbaoError.message}`)
}
