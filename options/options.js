document.addEventListener("DOMContentLoaded", () => {
  const apiEndpoint = document.getElementById("apiEndpoint");
  const apiKey = document.getElementById("apiKey");
  const model = document.getElementById("model");
  const temperature = document.getElementById("temperature");
  const maxTokens = document.getElementById("maxTokens");
  const disableThinking = document.getElementById("disableThinking");
  const customParams = document.getElementById("customParams");
  const rpm = document.getElementById("rpm");
  const maxConcurrent = document.getElementById("maxConcurrent");
  const promptType = document.getElementById("promptType");
  const promptContent = document.getElementById("promptContent");
  const saveButton = document.getElementById("save");
  const testButton = document.getElementById("testConnection");
  const testSourceText = document.getElementById("testSourceText");
  const status = document.getElementById("status");
  const testResult = document.getElementById("testResult");
  const toggleApiKey = document.getElementById("toggleApiKey");

  const defaultPrompts = DEFAULT_TRANSLATION_CONFIG.prompts;
  const defaultAdvancedSettings = DEFAULT_TRANSLATION_CONFIG.advancedSettings;

  let prompts = { ...defaultPrompts };

  chrome.storage.sync.get(
    {
      apiEndpoint: "",
      apiKey: "",
      model: "",
      prompts: defaultPrompts,
      advancedSettings: defaultAdvancedSettings,
    },
    (items) => {
      apiEndpoint.value = items.apiEndpoint;
      apiKey.value = items.apiKey;
      model.value = items.model;
      prompts = { ...defaultPrompts, ...items.prompts };
      promptContent.value = prompts[promptType.value];

      const adv = items.advancedSettings;
      temperature.value = adv.temperature;
      maxTokens.value = adv.maxTokens || "";
      disableThinking.checked = adv.disableThinking !== false;
      customParams.value = adv.customParams || "";
      rpm.value = adv.rpm || 10;
      maxConcurrent.value = adv.maxConcurrent || 5;
    }
  );

  promptType.addEventListener("change", () => {
    promptContent.value =
      prompts[promptType.value] || defaultPrompts[promptType.value];
  });

  const collectAdvancedSettings = () => ({
    temperature: parseFloat(temperature.value) || 0.3,
    maxTokens: maxTokens.value ? parseInt(maxTokens.value, 10) : null,
    disableThinking: disableThinking.checked,
    customParams: customParams.value.trim(),
    rpm: parseInt(rpm.value, 10) || 10,
    maxConcurrent: parseInt(maxConcurrent.value, 10) || 5,
  });

  saveButton.addEventListener("click", () => {
    prompts[promptType.value] = promptContent.value;

    chrome.storage.sync.set(
      {
        apiEndpoint: apiEndpoint.value,
        apiKey: apiKey.value,
        model: model.value,
        prompts: prompts,
        advancedSettings: collectAdvancedSettings(),
      },
      () => {
        status.textContent = "设置已保存。";
        setTimeout(() => {
          status.textContent = "";
        }, 2000);
      }
    );
  });

  testButton.addEventListener("click", async () => {
    const endpoint = apiEndpoint.value.trim();
    const key = apiKey.value.trim();
    const modelName = model.value.trim();

    if (!endpoint || !key || !modelName) {
      testResult.className = "test-result error";
      testResult.textContent = "请先填写 API 地址、密钥和模型名称。";
      return;
    }

    testButton.disabled = true;
    testButton.textContent = "测试中...";
    testResult.className = "test-result";
    testResult.textContent = "";

    const adv = collectAdvancedSettings();

    const sourceText = testSourceText.value.trim() || "But a man is not made for defeat. A man can be destroyed but not defeated.";

    try {
      const body = {
        model: modelName,
        messages: [
          {
            role: "user",
            content: `请将以下文本翻译成中文：${sourceText}`,
          },
        ],
        temperature: adv.temperature,
        stream: false,
      };

      if (adv.maxTokens) {
        body.max_tokens = adv.maxTokens;
      }
      if (adv.disableThinking) {
        body.enable_thinking = false;
      }
      if (adv.customParams) {
        try {
          const extra = JSON.parse(adv.customParams);
          Object.assign(body, extra);
        } catch (_) { }
      }

      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}${errText ? ": " + errText.slice(0, 200) : ""}`);
      }

      const data = await res.json();
      const content =
        data.choices?.[0]?.message?.content ||
        data.choices?.[0]?.text ||
        "(无法解析响应内容)";

      testResult.className = "test-result success";
      testResult.textContent = `✓ 连接成功\n"${sourceText}" → ${content}`;
    } catch (err) {
      testResult.className = "test-result error";
      testResult.textContent = `连接失败：${err.message}`;
    } finally {
      testButton.disabled = false;
      testButton.textContent = "测试连接";
    }
  });

  toggleApiKey.addEventListener("click", () => {
    const type = apiKey.type;
    apiKey.type = type === "password" ? "text" : "password";
    toggleApiKey.querySelector(".eye-icon").textContent =
      type === "password" ? "🔒" : "👁️";
  });
});
