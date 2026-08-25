/** Options overview. The only persisted control here is agentCoreBackend. */
import { useEffect, useState } from 'react';
import { type GeneralSettingsConfig, generalSettingsStore, DEFAULT_GENERAL_SETTINGS } from '@extension/storage';

type Backend = 'control' | 'nano';

export function OverviewSettings({
  onOpenModels,
  onOpenFirewall,
}: {
  onOpenModels: () => void;
  onOpenFirewall: () => void;
}) {
  const [settings, setSettings] = useState<GeneralSettingsConfig>(DEFAULT_GENERAL_SETTINGS);

  useEffect(() => {
    void generalSettingsStore.getSettings().then(setSettings);
  }, []);

  const backend = (settings.agentCoreBackend ?? 'control') as Backend;

  const setBackend = async (next: Backend) => {
    setSettings(prev => ({ ...prev, agentCoreBackend: next }));
    await generalSettingsStore.updateSettings({ agentCoreBackend: next });
    setSettings(await generalSettingsStore.getSettings());
  };

  return (
    <section className="chijie-options-stack" data-testid="options-overview">
      <header className="chijie-options-block">
        <h2>总览</h2>
        <p className="chijie-settings-muted">改密钥、执行方式和隐私。任务怎么跑，在侧栏里看。</p>
      </header>

      <article className="chijie-options-block" data-testid="overview-pipeline">
        <h3>怎么工作</h3>
        <p>你在侧栏发一句任务。持节在相关标签页上执行，做完把结果写回侧栏。默认不把你正在用的窗口抢到前台。</p>
      </article>

      <article className="chijie-options-block" data-testid="overview-model">
        <h3>执行核</h3>
        <p className="chijie-settings-muted">多数任务用默认即可。密钥和模型名在「模型」里改。</p>
        <div className="chijie-segment" role="group" aria-label="执行核">
          <button
            type="button"
            data-testid="backend-control"
            data-active={String(backend === 'control')}
            onClick={() => void setBackend('control')}>
            默认（control）
          </button>
          <button
            type="button"
            data-testid="backend-nano"
            data-active={String(backend === 'nano')}
            onClick={() => void setBackend('nano')}>
            轻量（nano）
          </button>
        </div>
        <button type="button" className="chijie-options-link" onClick={onOpenModels}>
          打开模型
        </button>
      </article>

      <article className="chijie-options-block" data-testid="overview-skill">
        <h3>Skill</h3>
        <p>
          Skill 是<strong>可验证任务配方</strong>
          ：整条任务可重跑，不是工具开关墙。任务成功后，在侧栏保存；下次改参数再委托。
        </p>
      </article>

      <article className="chijie-options-block" data-testid="overview-receipt">
        <h3>回执</h3>
        <p>任务完成后，侧栏给出结果和打开过的页。不另发回执编号。</p>
      </article>

      <article className="chijie-options-block" data-testid="overview-sites">
        <h3>站点权限</h3>
        <p>域名允许和拒绝在「防火墙」。细粒度站点策略还不在这页。</p>
        <button type="button" className="chijie-options-link" onClick={onOpenFirewall}>
          打开防火墙
        </button>
      </article>

      <article className="chijie-options-block" data-testid="overview-privacy">
        <h3>隐私</h3>
        <p>
          持节在你的登录会话里操作。不会在你没同意时把数据交到外面，也不会拿任务去训练模型。非聊天存储不保留表单原文、凭证或整页正文。
        </p>
      </article>
    </section>
  );
}
