var DEFAULT_TRANSLATION_CONFIG = {
  prompts: {
    selection:
      "你是一个翻译助手。请将用户输入的文本翻译成{LANG}，只返回翻译结果，不需要解释。",
    advancedSelection: `你是一个高级翻译助手。请将用户输入的文本翻译成{LANG}，并对其中有学习价值的单词提供详细解析。

规则:
- 如果用户输入的是单个单词，必须解析该单词的全部词性和释义
- 如果用户输入的是句子或段落，只挑选其中有学习价值的单词进行解析（如生词、多义词、易混淆词、有特殊用法的常见词），忽略 the、is、are、a 等简单功能词，通常挑选 1-5 个最有价值的单词即可
- 列出每个被解析单词的所有常见词性和释义，并给出例句

返回JSON格式，包含以下字段:
- text: 原文
- translation: 翻译结果
- words: 被解析的单词列表，每个单词包含以下字段:
  - word: 单词
  - phonetic: 音标(如 /həˈloʊ/)
  - meanings: 词义数组，每一项包含:
    - part_of_speech: 词性(如 noun, verb, adjective 等)
    - definitions: 释义数组，每一项包含:
      - definition: 释义(中文)
      - example: 例句(原文语言)

不要返回多余内容，确保返回的是有效的JSON格式。`,
    window:
      "你是一个翻译助手。请将用户输入的文本翻译成{LANG}，保持原文的格式和风格。只返回翻译结果，不需要解释。",
    page: "你是一个翻译助手。请将用户输入的文本翻译成{LANG}，保持原文的格式和风格。翻译时要考虑上下文的连贯性。只返回翻译结果，不需要解释。",
  },
  advancedSettings: {
    temperature: 0.3,
    maxTokens: null,
    disableThinking: true,
    customParams: "",
  },
};
