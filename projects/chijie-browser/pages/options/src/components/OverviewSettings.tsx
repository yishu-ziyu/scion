/**
 * design/003 Screen B — Options overview for 持节.
 * Pipeline, model tier, approval policy, Skill note, receipt prefs, sites placeholder, privacy.
 */
import { useEffect, useState } from 'react';
import {
  type GeneralSettingsConfig,
  generalSettingsStore,
  DEFAULT_GENERAL_SETTINGS,
} from '@extension/storage';

type Backend = 'control' | 'nano';

export function OverviewSettings() {
  const [settings, setSettings] = useState<GeneralSettingsConfig>(DEFAULT_GENERAL_SETTINGS);
  const [externalApproval, setExternalApproval] = useState(true);
  const [draftForms, setDraftForms] = useState(true);
  const [forcePauseSubmit, setForcePauseSubmit] = useState(false);
  const [receiptScreenshot, setReceiptScreenshot] = useState(true);
  const [receiptUrl, setReceiptUrl] = useState(true);
  const [receiptTime, setReceiptTime] = useState(true);
  const [receiptId, setReceiptId] = useState(true);

  useEffect(() => {
    void generalSettingsStore.getSettings().then(setSettings);
  }, []);

  const backend = (settings.agentCoreBackend ?? 'control') as Backend;

  const setBackend = async (next: Backend) => {
    setSettings(prev => ({ ...prev, agentCoreBackend: next }));
    await generalSettingsStore.updateSettings({ agentCoreBackend: next });
    const latest = await generalSettingsStore.getSettings();
    setSettings(latest);
  };

  return (
    <section className="space-y-6" data-testid="options-overview">
      <header className="mb-2">
        <h2 className="text-xl font-semibold text-[var(--chijie-paper)]">总览</h2>
        <p className="mt-1 text-sm text-[var(--chijie-muted)]">
          持节 · 浏览器行动 Agent：委托 → 轮次 → 审批 → 完成回执
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 1. Pipeline */}
        <article className="chijie-settings-card" data-testid="overview-pipeline">
          <h3 className="mb-3 text-base font-medium">1. 总览</h3>
          <p className="mb-3 text-sm text-[var(--chijie-muted)]">默认工作方式</p>
          <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-[var(--chijie-foreground)]">
            <span className="rounded-full border border-[var(--chijie-border)] px-3 py-1">任务委托</span>
            <span className="text-[var(--chijie-muted)]">→</span>
            <span className="rounded-full border border-[var(--chijie-border)] px-3 py-1">轮次执行</span>
            <span className="text-[var(--chijie-muted)]">→</span>
            <span className="rounded-full border border-[var(--chijie-border)] px-3 py-1">审批</span>
            <span className="text-[var(--chijie-muted)]">→</span>
            <span className="rounded-full border border-[var(--chijie-border)] px-3 py-1">完成回执</span>
          </div>
          <ul className="space-y-2 text-sm text-[var(--chijie-foreground)]">
            <li>✓ 已启用侧栏</li>
            <li>✓ 外部提交需审批</li>
            <li>✓ 页面证据已开启</li>
          </ul>
        </article>

        {/* 2. Model */}
        <article className="chijie-settings-card" data-testid="overview-model">
          <h3 className="mb-3 text-base font-medium">2. 模型</h3>
          <div className="space-y-3 text-sm">
            <div>
              <div className="mb-1 text-[var(--chijie-muted)]">正式分配</div>
              <div className="rounded-md border border-[var(--chijie-border)] bg-[var(--chijie-surface-raised)] px-3 py-2">
                中等模型（平衡速度与成本）
              </div>
              <p className="mt-1 text-xs text-[var(--chijie-muted)]">正式准确率闸门使用中等模型，禁止仅用旗舰刷分。</p>
            </div>
            <div>
              <div className="mb-1 text-[var(--chijie-muted)]">执行核</div>
              <div className="flex gap-2">
                <button
                  type="button"
                  data-testid="backend-control"
                  data-active={backend === 'control' ? 'true' : 'false'}
                  className={`flex-1 rounded-full border px-3 py-2 text-sm ${
                    backend === 'control'
                      ? 'border-[var(--chijie-accent)] bg-[var(--chijie-accent)] text-[#fff8f0]'
                      : 'border-[var(--chijie-border)] text-[var(--chijie-foreground)]'
                  }`}
                  onClick={() => void setBackend('control')}>
                  control（默认）
                </button>
                <button
                  type="button"
                  data-testid="backend-nano"
                  data-active={backend === 'nano' ? 'true' : 'false'}
                  className={`flex-1 rounded-full border px-3 py-2 text-sm ${
                    backend === 'nano'
                      ? 'border-[var(--chijie-accent)] bg-[var(--chijie-accent)] text-[#fff8f0]'
                      : 'border-[var(--chijie-border)] text-[var(--chijie-foreground)]'
                  }`}
                  onClick={() => void setBackend('nano')}>
                  nano（可拔）
                </button>
              </div>
              <p className="mt-1 text-xs text-[var(--chijie-muted)]">对应 G6：执行核可切换，L4 契约不变。</p>
            </div>
          </div>
        </article>

        {/* 3. Approval */}
        <article className="chijie-settings-card" data-testid="overview-approval">
          <h3 className="mb-3 text-base font-medium">3. 审批</h3>
          <div className="space-y-4 text-sm">
            <ToggleRow
              label="对外提交前请求一次批准（推荐）"
              hint="提交到外部站点或发送前，请求您的批准。"
              checked={externalApproval}
              onChange={setExternalApproval}
              testId="toggle-external-approval"
            />
            <ToggleRow
              label="填写表单时可自动草稿"
              hint="根据上下文自动填充表单草稿，待您确认后提交。"
              checked={draftForms}
              onChange={setDraftForms}
              testId="toggle-draft-forms"
            />
            <ToggleRow
              label="提交前强制暂停"
              hint="在提交动作前暂停，等待您的明确批准。"
              checked={forcePauseSubmit}
              onChange={setForcePauseSubmit}
              testId="toggle-force-pause"
            />
            <div className="rounded-md border border-[#e8c48a] bg-[#fff6e8] p-3 text-[var(--chijie-paper-ink)]">
              <div className="text-xs font-medium opacity-70">审批预览</div>
              <div className="mt-1 text-sm">将向外部站点提交表单 · 供应商注册申请表</div>
              <div className="mt-2 flex gap-2">
                <span className="rounded-full bg-[var(--chijie-accent)] px-3 py-1 text-xs text-[#fff8f0]">批准一次</span>
                <span className="rounded-full border border-[var(--chijie-paper-ink)] px-3 py-1 text-xs">
                  拒绝 / 退回修改
                </span>
              </div>
            </div>
          </div>
        </article>

        {/* 4. Skill */}
        <article className="chijie-settings-card" data-testid="overview-skill">
          <h3 className="mb-3 text-base font-medium">4. Skill</h3>
          <p className="mb-3 text-sm text-[var(--chijie-muted)]">
            Skill 是<strong className="text-[var(--chijie-foreground)]">可验证任务配方</strong>
            （整条任务可重跑），不是原子工具开关墙。成功任务可在侧栏保存为本地 Skill。
          </p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--chijie-foreground)]">
            <li>保存：任务完成后「保存为可再运行」</li>
            <li>重跑：填新参数后再次委托</li>
            <li>不在此页陈列 Search / Extract 等 tool chip 作为主叙事</li>
          </ul>
        </article>

        {/* 5. Receipt */}
        <article className="chijie-settings-card" data-testid="overview-receipt">
          <h3 className="mb-3 text-base font-medium">5. 回执</h3>
          <div className="space-y-3 text-sm">
            <ToggleRow label="保留页面证据截图" checked={receiptScreenshot} onChange={setReceiptScreenshot} />
            <ToggleRow label="记录目标网址" checked={receiptUrl} onChange={setReceiptUrl} />
            <ToggleRow label="记录完成时间" checked={receiptTime} onChange={setReceiptTime} />
            <ToggleRow label="生成回执 ID" checked={receiptId} onChange={setReceiptId} />
            <div className="rounded-md border border-[var(--chijie-border)] bg-[var(--chijie-surface-raised)] p-3">
              <div className="text-xs text-[var(--chijie-muted)]">回执预览</div>
              <div className="mt-1 font-medium text-[var(--chijie-paper)]">已完成</div>
              <div className="mt-1 font-mono text-[11px] text-[var(--chijie-muted)]">RCPT-…（示例）</div>
            </div>
          </div>
        </article>

        {/* 6. Sites placeholder */}
        <article className="chijie-settings-card" data-testid="overview-sites">
          <h3 className="mb-3 text-base font-medium">6. 站点权限</h3>
          <p className="mb-3 text-sm text-[var(--chijie-muted)]">占位：不阻塞主路径。细粒度站点策略后续迭代。</p>
          <ul className="space-y-2 text-sm">
            <li className="flex justify-between border-b border-[var(--chijie-border)] py-2">
              <span>当前标签页登录态</span>
              <span className="text-emerald-400">使用中</span>
            </li>
            <li className="flex justify-between border-b border-[var(--chijie-border)] py-2">
              <span>未授权站点自动提交</span>
              <span className="text-[var(--chijie-accent)]">阻止</span>
            </li>
          </ul>
        </article>
      </div>

      {/* 7. Privacy full width */}
      <article className="chijie-settings-card" data-testid="overview-privacy">
        <h3 className="mb-2 text-base font-medium">7. 隐私</h3>
        <p className="text-sm leading-relaxed text-[var(--chijie-foreground)]">
          持节在您的登录会话中执行操作。我们不会在未经您批准的情况下向外部提交数据。所有任务与数据仅用于帮助您完成工作，不会用于模型训练或其他用途。您可随时在侧栏或设置中查看、导出或删除相关记录。
        </p>
        <p className="mt-2 text-xs text-[var(--chijie-muted)]">
          非聊天存储不保留表单原文、凭证或完整页面正文（G7）。
        </p>
      </article>
    </section>
  );
}

function ToggleRow(props: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  testId?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="font-medium text-[var(--chijie-foreground)]">{props.label}</div>
        {props.hint && <p className="mt-0.5 text-xs text-[var(--chijie-muted)]">{props.hint}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={props.checked}
        data-testid={props.testId}
        onClick={() => props.onChange(!props.checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
          props.checked ? 'bg-[var(--chijie-accent)]' : 'bg-[var(--chijie-border-strong)]'
        }`}>
        <span
          className={`absolute top-0.5 size-5 rounded-full bg-white transition-transform ${
            props.checked ? 'left-5' : 'left-0.5'
          }`}
        />
      </button>
    </div>
  );
}
