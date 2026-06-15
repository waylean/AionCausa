import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import {
  Activity,
  CheckCircle2,
  CircleDot,
  Gauge,
  GitBranch,
  KeyRound,
  Map as MapIcon,
  MessageSquare,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Send,
  Settings,
  ShieldAlert,
  Sparkles,
  Trash2,
  Users,
} from 'lucide-react';
import clsx from 'clsx';
import { createDraftWorld, createSimulationWorld, summarizeEventText } from './domain/simulator';
import {
  advanceRuntimeWorld,
  applyRuntimeEvents,
  buildActorVisibleContexts,
  buildFocusedPressureThreadContext,
  buildRuntimeActorLedgers,
  buildRuntimeConfrontationScenes,
  buildRuntimeDialogueExchanges,
  buildRuntimeObservationFlow,
  buildRuntimePressureThreads,
  buildRuntimeReactionChains,
  buildRuntimePulseSlices,
  buildRuntimeRelations,
  continueRuntimeWorld,
  createRuntimeWorld,
} from './domain/worldRuntime';
import type {
  AgentProfile,
  AgentActionLog,
  HorizonMode,
  RuntimeActor,
  RuntimeActorContext,
  RuntimeActorLedger,
  RuntimeActorRelation,
  RuntimeAgentSignal,
  RuntimeConvergence,
  RuntimeConfrontationScene,
  RuntimeDialogueExchange,
  RuntimeEventType,
  RuntimeFocusedThreadContext,
  RuntimeObservationFlowFrame,
  RuntimePulseSlice,
  RuntimePressureThread,
  RuntimeReactionChain,
  RuntimeVisibility,
  RuntimeWorld,
  RuntimeWorldEvent,
  SimulationBranch,
  SimulationWorld,
} from './domain/types';
import {
  applyPreset,
  defaultProviderConfig,
  providerPresets,
  testProviderConnection,
  type ProviderConfig,
  type ProviderTestResult,
} from './services/providers';
import { deleteWorldArchive, listWorldArchives, loadWorldArchive, saveWorldArchive, type WorldArchiveSummary } from './services/archives';
import { requestActorPerspectivePulse, requestRuntimePulse } from './services/runtime';
import { generateSimulationWorld, requestWorldPreflight, type WorldPreflightResult } from './services/simulation';
import { polishInterviewAnswer, requestAgentInterview } from './services/interview';
import { requestWorldSummary } from './services/summary';

const starterPrompt = '如果商鞅变法之后，商鞅没有被杀，秦国会如何发展？';
const fixedGenerationHorizon: HorizonMode = 'strategic';
const agentColors = ['#6ee7c8', '#72b8ff', '#f4b86a', '#c6a7ff', '#f4dd72', '#f08aa4', '#7fd8ff', '#9ee493'];
const generationStages = [
  '解析中心事件与显性假设',
  '补全背景记忆与争议点',
  '铸造具体人物 Agent',
  '推演人物互动与世界线',
  '校验行动日志与时间节点',
  '启动世界观察室运行态',
];

type AppView = 'provider' | 'query' | 'world';
type WorkbenchPage = 'overview' | 'confrontation' | 'actors' | 'timeline' | 'evidence' | 'archive';

const workbenchPageMeta = [
  { id: 'overview', label: '世界总览', hint: '状态、幕序与压力线', Icon: Activity },
  { id: 'confrontation', label: '冲突观察', hint: '人物对话与直接交锋', Icon: ShieldAlert },
  { id: 'actors', label: '人物档案', hint: 'Agent 记忆、意图与行动账本', Icon: Users },
  { id: 'timeline', label: '时间线', hint: '分叉节点与行动记录', Icon: MapIcon },
  { id: 'evidence', label: '证据层', hint: '输入、假设与置信来源', Icon: Gauge },
  { id: 'archive', label: '世界档案', hint: '运行日志与收束状态', Icon: GitBranch },
] satisfies Array<{ id: WorkbenchPage; label: string; hint: string; Icon: typeof Activity }>;

interface QaHistoryRecord {
  id: string;
  createdAt: string;
  agentName: string;
  question: string;
  answer: string;
  worldTitle?: string;
  centerEvent?: string;
}

function normalizeHistoryKey(value?: string) {
  return String(value || '').replace(/\s+/g, '').trim();
}

function isHistoryRecordForWorld(record: QaHistoryRecord, world: SimulationWorld, runtimeWorld: RuntimeWorld, eventText: string) {
  const currentKeys = [world.eventText, runtimeWorld.centerEvent, eventText, world.centralQuestion].map(normalizeHistoryKey).filter(Boolean);
  const recordKey = normalizeHistoryKey(record.centerEvent);
  if (!recordKey) return false;
  return currentKeys.some((key) => key === recordKey);
}

function Hourglass({ compact = false }: { compact?: boolean }) {
  return (
    <div className={clsx('hourglass', compact && 'hourglass-compact')} aria-hidden="true">
      <span className="hourglass-frame" />
      <span className="sand sand-top" />
      <span className="sand-stream" />
      <span className="sand sand-bottom" />
    </div>
  );
}

function AionBackdrop() {
  return (
    <div className="aion-backdrop" aria-hidden="true">
      <div className="backdrop-sandfield" />
      <div className="backdrop-grid" />
      <div className="backdrop-causality">
        <span className="cause-node cause-node-root" />
        <span className="cause-node cause-node-left" />
        <span className="cause-node cause-node-right" />
        <span className="cause-node cause-node-low" />
      </div>
      <div className="backdrop-branches">
        <span />
        <span />
        <span />
        <span />
      </div>
      <div className="backdrop-contours">
        <span />
        <span />
        <span />
      </div>
      <div className="backdrop-orbit orbit-one" />
      <div className="backdrop-orbit orbit-two" />
    </div>
  );
}

function BrandTitle({ compact = false }: { compact?: boolean }) {
  return (
    <div className={clsx('brand-title', compact && 'brand-title-compact')}>
      <strong>AionCausa</strong>
      <span>因时沙盘</span>
    </div>
  );
}

