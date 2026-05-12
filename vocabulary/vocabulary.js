// *********************************/
// 单词本JavaScript
// *********************************/

document.addEventListener("DOMContentLoaded", () => {
  const vocabularyList = document.getElementById("vocabularyList");
  const emptyMessage = document.getElementById("emptyMessage");
  const wordCount = document.getElementById("wordCount");
  const searchInput = document.getElementById("searchInput");
  const clearAllBtn = document.getElementById("clearAll");

  let vocabularyData = [];

  const loadVocabulary = async () => {
    try {
      const result = await chrome.storage.local.get({ vocabulary: [] });
      if (Array.isArray(result.vocabulary)) {
        vocabularyData = result.vocabulary;
        renderVocabularyList(vocabularyData);
        updateWordCount();
      }
    } catch (error) {
      console.error("加载单词本失败:", error);
      showError("加载单词本失败，请刷新页面重试");
    }
  };

  // 兼容旧格式 { phonetic, definition, part_of_speech } 转为新格式 { phonetic, meanings }
  const normalizeDetails = (details) => {
    if (details.meanings && Array.isArray(details.meanings)) {
      return details;
    }
    const meanings = [];
    if (details.part_of_speech || details.definition) {
      meanings.push({
        part_of_speech: details.part_of_speech || "",
        definitions: [
          {
            definition: details.definition || "",
            example: "",
          },
        ],
      });
    }
    return {
      phonetic: details.phonetic || "",
      meanings,
    };
  };

  const renderVocabularyList = (words) => {
    vocabularyList.innerHTML = "";

    if (words.length === 0) {
      emptyMessage.style.display = "block";
      return;
    } else {
      emptyMessage.style.display = "none";
    }

    words.forEach((word) => {
      const wordCard = document.createElement("div");
      wordCard.className = "word-card";
      wordCard.dataset.word = word;

      wordCard.innerHTML = `
        <div class="word-header">
          <div class="word-title">
            <span class="word-text">${word}</span>
            <span class="word-phonetic" id="phonetic-${word}"></span>
          </div>
          <div class="word-actions">
            <button class="delete-word" data-word="${word}" title="删除单词">
              ✕
            </button>
          </div>
        </div>
        <div class="word-info" id="info-${word}">
          <div class="word-loading">加载单词信息中...</div>
        </div>
      `;

      vocabularyList.appendChild(wordCard);
      loadWordDetails(word);
    });

    document.querySelectorAll(".delete-word").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const word = e.currentTarget.dataset.word;
        removeWordFromVocabulary(word);
      });
    });
  };

  const loadWordDetails = async (word) => {
    try {
      const wordKey = `word_details_${word}`;
      const result = await chrome.storage.local.get({ [wordKey]: null });

      const infoContainer = document.getElementById(`info-${word}`);
      const phoneticElement = document.getElementById(`phonetic-${word}`);

      if (result[wordKey]) {
        const details = normalizeDetails(result[wordKey]);
        renderWordDetails(infoContainer, phoneticElement, details);
      } else {
        infoContainer.innerHTML = `
          <div class="word-definition">暂无详细释义</div>
        `;
      }
    } catch (error) {
      console.error(`加载单词"${word}"详细信息失败:`, error);
      const infoContainer = document.getElementById(`info-${word}`);
      infoContainer.innerHTML = `<div class="word-error">加载单词信息失败</div>`;
    }
  };

  const renderWordDetails = (container, phoneticEl, details) => {
    if (details.phonetic) {
      phoneticEl.textContent = details.phonetic;
    }

    if (!details.meanings || details.meanings.length === 0) {
      container.innerHTML = '<div class="word-definition">暂无详细释义</div>';
      return;
    }

    let html = '<div class="word-meanings">';

    details.meanings.forEach((meaning) => {
      html += '<div class="meaning-block">';

      if (meaning.part_of_speech) {
        html += `<span class="word-pos">${meaning.part_of_speech}</span>`;
      }

      if (meaning.definitions && meaning.definitions.length > 0) {
        html += '<div class="definitions-list">';
        meaning.definitions.forEach((def) => {
          html += '<div class="definition-item">';
          html += `<div class="word-definition">${def.definition || ""}</div>`;
          if (def.example) {
            html += `<div class="word-example">${def.example}</div>`;
          }
          html += "</div>";
        });
        html += "</div>";
      }

      html += "</div>";
    });

    html += "</div>";
    container.innerHTML = html;
  };

  const removeWordFromVocabulary = async (word) => {
    try {
      vocabularyData = vocabularyData.filter((w) => w !== word);

      await chrome.storage.local.set({ vocabulary: vocabularyData });

      const wordKey = `word_details_${word}`;
      await chrome.storage.local.remove(wordKey);

      renderVocabularyList(vocabularyData);
      updateWordCount();

      showToast(`单词 "${word}" 已从单词本中移除`);
    } catch (error) {
      console.error(`删除单词"${word}"失败:`, error);
      showError("删除单词失败，请重试");
    }
  };

  const updateWordCount = () => {
    wordCount.textContent = vocabularyData.length;
  };

  const clearVocabulary = async () => {
    if (vocabularyData.length === 0) {
      showToast("单词本已经是空的");
      return;
    }

    if (confirm("确定要清空单词本吗？此操作不可撤销。")) {
      try {
        const wordDetailsKeys = vocabularyData.map(
          (word) => `word_details_${word}`
        );

        vocabularyData = [];

        await chrome.storage.local.set({ vocabulary: [] });

        if (wordDetailsKeys.length > 0) {
          await chrome.storage.local.remove(wordDetailsKeys);
        }

        renderVocabularyList(vocabularyData);
        updateWordCount();

        showToast("单词本已清空");
      } catch (error) {
        console.error("清空单词本失败:", error);
        showError("清空单词本失败，请重试");
      }
    }
  };

  const searchVocabulary = (query) => {
    if (!query) {
      renderVocabularyList(vocabularyData);
      return;
    }

    const lowerQuery = query.toLowerCase();
    const filtered = vocabularyData.filter((word) =>
      word.toLowerCase().includes(lowerQuery)
    );

    renderVocabularyList(filtered);
  };

  const showError = (message) => {
    const errorElement = document.createElement("div");
    errorElement.className = "error-message";
    errorElement.textContent = message;

    vocabularyList.innerHTML = "";
    vocabularyList.appendChild(errorElement);
  };

  const showToast = (message) => {
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = message;

    document.body.appendChild(toast);

    setTimeout(() => {
      toast.classList.add("show");
    }, 10);

    setTimeout(() => {
      toast.classList.remove("show");
      setTimeout(() => {
        document.body.removeChild(toast);
      }, 300);
    }, 3000);
  };

  clearAllBtn.addEventListener("click", clearVocabulary);

  searchInput.addEventListener("input", (e) => {
    searchVocabulary(e.target.value.trim());
  });

  loadVocabulary();

  const style = document.createElement("style");
  style.textContent = `
    .toast {
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%) translateY(100px);
      background-color: #333;
      color: white;
      padding: 10px 20px;
      border-radius: 4px;
      z-index: 10000;
      opacity: 0;
      transition: transform 0.3s, opacity 0.3s;
    }

    .toast.show {
      transform: translateX(-50%) translateY(0);
      opacity: 1;
    }

    .error-message {
      background-color: #ffebee;
      color: #d32f2f;
      padding: 15px;
      border-radius: 4px;
      margin: 20px 0;
      text-align: center;
    }

    .word-loading, .word-error {
      color: #888;
      font-style: italic;
      font-size: 14px;
    }

    .word-error {
      color: #d32f2f;
    }

    .word-meanings {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .meaning-block {
      padding-left: 4px;
    }

    .meaning-block .word-pos {
      display: inline-block;
      background-color: var(--light-gray);
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 12px;
      color: #666;
      margin-bottom: 4px;
    }

    .definitions-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding-left: 8px;
    }

    .definition-item {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .definition-item .word-definition {
      font-size: 14px;
      line-height: 1.5;
    }

    .word-example {
      font-size: 13px;
      line-height: 1.4;
      color: #666;
      font-style: italic;
      padding-left: 12px;
      border-left: 2px solid var(--border-color);
      margin-top: 2px;
    }
  `;
  document.head.appendChild(style);
});
