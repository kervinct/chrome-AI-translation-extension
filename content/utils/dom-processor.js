class DOMProcessor {
  constructor() {
    this._blockTags = new Set([
      "p", "div", "article", "section", "blockquote", "li", "td", "th",
      "dd", "dt", "figcaption", "summary", "details", "aside", "main",
      "header", "footer", "nav", "figure", "address",
    ]);
    this._inlineSkipTags = new Set([
      "code", "kbd", "samp", "var", "tt",
    ]);
    this._skipTags = new Set([
      "script", "style", "noscript", "svg", "path", "meta", "link",
      "br", "hr", "iframe", "canvas", "map", "area", "pre",
      "input", "select", "textarea",
      "img", "video", "audio", "picture", "source",
    ]);
  }

  _isBlockElement(element) {
    const tag = element.tagName.toLowerCase();
    if (this._blockTags.has(tag) || /^h[1-6]$/.test(tag)) return true;
    const style = window.getComputedStyle(element);
    return style.display === "block";
  }

  _collectTextFromBlock(blockElement) {
    let codeElements = [];
    let textParts = [];

    const escapeHtml = (text) =>
      text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    const walk = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const t = node.textContent;
        if (t.trim()) {
          textParts.push(escapeHtml(t));
        }
        return;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) return;

      const tag = node.tagName.toLowerCase();

      if (this._inlineSkipTags.has(tag)) {
        codeElements.push(node);
        textParts.push(`<${tag}>${escapeHtml(node.textContent)}</${tag}>`);
        return;
      }

      if (this._skipTags.has(tag)) return;

      if (
        node.classList.contains("ai-translation-container") ||
        node.classList.contains("ai-translation-inline") ||
        node.classList.contains("ai-translator-popup") ||
        node.getAttribute("contenteditable") === "true"
      ) return;

      if (this._isBlockElement(node) && node !== blockElement) {
        return;
      }

      for (const child of node.childNodes) {
        walk(child);
      }
    };

    for (const child of blockElement.childNodes) {
      walk(child);
    }

    let text = textParts.join("").replace(/\s+/g, " ").trim();
    return { text, codeElements };
  }

  _isElementVisible(element) {
    if (!element) return false;
    const style = window.getComputedStyle(element);
    return !(
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.opacity === "0" ||
      style.height === "0px" ||
      style.width === "0px" ||
      element.hasAttribute("hidden")
    );
  }

  _hasChildBlocks(element) {
    for (const child of element.childNodes) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const tag = child.tagName.toLowerCase();
        if (this._skipTags.has(tag)) continue;
        if (this._isBlockElement(child)) return true;
      }
    }
    return false;
  }

  extractVisibleTextNodes() {
    const paragraphs = [];

    const findBlocks = (root) => {
      if (root.nodeType !== Node.ELEMENT_NODE) return;
      if (!this._isElementVisible(root)) return;

      const tag = root.tagName.toLowerCase();
      if (this._skipTags.has(tag)) return;
      if (
        root.classList.contains("ai-translation-container") ||
        root.classList.contains("ai-translation-inline") ||
        root.classList.contains("ai-translator-popup") ||
        root.getAttribute("contenteditable") === "true"
      ) return;

      if (this._isBlockElement(root) && tag !== "body") {
        if (!this._hasChildBlocks(root)) {
          const { text, codeElements } = this._collectTextFromBlock(root);
          if (text && text.length > 1) {
            paragraphs.push({
              blockElement: root,
              originalText: text,
              translatedText: "",
              codeElements,
            });
          }
          return;
        }
      }

      for (const child of root.childNodes) {
        findBlocks(child);
      }
    };

    findBlocks(document.body);

    return paragraphs;
  }

  prepareParagraphsForTranslation(paragraphs) {
    return paragraphs.filter((p) => p.originalText.length > 0);
  }

  _buildTranslatedDOM(translatedText, codeElements) {
    const fragment = document.createDocumentFragment();
    if (!codeElements || codeElements.length === 0) {
      fragment.appendChild(document.createTextNode(translatedText));
      return fragment;
    }

    const usedIndices = new Set();

    const decodeHtml = (text) => {
      const temp = document.createElement("textarea");
      temp.innerHTML = text;
      return temp.value;
    };

    const skipTagsStr = Array.from(this._inlineSkipTags).join("|");
    const codeTagPattern = new RegExp(
      `<(${skipTagsStr})>([\\s\\S]*?)<\\/\\1>`,
      "g"
    );

    let lastIndex = 0;
    let match;

    while ((match = codeTagPattern.exec(translatedText)) !== null) {
      const beforeText = translatedText.substring(lastIndex, match.index);
      if (beforeText) {
        fragment.appendChild(document.createTextNode(decodeHtml(beforeText)));
      }

      const content = decodeHtml(match[2]);
      const matchedIdx = codeElements.findIndex(
        (el, i) => el.textContent === content && !usedIndices.has(i)
      );

      if (matchedIdx !== -1) {
        usedIndices.add(matchedIdx);
        fragment.appendChild(codeElements[matchedIdx].cloneNode(true));
      } else {
        const codeEl = document.createElement(match[1]);
        codeEl.textContent = content;
        fragment.appendChild(codeEl);
      }

      lastIndex = match.index + match[0].length;
    }

    const tailText = translatedText.substring(lastIndex);
    if (tailText) {
      fragment.appendChild(document.createTextNode(decodeHtml(tailText)));
    }

    return fragment;
  }

  applyCompareTranslation(paragraph) {
    if (!paragraph || !paragraph.translatedText || !paragraph.translatedText.trim()) return;

    const blockElement = paragraph.blockElement;
    if (!blockElement) return;

    let container = blockElement.nextElementSibling;
    if (!container || !container.classList.contains("ai-translation-container")) {
      container = document.createElement("div");
      container.className = "ai-translation-container";
      blockElement.parentElement.insertBefore(container, blockElement.nextSibling);
    }

    container.innerHTML = "";

    const translatedDOM = this._buildTranslatedDOM(
      paragraph.translatedText,
      paragraph.codeElements
    );

    const wrapper = document.createElement(blockElement.tagName.toLowerCase());
    wrapper.className = "translation-content";

    const style = window.getComputedStyle(blockElement);
    container.style.fontFamily = style.fontFamily;
    container.style.fontSize = style.fontSize;
    container.style.lineHeight = style.lineHeight;
    container.style.color = style.color;
    container.style.borderLeft = "2px solid #4a8af4";
    container.style.paddingLeft = "10px";
    container.style.marginTop = "10px";
    container.style.marginBottom = "10px";

    wrapper.appendChild(translatedDOM);
    container.appendChild(wrapper);
  }

  applyReplaceTranslation(paragraph) {
    if (!paragraph || !paragraph.translatedText || !paragraph.translatedText.trim()) return;

    const blockElement = paragraph.blockElement;
    if (!blockElement) return;

    if (!blockElement.hasAttribute("data-original-html")) {
      blockElement.setAttribute("data-original-html", blockElement.outerHTML);
      blockElement.setAttribute("data-original-content", blockElement.innerHTML);
      blockElement.setAttribute("data-is-translated", "true");
    }

    const translatedDOM = this._buildTranslatedDOM(
      paragraph.translatedText,
      paragraph.codeElements
    );

    blockElement.innerHTML = "";
    blockElement.appendChild(translatedDOM);
  }

  // 恢复原始内容
  restoreOriginalWebPage() {
    try {
      // 恢复所有被翻译过的元素
      document
        .querySelectorAll('[data-is-translated="true"]')
        .forEach((element) => {
          try {
            if (element.hasAttribute("data-translated-nodes")) {
              // 恢复文本节点
              const translatedNodes = JSON.parse(
                element.getAttribute("data-translated-nodes")
              );
              translatedNodes.forEach((nodeInfo) => {
                if (nodeInfo.isText && nodeInfo.index >= 0) {
                  const textNode = element.childNodes[nodeInfo.index];
                  if (textNode && textNode.nodeType === Node.TEXT_NODE) {
                    textNode.textContent = nodeInfo.content;
                  }
                }
              });
              element.removeAttribute("data-translated-nodes");
            } else if (element.hasAttribute("data-original-html")) {
              // 恢复元素节点
              const originalHtml = element.getAttribute("data-original-html");
              if (originalHtml) {
                const temp = document.createElement("div");
                temp.innerHTML = originalHtml;
                const originalElement = temp.firstElementChild;
                if (originalElement) {
                  // 保留原始元素的事件监听器和引用
                  const parent = element.parentNode;
                  if (parent) {
                    parent.replaceChild(originalElement, element);
                  }
                } else {
                  // 如果无法完全替换，至少恢复内容
                  if (element.hasAttribute("data-original-content")) {
                    element.innerHTML = element.getAttribute(
                      "data-original-content"
                    );
                  }
                }
              }
            }

            // 移除所有标记属性
            element.removeAttribute("data-original-content");
            element.removeAttribute("data-original-html");
            element.removeAttribute("data-is-translated");
          } catch (elementError) {
            console.warn("恢复单个元素时出错:", elementError);
            // 继续处理其他元素
          }
        });

      // 移除所有翻译容器
      document
        .querySelectorAll(".ai-translation-container")
        .forEach((container) => {
          try {
            container.remove();
          } catch (containerError) {
            console.warn("移除翻译容器时出错:", containerError);
          }
        });
    } catch (error) {
      console.error("恢复原始内容时出错:", error);
    }
  }
}

// 导出翻译服务实例
const domProcessor = new DOMProcessor();
