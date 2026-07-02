import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Icon } from "../components/Icon";
import { MarkdownRenderer } from "../components/MarkdownRenderer";
import { RollingNumber } from "../components/RollingNumber";
import { isTauri, useSysStats, fmtProcMem } from "./sys";

type Role = "user" | "ai";
type AgentStage = "observe" | "reason" | "plan" | "act";

interface Msg {
  id: number;
  role: Role;
  text: string;
  reasoning?: string | null;
  evidence?: string;
  action?: PendingAction;
  tool?: PendingTool;
  createdAt: number;
}

interface AiReply {
  content: string;
  reasoning?: string | null;
}

const AI_KEYS = {
  apiUrl: "qific.openai_url",
  apiKey: "qific.openai_key",
  modelId: "qific.openai_model",
};

const CHAT_STORE_KEY = "qific.chat_sessions.v2";
const ACTIVE_CHAT_KEY = "qific.chat_active.v2";

interface PendingAction {
  title: string;
  steps: string[];
  status: "pending" | "approved" | "declined";
}

interface PendingTool {
  kind: "terminal";
  title: string;
  command: string;
  cwd?: string;
  status: "pending" | "running" | "completed" | "failed" | "declined";
  result?: TerminalCommandResult;
  error?: string;
}

interface TerminalCommandResult {
  command: string;
  cwd: string;
  exit_code: number | null;
  stdout: string;
  stderr: string;
  duration_ms: number;
  timed_out: boolean;
}

interface Conversation {
  id: string;
  title: string;
  preview: string;
  updatedAt: number;
  messages: Msg[];
}

interface AIAssistantProps {
  theme: string;
  newChatNonce?: number;
}

const SUGGESTIONS = ["诊断电脑变卡", "给我一份安全清理方案", "解释最高占用进程"];

const QUICK_ACTIONS = [
  {
    title: "性能诊断",
    desc: "CPU、内存、进程",
    prompt: "请根据当前系统状态诊断电脑变卡的原因，并给出不破坏数据的处理顺序。",
  },
  {
    title: "清理规划",
    desc: "先列方案再确认",
    prompt: "请帮我规划一次安全清理，只提出建议，不要假设已经执行。",
  },
  {
    title: "进程解释",
    desc: "说明用途与风险",
    prompt: "请解释当前高占用进程可能是什么，以及哪些可以安全关闭。",
  },
  {
    title: "终端诊断",
    desc: "确认后运行只读命令",
    prompt: "请用终端工具帮我做一次只读系统诊断，先提出要运行的命令，等我确认后再执行。",
  },
];

let msgSeq = Number(localStorage.getItem("qific.chat_msg_seq") ?? "0");
const nextId = () => {
  msgSeq += 1;
  localStorage.setItem("qific.chat_msg_seq", String(msgSeq));
  return msgSeq;
};

const now = () => Date.now();
const newChatId = () => `chat-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

const welcomeMessage = (): Msg => ({
  id: nextId(),
  role: "ai",
  text: [
    "### 我在这儿",
    "把现象、目标或限制告诉我。我会先读取本机实时状态，再给你一份可确认的处理方案。",
    "",
    "- 涉及删除、关闭进程、清理缓存时，我只会先提出方案",
    "- 你确认后才进入执行步骤",
    "- 回答会尽量给出依据、风险和下一步",
  ].join("\n"),
  evidence: "本地上下文已准备 · 等待你的目标",
  createdAt: now(),
});

const makeConversation = (): Conversation => ({
  id: newChatId(),
  title: "新的诊断会话",
  preview: "等待输入",
  updatedAt: now(),
  messages: [welcomeMessage()],
});

const safeParseSessions = (): Conversation[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(CHAT_STORE_KEY) ?? "[]") as Conversation[];
    return parsed
      .filter((conv) => conv && typeof conv.id === "string" && Array.isArray(conv.messages))
      .map((conv) => ({
        ...conv,
        preview: conv.preview || previewFromMessages(conv.messages),
        updatedAt: conv.updatedAt || now(),
        messages: conv.messages.map((m) => ({ ...m, createdAt: m.createdAt || conv.updatedAt || now() })),
      }));
  } catch {
    return [];
  }
};

const previewFromMessages = (messages: Msg[]) => {
  const last = [...messages].reverse().find((m) => m.role === "user" || m.text.trim());
  return last?.text.replace(/[#>*`\-]/g, "").replace(/\s+/g, " ").trim().slice(0, 42) || "等待输入";
};

