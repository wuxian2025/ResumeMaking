import { Button, Input, Message, Modal, Radio, Select } from "@arco-design/web-react";
// COMPAT: https://github.com/arco-design/arco-design/pull/2520
import "@arco-design/web-react/es/Select/style";
import "@arco-design/web-react/es/Radio/style";
import type { FC } from "react";
import React, { useEffect, useRef, useState } from "react";
import { useEditor } from "../../hooks/use-editor";
import {
  AI_PRESETS,
  deleteConversation,
  extractResumeText,
  isAiConfigured,
  loadAiSettings,
  loadConversations,
  saveAiSettings,
  saveConversation,
  streamChat,
  type AiProvider,
  type AiSettings,
  type ChatMessage,
  type StoredConversation,
} from "../../modules/ai";
import { getUniqueId } from "sketching-utils";
import { Markdown } from "./markdown";
import styles from "./index.m.scss";

type TaskType = "review" | "interview" | "custom";
type UiMessage = { role: "user" | "assistant"; content: string };

const TASK_LABELS: Record<string, string> = {
  review: "简历诊断",
  interview: "面试题生成",
  custom: "自定义提问",
};

const SYSTEM_PROMPTS: Record<Exclude<TaskType, "custom">, string> = {
  review:
    "你是一位资深HR与简历辅导专家。请从以下维度逐条分析这份简历并指出具体问题：1.结构与排版；2.内容表述(是否有空泛、夸大、含糊的描述)；3.量化与事实支撑；4.错别字与语法；5.改进建议。要求：每条问题指出位置、说明原因、给出修改示例，使用 Markdown 格式输出。",
  interview:
    "你是一位技术面试官。请基于这份简历的内容生成面试题：1.基础技术题(针对列出的技能栈)；2.项目深挖题(针对项目经历中的细节、难点与取舍)；3.开放场景题。每道题附上考察点与参考答案要点，使用 Markdown 格式输出。",
};

const GENERIC_SYSTEM = "你是一位专业的简历分析与求职辅导助手。";

