// 高级翻译窗口JavaScript
document.addEventListener("DOMContentLoaded", () => {
  const originalText = document.getElementById("originalText");
  const translatedText = document.getElementById("translatedText");
  const wordsSection = document.getElementById("wordsSection");
  const wordsList = document.getElementById("wordsList");
  const loadingSection = document.getElementById("loadingSection");
  const errorSection = document.getElementById("errorSection");
  const errorMessage = document.getElementById("errorMessage");
  const clearContentBtn = document.getElementById("clearContent");
  const openVocabularyBtn = document.getElementById("openVocabulary");

  let vocabulary = new Set();

  const loadVocabulary = async () => {
    try {
      const result = await chrome.storage.local.get({ vocabulary: [] });
      if (Array.isArray(result.vocabulary)) {
        vocabulary = new Set(result.vocabulary);
        console.log(`单词本加载完成，共 ${vocabulary.size} 个单词`);
      }
    } catch (error) {
      console.error("加载单词本失败:", error);
    }
  };

  const saveVocabulary = async () => {
    await chrome.storage.local.set({ vocabulary: Array.from(vocabulary) });
  };

  const addToVocabulary = async (word, meanings, phonetic) => {
    if (word && !vocabulary.has(word)) {
      vocabulary.add(word);
      await saveVocabulary();

      const wordDetails = {
        phonetic: phonetic || "",
        meanings: meanings || [],
      };

      const wordKey = `word_details_${word}`;
      await chrome.storage.local.set({ [wordKey]: wordDetails });
      return true;
    }
    return false;
  };

  const showLoading = () => {
    loadingSection.style.display = "flex";
    errorSection.style.display = "none";
    wordsSection.style.display = "none";
  };

  const hideLoading = () => {
    loadingSection.style.display = "none";
  };

  const showError = (message) => {
    errorMessage.textContent = message;
    errorSection.style.display = "block";
    loadingSection.style.display = "none";
    wordsSection.style.display = "none";
  };

  const hideError = () => {
    errorSection.style.display = "none";
  };

  // 将旧格式单词转换为新格式
  const normalizeWord = (word) => {
    if (word.meanings && Array.isArray(word.meanings)) {
      return word;
    }
    // 兼容旧格式: { word, phonetic, part_of_speech, definition }
    const meanings = [];
    if (word.part_of_speech || word.definition) {
      meanings.push({
        part_of_speech: word.part_of_speech || "",
        definitions: [
          {
            definition: word.definition || "",
            example: "",
          },
        ],
      });
    }
    return {
      word: word.word,
      phonetic: word.phonetic || "",
      meanings,
    };
  };

  const renderTranslation = (originalTextContent, translationResult) => {
    originalText.textContent = originalTextContent || "";

    if (translationResult && translationResult.translation) {
      translatedText.textContent = translationResult.translation;
    } else {
      translatedText.textContent = "翻译失败";
    }

    // 兼容新字段 words 和旧字段 complex_words
    const wordsData =
      (translationResult && translationResult.words) ||
      (translationResult && translationResult.complex_words);

    if (wordsData && wordsData.length > 0) {
      renderWordsList(wordsData);
      wordsSection.style.display = "block";
    } else {
      wordsSection.style.display = "none";
    }

    hideLoading();
    hideError();
  };

  const renderWordsList = (words) => {
    wordsList.innerHTML = "";

    words.forEach((rawWord) => {
      const word = normalizeWord(rawWord);

      const wordItem = document.createElement("div");
      wordItem.className = "word-item";

      // 单词头部: 单词 + 音标 + 加入单词本按钮
      const wordHeader = document.createElement("div");
      wordHeader.className = "word-header";

      const wordTitle = document.createElement("div");
      wordTitle.className = "word-title";

      const wordText = document.createElement("span");
      wordText.className = "word-text";
      wordText.textContent = word.word || "";
      wordTitle.appendChild(wordText);

      if (word.phonetic) {
        const phonetic = document.createElement("span");
        phonetic.className = "word-phonetic";
        phonetic.textContent = word.phonetic;
        wordTitle.appendChild(phonetic);
      }

      wordHeader.appendChild(wordTitle);

      const addButton = document.createElement("button");
      addButton.className = "add-to-vocabulary";
      addButton.textContent = "加入单词本";
      addButton.title = "将单词加入生词本";

      if (vocabulary.has(word.word)) {
        addButton.disabled = true;
        addButton.textContent = "已在单词本";
        addButton.className += " in-vocabulary";
      }

      addButton.addEventListener("click", async function () {
        const added = await addToVocabulary(
          word.word,
          word.meanings,
          word.phonetic
        );

        if (added) {
          this.disabled = true;
          this.textContent = "已加入单词本";
          this.className += " in-vocabulary";
        }
      });

      wordHeader.appendChild(addButton);
      wordItem.appendChild(wordHeader);

      // 词义列表
      if (word.meanings && word.meanings.length > 0) {
        const meaningsContainer = document.createElement("div");
        meaningsContainer.className = "word-meanings";

        word.meanings.forEach((meaning) => {
          const meaningBlock = document.createElement("div");
          meaningBlock.className = "meaning-block";

          if (meaning.part_of_speech) {
            const posLabel = document.createElement("span");
            posLabel.className = "word-pos";
            posLabel.textContent = meaning.part_of_speech;
            meaningBlock.appendChild(posLabel);
          }

          if (meaning.definitions && meaning.definitions.length > 0) {
            const defList = document.createElement("div");
            defList.className = "definitions-list";

            meaning.definitions.forEach((def) => {
              const defItem = document.createElement("div");
              defItem.className = "definition-item";

              const defText = document.createElement("span");
              defText.className = "word-definition";
              defText.textContent = def.definition || "";
              defItem.appendChild(defText);

              if (def.example) {
                const exampleEl = document.createElement("div");
                exampleEl.className = "word-example";
                exampleEl.textContent = def.example;
                defItem.appendChild(exampleEl);
              }

              defList.appendChild(defItem);
            });

            meaningBlock.appendChild(defList);
          }

          meaningsContainer.appendChild(meaningBlock);
        });

        wordItem.appendChild(meaningsContainer);
      }

      wordsList.appendChild(wordItem);
    });
  };

  const clearContent = () => {
    originalText.textContent = "";
    translatedText.textContent = "";
    wordsSection.style.display = "none";
    errorSection.style.display = "none";
    loadingSection.style.display = "none";
  };

  const openVocabulary = () => {
    chrome.runtime.sendMessage({ action: "openVocabularyPage" });
  };

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "updateAdvancedTranslation") {
      if (request.isLoading) {
        showLoading();
        originalText.textContent = request.originalText || "";
        translatedText.textContent = "";
        wordsSection.style.display = "none";
        hideError();
      } else if (request.errorMessage) {
        showError(request.errorMessage);
      } else {
        renderTranslation(request.originalText, request.translationResult);
      }

      sendResponse({});
      return true;
    }
  });

  clearContentBtn.addEventListener("click", clearContent);
  openVocabularyBtn.addEventListener("click", openVocabulary);

  loadVocabulary();
  clearContent();
});
