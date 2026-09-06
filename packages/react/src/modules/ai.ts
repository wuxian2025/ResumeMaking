import type { Editor } from "sketching-core";
import { Storage } from "sketching-utils";

const AI_SETTINGS_KEY = "__sketching-ai-settings";

export type AiProvider = "openai" | "anthropic";

/** 推理强度: off 时不向接口传递任何推理参数 */
export type ReasoningEffort = "off" | "low" | "medium" | "high";

export type AiSettings = {
  /** 接口协议: openai 兼容(`/chat/completions`)或 anthropic(`/messages`) */
  provider: AiProvider;
  /** 接口地址, 如 https://api.deepseek.com/v1 或 https://api.anthropic.com/v1 */
  baseURL: string;
  apiKey: string;
  model: string;
  reasoningEffort: ReasoningEffort;
};

export const DEFAULT_AI_SETTINGS: AiSettings = {
  provider: "openai",
  baseURL: "https://api.deepseek.com/v1",
  apiKey: "",
  model: "deepseek-chat",
  reasoningEffort: "off",
};

/** Anthropic 扩展思考的预算映射, `budget_tokens`必须小于`max_tokens` */
const ANTHROPIC_THINKING_BUDGETS: Record<Exclude<ReasoningEffort, "off">, number> = {
  low: 2048,
  medium: 8192,
  high: 16384,
};