function ProviderFields({
  provider,
  providerResult,
  isTesting,
  onProviderChange,
  onProviderTest,
}: {
  provider: ProviderConfig;
  providerResult: ProviderTestResult | null;
  isTesting: boolean;
  onProviderChange: (next: ProviderConfig) => void;
  onProviderTest: () => void;
}) {
  return (
    <div className="provider-fields">
      <label className="field-block compact">
        <span>Provider</span>
        <select value={provider.presetId} onChange={(event) => onProviderChange(applyPreset(provider, event.target.value))}>
          {providerPresets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field-block compact">
        <span>Base URL</span>
        <input value={provider.baseUrl} onChange={(event) => onProviderChange({ ...provider, baseUrl: event.target.value })} />
      </label>
      <label className="field-block compact">
        <span>Model</span>
        <input value={provider.model} onChange={(event) => onProviderChange({ ...provider, model: event.target.value })} />
      </label>
      <label className="field-block compact">
        <span>API Key</span>
        <input
          type="password"
          value={provider.apiKey}
          onChange={(event) => onProviderChange({ ...provider, apiKey: event.target.value })}
          placeholder="sk-..."
        />
      </label>
      <button className="secondary-action" disabled={isTesting} onClick={onProviderTest} type="button">
        {isTesting ? <RefreshCw className="spin" size={17} /> : <CheckCircle2 size={17} />}
        <span>测试连接</span>
      </button>
      {providerResult && (
        <p className={clsx('provider-result', providerResult.ok ? 'is-ok' : 'is-error')}>
          {providerResult.message}
          {providerResult.latencyMs ? ` · ${providerResult.latencyMs}ms` : ''}
        </p>
      )}
    </div>
  );
}

function ProviderSetupScreen({
  provider,
  providerResult,
  isTesting,
  onProviderChange,
  onProviderTest,
  onContinue,
}: {
  provider: ProviderConfig;
  providerResult: ProviderTestResult | null;
  isTesting: boolean;
  onProviderChange: (next: ProviderConfig) => void;
  onProviderTest: () => void;
  onContinue: () => void;
}) {
  return (
    <main className="screen-shell center-screen">
      <AionBackdrop />
      <section className="glass-panel provider-setup-panel">
        <BrandTitle />
        <div className="panel-kicker">
          <KeyRound size={17} />
          <span>模型接入</span>
        </div>
        <ProviderFields
          isTesting={isTesting}
          onProviderChange={onProviderChange}
          onProviderTest={onProviderTest}
          provider={provider}
          providerResult={providerResult}
        />
        <button className="primary-action" disabled={!provider.apiKey.trim()} onClick={onContinue} type="button">
          <Sparkles size={18} />
          <span>进入事件问询</span>
        </button>
      </section>
    </main>
  );
}

function EventQueryScreen({
  archiveSummaries,
  eventText,
  generationMessage,
  isPreflighting,
  isGenerating,
  preflightResult,
  onEventChange,
  onPreflight,
  onGenerate,
  onOpenProvider,
  onOpenArchive,
  onDeleteArchive,
  onRefreshArchives,
}: {
  archiveSummaries: WorldArchiveSummary[];
  eventText: string;
  generationMessage: string;
  isPreflighting: boolean;
  isGenerating: boolean;
  preflightResult: WorldPreflightResult | null;
  onEventChange: (next: string) => void;
  onPreflight: () => void;
  onGenerate: () => void;
  onOpenProvider: () => void;
  onOpenArchive: (id: string) => void;
  onDeleteArchive: (id: string) => void;
  onRefreshArchives: () => void;
}) {
  return (
    <main className="screen-shell query-screen">
      <AionBackdrop />
      <button className="icon-top-action" onClick={onOpenProvider} title="模型接入" type="button">
        <Settings size={18} />
      </button>
      <section className="query-panel">
        <BrandTitle />
        <label className="event-input-block">
          <span>中心事件</span>
          <textarea value={eventText} onChange={(event) => onEventChange(event.target.value)} />
        </label>
        <div className="query-action-row">
          <button className="secondary-action query-preflight" disabled={!eventText.trim() || isGenerating || isPreflighting} onClick={onPreflight} type="button">
            {isPreflighting ? <RefreshCw className="spin" size={17} /> : <Gauge size={17} />}
            <span>{isPreflighting ? '分析中' : '分析可创建性'}</span>
          </button>
          <button className="primary-action query-submit" disabled={!eventText.trim() || isGenerating || isPreflighting} onClick={onGenerate} type="button">
            {isGenerating ? <Hourglass compact /> : <Play size={18} />}
            <span>{isGenerating ? '生成中' : '生成沙盘'}</span>
          </button>
        </div>
        {preflightResult ? (
          <section className={clsx('preflight-panel', preflightResult.canSimulate ? 'is-pass' : 'is-blocked')}>
            <div className="preflight-head">
              <span>{preflightResult.canSimulate ? '可以创建世界' : '暂不建议创建'}</span>
              <em>{Math.round(preflightResult.confidence * 100)}%</em>
            </div>
            <strong>{preflightResult.eventSummary || '创建前分析'}</strong>
            <p>{preflightResult.message}</p>
            {preflightResult.reasons.length ? <small>依据：{preflightResult.reasons.slice(0, 2).join('；')}</small> : null}
            {preflightResult.missing.length ? <small>缺失：{preflightResult.missing.slice(0, 3).join('；')}</small> : null}
            {preflightResult.suggestedActors.length ? (
              <div className="preflight-actors">
                {preflightResult.suggestedActors.slice(0, 6).map((actor) => (
                  <span key={`${actor.name}-${actor.role}`}>{actor.name}</span>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}
        <div className={clsx('generation-console', isGenerating && 'is-running')}>
          {isGenerating ? <Hourglass compact /> : <CircleDot size={16} />}
          <span>{generationMessage}</span>
        </div>
        <section className="world-archive-panel">
          <div className="qa-history-head">
            <span>最近世界</span>
            <button onClick={onRefreshArchives} type="button">
              刷新
            </button>
          </div>
          {archiveSummaries.length ? (
            <div className="world-archive-list">
              {archiveSummaries.map((record) => (
                <article className="world-archive-item" key={record.id}>
                  <button className="world-archive-open" onClick={() => onOpenArchive(record.id)} type="button">
                    <strong>{record.title}</strong>
                    <span>{record.centerEvent || record.phase || 'AionCausa 世界档案'}</span>
                    <small>
                      {displayRuntimePhase(record.phase, record.pulse) || '观察室'} · {Math.round((record.confidence ?? 0) * 100)}%
                    </small>
                  </button>
                  <button
                    className="world-archive-delete"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDeleteArchive(record.id);
                    }}
                    title="删除这个世界"
                    type="button"
                  >
                    <Trash2 size={15} />
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state compact-empty">暂无世界档案</div>
          )}
        </section>
      </section>
    </main>
  );
}

function buildAnalysisParagraph(world: ReturnType<typeof createDraftWorld>) {
  const facts = world.eventAnalysis.facts.slice(0, 2).join('；');
  const assumptions = world.eventAnalysis.assumptions.slice(0, 2).join('；');
  const causes = world.eventAnalysis.causes.slice(0, 2).join('；');
  return [facts, assumptions ? `关键假设是：${assumptions}` : '', causes ? `主要因果压力来自：${causes}` : '']
    .filter(Boolean)
    .join('。');
}

function AgentRoster({ agents }: { agents: AgentProfile[] }) {
  if (!agents.length) return <div className="empty-state compact-empty">尚未生成具体人物</div>;
  return (
    <div className="agent-roster">
      {agents.map((agent, index) => (
        <button className="agent-chip" key={agent.id} style={{ '--agent-color': agentColors[index % agentColors.length] } as CSSProperties} type="button">
          <span>{agent.name}</span>
          <div className="agent-popover">
            <strong>{agent.name}</strong>
            <small>{agent.identity || agent.role}</small>
            <p>{agent.dilemma || agent.currentPressure || agent.goals.slice(0, 2).join(' / ')}</p>
            {agent.actions?.[0] ? <em>{agent.actions[0]}</em> : null}
          </div>
        </button>
      ))}
    </div>
  );
}

function BranchSummary({ branch }: { branch: SimulationBranch | null }) {
  if (!branch) return <div className="empty-state compact-empty">尚未生成世界线</div>;
  return (
    <div className="branch-compact">
      <strong>{branch.title}</strong>
      <p>{branch.summary}</p>
      <span>{Math.round(branch.credibility * 100)}% 可信度</span>
    </div>
  );
}

const runtimeEventLabels: Record<RuntimeEventType, string> = {
  speech: '发言',
  move: '行动',
  conflict: '冲突',
  alliance: '结盟',
  betrayal: '背叛',
  death: '死亡/退出',
  policy: '规则变化',
  rumor: '传闻',
  convergence: '收束',
};

function displayRuntimePhase(phase: string, pulse?: number) {
  const normalized = String(phase || '').trim();
  const flowMatch = normalized.match(/^(?:观察流|观察脉冲|脉冲)\s*(\d+)$/u);
  if (flowMatch) return `第 ${Number(flowMatch[1]) + 1} 幕`;
  if (!normalized && typeof pulse === 'number' && pulse >= 0) return `第 ${pulse + 1} 幕`;
  return normalized;
}

function sceneNumberFromPulse(pulse: number) {
  return Math.max(1, Number(pulse || 0) + 1);
}

function withGenerationTime(message: string, latencyMs?: number) {
  return latencyMs ? `${message}。生成时间：${latencyMs}ms` : message;
}

function displayGenerationMessage(message: string) {
  return String(message || '')
    .replace(/\s*(?:路|·)\s*(\d+)ms/gu, '。生成时间：$1ms')
    .replace(/。{2,}/g, '。');
}

function metricPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function statusLabel(status: RuntimeActor['status']) {
  const labels: Record<RuntimeActor['status'], string> = {
    alive: '在场',
    dead: '死亡',
    exiled: '流放',
    imprisoned: '囚禁',
    missing: '失踪',
    retired: '退隐',
    disgraced: '失权',
    underground: '转入地下',
  };
  return labels[status];
}

function ledgerKindLabel(kind: RuntimeActorLedger['entries'][number]['kind']) {
  const labels: Record<RuntimeActorLedger['entries'][number]['kind'], string> = {
    event: '事件',
    signal: '谋划',
    dialogue: '交锋',
    pressure: '压力',
    status: '状态',
  };
  return labels[kind];
}

function confrontationSourceLabel(source: RuntimeConfrontationScene['source']) {
  const labels: Record<RuntimeConfrontationScene['source'], string> = {
    dialogue: '对话',
    reaction: '反应',
    pressure: '压力',
    event: '事件',
  };
  return labels[source];
}

function RuntimeActorBoard({ actors }: { actors: RuntimeActor[] }) {
  if (!actors.length) return <div className="empty-state compact-empty">等待 Agent 进入世界</div>;
  return (
    <div className="runtime-actor-board">
      {actors.map((actor, index) => (
        <article
          className={clsx('runtime-actor-card', actor.status !== 'alive' && 'is-inactive')}
          key={actor.id}
          style={{ '--agent-color': agentColors[index % agentColors.length] } as CSSProperties}
        >
          <div>
            <strong>{actor.name}</strong>
            <span>{actor.faction}</span>
          </div>
          <small>{statusLabel(actor.status)}</small>
          <p>{actor.intent}</p>
          <div className="actor-meter" style={{ '--actor-risk': `${Math.round(actor.risk * 100)}%` } as CSSProperties} />
        </article>
      ))}
    </div>
  );
}

function ActorLedgerBoard({ ledgers }: { ledgers: RuntimeActorLedger[] }) {
  if (!ledgers.length) return <div className="empty-state compact-empty">等待人物生命线生成</div>;
  return (
    <div className="actor-ledger-board">
      {ledgers.slice(0, 6).map((ledger) => {
        const latestKinds = Array.from(new Set(ledger.entries.slice(0, 4).map((entry) => entry.kind)));
        return (
          <article className={clsx('actor-ledger-card', ledger.actor.status !== 'alive' && 'is-inactive')} key={ledger.actor.id}>
            <div className="actor-ledger-head">
              <div>
                <strong>{ledger.actor.name}</strong>
                <span>{ledger.knownActorIds.length} 个牵连人物</span>
              </div>
              <b>{metricPercent(ledger.riskScore)}</b>
            </div>
            <p>{ledger.statusSummary}</p>
            <em>{ledger.lastActionSummary}</em>
            <div className="actor-ledger-tags">
              <span>{metricPercent(ledger.influenceScore)} 影响</span>
              {latestKinds.map((kind) => (
                <small key={kind}>{ledgerKindLabel(kind)}</small>
              ))}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function AgentSignalBoard({ signals, actors }: { signals: RuntimeAgentSignal[]; actors: RuntimeActor[] }) {
  const latestSignals = signals.slice(0, 8);
  if (!latestSignals.length) return <div className="empty-state compact-empty">等待 Agent 读入世界信号</div>;
  return (
    <div className="agent-signal-board">
      {latestSignals.map((signal) => {
        const actor = actors.find((item) => item.id === signal.actorId);
        const targets = signal.targetActorIds
          .map((id) => actors.find((item) => item.id === id)?.name)
          .filter(Boolean)
          .join('、');
        return (
          <article className="agent-signal-card" key={signal.id}>
            <div>
              <strong>{signal.actorName || actor?.name}</strong>
              <span>{signal.visibility}</span>
            </div>
            <p>{signal.privateIntent}</p>
            <em>{signal.plannedAction}</em>
            {targets ? <small>指向：{targets}</small> : null}
          </article>
        );
      })}
    </div>
  );
}

function InfoBusBoard({ contexts }: { contexts: RuntimeActorContext[] }) {
  return (
    <div className="info-bus-board">
      {contexts.slice(0, 6).map((context) => (
        <article key={context.actorId}>
          <div>
            <strong>{context.actorName}</strong>
            <span>{context.faction}</span>
          </div>
          <p>
            可见 {context.visibleEventIds.length + context.visibleSignalIds.length} 条 · 隐藏 {context.hiddenCount} 条
          </p>
        </article>
      ))}
    </div>
  );
}

function AgentPerspectivePanel({
  actors,
  contexts,
  isPulsingPerspective,
  onPulsePerspective,
  selectedActorId,
  onSelectedActorChange,
}: {
  actors: RuntimeActor[];
  contexts: RuntimeActorContext[];
  isPulsingPerspective: boolean;
  onPulsePerspective: (actorId: string) => void;
  selectedActorId: string;
  onSelectedActorChange: (next: string) => void;
}) {
  const selectedContext = contexts.find((context) => context.actorId === selectedActorId) ?? contexts[0];
  const selectedActor = actors.find((actor) => actor.id === selectedContext?.actorId);
  if (!selectedContext) return <div className="empty-state compact-empty">等待 Agent 视角生成</div>;

  return (
    <div className="agent-perspective-panel">
      <div className="perspective-switcher">
        {contexts.slice(0, 6).map((context) => (
          <button
            className={clsx(context.actorId === selectedContext.actorId && 'is-active')}
            key={context.actorId}
            onClick={() => onSelectedActorChange(context.actorId)}
            type="button"
          >
            {context.actorName}
          </button>
        ))}
      </div>
      <article className="perspective-card">
        <div className="perspective-card-head">
          <div>
            <strong>{selectedContext.actorName}</strong>
            <span>{selectedContext.faction}</span>
          </div>
          <small>{selectedActor ? statusLabel(selectedActor.status) : '视角'}</small>
        </div>
        <div className="perspective-metrics">
          <span>可见 {selectedContext.visibleEventIds.length + selectedContext.visibleSignalIds.length}</span>
          <span>隐藏 {selectedContext.hiddenCount}</span>
        </div>
        <button
          className="perspective-action"
          disabled={isPulsingPerspective || selectedActor?.status !== 'alive'}
          onClick={() => onPulsePerspective(selectedContext.actorId)}
          type="button"
        >
          {isPulsingPerspective ? <RefreshCw className="spin" size={14} /> : <Sparkles size={14} />}
          <span>{isPulsingPerspective ? '视角观察中' : '以此视角推进'}</span>
        </button>
        <div className="perspective-summary-list">
          {selectedContext.visibleSummaries.slice(0, 5).map((summary, index) => (
            <p key={`${selectedContext.actorId}-${index}`}>{summary}</p>
          ))}
        </div>
      </article>
    </div>
  );
}

function RuntimeEventCard({ event, actors }: { event: RuntimeWorldEvent; actors: RuntimeActor[] }) {
  const names = event.actorIds
    .map((id) => actors.find((actor) => actor.id === id)?.name)
    .filter(Boolean)
    .join('、');
  return (
    <article className={clsx('runtime-event-card', `event-${event.type}`, `visibility-${event.visibility}`)}>
      <div className="runtime-event-meta">
        <span>{runtimeEventLabels[event.type]}</span>
        <small>{visibilityLabel(event.visibility)}</small>
        <em>{metricPercent(event.confidence)}</em>
      </div>
      <strong>{event.title}</strong>
      {names ? <small className="runtime-event-actors">{names}</small> : null}
      <p>{event.body}</p>
      <footer>
        <span>{event.impact}</span>
        <b>{metricPercent(event.confidence)}</b>
      </footer>
    </article>
  );
}

function relationLabel(kind: RuntimeActorRelation['kind']) {
  const labels: Record<RuntimeActorRelation['kind'], string> = {
    attention: '观察',
    alliance: '结盟',
    conflict: '冲突',
    betrayal: '背叛',
    fatal: '生死',
    influence: '施压',
  };
  return labels[kind];
}

function WorldNetworkBoard({
  actors,
  relations,
}: {
  actors: RuntimeActor[];
  relations: RuntimeActorRelation[];
}) {
  const visibleActors = actors.slice(0, 8);
  const positions = useMemo(() => {
    const centerX = 50;
    const centerY = 36;
    const radiusX = 35;
    const radiusY = 18;
    return new Map(
      visibleActors.map((actor, index) => {
        const angle = -Math.PI / 2 + (index / Math.max(visibleActors.length, 1)) * Math.PI * 2;
        return [
          actor.id,
          {
            x: centerX + Math.cos(angle) * radiusX,
            y: centerY + Math.sin(angle) * radiusY,
          },
        ];
      }),
    );
  }, [visibleActors]);
  const visibleRelations = relations.filter((relation) => positions.has(relation.sourceActorId) && positions.has(relation.targetActorId)).slice(0, 12);

  if (!visibleActors.length) return <div className="empty-state compact-empty">等待 Agent 进入世界网络</div>;

  return (
    <section className="world-network-board">
      <div className="world-network-head">
        <div>
          <GitBranch size={15} />
          <span>关系张力图</span>
        </div>
        <small>{visibleRelations.length} 条活跃关系</small>
      </div>
      <div className="world-network-canvas">
        <svg aria-hidden="true" className="world-network-lines" viewBox="0 0 100 62">
          <defs>
            <radialGradient id="network-core" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgba(118, 229, 212, 0.22)" />
              <stop offset="100%" stopColor="rgba(118, 229, 212, 0)" />
            </radialGradient>
          </defs>
          <ellipse cx="50" cy="31" fill="url(#network-core)" rx="24" ry="15" />
          {visibleRelations.map((relation) => {
            const source = positions.get(relation.sourceActorId);
            const target = positions.get(relation.targetActorId);
            if (!source || !target) return null;
            return (
              <line
                className={`network-line relation-${relation.kind}`}
                key={relation.id}
                strokeWidth={1 + relation.intensity * 2.8}
                x1={source.x}
                x2={target.x}
                y1={source.y}
                y2={target.y}
              />
            );
          })}
        </svg>
        {visibleActors.map((actor, index) => {
          const position = positions.get(actor.id) ?? { x: 50, y: 31 };
          const actorRelations = visibleRelations.filter((relation) => relation.sourceActorId === actor.id || relation.targetActorId === actor.id);
          const strongest = actorRelations[0];
          return (
            <article
              className={clsx('network-actor-node', actor.status !== 'alive' && 'is-inactive')}
              key={actor.id}
              style={
                {
                  '--agent-color': agentColors[index % agentColors.length],
                  '--node-x': `${position.x}%`,
                  '--node-y': `${(position.y / 62) * 100}%`,
                } as CSSProperties
              }
            >
              <span />
              <strong>{actor.name}</strong>
              <small>{statusLabel(actor.status)}</small>
              {strongest ? (
                <div className="network-actor-popover">
                  <b>
                    {relationLabel(strongest.kind)} · {Math.round(strongest.intensity * 100)}%
                  </b>
                  <p>{strongest.lastEventTitle}</p>
                  <em>{strongest.label}</em>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
      <div className="world-network-legend">
        <span className="legend-conflict">冲突</span>
        <span className="legend-alliance">结盟</span>
        <span className="legend-attention">观察/施压</span>
        <span className="legend-fatal">生死退出</span>
      </div>
    </section>
  );
}

function ContinuousObservationFlowBoard({
  actors,
  frames,
}: {
  actors: RuntimeActor[];
  frames: RuntimeObservationFlowFrame[];
}) {
  const actorName = (id: string) => actors.find((actor) => actor.id === id)?.name ?? id;
  const activeFrame = frames[0];

  if (!activeFrame) return <div className="empty-state compact-empty">等待世界产生第一幕稳定现场</div>;

  const activeSignal = activeFrame.signals[0];
  const activeDialogue = activeFrame.dialogues[0];
  const activeEvent = activeFrame.events[0];

  return (
    <section className="continuous-flow-board">
      <div className="continuous-flow-head">
        <div>
          <Activity size={15} />
          <span>连续世界幕序</span>
        </div>
        <small>{frames.length} 个连续片段</small>
      </div>

      <div className="continuous-flow-track">
        {frames.map((frame, index) => (
          <article
            className={clsx('continuous-flow-frame', index === 0 && 'is-current', frame.hasExitOrDeath && 'has-exit')}
            key={frame.pulse}
            style={{ '--flow-tension': `${Math.round(frame.dominantTension * 100)}%` } as CSSProperties}
          >
            <div className="flow-node">
              <CircleDot size={14} />
            </div>
            <div className="flow-frame-body">
              <div className="flow-frame-meta">
                <strong>{frame.timeLabel}</strong>
                <span>{metricPercent(frame.dominantTension)} 压力</span>
              </div>
              <p>{frame.summary}</p>
              <div className="flow-frame-actors">
                {frame.actorIds.slice(0, 4).map((id) => (
                  <small key={id}>{actorName(id)}</small>
                ))}
              </div>
              <div className="flow-frame-stats">
                <span>{frame.signals.length} 谋划</span>
                <span>{frame.dialogues.length} 对话</span>
                <span>{frame.events.length} 事件</span>
                {frame.hasExitOrDeath ? <b>退出/死亡</b> : null}
              </div>
            </div>
          </article>
        ))}
      </div>

      <div className="continuous-flow-detail">
        {activeSignal ? (
          <article>
            <small>读入与谋划</small>
            <strong>{activeSignal.actorName}</strong>
            <p>{activeSignal.privateIntent}</p>
            <em>{activeSignal.plannedAction}</em>
          </article>
        ) : null}
        {activeDialogue ? (
          <article>
            <small>直接交锋</small>
            <strong>{activeDialogue.topic}</strong>
            {activeDialogue.lines.slice(0, 2).map((line) => (
              <p key={`${activeDialogue.id}-${line.actorId}-${line.stance}`}>{line.text}</p>
            ))}
          </article>
        ) : null}
        {activeEvent ? (
          <article>
            <small>世界表层结果</small>
            <strong>{activeEvent.title}</strong>
            <p>{activeEvent.impact}</p>
            <em>{activeEvent.actorIds.map(actorName).join('、') || '世界旁白'}</em>
          </article>
        ) : null}
      </div>
    </section>
  );
}

function visibilityLabel(visibility: RuntimeWorldEvent['visibility']) {
  const labels: Record<RuntimeWorldEvent['visibility'], string> = {
    public: '公开',
    faction: '阵营',
    private: '私下',
    rumor: '传闻',
    secret: '秘密',
    observer_only: '旁白',
  };
  return labels[visibility];
}

function ConfrontationSceneBoard({
  actors,
  scenes,
}: {
  actors: RuntimeActor[];
  scenes: RuntimeConfrontationScene[];
}) {
  const actorName = (id: string) => actors.find((actor) => actor.id === id)?.name ?? id;
  if (!scenes.length) return <div className="empty-state compact-empty">等待人物之间形成可观察交锋</div>;

  const leadScene = scenes[0];

  return (
    <section className="confrontation-scene-board">
      <div className="confrontation-scene-head">
        <div>
          <ShieldAlert size={15} />
          <span>交锋现场</span>
        </div>
        <small>{scenes.length} 个活跃现场</small>
      </div>

      <article className="confrontation-lead" style={{ '--confrontation-tension': `${Math.round(leadScene.tension * 100)}%` } as CSSProperties}>
        <div className="confrontation-versus">
          <strong>{actorName(leadScene.initiatorActorId)}</strong>
          <span>VS</span>
          <strong>{leadScene.targetActorIds.map(actorName).join('、') || '局势本身'}</strong>
        </div>
        <div className="confrontation-meta">
          <span>{confrontationSourceLabel(leadScene.source)}</span>
          <span>{visibilityLabel(leadScene.visibility)}</span>
          <b>{metricPercent(leadScene.tension)} 张力</b>
        </div>
        <h3>{leadScene.title}</h3>
        <div className="confrontation-columns">
          <p>
            <small>触发</small>
            {leadScene.trigger}
          </p>
          <p>
            <small>回应</small>
            {leadScene.response}
          </p>
        </div>
        <em>{leadScene.stakes}</em>
      </article>

      <div className="confrontation-strip">
        {scenes.slice(1, 5).map((scene) => (
          <article key={scene.id}>
            <div>
              <strong>{actorName(scene.initiatorActorId)}</strong>
              <span>{metricPercent(scene.tension)}</span>
            </div>
            <p>{scene.title}</p>
            <small>{scene.targetActorIds.map(actorName).join('、') || confrontationSourceLabel(scene.source)}</small>
          </article>
        ))}
      </div>
    </section>
  );
}

function WorldObservationBoard({
  actors,
  slices,
}: {
  actors: RuntimeActor[];
  slices: RuntimePulseSlice[];
}) {
  const activeSlice = slices[0];
  if (!activeSlice) return <div className="empty-state compact-empty">等待第一幕生成</div>;
  const actorName = (id: string) => actors.find((actor) => actor.id === id)?.name ?? id;

  return (
    <section className="world-observation-board">
      <div className="world-observation-head">
        <div>
          <Activity size={15} />
          <span>历史观察室</span>
        </div>
        <small>
          脉冲 {activeSlice.pulse} · {activeSlice.phase}
        </small>
      </div>
      <p className="world-observation-summary">{activeSlice.summary}</p>
      <div className="world-observation-grid">
        <div className="observer-lane">
          <div className="observer-lane-title">
            <span>Agent 读入与谋划</span>
            <small>{activeSlice.privateSignalCount} 条私密信号</small>
          </div>
          {activeSlice.signals.length ? (
            activeSlice.signals.slice(0, 3).map((signal) => (
              <article className="observer-signal" key={signal.id}>
                <div>
                  <strong>{signal.actorName}</strong>
                  <span>{visibilityLabel(signal.visibility)}</span>
                </div>
                <p>{signal.privateIntent}</p>
                <em>{signal.plannedAction}</em>
                {signal.targetActorIds.length ? <small>指向：{signal.targetActorIds.map(actorName).join('、')}</small> : null}
              </article>
            ))
          ) : (
            <div className="empty-state compact-empty">这一轮还没有模型生成的私下谋划</div>
          )}
        </div>
        <div className="observer-lane">
          <div className="observer-lane-title">
            <span>世界公开裁决</span>
            <small>
              {activeSlice.publicEventCount} 公开 · {activeSlice.hiddenEventCount} 隐藏
            </small>
          </div>
          {activeSlice.events.length ? (
            activeSlice.events.slice(0, 2).map((event) => (
              <article className="observer-event" key={event.id}>
                <div>
                  <strong>{event.title}</strong>
                  <span>{visibilityLabel(event.visibility)}</span>
                </div>
                <p>{event.impact}</p>
                <small>{event.actorIds.map(actorName).join('、') || '世界旁白'}</small>
              </article>
            ))
          ) : (
            <div className="empty-state compact-empty">这一轮尚未产生公开事件</div>
          )}
        </div>
      </div>
    </section>
  );
}

function ReactionChainBoard({
  actors,
  chains,
}: {
  actors: RuntimeActor[];
  chains: RuntimeReactionChain[];
}) {
  const actorName = (id: string) => actors.find((actor) => actor.id === id)?.name ?? id;
  if (!chains.length) return <div className="empty-state compact-empty">等待 Agent 互相读取并形成反应链</div>;

  return (
    <section className="reaction-chain-board">
      <div className="reaction-chain-head">
        <div>
          <GitBranch size={15} />
          <span>Agent 反应链</span>
        </div>
        <small>{chains.length} 条可观察链路</small>
      </div>
      <div className="reaction-chain-list">
        {chains.slice(0, 5).map((chain) => (
          <article className="reaction-chain-card" key={chain.id}>
            <div className="reaction-node reaction-source">
              <small>刺激</small>
              <strong>{chain.sourceTitle}</strong>
              {chain.triggerSummary !== chain.sourceTitle ? <p>{chain.triggerSummary}</p> : null}
            </div>
            <div className="reaction-link" aria-hidden="true" />
            <div className="reaction-node reaction-reader">
              <small>读入者</small>
              <strong>{chain.readerActorName}</strong>
              <span>{visibilityLabel(chain.visibility)} · {metricPercent(chain.confidence)}</span>
            </div>
            <div className="reaction-link" aria-hidden="true" />
            <div className="reaction-node reaction-action">
              <small>准备动作</small>
              <p>{chain.reactionSummary}</p>
              {chain.targetActorIds.length ? <span>指向：{chain.targetActorIds.map(actorName).join('、')}</span> : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function DialogueRoomBoard({
  actors,
  exchanges,
}: {
  actors: RuntimeActor[];
  exchanges: RuntimeDialogueExchange[];
}) {
  const actorName = (id: string) => actors.find((actor) => actor.id === id)?.name ?? id;
  if (!exchanges.length) return <div className="empty-state compact-empty">等待 Agent 形成可观察交锋</div>;

  return (
    <section className="dialogue-room-board">
      <div className="dialogue-room-head">
        <div>
          <MessageSquare size={15} />
          <span>Agent 对话室</span>
        </div>
        <small>{exchanges.length} 场交锋</small>
      </div>
      <div className="dialogue-room-list">
        {exchanges.slice(0, 4).map((exchange) => (
          <article className="dialogue-exchange-card" key={exchange.id}>
            <header>
              <div>
                <strong>{exchange.topic}</strong>
                <small>{visibilityLabel(exchange.visibility)} · {metricPercent(exchange.confidence)}</small>
              </div>
              <p>{exchange.stakes}</p>
              <div className="dialogue-participants">
                {exchange.participants.map((id) => (
                  <span key={id}>{actorName(id)}</span>
                ))}
              </div>
            </header>
            <div className="dialogue-lines">
              {exchange.lines.map((line) => (
                <div className="dialogue-line" key={`${exchange.id}-${line.actorId}-${line.stance}`}>
                  <span>{line.actorName}</span>
                  <small>{line.stance}</small>
                  <p>{line.text}</p>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function PressureThreadBoard({
  actors,
  selectedThreadId,
  threads,
  onSelectThread,
}: {
  actors: RuntimeActor[];
  selectedThreadId: string;
  threads: RuntimePressureThread[];
  onSelectThread: (threadId: string) => void;
}) {
  const actorName = (id: string) => actors.find((actor) => actor.id === id)?.name ?? id;
  if (!threads.length) return <div className="empty-state compact-empty">等待世界压力线程形成</div>;

  return (
    <section className="pressure-thread-board">
      <div className="pressure-thread-head">
        <div>
          <ShieldAlert size={15} />
          <span>世界压力线程</span>
        </div>
        <small>{threads.length} 条未解压力</small>
      </div>
      <div className="pressure-thread-list">
        {threads.slice(0, 4).map((thread) => {
          const isFocused = thread.id === selectedThreadId;
          return (
            <button
              className={clsx('pressure-thread-card', isFocused && 'is-focused')}
              key={thread.id}
              onClick={() => onSelectThread(isFocused ? '' : thread.id)}
              type="button"
            >
              <div className="pressure-thread-top">
                <strong>{thread.title}</strong>
                <span>{metricPercent(thread.urgency)} 急迫</span>
              </div>
              {isFocused ? <span className="pressure-thread-focus-badge">聚焦中</span> : null}
              <div className="pressure-thread-actors">
                {thread.actorIds.map((id) => (
                  <small key={id}>{actorName(id)}</small>
                ))}
              </div>
              <p>{thread.unresolvedQuestion}</p>
              <em>{thread.nextPressure}</em>
              <div className="pressure-thread-meter" style={{ '--pressure-tension': `${Math.round(thread.tension * 100)}%` } as CSSProperties} />
            </button>
          );
        })}
      </div>
    </section>
  );
}

function FocusedPressureThreadPanel({
  context,
  onClearFocus,
}: {
  context: RuntimeFocusedThreadContext;
  onClearFocus: () => void;
}) {
  const actorName = (id: string) => context.actors.find((actor) => actor.id === id)?.name ?? id;
  return (
    <section className="focused-thread-panel">
      <div className="focused-thread-head">
        <div>
          <ShieldAlert size={15} />
          <span>聚焦线程观察</span>
        </div>
        <button className="focused-thread-clear" onClick={onClearFocus} type="button">
          取消聚焦
        </button>
      </div>
      <p className="focused-thread-summary">{context.summary}</p>
      <div className="focused-thread-actors">
        {context.actors.map((actor) => (
          <span key={actor.id}>{actor.name} · {statusLabel(actor.status)}</span>
        ))}
      </div>
      <div className="focused-thread-question">
        <strong>未解问题</strong>
        <p>{context.thread.unresolvedQuestion}</p>
      </div>
      <div className="focused-thread-next">
        <strong>下一步压力</strong>
        <em>{context.thread.nextPressure}</em>
      </div>
      {context.relatedDialogues.length ? (
        <div className="focused-thread-section">
          <strong>关联对话</strong>
          {context.relatedDialogues.slice(0, 2).map((exchange) => (
            <article className="focused-thread-dialogue" key={exchange.id}>
              <small>{exchange.topic}</small>
              {exchange.lines.slice(0, 2).map((line) => (
                <p key={`${exchange.id}-${line.actorId}-${line.stance}`}>{line.text}</p>
              ))}
            </article>
          ))}
        </div>
      ) : null}
      {context.relatedChains.length ? (
        <div className="focused-thread-section">
          <strong>关联反应链</strong>
          {context.relatedChains.slice(0, 2).map((chain) => (
            <article className="focused-thread-chain" key={chain.id}>
              <small>{chain.readerActorName} 读入：{chain.sourceTitle}</small>
              <p>{chain.reactionSummary}</p>
            </article>
          ))}
        </div>
      ) : null}
      {context.relatedEvents.length ? (
        <div className="focused-thread-section">
          <strong>关联世界事件</strong>
          {context.relatedEvents.slice(0, 3).map((event) => (
            <article className="focused-thread-event" key={event.id}>
              <small>{event.title}</small>
              <span>{event.actorIds.map(actorName).join('、') || '世界旁白'}</span>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ConvergencePanel({
  convergence,
  onContinueWorld,
}: {
  convergence: RuntimeConvergence;
  onContinueWorld: () => void;
}) {
  return (
    <section className={clsx('convergence-panel', convergence.shouldPause && 'is-paused')}>
      <div className="convergence-head">
        <Gauge size={16} />
        <span>{convergence.shouldPause ? '阶段性收束' : '世界运行中'}</span>
        <strong>{metricPercent(convergence.confidence)}</strong>
      </div>
      <p>{convergence.summary}</p>
      {convergence.unresolvedConflicts.length ? (
        <div className="unresolved-list">
          {convergence.unresolvedConflicts.map((conflict) => (
            <span key={conflict}>{conflict}</span>
          ))}
        </div>
      ) : null}
      {convergence.shouldPause ? (
        <div className="continue-options">
          {convergence.continueOptions.map((option) => (
            <button key={option} onClick={onContinueWorld} type="button">
              <GitBranch size={14} />
              <span>{option}</span>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function WorkbenchNav({
  activePage,
  onPageChange,
}: {
  activePage: WorkbenchPage;
  onPageChange: (page: WorkbenchPage) => void;
}) {
  return (
    <nav className="workbench-nav" aria-label="事件世界工作台导航">
      {workbenchPageMeta.map((item) => {
        const Icon = item.Icon;
        return (
          <button
            className={clsx(activePage === item.id && 'is-active')}
            key={item.id}
            onClick={() => onPageChange(item.id)}
            type="button"
          >
            <Icon size={16} />
            <span>{item.label}</span>
            <small>{item.hint}</small>
          </button>
        );
      })}
    </nav>
  );
}

function TimelineWorkbenchPage({
  onTimelineInput,
  selectedBranch,
  timelineProgress,
  totalSteps,
  world,
}: {
  onTimelineInput: (event: FormEvent<HTMLInputElement>) => void;
  selectedBranch: SimulationBranch | null;
  timelineProgress: number;
  totalSteps: number;
  world: SimulationWorld;
}) {
  const timelineLogs = world.actionLogs.slice(0, 10);

  return (
    <div className="timeline-workbench-page">
      <section className="timeline-control-panel">
        <div>
          <MapIcon size={17} />
          <span>时间线回放</span>
        </div>
        <input
          aria-label="拖动时间线"
          max={100}
          min={0}
          onChange={onTimelineInput}
          onInput={onTimelineInput}
          step={0.01}
          type="range"
          value={timelineProgress}
        />
        <small>{Math.round(timelineProgress)}% · {totalSteps} 节点</small>
      </section>

      <section className="timeline-branch-panel">
        <BranchSummary branch={selectedBranch} />
      </section>

      <section className="timeline-point-list">
        {world.timeline.map((point) => (
          <article key={`${point.year}-${point.branch}`}>
            <strong>{point.year}</strong>
            <p>{point.branch}</p>
            <span>原史参照：{point.original}</span>
            <small>{metricPercent(point.confidence)}</small>
          </article>
        ))}
      </section>

      <section className="timeline-log-panel">
        <div className="runtime-side-title">
          <Activity size={15} />
          <span>行动记录</span>
        </div>
        {timelineLogs.length ? (
          timelineLogs.map((log) => (
            <article key={log.id}>
              <strong>{log.timeLabel} · {log.agentName}</strong>
              <p>{log.action}</p>
              <span>{log.impact}</span>
            </article>
          ))
        ) : (
          <p className="empty-state">继续推动世界后，这里会记录人物行动。</p>
        )}
      </section>
    </div>
  );
}

function EvidenceWorkbenchPage({ world }: { world: SimulationWorld }) {
  const analysisGroups = [
    { label: '已知事实', items: world.eventAnalysis.facts },
    { label: '关键假设', items: world.eventAnalysis.assumptions },
    { label: '因果前提', items: world.eventAnalysis.causes },
    { label: '开放问题', items: world.eventAnalysis.openQuestions },
  ];

  return (
    <div className="evidence-workbench-page">
      <section className="evidence-analysis-grid">
        {analysisGroups.map((group) => (
          <article key={group.label}>
            <strong>{group.label}</strong>
            {group.items.map((item) => (
              <p key={item}>{item}</p>
            ))}
          </article>
        ))}
      </section>

      <section className="evidence-source-list">
        <div className="runtime-side-title">
          <Gauge size={15} />
          <span>证据与置信来源</span>
        </div>
        {world.evidence.map((item) => (
          <article key={item.id}>
            <div>
              <strong>{item.claim}</strong>
              <span>{metricPercent(item.confidence)}</span>
            </div>
            <small>{item.source.replaceAll('_', ' ')}</small>
          </article>
        ))}
      </section>
    </div>
  );
}

function OverviewAnalysisBoard({ world }: { world: SimulationWorld }) {
  return (
    <section className="overview-analysis-board">
      <article>
        <div className="runtime-side-title">
          <Sparkles size={15} />
          <span>事件摘要</span>
        </div>
        <p>{world.centralQuestion || world.eventText}</p>
      </article>
      <article>
        <div className="runtime-side-title">
          <CircleDot size={15} />
          <span>关键假设</span>
        </div>
        {world.eventAnalysis.assumptions.slice(0, 4).map((item) => (
          <p key={item}>{item}</p>
        ))}
      </article>
      <article>
        <div className="runtime-side-title">
          <ShieldAlert size={15} />
          <span>因果压力</span>
        </div>
        {world.eventAnalysis.causes.slice(0, 4).map((item) => (
          <p key={item}>{item}</p>
        ))}
      </article>
    </section>
  );
}

function OverviewAgentBoard({ agents }: { agents: AgentProfile[] }) {
  if (!agents.length) return <div className="empty-state compact-empty">尚未生成具体人物</div>;
  return (
    <section className="overview-agent-board">
      <div className="runtime-side-title">
        <Users size={15} />
        <span>Agent 人物</span>
      </div>
      <div className="overview-agent-grid">
        {agents.map((agent, index) => (
          <article key={agent.id} style={{ '--agent-color': agentColors[index % agentColors.length] } as CSSProperties}>
            <div>
              <span />
              <strong>{agent.name}</strong>
              <small>{agent.identity || agent.role}</small>
            </div>
            <p>{agent.dilemma || agent.currentPressure || agent.goals.slice(0, 2).join(' / ')}</p>
            {agent.actions?.[0] ? <em>{agent.actions[0]}</em> : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function OverviewInterviewBoard({
  agents,
  interviewAgentId,
  interviewAnswer,
  interviewQuestion,
  isInterviewing,
  onInterview,
  onInterviewAgentChange,
  onInterviewQuestionChange,
}: {
  agents: AgentProfile[];
  interviewAgentId: string;
  interviewAnswer: string;
  interviewQuestion: string;
  isInterviewing: boolean;
  onInterview: (agentId?: string) => void;
  onInterviewAgentChange: (next: string) => void;
  onInterviewQuestionChange: (next: string) => void;
}) {
  return (
    <section className="overview-interview-board">
      <div className="runtime-side-title">
        <MessageSquare size={15} />
        <span>采访人物</span>
      </div>
      <div className="overview-interview-controls">
        <select value={interviewAgentId} onChange={(event) => onInterviewAgentChange(event.target.value)}>
          <option value="">选择 Agent</option>
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>
        <input value={interviewQuestion} onChange={(event) => onInterviewQuestionChange(event.target.value)} placeholder="向这个人物提出一个具体问题" />
        <button disabled={!interviewAgentId || !interviewQuestion.trim() || isInterviewing} onClick={() => onInterview()} type="button">
          {isInterviewing ? <RefreshCw className="spin" size={16} /> : <Send size={16} />}
          <span>{isInterviewing ? '采访中' : '发送'}</span>
        </button>
      </div>
      {interviewAnswer ? (
        <p className="overview-interview-answer">{polishInterviewAnswer(interviewAnswer)}</p>
      ) : (
        <p className="overview-interview-empty">选择一个人物，询问他的处境、判断或下一步行动。</p>
      )}
    </section>
  );
}

function OverviewTimelineBoard({
  onTimelineInput,
  selectedBranch,
  timelineProgress,
  totalSteps,
}: {
  onTimelineInput: (event: FormEvent<HTMLInputElement>) => void;
  selectedBranch: SimulationBranch | null;
  timelineProgress: number;
  totalSteps: number;
}) {
  return (
    <section className="overview-timeline-board">
      <div className="runtime-side-title">
        <GitBranch size={15} />
        <span>时间线控制</span>
      </div>
      <BranchSummary branch={selectedBranch} />
      <div className="overview-timeline-control">
        <input
          aria-label="拖动时间线"
          max={100}
          min={0}
          onChange={onTimelineInput}
          onInput={onTimelineInput}
          step={0.01}
          type="range"
          value={timelineProgress}
        />
        <span>{Math.round(timelineProgress)}% · {totalSteps} 节点</span>
      </div>
    </section>
  );
}

function ArchiveWorkbenchPage({
  convergence,
  latestEvents,
  runtimeWorld,
  onContinueWorld,
}: {
  convergence: RuntimeConvergence;
  latestEvents: RuntimeWorldEvent[];
  runtimeWorld: RuntimeWorld;
  onContinueWorld: () => void;
}) {
  return (
    <div className="archive-workbench-page">
      <ConvergencePanel convergence={convergence} onContinueWorld={onContinueWorld} />
      <section className="runtime-stream archive-stream">
        {latestEvents.length ? (
          latestEvents.map((event) => (
            <RuntimeEventCard actors={runtimeWorld.actors} event={event} key={event.id} />
          ))
        ) : (
          <p className="empty-state">世界运行后会在这里沉淀观察日志。</p>
        )}
      </section>
    </div>
  );
}

function WorldRoom({
  activePage,
  interviewAgentId,
  interviewAnswer,
  interviewQuestion,
  isWorldRunning,
  isInterviewing,
  isPulsing,
  onInterview,
  onInterviewAgentChange,
  onInterviewQuestionChange,
  onContinueWorld,
  onTimelineInput,
  onPulseActorPerspective,
  onPulseWorld,
  onToggleWorldRun,
  runtimeWorld,
  selectedBranch,
  timelineProgress,
  totalSteps,
  world,
}: {
  activePage: WorkbenchPage;
  interviewAgentId: string;
  interviewAnswer: string;
  interviewQuestion: string;
  isWorldRunning: boolean;
  isInterviewing: boolean;
  isPulsing: boolean;
  onInterview: (agentId?: string) => void;
  onInterviewAgentChange: (next: string) => void;
  onInterviewQuestionChange: (next: string) => void;
  onContinueWorld: () => void;
  onTimelineInput: (event: FormEvent<HTMLInputElement>) => void;
  onPulseActorPerspective: (actorId: string) => void;
  onPulseWorld: (focusedPressureThreadId?: string) => void;
  onToggleWorldRun: () => void;
  runtimeWorld: RuntimeWorld;
  selectedBranch: SimulationBranch | null;
  timelineProgress: number;
  totalSteps: number;
  world: SimulationWorld;
}) {
  const latestEvents = runtimeWorld.stream.slice(0, 18);
  const actorContexts = useMemo(() => buildActorVisibleContexts(runtimeWorld), [runtimeWorld]);
  const actorLedgers = useMemo(() => buildRuntimeActorLedgers(runtimeWorld), [runtimeWorld]);
  const actorRelations = useMemo(() => buildRuntimeRelations(runtimeWorld), [runtimeWorld]);
  const pulseSlices = useMemo(() => buildRuntimePulseSlices(runtimeWorld), [runtimeWorld]);
  const observationFlow = useMemo(() => buildRuntimeObservationFlow(runtimeWorld), [runtimeWorld]);
  const confrontationScenes = useMemo(() => buildRuntimeConfrontationScenes(runtimeWorld), [runtimeWorld]);
  const reactionChains = useMemo(() => buildRuntimeReactionChains(runtimeWorld), [runtimeWorld]);
  const dialogueExchanges = useMemo(() => buildRuntimeDialogueExchanges(runtimeWorld), [runtimeWorld]);
  const pressureThreads = useMemo(() => buildRuntimePressureThreads(runtimeWorld), [runtimeWorld]);
  const [preferredPerspectiveActorId, setPreferredPerspectiveActorId] = useState('');
  const [focusedPressureThreadId, setFocusedPressureThreadId] = useState('');
  const selectedPerspectiveActorId = runtimeWorld.actors.some((actor) => actor.id === preferredPerspectiveActorId)
    ? preferredPerspectiveActorId
    : runtimeWorld.actors[0]?.id ?? '';

  const effectiveFocusedThreadId = pressureThreads.some((thread) => thread.id === focusedPressureThreadId)
    ? focusedPressureThreadId
    : '';

  const focusedThreadContext = useMemo(
    () => (effectiveFocusedThreadId ? buildFocusedPressureThreadContext(runtimeWorld, effectiveFocusedThreadId) : null),
    [runtimeWorld, effectiveFocusedThreadId],
  );

  const pageContent = {
    overview: (
      <>
        <OverviewAnalysisBoard world={world} />
        <OverviewAgentBoard agents={world.agents} />
        <OverviewInterviewBoard
          agents={world.agents}
          interviewAgentId={interviewAgentId}
          interviewAnswer={interviewAnswer}
          interviewQuestion={interviewQuestion}
          isInterviewing={isInterviewing}
          onInterview={onInterview}
          onInterviewAgentChange={onInterviewAgentChange}
          onInterviewQuestionChange={onInterviewQuestionChange}
        />
        <OverviewTimelineBoard
          onTimelineInput={onTimelineInput}
          selectedBranch={selectedBranch}
          timelineProgress={timelineProgress}
          totalSteps={totalSteps}
        />
        <WorldNetworkBoard actors={runtimeWorld.actors} relations={actorRelations} />
      </>
    ),
    confrontation: (
      <>
        <ConfrontationSceneBoard actors={runtimeWorld.actors} scenes={confrontationScenes} />
        <DialogueRoomBoard actors={runtimeWorld.actors} exchanges={dialogueExchanges} />
        <ReactionChainBoard actors={runtimeWorld.actors} chains={reactionChains} />
        <PressureThreadBoard actors={runtimeWorld.actors} selectedThreadId={effectiveFocusedThreadId} threads={pressureThreads} onSelectThread={setFocusedPressureThreadId} />
        {focusedThreadContext ? (
          <FocusedPressureThreadPanel context={focusedThreadContext} onClearFocus={() => setFocusedPressureThreadId('')} />
        ) : null}
      </>
    ),
    actors: (
      <>
        <RuntimeActorBoard actors={runtimeWorld.actors} />
        <ActorLedgerBoard ledgers={actorLedgers} />
        <AgentSignalBoard actors={runtimeWorld.actors} signals={runtimeWorld.signals} />
        <AgentPerspectivePanel
          actors={runtimeWorld.actors}
          contexts={actorContexts}
          isPulsingPerspective={isPulsing}
          onSelectedActorChange={setPreferredPerspectiveActorId}
          onPulsePerspective={onPulseActorPerspective}
          selectedActorId={selectedPerspectiveActorId}
        />
        <InfoBusBoard contexts={actorContexts} />
        <WorldObservationBoard actors={runtimeWorld.actors} slices={pulseSlices} />
      </>
    ),
    timeline: (
      <TimelineWorkbenchPage
        onTimelineInput={onTimelineInput}
        selectedBranch={selectedBranch}
        timelineProgress={timelineProgress}
        totalSteps={totalSteps}
        world={world}
      />
    ),
    evidence: <EvidenceWorkbenchPage world={world} />,
    archive: (
      <>
        <ContinuousObservationFlowBoard actors={runtimeWorld.actors} frames={observationFlow} />
        <ArchiveWorkbenchPage
          convergence={runtimeWorld.convergence}
          latestEvents={latestEvents}
          onContinueWorld={onContinueWorld}
          runtimeWorld={runtimeWorld}
        />
      </>
    ),
  } satisfies Record<WorkbenchPage, ReactNode>;

  return (
    <div className={clsx('world-room', activePage === 'overview' && 'is-overview-room')}>
      <div className="world-room-head">
        <div>
          <Activity size={18} />
          <span>世界观察室</span>
          <small>{runtimeWorld.phase}</small>
        </div>
        <div className="world-room-actions">
          <button disabled={runtimeWorld.convergence.shouldPause || isPulsing} onClick={() => onPulseWorld(effectiveFocusedThreadId || undefined)} type="button">
            {isPulsing ? <RefreshCw className="spin" size={15} /> : <Sparkles size={15} />}
            <span>{isPulsing ? '观察中' : '推进观察'}</span>
          </button>
          <button onClick={onToggleWorldRun} type="button">
            {isWorldRunning ? <Pause size={15} /> : <Play size={15} />}
            <span>{isWorldRunning ? '暂停推演' : '启动推演'}</span>
          </button>
        </div>
      </div>

      <section className="runtime-metrics">
        <article>
          <span>稳定度</span>
          <strong>{metricPercent(runtimeWorld.stability)}</strong>
        </article>
        <article>
          <span>冲突强度</span>
          <strong>{metricPercent(runtimeWorld.conflictLevel)}</strong>
        </article>
        <article>
          <span>幕序</span>
          <strong>
            {runtimeWorld.pulse}/{runtimeWorld.maxPulses}
          </strong>
        </article>
        <article>
          <span>总体置信度</span>
          <strong>{metricPercent(runtimeWorld.confidence)}</strong>
        </article>
      </section>

      <section className="world-room-grid is-single-page">
        <div className={clsx('runtime-main', 'runtime-page-main', `runtime-page-${activePage}`)}>
          {pageContent[activePage]}
        </div>

        {/* legacy runtime side moved into workbench pages
          <section>
            <div className="runtime-side-title">
              <Users size={15} />
              <span>人物状态</span>
            </div>
            <RuntimeActorBoard actors={runtimeWorld.actors} />
            <ActorLedgerBoard ledgers={actorLedgers} />
          </section>
          <section>
            <div className="runtime-side-title">
              <Activity size={15} />
              <span>Agent 动向</span>
            </div>
            <AgentSignalBoard actors={runtimeWorld.actors} signals={runtimeWorld.signals} />
          </section>
          <section>
            <div className="runtime-side-title">
              <GitBranch size={15} />
              <span className="runtime-side-title-override">Agent 视角</span>
              <span>信息总线</span>
            </div>
            <AgentPerspectivePanel
              actors={runtimeWorld.actors}
              contexts={actorContexts}
              isPulsingPerspective={isPulsing}
              onSelectedActorChange={setPreferredPerspectiveActorId}
              onPulsePerspective={onPulseActorPerspective}
              selectedActorId={selectedPerspectiveActorId}
            />
            <InfoBusBoard contexts={actorContexts} />
          </section>
          <section>
            <div className="runtime-side-title">
              <ShieldAlert size={15} />
              <span>冲突热点</span>
            </div>
            <div className="conflict-hotspots">
              {runtimeWorld.conflicts.map((conflict) => (
                <article key={conflict.id}>
                  <div>
                    <strong>{conflict.title}</strong>
                    <span>{metricPercent(conflict.intensity)}</span>
                  </div>
                  <p>{conflict.description}</p>
                </article>
              ))}
            </div>
          </section>
          <ConvergencePanel convergence={runtimeWorld.convergence} onContinueWorld={onContinueWorld} />
        */}
      </section>
    </div>
  );
}

function WorldContextStrip({
  analysisParagraph,
  interviewAgentId,
  interviewAnswer,
  interviewQuestion,
  isInterviewing,
  onInterview,
  onInterviewAgentChange,
  onInterviewQuestionChange,
  onTimelineInput,
  selectedBranch,
  timelineProgress,
  totalSteps,
  world,
}: {
  analysisParagraph: string;
  interviewAgentId: string;
  interviewAnswer: string;
  interviewQuestion: string;
  isInterviewing: boolean;
  onInterview: () => void;
  onInterviewAgentChange: (next: string) => void;
  onInterviewQuestionChange: (next: string) => void;
  onTimelineInput: (event: FormEvent<HTMLInputElement>) => void;
  selectedBranch: SimulationBranch | null;
  timelineProgress: number;
  totalSteps: number;
  world: SimulationWorld;
}) {
  return (
    <section className="world-context-strip">
      <article className="context-card context-analysis">
        <div className="context-card-head">
          <Sparkles size={15} />
          <span>事件摘要</span>
        </div>
        <p>{analysisParagraph || world.centralQuestion}</p>
      </article>

      <article className="context-card context-agents">
        <div className="context-card-head">
          <CircleDot size={15} />
          <span>Agent</span>
        </div>
        <AgentRoster agents={world.agents} />
      </article>

      <article className="context-card context-interview">
        <div className="context-card-head">
          <MessageSquare size={15} />
          <span>采访</span>
        </div>
        <div className="interview-compact">
          <select value={interviewAgentId} onChange={(event) => onInterviewAgentChange(event.target.value)}>
            <option value="">选择 Agent</option>
            {world.agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
          <input value={interviewQuestion} onChange={(event) => onInterviewQuestionChange(event.target.value)} placeholder="向人物提问" />
          <button disabled={!interviewAgentId || !interviewQuestion.trim() || isInterviewing} onClick={() => onInterview()} type="button">
            {isInterviewing ? <RefreshCw className="spin" size={16} /> : <Send size={16} />}
          </button>
        </div>
        {interviewAnswer ? <p className="interview-answer compact-answer">{polishInterviewAnswer(interviewAnswer)}</p> : null}
      </article>

      <article className="context-card context-timeline">
        <div className="context-card-head">
          <GitBranch size={15} />
          <span>时间线</span>
        </div>
        <strong>{selectedBranch?.title ?? world.simulationPlan.durationLabel}</strong>
        <div className="mini-timeline-preview">
          <input
            aria-label="拖动时间线"
            max={100}
            min={0}
            onChange={onTimelineInput}
            onInput={onTimelineInput}
            step={0.01}
            type="range"
            value={timelineProgress}
          />
          <span>
            {Math.round(timelineProgress)}% · {totalSteps} 节点
          </span>
        </div>
      </article>
    </section>
  );
}

type StageFocus =
  | { type: 'actor'; id: string }
  | { type: 'event'; id: string }
  | { type: 'relation'; id: string }
  | { type: 'cue'; id: string }
  | { type: 'world-summary' }
  | { type: 'qa-history' };

interface V2StageCue {
  id: string;
  kind: 'read' | 'plan' | 'dialogue';
  title: string;
  summary: string;
  actorIds: string[];
  sourceActorId?: string;
  targetActorIds: string[];
  lineByActorId?: Record<string, string>;
  confidence: number;
  visibility: RuntimeVisibility;
  x: number;
  y: number;
}

interface V2StageSlice {
  id: string;
  pulse: number;
  timeLabel: string;
  phase: string;
  signals: RuntimeAgentSignal[];
  events: RuntimeWorldEvent[];
  actorIds: string[];
  privateSignalCount: number;
  publicEventCount: number;
  hiddenEventCount: number;
  summary: string;
  kind: 'event' | 'signal' | 'timeline' | 'dialogue';
  title: string;
  confidence: number;
  visibility: RuntimeVisibility;
}

function truncateText(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

function sanitizeLegacyWorldText(value: string) {
  return String(value || '')
    .replace(/([^\s，。；：]{1,30})改变了下一步试探方式/gu, '$1发起一次试探行动')
    .replace(/释放出的信号，开始调整自己的公开姿态和私下安排/g, '的动作后，调整了接下来的行动方式')
    .replace(/王权中枢与旧制网络之间的误判空间扩大，冲突可能转入更隐蔽的层面。?/g, '双方判断出现偏差，冲突可能转入更隐蔽的层面。')
    .replace(/王权中枢与变法秩序之间的误判空间扩大，冲突可能转入更隐蔽的层面。?/g, '双方判断出现偏差，冲突可能转入更隐蔽的层面。')
    .replace(/王权中枢|旧制网络|变法秩序/gu, '相关力量');
}

function sceneChangeLabel(slice: V2StageSlice) {
  const eventCount = slice.events.filter((event) => event.id !== 'runtime-seed').length;
  const changeCount = eventCount + slice.signals.length;
  return `${changeCount || 1} 个变化 · ${metricPercent(slice.confidence)} 收敛`;
}

function displayRuntimeEventTitle(event: RuntimeWorldEvent) {
  const title = sanitizeLegacyWorldText(event.title || event.actionText || event.body || '世界出现新的行动').trim();
  return truncateText(title, 36);
}

function displayRuntimeEventBody(event: RuntimeWorldEvent) {
  return cleanActionBody(sanitizeLegacyWorldText(event.actionText || event.body || event.title || '')).trim();
}

function displayRuntimeEventImpact(event: RuntimeWorldEvent) {
  return cleanActionBody(sanitizeLegacyWorldText(event.effectText || event.impact || '')).trim();
}

function moodLabel(mood: RuntimeActor['mood']) {
  const labels: Record<RuntimeActor['mood'], string> = {
    aggressive: '进逼',
    calculating: '盘算',
    defensive: '防守',
    fragile: '动摇',
    withdrawn: '退场',
  };
  return labels[mood];
}

function stageEventTypeFromText(text: string): RuntimeEventType {
  if (/请辞|辞官|以退为进|退让|暂退|避锋芒/u.test(text)) return 'move';
  if (/死|杀|流放|囚|退场|失势|清算/u.test(text)) return 'death';
  if (/冲突|对抗|施压|威胁|争|斗/u.test(text)) return 'conflict';
  if (/盟|联合|拉拢|合作/u.test(text)) return 'alliance';
  if (/背叛|倒戈|出卖/u.test(text)) return 'betrayal';
  if (/法|制度|政策|改革|诏|令/u.test(text)) return 'policy';
  if (/传闻|秘密|暗线|私下/u.test(text)) return 'rumor';
  if (/说|问|谈|奏|召见/u.test(text)) return 'speech';
  return 'move';
}

function createTimelineStageEvent(
  world: ReturnType<typeof createDraftWorld>,
  runtimeWorld: RuntimeWorld,
  index: number,
  actionLog?: AgentActionLog,
  ordinal = 0,
): RuntimeWorldEvent {
  const timelinePoint = world.timeline[index] ?? world.timeline[0];
  const initiatorActorId = actionLog?.initiatorActorId || actionLog?.agentId;
  const actor = runtimeWorld.actors.find((item) => item.id === initiatorActorId) ?? runtimeWorld.actors[index % Math.max(runtimeWorld.actors.length, 1)];
  const targetActorIds = actionLog?.targetActorIds ?? [];
  const responderActorIds = actionLog?.responderActorIds ?? [];
  const affectedActorIds = actionLog?.affectedActorIds ?? [];
  const actorIds = actionLog
    ? Array.from(new Set([initiatorActorId, ...targetActorIds, ...responderActorIds, ...affectedActorIds])).filter(Boolean) as string[]
    : actor ? [actor.id] : runtimeWorld.actors.slice(0, 2).map((item) => item.id);
  const title = actionLog ? `${actionLog.agentName}：${actionLog.action}` : timelinePoint?.branch || '世界线扰动';
  const body = actionLog?.detail || timelinePoint?.branch || world.centralQuestion;
  const impact = actionLog?.impact || timelinePoint?.original || world.simulationPlan.stopReason;

  return {
    id: actionLog ? `stage-timeline-${index}-${actionLog.id || ordinal}` : `stage-timeline-${index}`,
    pulse: index,
    timeLabel: timelinePoint?.year || `节点 ${index + 1}`,
    type: stageEventTypeFromText(`${title}${body}${impact}`),
    visibility: /秘密|私下|暗/u.test(`${title}${body}`) ? 'secret' : 'public',
    actorIds,
    initiatorActorId: initiatorActorId || actor?.id,
    targetActorIds,
    responderActorIds,
    affectedActorIds,
    actionText: actionLog?.actionText || body,
    responseText: actionLog?.responseText || '',
    effectText: actionLog?.effectText || impact,
    title,
    body,
    impact,
    confidence: actionLog?.confidence ?? timelinePoint?.confidence ?? world.confidence,
  };
}

function cueKindLabel(kind: V2StageCue['kind']) {
  const labels: Record<V2StageCue['kind'], string> = {
    dialogue: '行动',
    plan: '谋划',
    read: '读入',
  };
  return labels[kind];
}

function normalizeActionText(value: string) {
  return sanitizeLegacyWorldText(value)
    .replace(/[，。；：:“”"'‘’\s/·|｜….]/gu, '')
    .replace(/秦孝公去世后/g, '')
    .replace(/旧怨与新君疑惧同时压向他/g, '')
    .replace(/王权中枢与变法秩序之间的误判空间扩大/g, '')
    .slice(0, 72);
}

function cleanActionBody(value: string) {
  let text = polishInterviewAnswer(sanitizeLegacyWorldText(String(value || '')))
    .replace(/^[^｜|。；;]{1,36}\s*[｜|]\s*(?:public|private|secret|faction|rumor|observer_only|公开|私下|秘密|阵营|传闻|旁白)\s*[｜|]\s*[^：:]{1,30}[：:]\s*/u, '')
    .replace(/^观察流\s*\d+\s*[｜|]\s*(?:public|private|secret|faction|rumor|observer_only|公开|私下|秘密|阵营|传闻|旁白)\s*[｜|]\s*[^：:]{1,80}[：:]\s*/u, '')
    .replace(/^观察脉冲\s*\d+\s*[｜|]\s*[^：:]{1,80}[：:]\s*/u, '')
    .replace(/^(?:初期|中期|长期|中段|远期|观察流\s*\d+|观察阶段\s*\d+)[｜|:：]\s*/u, '')
    .trim();
  const actionMatches = Array.from(
    text.matchAll(/((?:秘密|私下|公开)?(?:召见|下旨|命令|要求|派出|联络|劝说|上书|会见|威胁|保护|监视|试探|递交|整理|召集|游说|回应|拒绝|接受|谈判|封锁|释放|削去|保留|推动|安排|派遣)[^。；;]{6,120})/gu),
  );
  const actionMatch = actionMatches.at(-1);
  if (actionMatch?.[1] && actionMatch[1].length + 16 < text.length) text = actionMatch[1].trim();
  const withoutAbstractLead = text.replace(
    /^[^。；;]*(?:误判空间|冲突可能|压力|疑惧|旧怨|局势|表层|权力结构|稳定状态|收敛|必须|否则|阻止|防止|判断是否)[^。；;]*[。；;]\s*/u,
    '',
  ).trim();
  if (withoutAbstractLead.length >= 8) text = withoutAbstractLead;
  return text;
}

function canonicalActionText(value: string) {
  const text = cleanActionBody(value);
  const actionPattern =
    /提出|交出|宣布|召见|说服|联络|弹劾|调查|保护|威胁|退让|进攻|逃离|密奏|编撰|命令|准备|试探|上书|会见|拜访|支持|呈递|接见|索取|发言|进言|嘱咐|削去|保留|联合|暗示|逼问|质问|透露|派出|签署|封锁|谈判|要求|推动|召集|整理|提交|释放|公开|私下|游说/u;
  const segments = text
    .split(/\s*(?:[。；;]|\s\/\s)\s*/u)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const concrete = segments.find((segment) => actionPattern.test(segment) && segment.length >= 6);
  return concrete || text;
}

function isAgentPlaceholderName(value?: string) {
  return /^agent[-_\s]*\d+$/i.test(String(value || '').trim());
}

function safeActorName(id: string, actors: RuntimeActor[]) {
  const actor = actors.find((item) => item.id === id);
  if (actor?.name && !isAgentPlaceholderName(actor.name)) return actor.name;
  return isAgentPlaceholderName(id) ? '' : id;
}

function isIncompleteActionText(value: string) {
  const text = String(value || '').trim();
  if (!text) return true;
  if (/(?:\.\.\.|…)\s*$/.test(text)) return true;
  if (/[“‘"'（(]\s*$/.test(text)) return true;
  return false;
}

function isMetaWorldText(value: string) {
  return /读到|读入|信号|调整自己的公开姿态|私下安排|观察流|观察脉冲|预检|等待模型补全|尚未创建世界|可以创建事件世界|中心假设引发|模型|provider|本地骨架|回退|威胁未除|未来或需|围绕「/i.test(
    String(value || ''),
  );
}

function isConcreteWorldAction(value: string) {
  const text = String(value || '').trim();
  if (!text || isMetaWorldText(text) || isIncompleteActionText(text) || /agent[-_\s]*\d+/i.test(text)) return false;
  return /下旨|命令|召见|要求|派出|联络|监视|劝说|上书|会见|威胁(?:要|逼|对|其|刘|韩|萧|张|吕|商|嬴|甘|公)|保护|试探|递交|整理|召集|游说|回应|拒绝|接受|谈判|封锁|释放|削去|保留|推动|安排|派遣|贬为|任命|处置|接见|密信|密奏/u.test(
    text,
  );
}

function isActionOwnedByActor(rawValue: string, cleanedValue: string, actor: RuntimeActor, actors: RuntimeActor[]) {
  const raw = String(rawValue || '');
  const cleaned = String(cleanedValue || '').trim();
  if (!cleaned) return false;
  if (isAgentPlaceholderName(actor.name) || isIncompleteActionText(cleaned) || /agent[-_\s]*\d+/i.test(`${raw} ${cleaned}`)) return false;
  const actorAuthority = `${actor.name} ${actor.role} ${actor.faction}`;
  if (/^(?:正式)?(?:下旨|诏令)|(?:下旨|诏令)[^。；;]{0,18}(?:贬|封|杀|赦|命令)/u.test(cleaned) && !/(皇帝|君主|国王|王\b|帝\b|太后|摄政|执政|总统|政府|朝廷|元首|君王|国君|秦王|汉王|皇权|王权)/u.test(actorAuthority)) {
    return false;
  }
  const actionVerb = '(?:下旨|命令|召见|要求|派出|联络|监视|劝说|上书|会见|威胁|保护|试探|递交|整理|召集|游说|回应|拒绝|接受|谈判|封锁|释放|削去|保留|推动|安排|派遣)';
  const otherActors = actors.filter((item) => item.id !== actor.id && item.name);
  const otherActsAsSubject = otherActors.some((item) => {
    const name = escapeRegExp(item.name);
    return (
      new RegExp(`(^|[。；;\\s])${name}[：:]`, 'u').test(raw) ||
      new RegExp(`${name}[^。；;]{0,16}${actionVerb}`, 'u').test(raw) ||
      new RegExp(`^${name}[^。；;]{0,16}${actionVerb}`, 'u').test(cleaned)
    );
  });
  if (otherActsAsSubject && !new RegExp(`${escapeRegExp(actor.name)}[^。；;]{0,20}${actionVerb}`, 'u').test(raw)) {
    return false;
  }
  return true;
}

function normalizeSummaryClause(value: string) {
  return cleanActionBody(sanitizeLegacyWorldText(value))
    .replace(/^[；;，,。.\s]+/u, '')
    .replace(/[；;，,。.\s]+$/u, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function joinSummarySentences(parts: string[]) {
  return parts
    .map(normalizeSummaryClause)
    .filter(Boolean)
    .map((part) => `${part}。`)
    .join('')
    .replace(/。+/gu, '。')
    .replace(/；。/gu, '。')
    .replace(/。；/gu, '。');
}

function buildHistorianWorldSummary(world: SimulationWorld, runtimeWorld: RuntimeWorld, refreshVersion = 0) {
  const happened = summarizeWorldEvents(world, runtimeWorld)
    .slice(0, 8)
    .map((item) => item.body || item.title)
    .map(normalizeSummaryClause)
    .filter((item) => item && !isMetaWorldText(item));
  const pressure = runtimeWorld.convergence.unresolvedConflicts
    .map(normalizeSummaryClause)
    .filter((item) => item && !isMetaWorldText(item))
    .slice(0, 1);
  const center = world.eventSummary || summarizeEventText(world.eventText || runtimeWorld.centerEvent || runtimeWorld.centralQuestion);
  if (!happened.length) {
    return `这条世界线刚刚从“${center}”展开，核心人物还在读取局势、试探边界。真正的变化尚未沉淀成稳定现场，接下来最值得观察的是谁会先把假设变成公开行动。`;
  }

  const first = happened[0];
  const latest = happened[happened.length - 1];
  const middle = happened.slice(1, -1).filter((item) => item !== first && item !== latest).slice(-2);
  const openings = [
    `这条世界线围绕“${center}”开始偏转。`,
    `沙盘中的“${center}”没有停留在单点假设，而是逐渐变成一串连锁选择。`,
    `从“${center}”出发，世界没有立刻给出结论，而是在人物试探中慢慢显形。`,
  ];
  const pressurePart = pressure.length
    ? `现在局势的悬念集中在${pressure[0]}，它会决定下一幕是继续收束，还是转入更激烈的分叉`
    : '现在局势仍未完全收束，人物之间的信任、资源和风险正在重新排列。';
  return joinSummarySentences([
    openings[refreshVersion % openings.length],
    `起初，${first}`,
    middle.length ? `随后，${middle.join('；')}` : '',
    `到目前为止，${latest}`,
    pressurePart,
  ]);
}

function actorActionScopeLabel(kind: 'action' | 'response' | 'affected' | 'plan' | 'dialogue' | 'memory') {
  const labels = {
    action: '本幕行动',
    response: '本幕回应',
    affected: '本幕受影响',
    plan: '本幕谋划',
    dialogue: '本幕行动',
    memory: '承接记忆',
  };
  return labels[kind];
}

function summarizeWorldEvents(world: SimulationWorld, runtimeWorld: RuntimeWorld) {
  const fromLogs = (world.actionLogs ?? [])
    .slice()
    .sort((left, right) => left.step - right.step)
    .map((log) => {
      const body = cleanActionBody(log.actionText || log.detail || log.action || log.impact);
      const actorName = isAgentPlaceholderName(log.agentName) ? '' : log.agentName;
      return {
        id: log.id,
        timeLabel: log.timeLabel,
        title: actorName ? `${actorName}${log.action ? `：${log.action}` : ''}` : log.action,
        body: actorName && body && !body.startsWith(actorName) ? `${actorName}：${body}` : body,
      };
    });
  const fromRuntime = runtimeWorld.stream
    .filter((event) => event.id !== 'runtime-seed')
    .slice()
    .reverse()
    .map((event) => ({
      id: event.id,
      timeLabel: event.timeLabel,
      title: event.title,
      body: cleanActionBody(event.actionText || event.body || event.impact),
    }));
  const seen = new Set<string>();
  const summarized = [...fromLogs, ...fromRuntime]
    .filter((item) => isConcreteWorldAction(item.body || item.title))
    .filter((item) => {
      const key = normalizeActionText(canonicalActionText(item.body || item.title));
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return summarized.length > 8 ? summarized.slice(-8) : summarized;
}

function actorActionTitle(actorName: string, peers: string[], relation: 'initiator' | 'responder' | 'affected') {
  if (!peers.length) return actorName;
  const peerText = peers.join('、');
  if (relation === 'responder') return `${actorName} 回应 ${peerText}`;
  if (relation === 'affected') return `${actorName} 受${peerText}影响`;
  return `${actorName} 对 ${peerText}`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isActorObjectMention(text: string, actorName: string) {
  const name = escapeRegExp(actorName);
  return new RegExp(
    `(?:将|把|对|向|针对|弹劾|清算|处置|压制|召见|要求|试探)${name}|${name}(?:的罪状|的罪名|之罪|被|受|遭|面临)`,
    'u',
  ).test(text);
}

function stripActorLead(text: string, actorName: string) {
  return text.replace(new RegExp(`^${escapeRegExp(actorName)}[：:]?\\s*`, 'u'), '').trim();
}

function extractConcreteAction(value: string, actorName: string, allowImplicitSubject = false) {
  const text = polishInterviewAnswer(String(value || ''))
    .replace(/^[^。；;]*压力[^。；;]*[。；;]\s*/u, '')
    .replace(/^[^。；;]*疑惧[^。；;]*[。；;]\s*/u, '')
    .replace(/^[^。；;]*误判空间[^。；;]*[。；;]\s*/u, '');
  const segments = text
    .split(/\s*(?:\/|；|;)\s*/u)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const actionPattern =
    /提出|交出|宣布|召见|说服|联络|弹劾|调查|保护|威胁|退让|进攻|逃离|密奏|编撰|命令|准备|试探|上书|会见|拜访|支持|呈递|接见|索取|发言|进言|嘉奖|削去|保留|联合|暗示|逼问|质询/u;
  const actorSegment = segments.find(
    (segment) =>
      new RegExp(`(^|[。；;\\s])${escapeRegExp(actorName)}[：:]`, 'u').test(segment) ||
      (segment.includes(actorName) && actionPattern.test(segment) && !isActorObjectMention(segment, actorName)),
  );
  const actionSegment = segments.find((segment) => actionPattern.test(segment));
  if (actorSegment) return stripActorLead(actorSegment, actorName);
  if (!allowImplicitSubject || isActorObjectMention(text, actorName)) return '';
  return stripActorLead(actionSegment || segments[0] || text, actorName);
}

function V2FocusPanel({
  actors,
  currentEventIds,
  currentPulse,
  cues,
  events,
  focus,
  interviewAgentId,
  interviewAnswer,
  interviewQuestion,
  isInterviewing,
  isSummarizingWorld,
  onRefreshWorldSummary,
  onClose,
  onInterview,
  onInterviewAgentChange,
  onInterviewQuestionChange,
  qaHistoryRecords,
  relations,
  runtimeWorld,
  worldSummaryText,
}: {
  actors: RuntimeActor[];
  currentEventIds: Set<string>;
  currentPulse: number;
  cues: V2StageCue[];
  events: RuntimeWorldEvent[];
  focus: StageFocus | null;
  interviewAgentId: string;
  interviewAnswer: string;
  interviewQuestion: string;
  isInterviewing: boolean;
  isSummarizingWorld: boolean;
  onRefreshWorldSummary: () => void;
  onClose: () => void;
  onInterview: (agentId?: string) => void;
  onInterviewAgentChange: (next: string) => void;
  onInterviewQuestionChange: (next: string) => void;
  qaHistoryRecords: QaHistoryRecord[];
  relations: RuntimeActorRelation[];
  runtimeWorld: RuntimeWorld;
  worldSummaryText: string;
}) {
  const actor = focus?.type === 'actor' ? actors.find((item) => item.id === focus.id) : null;
  const event = focus?.type === 'event' ? events.find((item) => item.id === focus.id) : null;
  const relation = focus?.type === 'relation' ? relations.find((item) => item.id === focus.id) : null;
  const cue = focus?.type === 'cue' ? cues.find((item) => item.id === focus.id) : null;
  const historianWorldSummary = focus?.type === 'world-summary' ? worldSummaryText : '';
  const relatedActors = actor
    ? relations
        .filter((item) => item.sourceActorId === actor.id || item.targetActorId === actor.id)
        .slice(0, 3)
        .map((item) => actors.find((candidate) => candidate.id === (item.sourceActorId === actor.id ? item.targetActorId : item.sourceActorId))?.name)
        .filter(Boolean)
    : [];
  const actorActionHistory = actor
    ? (() => {
        const seen = new Set<string>();
        return [
          ...events
            .filter((item) => item.actorIds.includes(actor.id) && currentEventIds.has(item.id) && item.pulse === currentPulse)
            .map((item) => {
              const isInitiator = item.initiatorActorId === actor.id || (!item.initiatorActorId && item.actorIds[0] === actor.id);
              const isResponder = Boolean(item.responderActorIds?.includes(actor.id));
              const isAffected = Boolean(item.affectedActorIds?.includes(actor.id) || item.targetActorIds?.includes(actor.id));
              const actionKind = isInitiator ? 'action' : isResponder ? 'response' : isAffected ? 'affected' : 'action';
              const peerIds = isInitiator
                ? [...(item.targetActorIds ?? []), ...(item.responderActorIds ?? [])]
                : item.initiatorActorId
                  ? [item.initiatorActorId]
                  : item.actorIds.filter((id) => id !== actor.id);
              const peers = peerIds.map((id) => safeActorName(id, actors)).filter(Boolean);
              const body = isInitiator
                ? item.actionText || extractConcreteAction(item.body || item.title, actor.name, item.actorIds.length === 1)
                : isResponder
                  ? item.responseText || extractConcreteAction(item.body || item.title, actor.name, false)
                  : isAffected
                    ? item.effectText || ''
                    : extractConcreteAction(item.body || item.title, actor.name, false);
              return {
                id: item.id,
                timeLabel: actorActionScopeLabel(actionKind),
                title: actorActionTitle(actor.name, peers, isResponder ? 'responder' : isAffected && !isInitiator ? 'affected' : 'initiator'),
                body: stripActorLead(cleanActionBody(body), actor.name),
                impact: '',
                priority: isInitiator ? 2 : isResponder ? 3 : 4,
                rawSource: [item.actionText, item.responseText, item.effectText, item.body, item.title].filter(Boolean).join('。'),
              };
            }),
          ...cues
            .filter((item) =>
              item.kind === 'dialogue'
                ? Boolean(item.lineByActorId?.[actor.id])
                : item.kind !== 'read' && item.sourceActorId === actor.id,
            )
            .map((item) => {
              const peers = (item.sourceActorId === actor.id ? item.targetActorIds : item.actorIds.filter((id) => id !== actor.id))
                .map((id) => safeActorName(id, actors))
                .filter(Boolean);
              const ownDialogueLine = item.kind === 'dialogue' ? item.lineByActorId?.[actor.id] : '';
              const body = ownDialogueLine ? stripActorLead(ownDialogueLine, actor.name) : extractConcreteAction(item.summary || item.title, actor.name, item.sourceActorId === actor.id);
              const actionKind = item.kind === 'dialogue' ? 'dialogue' : 'plan';
              return {
                id: item.id,
                timeLabel: actorActionScopeLabel(actionKind),
                title: actorActionTitle(actor.name, peers, item.kind === 'dialogue' && item.sourceActorId !== actor.id ? 'responder' : 'initiator'),
                body: stripActorLead(cleanActionBody(body), actor.name),
                impact: '',
                priority: item.kind === 'plan' ? 0 : 1,
                rawSource: [ownDialogueLine, item.summary, item.title].filter(Boolean).join('。'),
              };
            }),
        ]
          .sort((left, right) => left.priority - right.priority)
          .filter((item) => {
            const key = normalizeActionText(canonicalActionText(item.body));
            const hasSimilarAction = Array.from(seen).some(
              (seenKey) => seenKey.includes(key) || key.includes(seenKey),
            );
            if (!isActionOwnedByActor(item.rawSource, item.body, actor, actors)) return false;
            if (!isConcreteWorldAction(item.body)) return false;
            if (!key || seen.has(key) || hasSimilarAction) return false;
            seen.add(key);
            return Boolean(item.body || item.title);
          })
          .slice(0, 7);
      })()
    : [];
  const shouldShowActorIntent = actor
    ? !actorActionHistory.some((item) => {
        const intentKey = normalizeActionText(actor.intent);
        const actionKey = normalizeActionText(item.body);
        return Boolean(intentKey && actionKey && (intentKey.includes(actionKey) || actionKey.includes(intentKey)));
      })
    : false;

  return (
    <aside className={clsx('v2-focus-panel', focus && 'is-open')}>
      <div className="v2-focus-head">
        <span>观察镜头</span>
        <button onClick={onClose} type="button">
          收起
        </button>
      </div>

      {!focus ? (
        <div className="v2-focus-empty">
          <CircleDot size={18} />
          <strong>靠近一个人物或事件</strong>
          <p>点击舞台上的光点，查看他的动机、压力和可采访入口。</p>
        </div>
      ) : null}

      {actor ? (
        <article className="v2-focus-body">
          <h2>{actor.name}</h2>
          <p>{actor.role}</p>
          <div className="v2-focus-stats">
            <span>{statusLabel(actor.status)}</span>
            <span>{moodLabel(actor.mood)}</span>
            <span>{metricPercent(actor.influence)} 影响</span>
          </div>
          {shouldShowActorIntent ? (
            <div className="v2-focus-line">
              <b>当前意图</b>
              <span>{actor.intent}</span>
            </div>
          ) : null}
          {relatedActors.length ? (
            <div className="v2-focus-line">
              <b>牵连人物</b>
              <span>{relatedActors.join('、')}</span>
            </div>
          ) : null}
          <div className="v2-focus-actions">
            <b>人物行动</b>
            {actorActionHistory.length ? (
              actorActionHistory.map((item) => (
                <div className="v2-focus-action" key={item.id}>
                  <small>{item.timeLabel}</small>
                  <strong>{item.title}</strong>
                  <p>{item.body}</p>
                  {item.impact ? <em>{item.impact}</em> : null}
                </div>
              ))
            ) : (
              <div className="v2-focus-action">
                <small>本幕待观察</small>
                <strong>{actor.name}</strong>
                <p>尚未留下可明确归属到该人物的具体行动。</p>
              </div>
            )}
          </div>
          <div className="v2-interview">
            <div className="v2-interview-title">
              <MessageSquare size={15} />
              <span>现场采访</span>
            </div>
            <input value={interviewQuestion} onChange={(event) => onInterviewQuestionChange(event.target.value)} placeholder={`问${actor.name}一个问题`} />
            <button
              disabled={!interviewQuestion.trim() || isInterviewing}
              onClick={() => {
                if (interviewAgentId !== actor.id) onInterviewAgentChange(actor.id);
                onInterview(actor.id);
              }}
              type="button"
            >
              {isInterviewing ? <RefreshCw className="spin" size={15} /> : <Send size={15} />}
              <span>{isInterviewing ? '等待回应' : '递交问题'}</span>
            </button>
            {interviewAnswer ? <p>{polishInterviewAnswer(interviewAnswer)}</p> : null}
          </div>
        </article>
      ) : null}

      {event ? (
        <article className="v2-focus-body">
          <small>{runtimeEventLabels[event.type]} · {visibilityLabel(event.visibility)}</small>
          <h2>{displayRuntimeEventTitle(event)}</h2>
          <p>{displayRuntimeEventBody(event)}</p>
          <div className="v2-focus-line">
            <b>影响</b>
            <span>{displayRuntimeEventImpact(event)}</span>
          </div>
          <div className="v2-focus-line">
            <b>在场人物</b>
            <span>{event.actorIds.map((id) => actors.find((item) => item.id === id)?.name).filter(Boolean).join('、') || '世界旁白'}</span>
          </div>
        </article>
      ) : null}

      {relation ? (
        <article className="v2-focus-body">
          <small>{relationLabel(relation.kind)} · {metricPercent(relation.intensity)}</small>
          <h2>{relation.label}</h2>
          <p>{relation.lastEventTitle}</p>
          <div className="v2-focus-line">
            <b>双方</b>
            <span>
              {[relation.sourceActorId, relation.targetActorId]
                .map((id) => actors.find((item) => item.id === id)?.name)
                .filter(Boolean)
                .join(' / ')}
            </span>
          </div>
        </article>
      ) : null}

      {focus?.type === 'qa-history' ? (
        <article className="v2-focus-body">
          <small>世界采访记录</small>
          <h2>往期问答</h2>
          <p>这里仅显示当前世界里曾经问过的问题。</p>
          <div className="v2-focus-actions v2-qa-history-list">
            {qaHistoryRecords.length ? (
              qaHistoryRecords.map((record) => (
                <div className="v2-focus-action v2-qa-history-card" key={record.id}>
                  <small>{record.agentName || 'Agent'} · {new Date(record.createdAt).toLocaleString()}</small>
                  <strong>{record.question}</strong>
                  <p>{polishInterviewAnswer(record.answer)}</p>
                </div>
              ))
            ) : (
              <div className="v2-focus-action">
                <small>暂无记录</small>
                <strong>这个世界还没有采访记录</strong>
                <p>点击某个人物后提问，回答会自动出现在这里。</p>
              </div>
            )}
          </div>
        </article>
      ) : null}

      {focus?.type === 'world-summary' ? (
        <article className="v2-focus-body">
          <small>世界汇报</small>
          <div className="v2-summary-title-row">
            <h2>当前世界总结</h2>
            <button disabled={isSummarizingWorld} onClick={onRefreshWorldSummary} type="button">
              <RefreshCw className={clsx(isSummarizingWorld && 'spin')} size={15} />
              <span>{isSummarizingWorld ? '总结中' : '刷新'}</span>
            </button>
          </div>
          <p className="v2-historian-summary">{historianWorldSummary}</p>
          <div className="v2-focus-stats">
            <span>{metricPercent(runtimeWorld.stability)} 稳定</span>
            <span>{metricPercent(runtimeWorld.conflictLevel)} 冲突</span>
            <span>{metricPercent(runtimeWorld.confidence)} 可信</span>
          </div>
        </article>
      ) : null}

      {cue ? (
        <article className="v2-focus-body">
          <small>{cueKindLabel(cue.kind)} · {visibilityLabel(cue.visibility)}</small>
          <h2>{sanitizeLegacyWorldText(cue.title)}</h2>
          <p>{cleanActionBody(cue.summary)}</p>
          <div className="v2-focus-line">
            <b>读入者</b>
            <span>{actors.find((item) => item.id === cue.sourceActorId)?.name || '世界现场'}</span>
          </div>
          {cue.targetActorIds.length ? (
            <div className="v2-focus-line">
              <b>指向人物</b>
              <span>{cue.targetActorIds.map((id) => actors.find((item) => item.id === id)?.name).filter(Boolean).join('、')}</span>
            </div>
          ) : null}
          <div className="v2-focus-stats">
            <span>{metricPercent(cue.confidence)} 可信</span>
            <span>{cue.actorIds.length} 人牵连</span>
          </div>
        </article>
      ) : null}
    </aside>
  );
}

function AionWorldStageV2({
  eventText,
  generationMessage,
  generationSource,
  historyRecords,
  interviewAgentId,
  interviewAnswer,
  interviewQuestion,
  isInterviewing,
  isPulsing,
  onBackToQuery,
  onContinueWorld,
  onInterview,
  onInterviewAgentChange,
  onInterviewQuestionChange,
  onOpenProvider,
  onPulseWorld,
  onRefreshHistory,
  provider,
  runtimeWorld,
  world,
}: {
  eventText: string;
  generationMessage: string;
  generationSource: 'llm' | 'local';
  historyRecords: QaHistoryRecord[];
  interviewAgentId: string;
  interviewAnswer: string;
  interviewQuestion: string;
  isInterviewing: boolean;
  isPulsing: boolean;
  onBackToQuery: () => void;
  onContinueWorld: () => void;
  onInterview: (agentId?: string) => void;
  onInterviewAgentChange: (next: string) => void;
  onInterviewQuestionChange: (next: string) => void;
  onOpenProvider: () => void;
  onPulseWorld: (focusedPressureThreadId?: string) => void;
  onRefreshHistory: () => void;
  provider: ProviderConfig;
  runtimeWorld: RuntimeWorld;
  world: ReturnType<typeof createDraftWorld>;
}) {
  const [focus, setFocus] = useState<StageFocus | null>(null);
  const [selectedSceneIndex, setSelectedSceneIndex] = useState(0);
  const [summaryRefreshVersion, setSummaryRefreshVersion] = useState(0);
  const [modelWorldSummary, setModelWorldSummary] = useState('');
  const [isSummarizingWorld, setIsSummarizingWorld] = useState(false);
  const pulseSlices = useMemo(() => buildRuntimePulseSlices(runtimeWorld), [runtimeWorld]);
  const relations = useMemo(() => buildRuntimeRelations(runtimeWorld), [runtimeWorld]);
  const reactionChains = useMemo(() => buildRuntimeReactionChains(runtimeWorld), [runtimeWorld]);
  const dialogueExchanges = useMemo(() => buildRuntimeDialogueExchanges(runtimeWorld), [runtimeWorld]);
  const stageSlices: V2StageSlice[] = useMemo(() => {
    const timelineEventsByStep = new Map<number, RuntimeWorldEvent[]>();
    world.timeline.forEach((_, index) => {
      const matchingLogs = world.actionLogs.filter((log) => log.step === index);
      const events = matchingLogs.map((log, logIndex) => createTimelineStageEvent(world, runtimeWorld, index, log, logIndex));
      if (events.length) timelineEventsByStep.set(index, events);
    });
    const pulseSummarySlices: V2StageSlice[] = pulseSlices
      .filter((slice) => slice.events.length || slice.signals.length)
      .map((slice) => {
        const timelineEvents = timelineEventsByStep.get(slice.pulse) ?? [];
        const events = [...slice.events, ...timelineEvents].filter(
          (event, index, allEvents) => allEvents.findIndex((item) => item.id === event.id) === index,
        );
        const actorIds = Array.from(new Set([...slice.actorIds, ...events.flatMap((event) => event.actorIds)]));
        return {
          id: `pulse-${slice.pulse}`,
          pulse: slice.pulse,
          timeLabel: slice.timeLabel,
          phase: slice.phase,
          signals: slice.signals,
          events,
          actorIds,
          privateSignalCount: slice.privateSignalCount,
          publicEventCount: Math.max(slice.publicEventCount, events.filter((event) => event.visibility === 'public').length),
          hiddenEventCount: slice.hiddenEventCount,
          summary: sanitizeLegacyWorldText(slice.summary),
          kind: slice.signals.length && !events.length ? 'signal' : 'event',
          title: sanitizeLegacyWorldText(slice.summary || slice.phase),
          confidence: Math.max(...events.map((event) => event.confidence), ...slice.signals.map((signal) => signal.confidence), world.confidence),
          visibility: slice.hiddenEventCount || events.some((event) => event.visibility === 'secret') ? 'secret' : slice.privateSignalCount ? 'private' : 'public',
        };
      });
    const visibleTimelinePoints = world.timeline.slice(0, Math.max(runtimeWorld.pulse + 1, 1));
    const timelineSlices = visibleTimelinePoints.map((point, index) => {
      const matchingLogs = world.actionLogs.filter((log) => log.step === index);
      const events = matchingLogs.length
        ? matchingLogs.map((log, logIndex) => createTimelineStageEvent(world, runtimeWorld, index, log, logIndex))
        : [createTimelineStageEvent(world, runtimeWorld, index)];
      const actorIds = Array.from(new Set(events.flatMap((event) => event.actorIds)));
      const confidence = Math.max(...events.map((event) => event.confidence), point.confidence, world.confidence);
      return {
        id: `timeline-${index}`,
        pulse: index,
        timeLabel: point.year,
        phase: truncateText(point.branch || point.original, 10),
        signals: [],
        events,
        actorIds: actorIds.length ? actorIds : runtimeWorld.actors.slice(0, 3).map((actor) => actor.id),
        privateSignalCount: 0,
        publicEventCount: events.length,
        hiddenEventCount: 0,
        summary: sanitizeLegacyWorldText(point.branch || point.original),
        kind: 'timeline' as const,
        title: sanitizeLegacyWorldText(events.length > 1 ? `${point.branch || point.original} · ${events.length} 个行动` : events[0].title),
        confidence,
        visibility: events.some((event) => event.visibility === 'secret') ? 'secret' : events[0].visibility,
      };
    });
    const mergedSlices = new Map<number, V2StageSlice>();
    timelineSlices.forEach((slice) => mergedSlices.set(slice.pulse, slice));
    pulseSummarySlices.forEach((slice) => {
      const base = mergedSlices.get(slice.pulse);
      if (!base) {
        mergedSlices.set(slice.pulse, slice);
        return;
      }
      const events = [...slice.events, ...base.events].filter(
        (event, index, allEvents) => allEvents.findIndex((item) => item.id === event.id) === index,
      );
      const actorIds = Array.from(new Set([...slice.actorIds, ...base.actorIds, ...events.flatMap((event) => event.actorIds)]));
      mergedSlices.set(slice.pulse, {
        ...base,
        ...slice,
        id: slice.id,
        events,
        actorIds,
        publicEventCount: Math.max(slice.publicEventCount, base.publicEventCount, events.filter((event) => event.visibility === 'public').length),
        hiddenEventCount: Math.max(slice.hiddenEventCount, base.hiddenEventCount),
        privateSignalCount: Math.max(slice.privateSignalCount, base.privateSignalCount),
          summary: sanitizeLegacyWorldText(slice.summary || base.summary),
          title: sanitizeLegacyWorldText(slice.title || base.title),
        confidence: Math.max(slice.confidence, base.confidence, ...events.map((event) => event.confidence)),
        visibility:
          slice.visibility === 'secret' || base.visibility === 'secret'
            ? 'secret'
            : slice.visibility === 'private' || base.visibility === 'private'
              ? 'private'
              : slice.visibility,
      });
    });
    return Array.from(mergedSlices.values())
      .filter((slice) => slice.title || slice.summary)
      .sort((left, right) => left.pulse - right.pulse)
      .slice(0, 36);
  }, [pulseSlices, runtimeWorld, world]);
  useEffect(() => {
    const nextIndex = Math.max(stageSlices.length - 1, 0);
    queueMicrotask(() => {
      setSelectedSceneIndex((current) => (current === nextIndex ? current : nextIndex));
    });
  }, [runtimeWorld.pulse, stageSlices.length]);
  useEffect(() => {
    queueMicrotask(() => {
      setSummaryRefreshVersion(0);
      setModelWorldSummary('');
    });
  }, [runtimeWorld.pulse, runtimeWorld.stream.length]);
  const localWorldSummary = useMemo(
    () => buildHistorianWorldSummary(world, runtimeWorld, summaryRefreshVersion),
    [runtimeWorld, summaryRefreshVersion, world],
  );
  const visibleWorldSummary = modelWorldSummary || localWorldSummary;

  const handleRefreshWorldSummary = useCallback(async () => {
    setSummaryRefreshVersion((current) => current + 1);
    setModelWorldSummary('');
    if (!provider.apiKey.trim()) return;

    setIsSummarizingWorld(true);
    try {
      const result = await requestWorldSummary({ provider, runtimeWorld, world });
      if (result.ok && result.summary) {
        setModelWorldSummary(result.summary);
      }
    } finally {
      setIsSummarizingWorld(false);
    }
  }, [provider, runtimeWorld, world]);
  const selectedSliceIndex = Math.min(Math.max(selectedSceneIndex, 0), Math.max(stageSlices.length - 1, 0));
  const selectedSlice = stageSlices[selectedSliceIndex] ?? stageSlices[0];
  const currentPulse = selectedSlice?.pulse ?? runtimeWorld.pulse;
  const selectedSceneEvents = useMemo(() => selectedSlice?.events ?? [], [selectedSlice]);
  const eventOrder = useMemo(() => new Map(selectedSceneEvents.map((event, index) => [event.id, index])), [selectedSceneEvents]);
  const currentEventIds = useMemo(() => new Set(selectedSceneEvents.map((event) => event.id)), [selectedSceneEvents]);
  const visibleEvents = useMemo(() => {
    const currentEvents = selectedSceneEvents.filter((event) => event.id !== 'runtime-seed');
    const fallbackEvents = currentEvents.length
      ? currentEvents
      : runtimeWorld.stream.filter((event) => event.pulse === currentPulse && event.id !== 'runtime-seed');

    return fallbackEvents
      .filter((event, index, events) => events.findIndex((item) => item.id === event.id) === index)
      .sort((left, right) => {
        if (left.pulse !== right.pulse) return left.pulse - right.pulse;
        return (eventOrder.get(left.id) ?? 999) - (eventOrder.get(right.id) ?? 999);
      })
      .slice(0, 6);
  }, [currentPulse, eventOrder, runtimeWorld.stream, selectedSceneEvents]);
  const currentUpdatedActorIds = useMemo(() => {
    const ids = new Set<string>();
    visibleEvents.forEach((event) => {
      if (event.initiatorActorId) ids.add(event.initiatorActorId);
      event.responderActorIds?.forEach((id) => ids.add(id));
      if (!event.initiatorActorId && !event.responderActorIds?.length) {
        event.actorIds.slice(0, 1).forEach((id) => ids.add(id));
      }
    });
    selectedSlice?.signals?.forEach((signal) => {
      ids.add(signal.actorId);
    });
    return ids;
  }, [selectedSlice, visibleEvents]);
  const recentActorScores = useMemo(() => {
    const scores = new Map<string, number>();
    runtimeWorld.stream.slice(0, 24).forEach((event, eventIndex) => {
      event.actorIds.forEach((id) => {
        scores.set(id, (scores.get(id) ?? 0) + Math.max(1, 12 - eventIndex));
      });
    });
    runtimeWorld.signals.slice(0, 24).forEach((signal, signalIndex) => {
      scores.set(signal.actorId, (scores.get(signal.actorId) ?? 0) + Math.max(1, 8 - signalIndex));
      signal.targetActorIds.forEach((id) => scores.set(id, (scores.get(id) ?? 0) + Math.max(1, 4 - signalIndex)));
    });
    return scores;
  }, [runtimeWorld.signals, runtimeWorld.stream]);
  const visibleActors = runtimeWorld.actors
    .filter((actor) => !isAgentPlaceholderName(actor.name))
    .slice()
    .sort((left, right) => {
      const leftUpdated = currentUpdatedActorIds.has(left.id) ? 1 : 0;
      const rightUpdated = currentUpdatedActorIds.has(right.id) ? 1 : 0;
      if (leftUpdated !== rightUpdated) return rightUpdated - leftUpdated;
      const leftRecent = recentActorScores.get(left.id) ?? 0;
      const rightRecent = recentActorScores.get(right.id) ?? 0;
      if (leftRecent !== rightRecent) return rightRecent - leftRecent;
      const leftAlive = left.status === 'alive' ? 1 : 0;
      const rightAlive = right.status === 'alive' ? 1 : 0;
      if (leftAlive !== rightAlive) return rightAlive - leftAlive;
      return right.influence - left.influence;
    })
    .slice(0, 8);
  const stageActors = visibleActors.map((actor, index) => {
    const coordinates = [
      { x: 56, y: 51 },
      { x: 42, y: 34 },
      { x: 73, y: 33 },
      { x: 42, y: 68 },
      { x: 79, y: 66 },
      { x: 57, y: 22 },
      { x: 34, y: 50 },
      { x: 88, y: 49 },
    ][index] ?? { x: 50, y: 50 };
    const hasUpdate = currentUpdatedActorIds.has(actor.id);
    const isActive = hasUpdate;
    const pulseOffset = selectedSlice ? ((selectedSlice.pulse + index) % 3) - 1 : 0;
    const x = isActive ? coordinates.x + (50 - coordinates.x) * 0.08 : coordinates.x + pulseOffset * 1.2;
    const y = isActive ? coordinates.y + (50 - coordinates.y) * 0.08 : coordinates.y - pulseOffset;
    return { actor, index, hasUpdate, isActive, x, y };
  });
  const stageCues = useMemo(() => {
    const signalCues: V2StageCue[] = (selectedSlice?.signals ?? []).slice(0, 2).map((signal, index) => ({
      id: `cue-signal-${signal.id}`,
      kind: 'plan',
      title: `${signal.actorName} 正在谋划`,
      summary: signal.plannedAction || signal.privateIntent,
      actorIds: [signal.actorId, ...signal.targetActorIds],
      sourceActorId: signal.actorId,
      targetActorIds: signal.targetActorIds,
      confidence: signal.confidence,
      visibility: signal.visibility,
      x: [38, 64][index] ?? 52,
      y: [27, 72][index] ?? 62,
    }));
    const dialogueCues: V2StageCue[] = dialogueExchanges
      .filter((exchange) => exchange.pulse === currentPulse)
      .slice(0, 1)
      .map((exchange) => ({
        id: `cue-dialogue-${exchange.id}`,
        kind: 'dialogue',
        title: exchange.topic,
        summary: exchange.lines
          .map((line) => `${line.actorName}：${cleanActionBody(stripActorLead(line.text, line.actorName))}`)
          .filter((line) => line.replace(/^[^：:]+[：:]\s*/u, '').trim())
          .join(' / '),
        actorIds: exchange.participants,
        sourceActorId: exchange.lines[0]?.actorId ?? exchange.participants[0],
        targetActorIds: exchange.participants.filter((id) => id !== (exchange.lines[0]?.actorId ?? exchange.participants[0])),
        lineByActorId: Object.fromEntries(exchange.lines.map((line) => [line.actorId, cleanActionBody(stripActorLead(line.text, line.actorName))])),
        confidence: exchange.confidence,
        visibility: exchange.visibility,
        x: 50,
        y: 78,
      }));
    const reactionCues: V2StageCue[] = reactionChains
      .filter((chain) => chain.pulse === currentPulse)
      .slice(0, 2)
      .map((chain, index) => ({
        id: `cue-reaction-${chain.id}`,
        kind: 'read',
        title: `${chain.readerActorName} 读入信号`,
        summary: `${chain.triggerSummary}；${chain.reactionSummary}`,
        actorIds: [chain.readerActorId, ...chain.targetActorIds],
        sourceActorId: chain.readerActorId,
        targetActorIds: chain.targetActorIds,
        confidence: chain.confidence,
        visibility: chain.visibility,
        x: [33, 67][index] ?? 50,
        y: [72, 27][index] ?? 50,
      }));
    return [...dialogueCues, ...signalCues, ...reactionCues]
      .filter((cue, index, cues) => cues.findIndex((item) => item.id === cue.id) === index)
      .slice(0, 5);
  }, [currentPulse, dialogueExchanges, reactionChains, selectedSlice]);
  const focusEvents = useMemo(() => {
    const byId = new Map<string, RuntimeWorldEvent>();
    [...visibleEvents, ...stageSlices.flatMap((slice) => slice.events), ...runtimeWorld.stream].forEach((event) => byId.set(event.id, event));
    return Array.from(byId.values());
  }, [runtimeWorld.stream, stageSlices, visibleEvents]);
  const worldHistoryRecords = useMemo(
    () =>
      historyRecords
        .filter((record) => isHistoryRecordForWorld(record, world, runtimeWorld, eventText))
        .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()),
    [eventText, historyRecords, runtimeWorld, world],
  );
  const nextSceneNumber = stageSlices.length + 1;
  const centerEventText = eventText || runtimeWorld.centerEvent || runtimeWorld.centralQuestion || world.eventText;
  const centerEventSummary = world.eventSummary || truncateText(centerEventText, 24);
  const visibleGenerationMessage =
    generationSource === 'local' && /fetch|failed|error|network|请求|失败/i.test(generationMessage)
      ? '本地结构化观察室已启动'
      : displayGenerationMessage(generationMessage);

  return (
    <main className="world-shell v2-world-shell">
      <AionBackdrop />
      <header className="v2-topbar">
        <BrandTitle compact />
        <div className="v2-world-state">
          <span>{world.domain}</span>
          <b>{displayRuntimePhase(runtimeWorld.phase, runtimeWorld.pulse)}</b>
          <em className={clsx(generationSource === 'llm' ? 'status-ok' : 'status-local')}>{truncateText(visibleGenerationMessage, 24)}</em>
        </div>
        <div className="v2-top-actions">
          <button onClick={onBackToQuery} title="重新输入事件" type="button">
            <RotateCcw size={17} />
          </button>
          <button onClick={onOpenProvider} title="模型接入" type="button">
            <Settings size={17} />
          </button>
        </div>
      </header>

      <section className="v2-stage-shell">
        <div className="v2-stage-heading">
          <div>
            <small>中心事件</small>
            <button className="v2-center-event-title" title={centerEventText} type="button">
              <h1>{centerEventSummary}</h1>
              <span className="v2-center-event-tooltip" role="tooltip">
                <small>完整中心事件</small>
                <strong>{centerEventText}</strong>
              </span>
            </button>
          </div>
          <div className="v2-stage-controls">
            <button
              className={clsx(focus?.type === 'world-summary' && 'is-active')}
              onClick={() => setFocus({ type: 'world-summary' })}
              type="button"
            >
              <Gauge size={16} />
              <span>总结世界</span>
            </button>
            <button
              className={clsx(focus?.type === 'qa-history' && 'is-active')}
              onClick={() => {
                onRefreshHistory();
                setFocus({ type: 'qa-history' });
              }}
              type="button"
            >
              <MessageSquare size={16} />
              <span>往期问答</span>
              {worldHistoryRecords.length ? <em>{worldHistoryRecords.length}</em> : null}
            </button>
            <button disabled={runtimeWorld.convergence.shouldPause || isPulsing} onClick={() => onPulseWorld()} type="button">
              {isPulsing ? <RefreshCw className="spin" size={16} /> : <Sparkles size={16} />}
              <span>{isPulsing ? '收敛中' : `推进第 ${nextSceneNumber} 幕`}</span>
            </button>
            {runtimeWorld.convergence.shouldPause && runtimeWorld.convergence.pauseType === 'stage_convergence' ? (
              <button onClick={onContinueWorld} type="button">
                <GitBranch size={16} />
                <span>继续深入</span>
              </button>
            ) : null}
          </div>
        </div>

        <div className={clsx('v2-world-board', focus && 'has-focus')}>
          <section className="v2-stage-canvas" aria-label="事件世界现场">
            <div className="v2-stage-scatter" aria-label="当前幕画面">
              <div className="v2-event-column" aria-label="本幕事件">
                {visibleEvents.map((event) => (
                  <button
                    className={clsx('v2-event-pulse', focus?.type === 'event' && focus.id === event.id && 'is-focused', `event-${event.type}`)}
                    key={event.id}
                    onClick={() => setFocus({ type: 'event', id: event.id })}
                    type="button"
                  >
                    <strong>{truncateText(displayRuntimeEventTitle(event), 12)}</strong>
                    <small>{runtimeEventLabels[event.type]} · {visibilityLabel(event.visibility)}</small>
                  </button>
                ))}
              </div>

              {stageActors.map(({ actor, hasUpdate, index, isActive, x, y }) => (
                <button
                  className={clsx(
                    'v2-actor-node',
                    hasUpdate && 'has-update',
                    isActive && 'is-active',
                    focus?.type === 'actor' && focus.id === actor.id && 'is-focused',
                    actor.status !== 'alive' && 'is-inactive',
                  )}
                  key={actor.id}
                  onClick={() => {
                    setFocus({ type: 'actor', id: actor.id });
                    onInterviewAgentChange(actor.id);
                  }}
                  style={{ '--agent-color': agentColors[index % agentColors.length], '--actor-x': `${x}%`, '--actor-y': `${y}%` } as CSSProperties}
                  type="button"
                >
                  <span />
                  <strong>{truncateText(actor.name, 6)}</strong>
                </button>
              ))}
            </div>

            <div className="v2-scene-strip" aria-label="幕序列">
              {stageSlices.map((slice, index) => (
                <button
                  className={clsx(index === selectedSliceIndex && 'is-active')}
                  key={slice.id}
                  onClick={() => setSelectedSceneIndex(index)}
                  type="button"
                >
                  <small>第 {sceneNumberFromPulse(slice.pulse)} 幕</small>
                  <span>{sceneChangeLabel(slice)}</span>
                </button>
              ))}
            </div>
          </section>

          <V2FocusPanel
            actors={runtimeWorld.actors}
            currentEventIds={currentEventIds}
            currentPulse={currentPulse}
            cues={stageCues}
            events={focusEvents}
            focus={focus}
            interviewAgentId={interviewAgentId}
            interviewAnswer={interviewAnswer}
            interviewQuestion={interviewQuestion}
            isInterviewing={isInterviewing}
            isSummarizingWorld={isSummarizingWorld}
            onClose={() => setFocus(null)}
            onInterview={onInterview}
            onInterviewAgentChange={onInterviewAgentChange}
            onInterviewQuestionChange={onInterviewQuestionChange}
            onRefreshWorldSummary={handleRefreshWorldSummary}
            qaHistoryRecords={worldHistoryRecords}
            relations={relations}
            runtimeWorld={runtimeWorld}
            worldSummaryText={visibleWorldSummary}
          />
        </div>
      </section>
    </main>
  );
}

function WorldDashboard(props: {
  activeWorkbenchPage: WorkbenchPage;
  eventText: string;
  generationMessage: string;
  generationSource: 'llm' | 'local';
  historyRecords: QaHistoryRecord[];
  interviewAgentId: string;
  interviewAnswer: string;
  interviewQuestion: string;
  isInterviewing: boolean;
  isPulsing: boolean;
  onBackToQuery: () => void;
  onWorkbenchPageChange: (page: WorkbenchPage) => void;
  onInterview: () => void;
  onInterviewAgentChange: (next: string) => void;
  onInterviewQuestionChange: (next: string) => void;
  onContinueWorld: () => void;
  onOpenProvider: () => void;
  onPulseActorPerspective: (actorId: string) => void;
  onPulseWorld: (focusedPressureThreadId?: string) => void;
  onRefreshHistory: () => void;
  onTimelineInput: (event: FormEvent<HTMLInputElement>) => void;
  onToggleWorldRun: () => void;
  selectedBranch: SimulationBranch | null;
  isWorldRunning: boolean;
  runtimeWorld: RuntimeWorld;
  timelineProgress: number;
  totalSteps: number;
  world: ReturnType<typeof createDraftWorld>;
  provider: ProviderConfig;
}) {
  void buildAnalysisParagraph;
  void WorkbenchNav;
  void WorldContextStrip;
  void WorldRoom;
  return (
    <AionWorldStageV2
      eventText={props.eventText}
      generationMessage={props.generationMessage}
      generationSource={props.generationSource}
      historyRecords={props.historyRecords}
      interviewAgentId={props.interviewAgentId}
      interviewAnswer={props.interviewAnswer}
      interviewQuestion={props.interviewQuestion}
      isInterviewing={props.isInterviewing}
      isPulsing={props.isPulsing}
      onBackToQuery={props.onBackToQuery}
      onContinueWorld={props.onContinueWorld}
      onInterview={props.onInterview}
      onInterviewAgentChange={props.onInterviewAgentChange}
      onInterviewQuestionChange={props.onInterviewQuestionChange}
      onOpenProvider={props.onOpenProvider}
      onPulseWorld={props.onPulseWorld}
      provider={props.provider}
      onRefreshHistory={props.onRefreshHistory}
      runtimeWorld={props.runtimeWorld}
      world={props.world}
    />
  );
}

function App() {
  const [eventText, setEventText] = useState(starterPrompt);
  const [world, setWorld] = useState(() => createDraftWorld(starterPrompt, fixedGenerationHorizon));
  const [provider, setProvider] = useState<ProviderConfig>(defaultProviderConfig);
  const [providerResult, setProviderResult] = useState<ProviderTestResult | null>(null);
  const [view, setView] = useState<AppView>(() => (defaultProviderConfig.apiKey.trim() ? 'query' : 'provider'));
  const [isTesting, setIsTesting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPreflighting, setIsPreflighting] = useState(false);
  const [preflightResult, setPreflightResult] = useState<WorldPreflightResult | null>(null);
  const [preflightEventText, setPreflightEventText] = useState('');
  const [generationStage, setGenerationStage] = useState(0);
  const [generationMessage, setGenerationMessage] = useState('等待输入中心事件。');
  const [generationSource, setGenerationSource] = useState<'llm' | 'local'>('local');
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [timelineProgress, setTimelineProgress] = useState(0);
  const [interviewAgentId, setInterviewAgentId] = useState('');
  const [interviewQuestion, setInterviewQuestion] = useState('');
  const [interviewAnswer, setInterviewAnswer] = useState('');
  const [isInterviewing, setIsInterviewing] = useState(false);
  const [historyRecords, setHistoryRecords] = useState<QaHistoryRecord[]>([]);
  const [archiveSummaries, setArchiveSummaries] = useState<WorldArchiveSummary[]>([]);
  const [activeArchiveId, setActiveArchiveId] = useState(() => `world-${Date.now()}`);
  const [activeWorkbenchPage, setActiveWorkbenchPage] = useState<WorkbenchPage>('overview');
  const [runtimeWorld, setRuntimeWorld] = useState(() => createRuntimeWorld(createDraftWorld(starterPrompt, fixedGenerationHorizon)));
  const [isWorldRunning, setIsWorldRunning] = useState(false);
  const [isPulsing, setIsPulsing] = useState(false);
  const pulseLockRef = useRef(false);
  const runtimeWorldRef = useRef(runtimeWorld);
  const worldRef = useRef(world);
  const providerRef = useRef(provider);
  const activeArchiveIdRef = useRef(activeArchiveId);

  const selectedBranch = world.branches.find((branch) => branch.id === selectedBranchId) ?? world.branches[0] ?? null;
  const totalSteps = Math.max(world.simulationPlan.totalSteps, 2);
  const liveGenerationMessage = useMemo(
    () => {
      if (!isGenerating) return generationMessage;
      const elapsedSeconds = Math.max(1, Math.round(generationStage * 2.4));
      return `${generationStages[generationStage % generationStages.length]} · 已等待约 ${elapsedSeconds} 秒 · 最长等待 10 分钟`;
    },
    [generationMessage, generationStage, isGenerating],
  );

  useEffect(() => {
    if (!isGenerating) return undefined;
    const timer = window.setInterval(() => setGenerationStage((stage) => stage + 1), 2400);
    return () => window.clearInterval(timer);
  }, [isGenerating]);

  useEffect(() => {
    runtimeWorldRef.current = runtimeWorld;
  }, [runtimeWorld]);

  useEffect(() => {
    worldRef.current = world;
  }, [world]);

  useEffect(() => {
    providerRef.current = provider;
  }, [provider]);

  useEffect(() => {
    activeArchiveIdRef.current = activeArchiveId;
  }, [activeArchiveId]);

  async function loadQaHistory() {
    try {
      const response = await fetch('/api/qa-history');
      const payload = (await response.json()) as { ok?: boolean; records?: QaHistoryRecord[] };
      setHistoryRecords(Array.isArray(payload.records) ? payload.records : []);
    } catch {
      setHistoryRecords([]);
    }
  }

  async function loadWorldArchives() {
    setArchiveSummaries((await listWorldArchives()).slice(0, 80));
  }

  const persistWorldArchive = useCallback(async (
    nextRuntimeWorld: RuntimeWorld,
    nextWorld: SimulationWorld,
    source: 'llm' | 'local' = generationSource,
    message = generationMessage,
    archiveId = activeArchiveIdRef.current,
  ) => {
    const summary = await saveWorldArchive({
      id: archiveId,
      world: nextWorld,
      runtimeWorld: nextRuntimeWorld,
      source,
      message,
    });
    if (summary) {
      setArchiveSummaries((current) => [summary, ...current.filter((item) => item.id !== summary.id)].slice(0, 80));
    }
  }, [generationMessage, generationSource]);

  async function handleOpenArchive(id: string) {
    const archive = await loadWorldArchive(id);
    if (!archive?.world || !archive.runtimeWorld) return;
    setActiveArchiveId(archive.id);
    activeArchiveIdRef.current = archive.id;
    setWorld(archive.world);
    setRuntimeWorld(archive.runtimeWorld);
    setEventText(archive.world.eventText || archive.runtimeWorld.centerEvent || eventText);
    setSelectedBranchId(archive.world.branches[0]?.id ?? '');
    setInterviewAgentId(archive.world.agents[0]?.id ?? '');
    setTimelineProgress(0);
    setGenerationSource(archive.source ?? 'local');
    setGenerationMessage(archive.message || '已载入世界档案。');
    setIsGenerating(false);
    setIsWorldRunning(false);
    setActiveWorkbenchPage('overview');
    setView('world');
  }

  async function handleDeleteArchive(id: string) {
    setArchiveSummaries((current) => current.filter((item) => item.id !== id));
    const ok = await deleteWorldArchive(id);
    if (!ok) {
      await loadWorldArchives();
    }
    if (activeArchiveIdRef.current === id) {
      setActiveArchiveId('');
      activeArchiveIdRef.current = '';
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadQaHistory();
      void loadWorldArchives();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function handleTimelineProgressInput(event: FormEvent<HTMLInputElement>) {
    const nextProgress = Number(event.currentTarget.value);
    setTimelineProgress(nextProgress);
    if (world.branches.length > 1) {
      const nextIndex = Math.min(world.branches.length - 1, Math.floor((nextProgress / 100) * world.branches.length));
      setSelectedBranchId(world.branches[nextIndex]?.id ?? '');
    }
  }

  async function handleProviderTest() {
    setIsTesting(true);
    setProviderResult(null);
    const result = await testProviderConnection(provider);
    setProviderResult(result);
    setIsTesting(false);
  }

  function handleEventTextChange(next: string) {
    setEventText(next);
    if (normalizeHistoryKey(next) !== normalizeHistoryKey(preflightEventText)) {
      setPreflightResult(null);
    }
  }

  async function handlePreflightWorld() {
    setIsPreflighting(true);
    setGenerationMessage('正在分析中心事件是否足够创建世界。');
    const result = await requestWorldPreflight({ eventText, provider });
    setPreflightResult(result);
    setPreflightEventText(eventText);
    setGenerationMessage(withGenerationTime(result.message, result.latencyMs));
    setIsPreflighting(false);
  }

  async function handleGenerateSandbox() {
    const nextArchiveId = `world-${Date.now()}`;
    setActiveArchiveId(nextArchiveId);
    activeArchiveIdRef.current = nextArchiveId;
    setIsGenerating(true);
    setIsWorldRunning(false);
    setGenerationStage(0);
    setGenerationMessage('正在启动世界观察室。');
    setInterviewAnswer('');

    let activePreflight =
      preflightResult && normalizeHistoryKey(preflightEventText) === normalizeHistoryKey(eventText) ? preflightResult : null;
    const hasModelProvider = Boolean(provider.apiKey.trim());

    if (hasModelProvider) {
      if (!activePreflight) {
        setGenerationMessage('正在先分析该问题是否足够创建世界。');
        setIsPreflighting(true);
        activePreflight = await requestWorldPreflight({ eventText, provider });
        setPreflightResult(activePreflight);
        setPreflightEventText(eventText);
        setIsPreflighting(false);
      }

      if (!activePreflight.canSimulate) {
        setGenerationSource('local');
        setGenerationMessage(activePreflight.message || '该输入暂时不足以创建可观察世界。');
        setIsGenerating(false);
        setIsWorldRunning(false);
        setView('query');
        return;
      }

      setGenerationMessage('创建前分析已通过，正在等待模型生成完整世界。');
    } else {
      const previewWorld = createSimulationWorld(eventText, fixedGenerationHorizon);
      if (!previewWorld.agents.length) {
        setWorld(previewWorld);
        setGenerationSource('local');
        setGenerationMessage(previewWorld.simulationPlan.stopReason);
        setIsGenerating(false);
        setIsWorldRunning(false);
        setView('query');
        return;
      }
      const previewRuntimeWorld = createRuntimeWorld(previewWorld);
      setWorld(previewWorld);
      setRuntimeWorld(previewRuntimeWorld);
      setGenerationSource('local');
      setGenerationMessage('未配置 API Key，已启动本地离线骨架。');
      setSelectedBranchId(previewWorld.branches[0]?.id ?? '');
      setInterviewAgentId(previewWorld.agents[0]?.id ?? '');
      setTimelineProgress(0);
      setIsGenerating(false);
      setActiveWorkbenchPage('overview');
      setView('world');
      void persistWorldArchive(previewRuntimeWorld, previewWorld, 'local', '未配置 API Key，已启动本地离线骨架。', nextArchiveId);
      return;
    }

    const result = await generateSimulationWorld({ eventText, horizon: fixedGenerationHorizon, provider, preflight: activePreflight });
    if (hasModelProvider && result.source === 'local') {
      setGenerationSource(result.source);
      setGenerationMessage(result.message);
      setIsGenerating(false);
      setIsWorldRunning(false);
      setView('query');
      return;
    }

    if (!result.world.agents.length) {
      setWorld(result.world);
      setGenerationSource(result.source);
      setGenerationMessage(result.message);
      setIsGenerating(false);
      setIsWorldRunning(false);
      setView('query');
      return;
    }

    const generatedRuntimeWorld = createRuntimeWorld(result.world);
    setWorld(result.world);
    setRuntimeWorld(generatedRuntimeWorld);
    setGenerationSource(result.source);
    const resultMessage = withGenerationTime(result.message, result.latencyMs);
    setGenerationMessage(resultMessage);
    setIsGenerating(false);
    setSelectedBranchId(result.world.branches[0]?.id ?? '');
    setInterviewAgentId(result.world.agents[0]?.id ?? '');
    setTimelineProgress(0);
    setActiveWorkbenchPage('overview');
    setView('world');
    await persistWorldArchive(
      generatedRuntimeWorld,
      result.world,
      result.source,
      resultMessage,
      nextArchiveId,
    );
  }

  const pulseWorldOnce = useCallback(async (focusedPressureThreadId?: string) => {
    const currentRuntime = runtimeWorldRef.current;
    if (pulseLockRef.current || currentRuntime.convergence.shouldPause) return;

    pulseLockRef.current = true;
    setIsPulsing(true);

    const result = await requestRuntimePulse({
      provider: providerRef.current,
      runtimeWorld: currentRuntime,
      world: worldRef.current,
      focusedPressureThreadId,
    });

    const pulseMessage = withGenerationTime(result.message, result.latencyMs);
    if (providerRef.current.apiKey.trim() && result.source === 'local') {
      setGenerationMessage(`${withGenerationTime(result.message, result.latencyMs)} 当前世界未改写。`);
      pulseLockRef.current = false;
      setIsPulsing(false);
      setIsWorldRunning(false);
      return;
    }
    setGenerationSource(result.source);
    setGenerationMessage(withGenerationTime(result.message, result.latencyMs));
    setRuntimeWorld((current) => {
      const next = result.events.length || result.signals.length || result.actorUpdates.length
        ? applyRuntimeEvents(current, worldRef.current, result.events, result.signals, result.actorUpdates)
        : advanceRuntimeWorld(current, worldRef.current);
      if (next.convergence.shouldPause) {
        window.setTimeout(() => setIsWorldRunning(false), 0);
      }
      window.setTimeout(() => void persistWorldArchive(next, worldRef.current, result.source, pulseMessage), 0);
      return next;
    });
    setTimelineProgress(100);

    pulseLockRef.current = false;
    setIsPulsing(false);
  }, [persistWorldArchive]);

  const pulseActorPerspectiveOnce = useCallback(
    async (actorId: string) => {
      const currentRuntime = runtimeWorldRef.current;
      if (pulseLockRef.current || currentRuntime.convergence.shouldPause) return;

      pulseLockRef.current = true;
      setIsPulsing(true);

      try {
        const result = await requestActorPerspectivePulse({
          actorId,
          provider: providerRef.current,
          runtimeWorld: currentRuntime,
          world: worldRef.current,
        });
        const pulseMessage = withGenerationTime(result.message, result.latencyMs);

        if (providerRef.current.apiKey.trim() && result.source === 'local') {
          setGenerationMessage(`${pulseMessage} 当前世界未改写。`);
          setIsWorldRunning(false);
          return;
        }
        setGenerationSource(result.source);
        setGenerationMessage(pulseMessage);
        setRuntimeWorld((current) => {
          const next = result.events.length || result.signals.length || result.actorUpdates.length
            ? applyRuntimeEvents(current, worldRef.current, result.events, result.signals, result.actorUpdates)
            : advanceRuntimeWorld(current, worldRef.current);
          if (next.convergence.shouldPause) {
            window.setTimeout(() => setIsWorldRunning(false), 0);
          }
          window.setTimeout(() => void persistWorldArchive(next, worldRef.current, result.source, pulseMessage), 0);
          return next;
        });
        setTimelineProgress(100);
      } finally {
        pulseLockRef.current = false;
        setIsPulsing(false);
      }
    },
    [persistWorldArchive],
  );

  useEffect(() => {
    if (!isWorldRunning) return undefined;
    const timer = window.setInterval(() => {
      void pulseWorldOnce();
    }, 2400);
    return () => window.clearInterval(timer);
  }, [isWorldRunning, pulseWorldOnce]);

  function handlePulseWorld(focusedPressureThreadId?: string) {
    void pulseWorldOnce(focusedPressureThreadId);
  }

  function handlePulseActorPerspective(actorId: string) {
    void pulseActorPerspectiveOnce(actorId);
  }

  function handleToggleWorldRun() {
    if (runtimeWorld.convergence.shouldPause) return;
    setIsWorldRunning((current) => !current);
  }

  function handleContinueWorld() {
    setRuntimeWorld((current) => {
      const next = continueRuntimeWorld(current);
      window.setTimeout(() => void persistWorldArchive(next, worldRef.current, generationSource, '世界已进入下一轮观察。'), 0);
      return next;
    });
    setTimelineProgress(100);
    setIsWorldRunning(false);
  }

  async function handleInterviewAgent(agentIdOverride?: string) {
    const targetAgentId = agentIdOverride || interviewAgentId;
    const agent = world.agents.find((item) => item.id === targetAgentId);
    if (!agent || !interviewQuestion.trim()) return;
    if (agent.id !== interviewAgentId) setInterviewAgentId(agent.id);
    setIsInterviewing(true);
    setInterviewAnswer('');

    try {
      const currentRuntime = runtimeWorldRef.current;
      const actorContexts = buildActorVisibleContexts(currentRuntime);
      const actorLedgers = buildRuntimeActorLedgers(currentRuntime);
      const confrontationScenes = buildRuntimeConfrontationScenes(currentRuntime);
      const observationFlow = buildRuntimeObservationFlow(currentRuntime);
      const result = await requestAgentInterview({
        actorContext: actorContexts.find((context) => context.actorId === agent.id),
        actorLedger: actorLedgers.find((ledger) => ledger.actor.id === agent.id),
        agent,
        confrontationScenes: confrontationScenes.filter((scene) => scene.actorIds.includes(agent.id)).slice(0, 5),
        observationFlow: observationFlow.filter((frame) => frame.actorIds.includes(agent.id)).slice(0, 4),
        provider: providerRef.current,
        question: interviewQuestion,
        runtimeWorld: currentRuntime,
        world,
      });
      setInterviewAnswer(result.answer);
      if (result.ok) {
        await fetch('/api/qa-history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: `qa-${Date.now()}`,
            createdAt: new Date().toISOString(),
            agentId: agent.id,
            agentName: agent.name,
            question: interviewQuestion,
            answer: result.answer,
            worldTitle: world.title,
            centerEvent: world.eventText,
          }),
        });
        await loadQaHistory();
      }
    } catch (error) {
      setInterviewAnswer(error instanceof Error ? error.message : '采访失败');
    }

    setIsInterviewing(false);
  }

  if (view === 'provider') {
    return (
      <ProviderSetupScreen
        isTesting={isTesting}
        onContinue={() => setView('query')}
        onProviderChange={setProvider}
        onProviderTest={handleProviderTest}
        provider={provider}
        providerResult={providerResult}
      />
    );
  }

  if (view === 'query' || isGenerating) {
    return (
      <EventQueryScreen
        archiveSummaries={archiveSummaries}
        eventText={eventText}
        generationMessage={liveGenerationMessage}
        isGenerating={isGenerating}
        isPreflighting={isPreflighting}
        preflightResult={preflightResult}
        onEventChange={handleEventTextChange}
        onGenerate={handleGenerateSandbox}
        onPreflight={handlePreflightWorld}
        onDeleteArchive={(id) => void handleDeleteArchive(id)}
        onOpenProvider={() => setView('provider')}
        onOpenArchive={(id) => void handleOpenArchive(id)}
        onRefreshArchives={() => void loadWorldArchives()}
      />
    );
  }

  return (
    <WorldDashboard
      activeWorkbenchPage={activeWorkbenchPage}
      eventText={eventText}
      generationMessage={generationMessage}
      generationSource={generationSource}
      historyRecords={historyRecords}
      interviewAgentId={interviewAgentId}
      interviewAnswer={interviewAnswer}
      interviewQuestion={interviewQuestion}
      isInterviewing={isInterviewing}
      isPulsing={isPulsing}
      isWorldRunning={isWorldRunning}
      onBackToQuery={() => setView('query')}
      onContinueWorld={handleContinueWorld}
      onInterview={handleInterviewAgent}
      onInterviewAgentChange={setInterviewAgentId}
      onInterviewQuestionChange={setInterviewQuestion}
      onOpenProvider={() => setView('provider')}
      onPulseActorPerspective={handlePulseActorPerspective}
      onPulseWorld={handlePulseWorld}
      onRefreshHistory={() => void loadQaHistory()}
      onTimelineInput={handleTimelineProgressInput}
      onToggleWorldRun={handleToggleWorldRun}
      onWorkbenchPageChange={setActiveWorkbenchPage}
      provider={provider}
      runtimeWorld={runtimeWorld}
      selectedBranch={selectedBranch}
      timelineProgress={timelineProgress}
      totalSteps={totalSteps}
      world={world}
    />
  );
}

export default App;
