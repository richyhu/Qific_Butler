import { useState, useEffect, useCallback } from "react";
import "./App.css";
import "./components/Button.css";

import { Icon, IconName } from "./components/Icon";
import { Dashboard } from "./sections/Dashboard";
import { AIAssistant } from "./sections/AIAssistant";
import { FileManager } from "./sections/FileManager";
import { Cleanup } from "./sections/Cleanup";
import { Settings } from "./sections/Settings";
import { isTauri } from "./sections/sys";
import { APP_LOGO_DARK, APP_LOGO_LIGHT, APP_NAME } from "./brand";

export type TabId = "dashboard" | "chat" | "files" | "cleanup" | "settings";
export type Theme = "dark" | "light";

interface NavItem {
  id: TabId;
  label: string;
  icon: IconName;
  hint: string;
}

const NAV: { primary: NavItem[]; secondary: NavItem[] } = {
  primary: [
    { id: "dashboard", label: "系统监控", icon: "activity", hint: "实时资源与进程" },
    { id: "chat", label: "AI 助手", icon: "sparkles", hint: "对话式诊断与修复" },
    { id: "files", label: "文件管理", icon: "folder", hint: "智能索引与搜索" },
    { id: "cleanup", label: "智能清理", icon: "broom", hint: "AI 规划安全清理" },
  ],
  secondary: [
    { id: "settings", label: "设置", icon: "settings", hint: "偏好与 API Key" },
  ],
};

const THEME_KEY = "qific.theme";

function App() {
  const [activeTab, setActiveTab] = useState<TabId>("dashboard");
  const [newChatNonce, setNewChatNonce] = useState(0);
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem(THEME_KEY) as Theme | null;
    // default to dark — matches the product's reference design kit
    return saved ?? "dark";
  });

  // reflect theme on <html> so the .dark CSS variable set takes effect
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  }, []);

  const openNewChat = useCallback(() => {
    setActiveTab("chat");
    setNewChatNonce(Date.now());
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openNewChat();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openNewChat]);

  const allItems = [...NAV.primary, ...NAV.secondary];
  const current = allItems.find((n) => n.id === activeTab)!;
  const appLogo = theme === "dark" ? APP_LOGO_DARK : APP_LOGO_LIGHT;

  return (
    <div className="app-shell">
      {/* ---------- Sidebar ---------- */}
      <aside className="sidebar">
        <div className="sb-brand">
          <img className="sb-logo sb-logo-img" src={appLogo} alt={`${APP_NAME} logo`} />
          <div className="col" style={{ gap: 0 }}>
            <span className="sb-name">{APP_NAME}</span>
            <span className="sb-tag">AI 电脑管家</span>
          </div>
        </div>

        <button
          className="sb-newchat"
          onClick={openNewChat}
          aria-label="开始新对话"
        >
          <Icon name="plus" size={16} />
          <span>问 AI 管家</span>
          <kbd>⌘K</kbd>
        </button>

        <nav className="sb-nav">
          <p className="sb-group-label">主要功能</p>
          {NAV.primary.map((item) => (
            <NavButton
              key={item.id}
              item={item}
              active={activeTab === item.id}
              onClick={() => setActiveTab(item.id)}
            />
          ))}
        </nav>

        <nav className="sb-nav sb-footer">
          {NAV.secondary.map((item) => (
            <NavButton
              key={item.id}
              item={item}
              active={activeTab === item.id}
              onClick={() => setActiveTab(item.id)}
            />
          ))}
        </nav>
      </aside>

      {/* ---------- Main ---------- */}
      <main className="main">
        <header className="topbar">
          <div className="section-head" style={{ marginBottom: 0, flex: 1 }}>
            <div>
              <div className="eyebrow-line">{current.hint}</div>
              <h1>{current.label}</h1>
            </div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <div className={`topbar-status ${isTauri() ? "ok" : "warn"}`}>
              <span />
              {isTauri() ? "桌面端" : "预览模式"}
            </div>
            <button className="iconbtn" onClick={toggleTheme} aria-label="切换主题" title="切换明暗主题">
              <Icon name={theme === "dark" ? "sun" : "moon"} size={17} />
            </button>
          </div>
        </header>

        <div className="content">
          {activeTab === "dashboard" && <Dashboard theme={theme} />}
          {activeTab === "chat" && <AIAssistant theme={theme} newChatNonce={newChatNonce} />}
          {activeTab === "files" && <FileManager />}
          {activeTab === "cleanup" && <Cleanup />}
          {activeTab === "settings" && (
            <Settings theme={theme} onThemeToggle={toggleTheme} />
          )}
        </div>
      </main>
    </div>
  );
}

const NavButton: React.FC<{
  item: NavItem;
  active: boolean;
  onClick: () => void;
}> = ({ item, active, onClick }) => (
  <button
    className={`sb-item${active ? " active" : ""}`}
    onClick={onClick}
    title={item.hint}
  >
    <Icon name={item.icon} size={17} />
    <span className="sb-item-label">{item.label}</span>
    {active && <span className="sb-item-dot" />}
  </button>
);

export default App;
