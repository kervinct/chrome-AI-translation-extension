class TranslationService {
  constructor() {
    this.activeTasks = new Map();
    this.maxConcurrent = 5;
    this.progress = {
      total: 0,
      completed: 0,
      succeeded: 0,
      failed: 0,
      cached: 0,
    };
    this.shouldStop = false;
    this.currentType = "";
    this.taskQueue = [];
    this.runningTasks = new Set();
    this.currentParagraphMap = new Map();
    this.failedTasks = [];

    this._requestTimestamps = [];
    this._rpm = 10;
    this._rpmReady = false;
  }

  _reset() {
    this.activeTasks.clear();
    this.progress = {
      total: 0,
      completed: 0,
      succeeded: 0,
      failed: 0,
      cached: 0,
    };
    this.shouldStop = false;
    this.taskQueue = [];
    this.runningTasks.clear();
    this.currentParagraphMap = new Map();
    this.failedTasks = [];
    this._requestTimestamps = [];

    document
      .querySelectorAll('[data-is-translated="true"]')
      .forEach((element) => {
        element.removeAttribute("data-translated-nodes");
        element.removeAttribute("data-original-content");
        element.removeAttribute("data-original-html");
        element.removeAttribute("data-is-translated");
      });

    document
      .querySelectorAll(".ai-translation-container")
      .forEach((container) => {
        container.remove();
      });
  }

  async _getAPISettings() {
    const cfg =
      typeof DEFAULT_TRANSLATION_CONFIG !== "undefined"
        ? DEFAULT_TRANSLATION_CONFIG
        : {
            prompts: {},
            advancedSettings: {
              temperature: 0.3,
              maxTokens: null,
              disableThinking: true,
              customParams: "",
              rpm: 10,
              maxConcurrent: 5,
            },
          };

    return new Promise((resolve) => {
      chrome.storage.sync.get(
        {
          apiEndpoint: "",
          apiKey: "",
          model: "",
          prompts: cfg.prompts,
          advancedSettings: cfg.advancedSettings,
        },
        (items) => {
          resolve(items);
        },
      );
    });
  }

  async _ensureRpmConfig() {
    if (this._rpmReady) return;
    const settings = await this._getAPISettings();
    const adv = settings.advancedSettings || {};
    this._rpm = adv.rpm || 10;
    this.maxConcurrent = adv.maxConcurrent || 5;
    this._rpmReady = true;
  }

  async _waitForRateLimit() {
    const now = Date.now();
    const windowMs = 60000;
    this._requestTimestamps = this._requestTimestamps.filter(
      (ts) => now - ts < windowMs,
    );

    if (this._requestTimestamps.length >= this._rpm) {
      const oldestInWindow = this._requestTimestamps[0];
      const waitMs = windowMs - (now - oldestInWindow) + 100;
      if (waitMs > 0) {
        console.log(`速率限制: 等待 ${Math.ceil(waitMs / 1000)}s...`);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }

    this._requestTimestamps.push(Date.now());
  }

  _filterAndDeduplicateParagraphs(paragraphs) {
    const seen = new Set();
    const uniqueParagraphs = [];

    paragraphs.forEach((paragraph) => {
      const key = this._generateParagraphKey(paragraph);
      if (!seen.has(key)) {
        seen.add(key);
        uniqueParagraphs.push(paragraph);
      }
    });

    return uniqueParagraphs;
  }

  _generateParagraphKey(paragraph) {
    if (!paragraph || !paragraph.originalText) {
      return "";
    }

    return `block:${paragraph.originalText}`;
  }

  async _startTranslationTask(task) {
    if (this.shouldStop) return;

    this.runningTasks.add(task.id);

    let success = false;
    try {
      const url = window.location.href;
      const cachedTranslation = await CacheManager.getCache(
        url,
        task.paragraph.originalText,
        task.targetLang,
        this.currentType,
      );

      if (cachedTranslation) {
        task.paragraph.translatedText = cachedTranslation.translation;
        this._applyTranslation(task.paragraph);
        this.progress.cached++;
        success = true;
        this.runningTasks.delete(task.id);
        this._updateProgress(success);
        this._startNextTask();
        return;
      }

      await this._waitForRateLimit();

      if (this.shouldStop) {
        this.runningTasks.delete(task.id);
        return;
      }

      const controller = new AbortController();
      const signal = controller.signal;
      this.activeTasks.set(task.id, controller);

      const response = await this._callTranslationAPI(
        task.paragraph.originalText,
        task.targetLang,
        "page",
        signal,
      );

      const translatedText = await this._handleStreamingResponse(
        response,
        (partialText) => {
          if (!this.shouldStop) {
            task.paragraph.translatedText = partialText;
            this._applyTranslation(task.paragraph);
          }
        },
      );

      if (!this.shouldStop && translatedText.trim()) {
        await CacheManager.setCache(
          url,
          task.paragraph.originalText,
          translatedText.trim(),
          task.targetLang,
          this.currentType,
        );
        success = true;
      }
    } catch (error) {
      if (error.name === "AbortError") {
        console.log("翻译请求被取消");
      } else {
        console.error("流式翻译错误:", error.message);
        this.failedTasks.push({
          id: task.id,
          paragraph: task.paragraph,
          targetLang: task.targetLang,
          error: error.message,
        });
      }
    } finally {
      this.activeTasks.delete(task.id);
      this.runningTasks.delete(task.id);
      this._updateProgress(success);
      this._startNextTask();
    }
  }

  _startNextTask() {
    if (this.shouldStop) return;

    if (
      this.taskQueue.length > 0 &&
      this.runningTasks.size < this.maxConcurrent
    ) {
      const nextTask = this.taskQueue.shift();
      if (nextTask) {
        this._startTranslationTask(nextTask);
      }
    }
  }

  _applyTranslation(paragraph) {
    if (this.currentType === "compare") {
      domProcessor.applyCompareTranslation(paragraph);
    } else if (this.currentType === "replace") {
      domProcessor.applyReplaceTranslation(paragraph);
    }
  }

  _updateProgress(success) {
    this.progress.completed++;
    if (success) this.progress.succeeded++;

    const failedCount = this.progress.completed - this.progress.succeeded;
    const percent = Math.min(
      Math.floor((this.progress.completed / this.progress.total) * 100),
      100,
    );

    const statusText =
      failedCount > 0
        ? `${this.progress.completed}/${this.progress.total} (${percent}%) 成功:${this.progress.succeeded} 失败:${failedCount}`
        : `${this.progress.completed}/${this.progress.total} (${percent}%)`;

    console.log(`翻译进度: ${statusText} [缓存:${this.progress.cached}]`);

    chrome.runtime.sendMessage({
      action: "updateProgressBar",
      progress: percent,
      succeeded: this.progress.succeeded,
      failed: failedCount,
      total: this.progress.total,
    });

    if (this.progress.completed >= this.progress.total || this.shouldStop) {
      const finalFailed = this.progress.completed - this.progress.succeeded;
      chrome.runtime.sendMessage({
        action: "translationComplete",
        succeeded: this.progress.succeeded,
        failed: finalFailed,
        total: this.progress.total,
        hasFailed: finalFailed > 0,
      });
    }
  }

  async _callTranslationAPI(
    text,
    targetLang,
    type = "selection",
    signal = null,
  ) {
    const settings = await this._getAPISettings();
    if (!settings.apiEndpoint || !settings.apiKey || !settings.model) {
      throw new Error("请先在设置页面配置API信息");
    }

    const prompt = settings.prompts?.[type] || settings.prompts?.selection;
    if (!prompt) {
      throw new Error("未配置翻译提示词");
    }

    const body = {
      model: settings.model,
      messages: [
        { role: "system", content: prompt.replace("{LANG}", targetLang) },
        { role: "user", content: text },
      ],
      temperature: settings.advancedSettings?.temperature ?? 0.3,
      stream: true,
    };

    const adv = settings.advancedSettings || {};
    if (adv.maxTokens) body.max_tokens = adv.maxTokens;
    if (adv.disableThinking !== false) body.enable_thinking = false;
    if (adv.customParams) {
      try {
        Object.assign(body, JSON.parse(adv.customParams));
      } catch (_) {}
    }

    const requestOptions = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify(body),
    };

    if (signal) requestOptions.signal = signal;

    function bgStreamFetch(url, options) {
      // 1. 过滤掉无法序列化的 signal
      const sanitizedOptions = { ...options };
      if (sanitizedOptions.signal) delete sanitizedOptions.signal;

      // 2. 创建一个标准的 Web ReadableStream
      const stream = new ReadableStream({
        start(controller) {
          // 在流启动时，建立插件长连接
          const port = chrome.runtime.connect({ name: "llm-stream" });

          port.postMessage({ url, options: sanitizedOptions });

          // 监听后台发回的 chunk，并塞入 Stream 的队列中
          port.onMessage.addListener((msg) => {
            if (msg.status === "chunk") {
              // 必须把字符串编码为 Uint8Array 字节流，因为原生 fetch 的 stream 是字节流
              const encoder = new TextEncoder();
              controller.enqueue(encoder.encode(msg.data));
            } else if (msg.status === "end") {
              controller.close(); // 正常结束流
              port.disconnect();
            } else if (msg.status === "error") {
              controller.error(new Error(msg.error));
              port.disconnect();
            }
          });

          // 如果外部取消了流读取（例如调用了 reader.cancel()），同步断开端口
          port.onDisconnect.addListener(() => {
            try {
              controller.close();
            } catch (e) {}
          });
        },
      });

      // 3. 完美伪造一个原生 fetch 的 Response 对象
      return {
        ok: true,
        status: 200,
        body: stream, // 这里就是原生的 ReadableStream！
        // 如果原代码里用了 response.text() 或 json()，也可以顺便伪造：
        json: async () => {
          const reader = stream.getReader();
          let result = "";
          const decoder = new TextDecoder();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            result += decoder.decode(value);
          }
          return JSON.parse(result);
        },
      };
    }

    const response = await bgStreamFetch(settings.apiEndpoint, requestOptions);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return response;
  }

  async _handleStreamingResponse(response, onPartialContent = null) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let translatedText = "";
    let isDone = false;

    try {
      while (!isDone) {
        if (this.shouldStop) {
          try {
            await reader.cancel();
          } catch (_) {}
          break;
        }

        let readResult;
        try {
          readResult = await reader.read();
        } catch (error) {
          if (error.name === "AbortError") break;
          throw error;
        }

        const { done, value } = readResult;
        if (done) {
          isDone = true;
          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (!line.trim() || line.includes("[DONE]")) continue;
          if (line.startsWith("data: ")) {
            try {
              const jsonStr = line.slice(6).trim();
              if (!jsonStr || jsonStr === "[DONE]") continue;
              const json = JSON.parse(jsonStr);
              if (json.choices?.[0]?.delta?.content) {
                translatedText += json.choices[0].delta.content;
                if (typeof onPartialContent === "function") {
                  onPartialContent(translatedText);
                }
              }
            } catch (e) {
              console.log("解析流式响应出错:", e);
            }
          }
        }
      }
    } catch (error) {
      if (error.name !== "AbortError") {
        console.log("处理流式响应出错:", error);
      }
    } finally {
      try {
        reader.cancel().catch(() => {});
      } catch (_) {}
    }

    return translatedText;
  }

  stopAllTranslations() {
    this.shouldStop = true;
    for (const controller of this.activeTasks.values()) {
      if (controller && controller.abort) {
        try {
          controller.abort();
        } catch (_) {}
      }
    }
    this.activeTasks.clear();
    this.taskQueue = [];
    this.runningTasks.clear();
  }

  async streamingPageTranslate(paragraphs, type, targetLang) {
    domProcessor.restoreOriginalWebPage();
    this._reset();
    this._rpmReady = false;
    this.currentType = type;

    await this._ensureRpmConfig();

    const uniqueParagraphs = this._filterAndDeduplicateParagraphs(paragraphs);

    this.progress = {
      total: uniqueParagraphs.length,
      completed: 0,
      succeeded: 0,
      failed: 0,
      cached: 0,
    };

    const url = window.location.href;
    const cacheChecks = await Promise.all(
      uniqueParagraphs.map(async (paragraph) => {
        const cache = await CacheManager.getCache(
          url,
          paragraph.originalText,
          targetLang,
          this.currentType,
        );
        return { paragraph, cache };
      }),
    );

    const { cachedParagraphs, uncachedParagraphs } = cacheChecks.reduce(
      (acc, { paragraph, cache }) => {
        if (cache) {
          acc.cachedParagraphs.push({
            ...paragraph,
            translatedText: cache.translation,
          });
        } else {
          acc.uncachedParagraphs.push(paragraph);
        }
        return acc;
      },
      { cachedParagraphs: [], uncachedParagraphs: [] },
    );

    this.progress.cached = cachedParagraphs.length;
    this.progress.completed = cachedParagraphs.length;
    this.progress.succeeded = cachedParagraphs.length;

    for (const paragraph of cachedParagraphs) {
      this._applyTranslation(paragraph);
    }

    if (this.progress.cached > 0) {
      const percent = Math.floor(
        (this.progress.completed / this.progress.total) * 100,
      );
      chrome.runtime.sendMessage({
        action: "updateProgressBar",
        progress: percent,
        succeeded: this.progress.succeeded,
        failed: 0,
        total: this.progress.total,
      });
    }

    this.taskQueue = uncachedParagraphs.map((paragraph, index) => ({
      id: `task_${index}`,
      paragraph,
      targetLang,
    }));

    if (this.taskQueue.length === 0) {
      chrome.runtime.sendMessage({
        action: "updateProgressBar",
        progress: 100,
        succeeded: this.progress.succeeded,
        failed: 0,
        total: this.progress.total,
      });
      chrome.runtime.sendMessage({
        action: "translationComplete",
        succeeded: this.progress.succeeded,
        failed: 0,
        total: this.progress.total,
        hasFailed: false,
      });
      return true;
    }

    const initialTasks = this.taskQueue.splice(0, this.maxConcurrent);
    await Promise.all(
      initialTasks.map((task) => this._startTranslationTask(task)),
    );

    while (this.taskQueue.length > 0 || this.runningTasks.size > 0) {
      if (this.shouldStop) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (!this.shouldStop) {
      const finalFailed = this.progress.completed - this.progress.succeeded;
      const finalPercent =
        this.progress.total > 0
          ? Math.floor((this.progress.completed / this.progress.total) * 100)
          : 100;
      chrome.runtime.sendMessage({
        action: "updateProgressBar",
        progress: finalPercent,
        succeeded: this.progress.succeeded,
        failed: finalFailed,
        total: this.progress.total,
      });
      chrome.runtime.sendMessage({
        action: "translationComplete",
        succeeded: this.progress.succeeded,
        failed: finalFailed,
        total: this.progress.total,
        hasFailed: finalFailed > 0,
      });
    } else {
      console.log("翻译任务被用户中止");
    }

    return this.progress.succeeded === this.progress.total;
  }

  getFailedTasks() {
    return this.failedTasks;
  }

  async streamingSingleTranslate(
    text,
    targetLang,
    type = "selection",
    signal = null,
  ) {
    return await this._callTranslationAPI(text, targetLang, type, signal);
  }

  async handleSingleTranslationResponse(response, onUpdate, onComplete) {
    const translatedText = await this._handleStreamingResponse(
      response,
      onUpdate,
    );
    if (typeof onComplete === "function") onComplete(translatedText);
    return translatedText;
  }
}

const translationService = new TranslationService();
