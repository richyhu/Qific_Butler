import React, { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Icon } from "../components/Icon";
import type { Theme } from "../App";

const KEYS = {
  apiUrl: "qific.openai_url",
  apiKey: "qific.openai_key",
  modelId: "qific.openai_model",
  autostart: "qific.autostart",
  proactive: "qific.proactive_alerts",
  betaIndex: "qific.beta_index",
};

interface TestResult {
  ok: boolean;
  content: string;
  reasoning?: string | null;
}

export const Settings: React.FC<{
  theme: Theme;
  onThemeToggle: () => void;
}> = ({ theme, onThemeToggle }) => {
  const [apiUrl, setApiUrl] = useState(() => localStorage.getItem(KEYS.apiUrl) ?? "https://api.openai.com/v1");
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(KEYS.apiKey) ?? "");
  const [modelId, setModelId] = useState(() => localStorage.getItem(KEYS.modelId) ?? "gpt-4.1-mini");
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testError, setTestError] = useState("");
  const [autostart, setAutostart] = useState(() => localStorage.getItem(KEYS.autostart) === "1");
  const [proactive, setProactive] = useState(() => localStorage.getItem(KEYS.proactive) === "1");
  const [betaIndex, setBetaIndex] = useState(() => localStorage.getItem(KEYS.betaIndex) === "1");

  const saveAi = () => {
    localStorage.setItem(KEYS.apiUrl, apiUrl.trim());
    localStorage.setItem(KEYS.apiKey, apiKey.trim());
    localStorage.setItem(KEYS.modelId, modelId.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  const testConnection = async () => {
    saveAi();
    setTesting(true);
    setTestResult(null);
    setTestError("");
    try {
      const result = await invoke<TestResult>("test_ai_connection", {
        apiUrl: apiUrl.trim(),
        apiKey: apiKey.trim(),
        modelId: modelId.trim(),
      });
      setTestResult(result);
    } catch (e) {
      setTestError(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  };

  const togglePersist = (
    key: string,
    val: boolean,
    setter: React.Dispatch<React.SetStateAction<boolean>>
  ) => {
    localStorage.setItem(key, val ? "1" : "0");
    setter(val);
  };

  return (
    <div className="stack settings-shell">
      <section className="panel">
        <div className="panel-head soft-head">
          <span className="ichip"><Icon name="sparkles" size={16} /></span>
          <div>
            <div className="title">AI 接口</div>
            <div className="meta">OpenAI 标准兼容接口；配置只保存在本地</div>
          </div>
        </div>
        <div className="panel-body stack" style={{ gap: 12 }}>
          <Row label="API URL" desc="填写基础地址，例如 https://api.openai.com/v1；也支持直接填 /chat/completions。">
            <input className="field settings-field" value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} placeholder="https://api.openai.com/v1" />
          </Row>
          <Row label="API Key" desc="用于后台代理请求，不会上传到除你填写的接口以外的地方。">
            <div className="ai-input-row settings-field">
              <input className="field" type={showKey ? "text" : "password"} value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." />
              <button className="btn secondary sm" onClick={() => setShowKey((s) => !s)} title={showKey ? "隐藏" : "显示"}>
                <Icon name={showKey ? "x" : "search"} size={14} />
              </button>
            </div>
          </Row>
          <Row label="模型 ID" desc="例如 gpt-4.1-mini、deepseek-reasoner、qwen3 等。">
            <input className="field settings-field" value={modelId} onChange={(e) => setModelId(e.target.value)} placeholder="gpt-4.1-mini" />
          </Row>

          <div className="settings-actions">
            {saved && <span className="pill ok"><Icon name="check" size={12} />已保存</span>}
            <button className="btn secondary sm" onClick={saveAi}><Icon name="check" size={14} />保存</button>
            <button className="btn primary sm" onClick={testConnection} disabled={testing || !apiUrl.trim() || !apiKey.trim() || !modelId.trim()}>
              <Icon name="activity" size={14} />{testing ? "检测中" : "检测接口"}
            </button>
          </div>

          {(testResult || testError) && (
            <div className={`test-result ${testResult?.ok ? "ok" : "warn"}`}>
              <div className="test-result-head">
                <Icon name={testResult?.ok ? "check" : "alert"} size={14} />
                <span>{testResult?.ok ? "接口可用" : "检测失败"}</span>
              </div>
              {testResult?.content && <p>{testResult.content}</p>}
              {testResult?.reasoning && (
                <div className="reasoning-box">
                  <span>思考标签</span>
                  <pre>{testResult.reasoning}</pre>
                </div>
              )}
              {testError && <p>{testError}</p>}
            </div>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head soft-head">
          <span className="ichip"><Icon name="sun" size={16} /></span>
          <div>
            <div className="title">外观</div>
            <div className="meta">主题会即时切换并记住你的偏好</div>
          </div>
        </div>
        <div className="panel-body">
          <Row label="主题模式" desc="暗色为推荐外观，界面保持柔和低干扰。">
            <button className="btn secondary sm" onClick={onThemeToggle}>
              <Icon name={theme === "dark" ? "sun" : "moon"} size={14} />
              {theme === "dark" ? "切换到亮色" : "切换到暗色"}
            </button>
          </Row>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head soft-head">
          <span className="ichip"><Icon name="settings" size={16} /></span>
          <div>
            <div className="title">行为</div>
            <div className="meta">控制管家在后台如何工作</div>
          </div>
        </div>
        <div className="panel-body stack" style={{ gap: 4 }}>
          <Toggle label="开机自启动" desc="登录系统时自动在后台运行管家" checked={autostart} onChange={(v) => togglePersist(KEYS.autostart, v, setAutostart)} />
          <Toggle label="异常主动提醒" desc="CPU/内存持续过高时通过系统通知提醒你" checked={proactive} onChange={(v) => togglePersist(KEYS.proactive, v, setProactive)} />
          <Toggle label="实验性：后台增量索引（Beta）" desc="文件变更时自动增量更新索引" checked={betaIndex} onChange={(v) => togglePersist(KEYS.betaIndex, v, setBetaIndex)} />
        </div>
      </section>
    </div>
  );
};

const Row: React.FC<{ label: string; desc?: string; children: React.ReactNode }> = ({ label, desc, children }) => (
  <div className="st-row">
    <div className="col" style={{ gap: 2, minWidth: 0 }}>
      <span className="st-label">{label}</span>
      {desc && <span className="muted" style={{ fontSize: 12 }}>{desc}</span>}
    </div>
    <div className="row settings-control">{children}</div>
  </div>
);

const Toggle: React.FC<{ label: string; desc?: string; checked: boolean; onChange: (v: boolean) => void }> = ({ label, desc, checked, onChange }) => (
  <div className="st-row">
    <div className="col" style={{ gap: 2 }}>
      <span className="st-label">{label}</span>
      {desc && <span className="muted" style={{ fontSize: 12 }}>{desc}</span>}
    </div>
    <button className="toggle" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} />
  </div>
);