/** 右侧停靠的 AI 助手侧栏, IDE 插件风格, 不遮挡简历画布 */
export const AiSidebar: FC = () => {
  const { editor } = useEditor();
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [task, setTask] = useState<TaskType>("review");
  const [question, setQuestion] = useState("");
  // 多轮对话: 仅包含 user/assistant, system 提示词单独保存
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [streaming, setStreaming] = useState("");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [historyList, setHistoryList] = useState<StoredConversation[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const streamRef = useRef("");
  const systemRef = useRef("");
  const transcriptRef = useRef<HTMLDivElement>(null);
  // 当前对话的持久化元信息
  const conversationRef = useRef<{ id: string; task: string; createdAt: number } | null>(null);
  const messagesRef = useRef<UiMessage[]>([]);

  // 设置表单
  const [settingsDraft, setSettingsDraft] = useState(loadAiSettings());

  /** 统一的消息更新入口, 同步维护渲染状态与持久化用的引用 */
  const applyMessages = (next: UiMessage[]) => {
    messagesRef.current = next;
    setMessages(next);
  };

  /** 将当前对话写入 localStorage(自动淘汰超限的旧记录) */
  const persistConversation = () => {
    const meta = conversationRef.current;
    const current = messagesRef.current;
    if (!meta || !current.length) return void 0;
    const firstUser = current.find(message => message.role === "user");
    saveConversation({
      id: meta.id,
      task: meta.task,
      title: (firstUser ? firstUser.content.replace(/\s+/g, " ").slice(0, 24) : "对话") || "对话",
      createdAt: meta.createdAt,
      updatedAt: Date.now(),
      system: systemRef.current,
      messages: current,
    });
    setHistoryList(loadConversations());
  };

  // 打开侧栏时刷新历史列表
  useEffect(() => {
    setHistoryList(loadConversations());
  }, []);

  // 流式输出时自动滚动到底部
  useEffect(() => {
    const el = transcriptRef.current;
    el && (el.scrollTop = el.scrollHeight);
  }, [messages, streaming]);

  const onSaveSettings = () => {
    if (!isAiConfigured(settingsDraft)) {
      Message.warning("请完整填写接口地址、API Key 与模型");
      return void 0;
    }
    saveAiSettings(settingsDraft);
    setSettingsDraft({ ...settingsDraft });
    setSettingsVisible(false);
    Message.success("AI 设置已保存到本地浏览器");
  };

  /** 发起一轮流式请求, 完成后将回复落入对话记录 */
  const runStream = async (history: ChatMessage[]) => {
    const current = loadAiSettings();
    if (!isAiConfigured(current)) {
      Message.warning("请先完成 AI 设置(接口地址 / Key / 模型)");
      setSettingsVisible(true);
      return void 0;
    }
    setLoading(true);
    streamRef.current = "";
    setStreaming("");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await streamChat({
        settings: current,
        signal: controller.signal,
        messages: history,
        onDelta: delta => {
          streamRef.current += delta;
          setStreaming(streamRef.current);
        },
      });
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        streamRef.current += `\n\n[请求出错] ${(error as Error).message}`;
      }
    } finally {
      const content = streamRef.current;
      if (content) {
        applyMessages([...messagesRef.current, { role: "assistant", content }]);
      }
      setStreaming("");
      streamRef.current = "";
      setLoading(false);
      abortRef.current = null;
      persistConversation();
    }
  };

  const onStart = async () => {
    const resume = extractResumeText(editor);
    if (!resume.trim()) {
      Message.warning("简历内容为空, 请先编辑简历");
      return void 0;
    }
    const userContent =
      task === "custom"
        ? `以下是我的简历内容:\n\n${resume}\n\n我的问题: ${question || "请针对这份简历给出分析与建议"}`
        : `请分析以下简历内容:\n\n${resume}`;
    systemRef.current = task === "custom" ? GENERIC_SYSTEM : SYSTEM_PROMPTS[task];
    conversationRef.current = { id: getUniqueId(), task, createdAt: Date.now() };
    applyMessages([{ role: "user", content: userContent }]);
    await runStream([
      { role: "system", content: systemRef.current },
      { role: "user", content: userContent },
    ]);
  };

  const onSend = async () => {
    const text = input.trim();
    if (!text || loading) return void 0;
    const history: ChatMessage[] = [
      { role: "system", content: systemRef.current },
      ...messagesRef.current.map(message => ({ role: message.role, content: message.content })),
      { role: "user", content: text },
    ];
    applyMessages([...messagesRef.current, { role: "user", content: text }]);
    setInput("");
    await runStream(history);
  };

  const onStop = () => {
    abortRef.current && abortRef.current.abort();
  };

  const onReset = () => {
    if (loading) return void 0;
    conversationRef.current = null;
    applyMessages([]);
    setStreaming("");
    setInput("");
    streamRef.current = "";
  };

  /** 加载一条历史对话继续追问 */
  const onLoadHistory = (id: string) => {
    if (loading) return void 0;
    const found = historyList.find(item => item.id === id);
    if (!found) return void 0;
    conversationRef.current = { id: found.id, task: found.task, createdAt: found.createdAt };
    systemRef.current = found.system;
    setTask((found.task as TaskType) || "custom");
    applyMessages(found.messages);
    setStreaming("");
    setInput("");
  };

  const onDeleteHistory = () => {
    const meta = conversationRef.current;
    if (meta) {
      deleteConversation(meta.id);
      setHistoryList(loadConversations());
      Message.info("已删除当前对话记录");
    }
  };

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };

  const hasConversation = messages.length > 0;

  return (
    <div className={`${styles.panel} ${styles.sidebar}`}>
      <div className={styles.sidebarHeader}>
        <div className={styles.panelTitle}>
          <span className={styles.spark}>✦</span>
          AI 助手
        </div>
        <div className={styles.sidebarActions}>
          <Button size="mini" type="text" onClick={() => setSettingsVisible(true)}>
            设置
          </Button>
        </div>
      </div>
      <div className={styles.sidebarBody}>
        <div className={styles.row}>
          <div className={styles.label}>任务类型</div>
          <Radio.Group
            value={task}
            onChange={value => setTask(value as TaskType)}
            type="button"
            size="mini"
            disabled={hasConversation}
          >
            <Radio value="review">简历诊断</Radio>
            <Radio value="interview">面试题</Radio>
            <Radio value="custom">提问</Radio>
          </Radio.Group>
        </div>
        {historyList.length > 0 && (
          <div className={styles.row}>
            <div className={styles.label}>历史</div>
            <Select
              size="mini"
              style={{ flex: 1 }}
              placeholder="加载历史对话"
              value={conversationRef.current ? conversationRef.current.id : undefined}
              onChange={onLoadHistory}
            >
              {historyList.map(item => (
                <Select.Option key={item.id} value={item.id}>
                  {formatTime(item.updatedAt)} · {TASK_LABELS[item.task] || item.task} · {item.title}
                </Select.Option>
              ))}
            </Select>
            <Button size="mini" type="text" onClick={onDeleteHistory}>
              删除
            </Button>
          </div>
        )}
        {!hasConversation && (
          <div className={styles.row}>
            {task === "custom" ? (
              <Input.TextArea
                placeholder="输入你想问的问题, 如: 这份简历匹配大厂前端实习岗吗?"
                autoSize={{ minRows: 2, maxRows: 4 }}
                value={question}
                onChange={setQuestion}
              />
            ) : (
              <div className={styles.hint}>将读取当前简历全文发送给 AI, 生成后可继续追问。</div>
            )}
          </div>
        )}
        {hasConversation && (
          <div className={styles.transcript} ref={transcriptRef}>
            {messages.map((message, index) => (
              <div key={index} className={message.role === "user" ? styles.msgUser : styles.msgAi}>
                <div className={styles.msgRole}>
                  <span
                    className={`${styles.avatar} ${message.role === "user" ? styles.avatarUser : styles.avatarAi}`}
                  >
                    {message.role === "user" ? "我" : "✦"}
                  </span>
                  {message.role === "user" ? "我" : "AI 助手"}
                </div>
                <div
                  className={`${styles.bubble} ${message.role === "user" ? styles.bubbleUser : styles.bubbleAi}`}
                >
                  {message.role === "user" ? <pre>{message.content}</pre> : <Markdown text={message.content} />}
                </div>
              </div>
            ))}
            {streaming && (
              <div className={styles.msgAi}>
                <div className={styles.msgRole}>
                  <span className={`${styles.avatar} ${styles.avatarAi}`}>✦</span>
                  AI 助手
                </div>
                <div className={`${styles.bubble} ${styles.bubbleAi}`}>
                  <Markdown text={streaming} />
                </div>
              </div>
            )}
          </div>
        )}
        <div className={styles.composer}>
          <Input.TextArea
            placeholder={hasConversation ? "继续追问, Enter 发送" : "选择任务后点击开始"}
            autoSize={{ minRows: 1, maxRows: 4 }}
            value={input}
            onChange={setInput}
            disabled={!hasConversation && task !== "custom"}
            onPressEnter={hasConversation ? onSend : undefined}
          />
          {!loading ? (
            hasConversation ? (
              <Button size="small" type="primary" onClick={onSend}>
                发送
              </Button>
            ) : (
              <Button size="small" type="primary" onClick={onStart}>
                开始
              </Button>
            )
          ) : (
            <Button size="small" status="danger" onClick={onStop}>
              停止
            </Button>
          )}
        </div>
        <div className={styles.sidebarFooter}>
          {hasConversation && !loading && (
            <Button size="mini" type="text" onClick={onReset}>
              新对话
            </Button>
          )}
          {loading && (
            <div className={styles.hint}>
              生成中
              <span className={styles.dots}>
                <span>.</span>
                <span>.</span>
                <span>.</span>
              </span>
            </div>
          )}
        </div>
      </div>
      <Modal
        title={<div>AI 设置</div>}
        visible={settingsVisible}
        onCancel={() => setSettingsVisible(false)}
        footer={null}
        focusLock={false}
        className={styles.panel}
        style={{ width: 560 }}
      >
        <div className={styles.row}>
          <div className={styles.label}>接口协议</div>
          <Radio.Group
            size="small"
            type="button"
            value={settingsDraft.provider}
            onChange={value => setSettingsDraft(prev => ({ ...prev, provider: value as AiProvider }))}
          >
            <Radio value="openai">OpenAI 兼容</Radio>
            <Radio value="anthropic">Anthropic</Radio>
          </Radio.Group>
        </div>
        <div className={styles.row}>
          <div className={styles.label}>服务商预设</div>
          <Select
            size="small"
            style={{ width: 200 }}
            placeholder="选择后自动填充"
            onChange={value => {
              const preset = AI_PRESETS.find(item => item.name === value);
              preset &&
                setSettingsDraft(prev => ({
                  ...prev,
                  provider: preset.provider,
                  baseURL: preset.baseURL,
                  model: preset.model,
                }));
            }}
          >
            {AI_PRESETS.map(preset => (
              <Select.Option key={preset.name} value={preset.name}>
                {preset.name}
              </Select.Option>
            ))}
          </Select>
        </div>
        <div className={styles.row}>
          <div className={styles.label}>接口地址</div>
          <Input
            size="small"
            placeholder="https://api.deepseek.com/v1"
            value={settingsDraft.baseURL}
            onChange={value => setSettingsDraft(prev => ({ ...prev, baseURL: value }))}
          />
        </div>
        <div className={styles.row}>
          <div className={styles.label}>API Key</div>
          <Input.Password
            size="small"
            placeholder="sk-..."
            value={settingsDraft.apiKey}
            onChange={value => setSettingsDraft(prev => ({ ...prev, apiKey: value }))}
          />
        </div>
        <div className={styles.row}>
          <div className={styles.label}>模型</div>
          <Input
            size="small"
            placeholder="deepseek-chat"
            value={settingsDraft.model}
            onChange={value => setSettingsDraft(prev => ({ ...prev, model: value }))}
          />
        </div>
        <div className={styles.row}>
          <div className={styles.label}>推理强度</div>
          <Radio.Group
            size="small"
            type="button"
            value={settingsDraft.reasoningEffort}
            onChange={value =>
              setSettingsDraft(prev => ({ ...prev, reasoningEffort: value as AiSettings["reasoningEffort"] }))
            }
          >
            <Radio value="off">关闭</Radio>
            <Radio value="low">低</Radio>
            <Radio value="medium">中</Radio>
            <Radio value="high">高</Radio>
          </Radio.Group>
        </div>
        <div className={styles.hint}>
          OpenAI 兼容协议适用于 DeepSeek/通义/Moonshot/Ollama 等大部分服务商,
          Anthropic 协议适用于 Claude 系列模型, 均支持自定义中转地址。Key 仅保存在本地浏览器,
          请求由浏览器直接发往你所配置的接口地址。
        </div>
        <div className={styles.row}>
          <Button size="small" type="primary" onClick={onSaveSettings}>
            保存
          </Button>
        </div>
      </Modal>
    </div>
  );
};