const titleFromText = (text: string) => {
  const cleaned = text.replace(/\s+/g, " ").replace(/[。！？!?].*$/, "").trim();
  if (!cleaned) return "新的诊断会话";
  return cleaned.length > 18 ? `${cleaned.slice(0, 18)}…` : cleaned;
};

const formatRelative = (ts: number) => {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))} 分钟前`;
  if (diff < 86_400_000) return "今天";
  if (diff < 172_800_000) return "昨天";
  return new Date(ts).toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
};

const extractAction = (text: string): PendingAction | undefined => {
  const risky = /删除|清理|移到废纸篓|关闭进程|结束进程|卸载|重置|修改设置|缓存/.test(text);
  if (!risky) return undefined;
  const lines = text
    .split("\n")
    .map((line) => line.trim().replace(/^[-*]\s+/, "").replace(/^\d+[.)]\s+/, ""))
    .filter((line) => line && !/^#{1,6}\s/.test(line));
  const steps = lines
    .filter((line) => /清理|删除|移动|关闭|检查|备份|确认|废纸篓|缓存|进程/.test(line))
    .slice(0, 4);
  return {
    title: "需要你确认后再执行",
    steps: steps.length ? steps : ["复核候选项", "移到废纸篓或保持可撤销", "写入本地操作日志"],
    status: "pending",
  };
};

const extractTerminalTool = (text: string): PendingTool | undefined => {
  const xml = text.match(/<terminal(?:\s+cwd="([^"]+)")?>([\s\S]*?)<\/terminal>/i);
  const fenced = text.match(/```(?:terminal|shell|bash|zsh)\s*\n([\s\S]*?)```/i);
  const command = (xml?.[2] || fenced?.[1] || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .join(" && ")
    .trim();
  if (!command) return undefined;
  return {
    kind: "terminal",
    title: "终端工具 · 等待确认",
    command,
    cwd: xml?.[1],
    status: "pending",
  };
};

const stripToolMarkup = (text: string) =>
  text
    .replace(/<terminal(?:\s+cwd="[^"]+")?>[\s\S]*?<\/terminal>/gi, "")
    .trim();

const localReply = (input: string, context: string): Msg => {
  const q = input.toLowerCase();
  const has = (...k: string[]) => k.some((x) => q.includes(x));

  if (has("卡", "慢", "lag", "卡顿")) {
    return {
      id: nextId(),
      role: "ai",
      text: [
        "### 初步结论",
        "电脑变卡通常先看 **内存压力** 和 **持续高占用进程**。我建议先做诊断，不直接关闭进程。",
        "",
        "1. 观察 CPU、内存和前台应用是否同时升高",
        "2. 找出连续占用 30 秒以上的进程",
        "3. 优先关闭你确认不用的应用，再考虑清理缓存",
        "",
        "> 任何关闭进程或清理操作，都应该先确认用途和是否可撤销。",
      ].join("\n"),
      evidence: context.split("\n").slice(1, 3).join(" · "),
      action: {
        title: "建议的安全处理顺序",
        steps: ["记录当前高占用进程", "关闭非工作相关应用", "扫描可撤销缓存和下载项"],
        status: "pending",
      },
      createdAt: now(),
    };
  }

  if (has("清理", "清", "删", "clean")) {
    return {
      id: nextId(),
      role: "ai",
      text: [
        "### 清理前先定规则",
        "我会按安全优先级来规划：**大文件**、**长期未访问文件**、**疑似重复文件**。默认只建议移到废纸篓，不做永久删除。",
        "",
        "- 高优先级：安装包、压缩包、视频导出文件",
        "- 中优先级：180 天未修改且不在项目目录里的文件",
        "- 暂不处理：代码仓库、系统目录、隐藏目录和未知来源文件",
      ].join("\n"),
      evidence: "清理策略 · 只基于文件元数据，不读取文件内容",
      action: {
        title: "清理方案需要确认",
        steps: ["扫描候选文件", "按风险分组展示", "确认后移到废纸篓并记录日志"],
        status: "pending",
      },
      createdAt: now(),
    };
  }

  if (has("进程", "占用", "内存", "cpu", "process")) {
    return {
      id: nextId(),
      role: "ai",
      text: [
        "### 我会这样判断进程风险",
        "先看它是不是你主动打开的应用，再看是否属于系统组件。对不熟悉的进程，不建议直接结束。",
        "",
        "| 判断项 | 处理方式 |",
        "| --- | --- |",
        "| 前台应用 | 先保存工作，再退出 |",
        "| 浏览器子进程 | 关闭占用最高的标签页 |",
        "| 系统进程 | 只观察，不直接结束 |",
      ].join("\n"),
      evidence: context.split("\n").find((line) => line.startsWith("高占用进程")) || "等待实时进程数据",
      createdAt: now(),
    };
  }

  if (has("终端", "命令", "terminal", "shell", "诊断")) {
    return {
      id: nextId(),
      role: "ai",
      text: [
        "### 可以接入终端诊断",
        "我建议先运行一条只读命令，快速看磁盘、内存压力和当前目录空间占用。命令不会删除或修改文件。",
        "",
        "- `df -h` 查看磁盘空间",
        "- `vm_stat` 查看内存页状态",
        "- `du -sh ~/Downloads 2>/dev/null` 查看下载目录体积",
      ].join("\n"),
      evidence: "终端工具 · 需要用户确认后执行",
      tool: {
        kind: "terminal",
        title: "运行只读系统诊断",
        command: "df -h && vm_stat && du -sh ~/Downloads 2>/dev/null",
        status: "pending",
      },
      createdAt: now(),
    };
  }

  return {
    id: nextId(),
    role: "ai",
    text: [
      "### 收到",
      "我可以继续往下拆。为了给你更准的建议，请补充一个目标：你是想 **诊断原因**、**释放空间**，还是 **确认某个进程/文件是否安全**？",
      "",
      "你也可以直接说：`帮我生成一份不会误删文件的清理方案`。",
    ].join("\n"),
    evidence: "本地演示模式 · 配置模型后将使用真实 API 回复",
    createdAt: now(),
  };
};

export const AIAssistant: React.FC<AIAssistantProps> = ({ newChatNonce = 0 }) => {
  const { stats } = useSysStats(2200);
  const [conversations, setConversations] = useState<Conversation[]>(() => {
    const saved = safeParseSessions();
    return saved.length ? saved : [makeConversation()];
  });
  const [activeConv, setActiveConv] = useState(() => localStorage.getItem(ACTIVE_CHAT_KEY) || "");
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState("");
  const [stage, setStage] = useState<AgentStage>("observe");
  const apiUrl = localStorage.getItem(AI_KEYS.apiUrl)?.trim() || "https://api.openai.com/v1";
  const apiKey = localStorage.getItem(AI_KEYS.apiKey)?.trim() || "";
  const modelId = localStorage.getItem(AI_KEYS.modelId)?.trim() || "";
  const apiReady = !!apiUrl && !!apiKey && !!modelId;
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastNonce = useRef(Number(sessionStorage.getItem("qific.chat_new_signal") ?? "0"));

  const active = useMemo(() => {
    const found = conversations.find((c) => c.id === activeConv);
    return found ?? conversations[0];
  }, [activeConv, conversations]);

  const messages = active?.messages ?? [];

  const context = useMemo(() => {
    if (!stats) return "当前没有实时系统数据。";
    const memPct = stats.total_memory ? ((stats.used_memory / stats.total_memory) * 100).toFixed(1) : "未知";
    const top = stats.processes
      .slice(0, 5)
      .map((p) => `${p.name || `PID ${p.pid}`} CPU ${p.cpu_usage.toFixed(1)}%, 内存 ${fmtProcMem(p.memory)}`)
      .join("；");
    return [
      "实时系统摘要：",
      `CPU ${stats.cpu_usage.toFixed(1)}%；内存 ${memPct}%；磁盘 ${stats.disk_name ?? "未知"}。`,
      top ? `高占用进程：${top}` : "暂无进程列表。",
    ].join("\n");
  }, [stats]);

  const contextCards = useMemo(() => {
    if (!stats) {
      return [
        { label: "运行环境", value: isTauri() ? "等待采样" : "预览模式" },
        { label: "上下文", value: "离线演示" },
      ];
    }
    const memPct = stats.total_memory ? ((stats.used_memory / stats.total_memory) * 100).toFixed(0) : "--";
    const top = stats.processes[0]?.name || "暂无";
    return [
      { label: "CPU", value: `${stats.cpu_usage.toFixed(1)}%` },
      { label: "内存", value: `${memPct}%` },
      { label: "最高占用", value: top },
    ];
  }, [stats]);

  const persist = useCallback((next: Conversation[], activeId = active?.id) => {
    const trimmed = next
      .map((conv) => ({ ...conv, messages: conv.messages.slice(-80) }))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 30);
    localStorage.setItem(CHAT_STORE_KEY, JSON.stringify(trimmed));
    if (activeId) localStorage.setItem(ACTIVE_CHAT_KEY, activeId);
  }, [active?.id]);

  const updateConversation = useCallback((id: string, updater: (conv: Conversation) => Conversation) => {
    setConversations((prev) => {
      const next = prev.map((conv) => (conv.id === id ? updater(conv) : conv));
      persist(next, id);
      return next;
    });
  }, [persist]);

  const startNewChat = useCallback(() => {
    const conv = makeConversation();
    setConversations((prev) => {
      const next = [conv, ...prev];
      persist(next, conv.id);
      return next;
    });
    setActiveConv(conv.id);
    setInput("");
    setError("");
  }, [persist]);

  useEffect(() => {
    if (!conversations[0]) return;
    if (!activeConv || !conversations.some((conv) => conv.id === activeConv)) {
      setActiveConv(conversations[0].id);
    }
  }, [activeConv, conversations]);

  useEffect(() => {
    persist(conversations, active?.id);
  }, [active?.id, conversations, persist]);

  useEffect(() => {
    if (newChatNonce && newChatNonce !== lastNonce.current) {
      lastNonce.current = newChatNonce;
      sessionStorage.setItem("qific.chat_new_signal", String(newChatNonce));
      startNewChat();
    }
  }, [newChatNonce, startNewChat]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, thinking]);

  useEffect(() => {
    if (!thinking) {
      setStage("observe");
      return;
    }
    const steps: AgentStage[] = ["observe", "reason", "plan", "act"];
    let index = 0;
    setStage(steps[index]);
    const timer = window.setInterval(() => {
      index = Math.min(index + 1, steps.length - 1);
      setStage(steps[index]);
    }, 650);
    return () => window.clearInterval(timer);
  }, [thinking]);

  const removeConversation = (id: string) => {
    setConversations((prev) => {
      const next = prev.filter((c) => c.id !== id);
      const fallback = next[0] ?? makeConversation();
      const final = next.length ? next : [fallback];
      const nextActive = activeConv === id ? fallback.id : activeConv;
      persist(final, nextActive);
      window.setTimeout(() => setActiveConv(nextActive), 0);
      return final;
    });
  };

  const send = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || !active || thinking) return;
    const convId = active.id;
    const userMsg: Msg = { id: nextId(), role: "user", text: content, createdAt: now() };
    const historyForRequest = [...active.messages, userMsg];
    updateConversation(convId, (conv) => ({
      ...conv,
      title: conv.messages.length <= 1 ? titleFromText(content) : conv.title,
      preview: content,
      updatedAt: now(),
      messages: [...conv.messages, userMsg],
    }));
    setInput("");
    setError("");
    setThinking(true);
    try {
      if (apiReady && isTauri()) {
        const reply = await invoke<AiReply>("ask_openai", {
          apiUrl,
          apiKey,
          modelId,
          messages: historyForRequest.slice(-14).map((m) => ({
            role: m.role === "ai" ? "assistant" : "user",
            content: m.text,
          })),
          context: [
            context,
            "会话要求：请使用 markdown。结构优先级为：结论、依据、建议步骤、需要确认的操作。涉及风险操作时必须明确等待用户确认。",
            "如果需要终端能力，只能提出只读或低风险诊断命令，并用 <terminal>命令</terminal> 单独包裹。不要提出 sudo、rm、关机、重启、磁盘擦除、权限递归修改等危险命令。",
          ].join("\n\n"),
        });
        const aiText = reply.content || "接口返回了空内容。";
        const tool = extractTerminalTool(aiText);
        const aiMsg: Msg = {
          id: nextId(),
          role: "ai",
          text: stripToolMarkup(aiText),
          reasoning: reply.reasoning,
          evidence: `${modelId} · 已结合本机上下文`,
          action: extractAction(aiText),
          tool,
          createdAt: now(),
        };
        updateConversation(convId, (conv) => ({
          ...conv,
          preview: previewFromMessages([aiMsg]),
          updatedAt: now(),
          messages: [...conv.messages, aiMsg],
        }));
      } else {
        await new Promise((resolve) => window.setTimeout(resolve, 460));
        const aiMsg = localReply(content, context);
        updateConversation(convId, (conv) => ({
          ...conv,
          preview: previewFromMessages([aiMsg]),
          updatedAt: now(),
          messages: [...conv.messages, aiMsg],
        }));
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      const aiMsg = localReply(content, context);
      updateConversation(convId, (conv) => ({
        ...conv,
        preview: "接口异常，已使用本地策略回复",
        updatedAt: now(),
        messages: [...conv.messages, aiMsg],
      }));
    } finally {
      setThinking(false);
    }
  };

  const resolveAction = (msgId: number, status: "approved" | "declined") => {
    if (!active) return;
    updateConversation(active.id, (conv) => ({
      ...conv,
      updatedAt: now(),
      messages: conv.messages.map((msg) =>
        msg.id === msgId && msg.action ? { ...msg, action: { ...msg.action, status } } : msg,
      ),
    }));
  };

  const updateTool = (msgId: number, updater: (tool: PendingTool) => PendingTool) => {
    if (!active) return;
    updateConversation(active.id, (conv) => ({
      ...conv,
      updatedAt: now(),
      messages: conv.messages.map((msg) =>
        msg.id === msgId && msg.tool ? { ...msg, tool: updater(msg.tool) } : msg,
      ),
    }));
  };

  const runTool = async (msgId: number, tool: PendingTool) => {
    if (!active || tool.status !== "pending") return;
    if (!isTauri()) {
      updateTool(msgId, (current) => ({ ...current, status: "failed", error: "终端工具只在桌面端可用。" }));
      return;
    }
    updateTool(msgId, (current) => ({ ...current, status: "running", error: undefined }));
    try {
      const result = await invoke<TerminalCommandResult>("run_terminal_command", {
        request: { command: tool.command, cwd: tool.cwd || null, timeout_ms: 12_000 },
      });
      updateConversation(active.id, (conv) => ({
        ...conv,
        preview: "终端命令已返回输出",
        updatedAt: now(),
        messages: [
          ...conv.messages.map((msg) =>
            msg.id === msgId && msg.tool
              ? { ...msg, tool: { ...msg.tool, status: "completed" as const, result } }
              : msg,
          ),
          {
            id: nextId(),
            role: "ai",
            text: [
              "### 终端结果已返回",
              `命令退出码：\`${result.exit_code ?? "超时"}\`，用时 **${result.duration_ms}ms**。`,
              "",
              result.timed_out ? "命令超时，建议缩小范围后再试。" : "你可以继续让我解释输出，或基于结果生成下一步方案。",
            ].join("\n"),
            evidence: `Terminal · ${result.cwd}`,
            createdAt: now(),
          },
        ],
      }));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      updateTool(msgId, (current) => ({ ...current, status: "failed", error: message }));
    }
  };

  const declineTool = (msgId: number) => {
    updateTool(msgId, (current) => ({ ...current, status: "declined" }));
  };

  return (
    <div className="ai-shell">
      <aside className="ai-side">
        <div className="ai-side-head">
          <span className="mcard-eyebrow">会话历史</span>
          <button className="iconbtn ai-new-btn" onClick={startNewChat} aria-label="新建聊天" title="新建聊天">
            <Icon name="plus" size={16} />
          </button>
        </div>
        <div className="ai-conv-list">
          {conversations.map((c) => (
            <div
              key={c.id}
              role="button"
              tabIndex={0}
              className={`ai-conv${active?.id === c.id ? " active" : ""}`}
              onClick={() => setActiveConv(c.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setActiveConv(c.id);
                }
              }}
            >
              <span className="ichip" style={{ width: 28, height: 28 }}>
                <Icon name="chat" size={14} />
              </span>
              <span className="grow" style={{ minWidth: 0 }}>
                <span className="ai-conv-title">{c.title}</span>
                <span className="ai-conv-prev">{c.preview}</span>
              </span>
              <span className="ai-conv-actions">
                <span className="ai-conv-ts">{formatRelative(c.updatedAt)}</span>
                {conversations.length > 1 && (
                  <button
                    className="ai-conv-delete"
                    type="button"
                    title="删除会话"
                    onClick={(event) => {
                      event.stopPropagation();
                      removeConversation(c.id);
                    }}
                  >
                    <Icon name="x" size={12} />
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
      </aside>

      <section className="ai-main">
        <header className="ai-threadbar">
          <div className="ai-thread-title">
            <div className="ai-kicker">AI Butler · Agent Workspace</div>
            <h2>{active?.title || "新的诊断会话"}</h2>
          </div>
          <div className="ai-context-strip" aria-label="当前上下文">
            {contextCards.map((item) => (
              <span className="ai-context-pill" key={item.label} title={`${item.label} ${item.value}`}>
                <span>{item.label}</span>
                <b>{item.value}</b>
              </span>
            ))}
            <span className="ai-status-pill"><i />{isTauri() ? "桌面端" : "预览"}</span>
            <span className="ai-status-pill"><i />{apiReady ? "接口已配置" : "演示模式"}</span>
          </div>
        </header>

        {error && <div className="ai-banner"><Icon name="alert" size={15} /><span>{error}</span></div>}

        <div className="ai-scroll" ref={scrollRef}>
          {messages.map((m) => (
            <div key={m.id} className={`ai-msg ${m.role}`}>
              <div className="ai-avatar">
                {m.role === "ai" ? <Icon name="sparkles" size={15} /> : <Icon name="user" size={15} />}
              </div>
              <div className="ai-bubble">
                {m.role === "ai" ? (
                  <MarkdownRenderer content={m.text} className="ai-markdown" />
                ) : (
                  <p className="ai-text">{m.text}</p>
                )}
                {m.evidence && (
                  <div className="ai-evidence">
                    <Icon name="activity" size={12} />
                    <span>{m.evidence}</span>
                  </div>
                )}
                {m.reasoning && (
                  <details className="ai-reasoning">
                    <summary>已思考</summary>
                    <pre>{m.reasoning}</pre>
                  </details>
                )}
                {m.action && (
                  <ActionCard
                    action={m.action}
                    onApprove={() => resolveAction(m.id, "approved")}
                    onDecline={() => resolveAction(m.id, "declined")}
                  />
                )}
                {m.tool && (
                  <TerminalToolCard
                    tool={m.tool}
                    onRun={() => runTool(m.id, m.tool!)}
                    onDecline={() => declineTool(m.id)}
                  />
                )}
              </div>
            </div>
          ))}
          {thinking && <ThinkingMessage stage={stage} />}
        </div>

        <div className="ai-composer">
          <div className="ai-suggestions">
            {QUICK_ACTIONS.map((item) => (
              <button
                key={item.title}
                className="ai-chip ai-chip-strong"
                onClick={() => send(item.prompt)}
                disabled={thinking}
                title={item.desc}
              >
                {item.title}
              </button>
            ))}
            {SUGGESTIONS.map((s) => (
              <button key={s} className="ai-chip" onClick={() => send(s)} disabled={thinking}>{s}</button>
            ))}
          </div>
          <div className="ai-input-row">
            <textarea
              className="field ai-textarea"
              placeholder="描述现象、目标或限制，例如：风扇很响但我不想误删文件"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <button className="btn primary ai-send" onClick={() => send()} aria-label="发送" disabled={thinking || !input.trim()}>
              <Icon name="send" size={15} />
              <span>发送</span>
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};

const ThinkingMessage: React.FC<{ stage: AgentStage }> = ({ stage }) => {
  const labels: Record<AgentStage, string> = {
    observe: "读取上下文",
    reason: "整理判断",
    plan: "生成步骤",
    act: "等待确认边界",
  };
  return (
    <div className="ai-msg ai thinking">
      <div className="ai-avatar"><Icon name="sparkles" size={15} /></div>
      <div className="ai-bubble">
        <div className="agent-steps" aria-label="Agent 处理状态">
          {(Object.keys(labels) as AgentStage[]).map((key) => (
            <span key={key} className={key === stage ? "active" : ""}>{labels[key]}</span>
          ))}
        </div>
        <p className="ai-text muted">正在把系统状态、会话上下文和安全边界合在一起。</p>
      </div>
    </div>
  );
};

const ActionCard: React.FC<{
  action: PendingAction;
  onApprove: () => void;
  onDecline: () => void;
}> = ({ action, onApprove, onDecline }) => {
  const done = action.status !== "pending";
  return (
    <div className={`ai-action ${action.status}`}>
      <div className="ai-action-head">
        <Icon name="alert" size={14} />
        <span>{action.title}</span>
      </div>
      <ul className="ai-action-steps">
        {action.steps.map((s, i) => (
          <li key={i}>
            <span className="ai-step-dot" />
            {s}
          </li>
        ))}
      </ul>
      {done ? (
        <div className={`ai-action-result ${action.status}`}>
          <Icon name={action.status === "approved" ? "check" : "x"} size={13} />
          {action.status === "approved" ? "已确认。下一阶段会接入真实执行与可撤销日志。" : "已取消，未做任何改动"}
        </div>
      ) : (
        <div className="ai-action-btns">
          <button className="btn secondary sm" onClick={onDecline}>
            <Icon name="x" size={13} />取消
          </button>
          <button className="btn primary sm" onClick={onApprove}>
            <Icon name="check" size={13} />确认方案
          </button>
        </div>
      )}
    </div>
  );
};

const TerminalToolCard: React.FC<{
  tool: PendingTool;
  onRun: () => void;
  onDecline: () => void;
}> = ({ tool, onRun, onDecline }) => {
  const done = tool.status === "completed" || tool.status === "failed" || tool.status === "declined";
  return (
    <div className={`tool-card ${tool.status}`}>
      <div className="tool-card-head">
        <span className="ichip sm"><Icon name="command" size={13} /></span>
        <div className="grow">
          <div className="tool-title">{tool.title}</div>
          <div className="tool-meta">{tool.cwd || "默认工作目录"}</div>
        </div>
        <span className="pill flat">{tool.status === "running" ? "运行中" : tool.status === "completed" ? "已完成" : tool.status === "failed" ? "失败" : tool.status === "declined" ? "已取消" : "待确认"}</span>
      </div>
      <pre className="tool-command"><code>{tool.command}</code></pre>
      {tool.status === "pending" && (
        <div className="tool-warning">
          <Icon name="shield" size={13} />
          <span>命令会在本机终端环境中执行。已拦截高风险命令，但仍建议只运行诊断类命令。</span>
        </div>
      )}
      {tool.result && (
        <div className="tool-result">
          <div className="tool-result-meta">
            <span>退出码 <b>{tool.result.exit_code ?? "超时"}</b></span>
            <span>耗时 <RollingNumber value={tool.result.duration_ms} unit="ms" compact /></span>
          </div>
          {tool.result.stdout && <pre><code>{tool.result.stdout}</code></pre>}
          {tool.result.stderr && <pre className="stderr"><code>{tool.result.stderr}</code></pre>}
        </div>
      )}
      {tool.error && <div className="tool-error"><Icon name="alert" size={13} /><span>{tool.error}</span></div>}
      {!done && tool.status !== "running" && (
        <div className="ai-action-btns">
          <button className="btn secondary sm" onClick={onDecline}><Icon name="x" size={13} />取消</button>
          <button className="btn primary sm" onClick={onRun}><Icon name="command" size={13} />确认运行</button>
        </div>
      )}
      {tool.status === "running" && <div className="tool-running"><span />正在执行命令…</div>}
    </div>
  );
};