/** 常见服务商预设, 便于快速填充 */
export const AI_PRESETS: { name: string; provider: AiProvider; baseURL: string; model: string }[] = [
  { name: "DeepSeek", provider: "openai", baseURL: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  { name: "OpenAI", provider: "openai", baseURL: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  { name: "Anthropic", provider: "anthropic", baseURL: "https://api.anthropic.com/v1", model: "claude-sonnet-4-5" },
  { name: "通义千问", provider: "openai", baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus" },
  { name: "Moonshot", provider: "openai", baseURL: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k" },
  { name: "智谱 GLM", provider: "openai", baseURL: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-flash" },
  { name: "本地 Ollama", provider: "openai", baseURL: "http://localhost:11434/v1", model: "qwen2.5:7b" },
];

export const loadAiSettings = (): AiSettings => {
  const saved = Storage.local.get<Partial<AiSettings>>(AI_SETTINGS_KEY) || {};
  const effort = saved.reasoningEffort;
  return {
    provider: saved.provider === "anthropic" ? "anthropic" : "openai",
    baseURL: saved.baseURL || DEFAULT_AI_SETTINGS.baseURL,
    apiKey: saved.apiKey || "",
    model: saved.model || DEFAULT_AI_SETTINGS.model,
    reasoningEffort:
      effort === "low" || effort === "medium" || effort === "high" ? effort : "off",
  };
};

export const saveAiSettings = (settings: AiSettings) => {
  Storage.local.set(AI_SETTINGS_KEY, settings);
};

export const isAiConfigured = (settings: AiSettings) => {
  return !!(settings.baseURL && settings.apiKey && settings.model);
};

// ====== 对话历史持久化 ======

const AI_CONVERSATIONS_KEY = "__sketching-ai-conversations";
/** 最多保留的对话数量, 超出后淘汰最旧的 */
export const MAX_CONVERSATIONS = 20;
/** 历史记录的总体积上限, 超出后从最旧开始淘汰 */
export const MAX_CONVERSATIONS_SIZE = 1024 * 1024;

export type StoredConversation = {
  id: string;
  task: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
};

export const loadConversations = (): StoredConversation[] => {
  const store = Storage.local.get<{ conversations?: StoredConversation[] }>(AI_CONVERSATIONS_KEY);
  return (store && store.conversations) || [];
};

export const saveConversation = (conversation: StoredConversation) => {
  const list = loadConversations().filter(item => item.id !== conversation.id);
  list.unshift(conversation);
  let store = { conversations: list.slice(0, MAX_CONVERSATIONS) };
  while (JSON.stringify(store).length > MAX_CONVERSATIONS_SIZE && store.conversations.length > 1) {
    store = { conversations: store.conversations.slice(0, -1) };
  }
  Storage.local.set(AI_CONVERSATIONS_KEY, store);
};

export const deleteConversation = (id: string) => {
  Storage.local.set(AI_CONVERSATIONS_KEY, {
    conversations: loadConversations().filter(item => item.id !== id),
  });
};

/**
 * 从编辑器中提取简历纯文本
 * 文本图形按`y -> x`排序后拼接, 还原阅读顺序
 */
export const extractResumeText = (editor: Editor): string => {
  const deltaSetLike = editor.deltaSet.getDeltas();
  const texts: { x: number; y: number; text: string }[] = [];
  for (const delta of Object.values(deltaSetLike)) {
    if (!delta || delta.key !== "text" || !delta.attrs || !delta.attrs.DATA) continue;
    try {
      const lines = JSON.parse(delta.attrs.DATA) as { chars: { char: string }[] }[];
      const text = lines.map(line => line.chars.map(item => item.char).join("")).join("\n");
      text.trim() && texts.push({ x: delta.x, y: delta.y, text });
    } catch (error) {
      // 单个图形数据异常时跳过, 不影响其余内容
    }
  }
  texts.sort((a, b) => a.y - b.y || a.x - b.x);
  return texts.map(item => item.text).join("\n\n");
};

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/** 解析一行 SSE`data:`载荷并回调增量文本, 返回是否结束 */
const consumeOpenAiPayload = (payload: string, onDelta: (text: string) => void) => {
  if (payload === "[DONE]") return true;
  try {
    const json = JSON.parse(payload);
    const delta = json.choices && json.choices[0] && json.choices[0].delta && json.choices[0].delta.content;
    delta && onDelta(delta);
  } catch {
    // 忽略心跳注释等非 JSON 行
  }
  return false;
};

/** Anthropic 的 SSE 事件流, 文本增量在`content_block_delta`事件中 */
const consumeAnthropicPayload = (payload: string, onDelta: (text: string) => void) => {
  try {
    const json = JSON.parse(payload);
    if (json.type === "content_block_delta" && json.delta && json.delta.type === "text_delta") {
      json.delta.text && onDelta(json.delta.text);
    }
    if (json.type === "message_stop") return true;
  } catch {
    // 忽略心跳等非 JSON 行
  }
  return false;
};

/**
 * 流式对话: 依据`provider`分发给 OpenAI 兼容接口或 Anthropic 接口
 * 请求由浏览器直接发往配置的地址
 */
export const streamChat = async (options: {
  settings: AiSettings;
  messages: ChatMessage[];
  onDelta: (text: string) => void;
  signal?: AbortSignal;
}): Promise<void> => {
  const { settings, messages, onDelta, signal } = options;
  const base = settings.baseURL.replace(/\/+$/, "");
  const isAnthropic = settings.provider === "anthropic";
  const url = base + (isAnthropic ? "/messages" : "/chat/completions");
  const headers: Record<string, string> = isAnthropic
    ? {
        "Content-Type": "application/json",
        "x-api-key": settings.apiKey,
        "anthropic-version": "2023-06-01",
        // COMPAT: Anthropic 浏览器直连 CORS 需要显式声明
        "anthropic-dangerous-direct-browser-access": "true",
      }
    : {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.apiKey}`,
      };
  let body: Record<string, unknown>;
  if (isAnthropic) {
    // Anthropic 的`system`是顶层参数, 且`max_tokens`必填
    const system = messages.filter(message => message.role === "system").map(message => message.content).join("\n");
    const rest = messages
      .filter(message => message.role !== "system")
      .map(message => ({ role: message.role, content: message.content }));
    const effort = settings.reasoningEffort;
    const budget = effort !== "off" ? ANTHROPIC_THINKING_BUDGETS[effort] : 0;
    body = {
      model: settings.model,
      // 扩展思考要求`max_tokens`大于`budget_tokens`
      max_tokens: budget ? budget + 8192 : 8192,
      messages: rest,
      stream: true,
      ...(system ? { system } : {}),
      ...(budget ? { thinking: { type: "enabled", budget_tokens: budget } } : {}),
    };
  } else {
    body = {
      model: settings.model,
      messages,
      stream: true,
      // o 系与 gpt-5 等推理模型使用`reasoning_effort`, 其余服务商大多忽略该字段
      ...(settings.reasoningEffort !== "off" ? { reasoning_effort: settings.reasoningEffort } : {}),
    };
  }
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`请求失败(${response.status}): ${errorBody.slice(0, 300) || response.statusText}`);
  }
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const consume = isAnthropic ? consumeAnthropicPayload : consumeOpenAiPayload;
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      if (consume(trimmed.slice(5).trim(), onDelta)) return;
    }
  }
};
