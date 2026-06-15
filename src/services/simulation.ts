import { jsonrepair } from 'jsonrepair';
import { createDraftWorld, createSimulationWorld, summarizeEventText } from '../domain/simulator';
import type {
  AgentProfile,
  AgentActionLog,
  EvidenceItem,
  EventAnalysis,
  GraphMemoryNode,
  HorizonMode,
  SimulationPlan,
  SimulationBranch,
  SimulationWorld,
  TimelinePoint,
  WorldMetric,
} from '../domain/types';
import type { ProviderConfig } from './providers';

export interface SimulationGenerateResult {
  world: SimulationWorld;
  source: 'llm' | 'local';
  message: string;
  latencyMs?: number;
}

export interface WorldPreflightActor {
  name: string;
  role: string;
  identity?: string;
  reason?: string;
  confidence?: number;
}

export interface WorldPreflightResult {
  canSimulate: boolean;
  confidence: number;
  domain: string;
  eventSummary: string;
  enrichedEventText: string;
  reasons: string[];
  missing: string[];
  backgroundNotes: string[];
  suggestedActors: WorldPreflightActor[];
  message: string;
  latencyMs?: number;
}

interface SimulationApiResponse {
  ok: boolean;
  content?: string;
  message?: string;
  latencyMs?: number;
}

const PREFLIGHT_REQUEST_TIMEOUT_MS = 4 * 60 * 1000;
const SIMULATION_REQUEST_TIMEOUT_MS = 10 * 60 * 1000;

const emptyPreflight: WorldPreflightResult = {
  canSimulate: false,
  confidence: 0.08,
  domain: '待分析',
  eventSummary: '',
  enrichedEventText: '',
  reasons: [],
  missing: [],
  backgroundNotes: [],
  suggestedActors: [],
  message: '尚未分析。',
};

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function clamp(value: unknown, fallback: number): number {
  return Math.min(0.98, Math.max(0.08, asNumber(value, fallback)));
}

function asArray<T>(value: unknown, mapper: (item: unknown, index: number) => T): T[] {
  return Array.isArray(value) ? value.map(mapper) : [];
}

function asStringArray(value: unknown, fallback: string[] = []): string[] {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 8) : fallback;
}

export function normalizeWorldPreflight(raw: unknown, eventText: string, latencyMs?: number): WorldPreflightResult {
  const row = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const actors = asArray<WorldPreflightActor>(row.suggestedActors, (item, index) => {
    const actor = typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : {};
    return {
      name: asString(actor.name, `人物 ${index + 1}`),
      role: asString(actor.role, '事件参与者'),
      identity: typeof actor.identity === 'string' ? actor.identity : undefined,
      reason: typeof actor.reason === 'string' ? actor.reason : undefined,
      confidence: clamp(actor.confidence, 0.58),
    };
  }).filter((actor) => actor.name && !isNonPersonName(actor.name));
  const canSimulate = Boolean(row.canSimulate) && actors.length >= 3;
  const missing = asStringArray(row.missing, canSimulate ? [] : ['缺少足够具体的人物、关系或行动信息']);
  return {
    canSimulate,
    confidence: clamp(row.confidence, canSimulate ? 0.62 : 0.22),
    domain: asString(row.domain, '通用事件'),
    eventSummary: asString(row.eventSummary, summarizeEventText(eventText)),
    enrichedEventText: asString(row.enrichedEventText, eventText),
    reasons: asStringArray(row.reasons, canSimulate ? ['模型判断该事件具有明确人物与冲突，可以创建世界。'] : []),
    missing,
    backgroundNotes: asStringArray(row.backgroundNotes),
    suggestedActors: actors,
    message: canSimulate ? '预检通过，可以创建事件世界。' : `暂不建议创建：${missing.join('；')}`,
    latencyMs,
  };
}

function createPreflightFallbackWorld(eventText: string, horizon: HorizonMode, preflight: WorldPreflightResult): SimulationWorld {
  const world = createDraftWorld(eventText, horizon);
  const actors: AgentProfile[] = preflight.suggestedActors.map((actor, index) => ({
    id: `agent-preflight-${index + 1}`,
    name: actor.name,
    role: actor.role,
    identity: actor.identity || actor.reason || actor.role,
    dilemma: actor.reason || '需要在中心事件改变后重新选择行动。',
    currentPressure: preflight.reasons[index % Math.max(preflight.reasons.length, 1)] || '中心事件已经改变原有局势。',
    goals: ['守住核心利益', '判断其他人物反应', '争取下一步主动权'],
    constraints: preflight.missing.length ? preflight.missing.slice(0, 3) : ['信息仍需由后续生成补全'],
    leverage: preflight.backgroundNotes.slice(0, 3).length ? preflight.backgroundNotes.slice(0, 3) : ['人物身份与既有关系'],
    actions: [`围绕「${preflight.eventSummary || summarizeEventText(eventText)}」先做出试探行动`],
    relationships: actorsRelationHint(preflight.suggestedActors, index),
    riskTolerance: clamp(0.52 + index * 0.04, 0.58),
    confidence: actor.confidence ?? preflight.confidence,
  }));
  const branches: SimulationBranch[] = [
    {
      id: 'branch-preflight-stable',
      title: '预检稳定线',
      horizon,
      credibility: preflight.confidence,
      divergence: 0.28,
      trigger: preflight.reasons[0] || '中心事件具备可推演人物与冲突。',
      summary: preflight.backgroundNotes[0] || '模型预检认为该事件可以进入世界生成。',
      causalChain: preflight.reasons.length ? preflight.reasons : ['中心事件成立', '关键人物开始行动', '世界线进入分支'],
      storyBeats: preflight.backgroundNotes.length ? preflight.backgroundNotes : ['等待分阶段生成补全具体场景'],
      metrics: [{ id: 'metric-preflight-confidence', label: '预检置信', value: `${Math.round(preflight.confidence * 100)}%`, delta: '+LLM', tone: 'volatile' }],
      tone: 'volatile',
    },
    {
      id: 'branch-preflight-conflict',
      title: '冲突升级线',
      horizon,
      credibility: Math.max(0.18, preflight.confidence - 0.12),
      divergence: 0.48,
      trigger: preflight.reasons[1] || '关键人物利益无法同时满足。',
      summary: '后续生成会检验人物行动是否把冲突推向升级。',
      causalChain: ['人物目标冲突', '行动引发回应', '世界线扩大分歧'],
      storyBeats: ['等待模型生成具体交锋'],
      metrics: [{ id: 'metric-preflight-pressure', label: '冲突压力', value: '待生成', delta: '+?', tone: 'speculative' }],
      tone: 'speculative',
    },
    {
      id: 'branch-preflight-fragment',
      title: '权力重组线',
      horizon,
      credibility: Math.max(0.16, preflight.confidence - 0.18),
      divergence: 0.56,
      trigger: preflight.reasons[2] || '原有秩序被改变点扰动。',
      summary: '后续生成会补全事件对制度、阵营或组织的连锁影响。',
      causalChain: ['改变点扰动秩序', '人物重新站队', '新均衡形成或失败'],
      storyBeats: ['等待模型生成新均衡'],
      metrics: [{ id: 'metric-preflight-order', label: '秩序重组', value: '待观察', delta: '+?', tone: 'speculative' }],
      tone: 'speculative',
    },
  ];

  return {
    ...world,
    eventSummary: preflight.eventSummary || summarizeEventText(eventText),
    domain: preflight.domain,
    centralQuestion: eventText,
    confidence: preflight.confidence,
    simulationPlan: {
      startLabel: '预检通过',
      endLabel: '等待模型生成完整世界',
      durationLabel: '由 LLM 判断',
      totalSteps: 6,
      stopReason: preflight.reasons.join('；') || preflight.message,
    },
    eventAnalysis: {
      facts: [eventText, ...preflight.backgroundNotes.slice(0, 3)],
      assumptions: preflight.reasons.slice(0, 4),
      causes: preflight.backgroundNotes.slice(0, 4),
      openQuestions: preflight.missing,
    },
    evidence: [
      { id: 'ev-user', claim: eventText, source: 'user_input', confidence: 0.9, usedIn: ['preflight'] },
      { id: 'ev-preflight', claim: preflight.message, source: 'llm_background', confidence: preflight.confidence, usedIn: ['preflight'] },
    ],
    agents: actors,
    actionLogs: actors.map((actor, index) => {
      const target = actors[(index + 1) % actors.length];
      return {
        id: `act-preflight-${index + 1}`,
        step: index % 4,
        timeLabel: `预检阶段 ${index + 1}`,
        agentId: actor.id,
        agentName: actor.name,
        initiatorActorId: actor.id,
        targetActorIds: target ? [target.id] : [],
        responderActorIds: target ? [target.id] : [],
        affectedActorIds: [],
        action: actor.actions?.[0] || '试探局势',
        detail: actor.actions?.[0] || actor.dilemma || '根据预检信息准备行动。',
        impact: target ? `${target.name}需要回应${actor.name}带来的压力。` : '后续生成将补全影响。',
        actionText: actor.actions?.[0] || '试探局势',
        responseText: target ? `${target.name}观察并准备回应。` : '',
        effectText: '预检世界骨架等待模型补全。',
        branchId: branches[index % branches.length]?.id,
        confidence: actor.confidence,
      };
    }),
    branches,
    timeline: [
      { year: '预检', original: '尚未创建世界', branch: preflight.message, confidence: preflight.confidence },
      { year: '第一幕', original: '等待模型补全', branch: preflight.reasons[0] || '关键人物开始行动', confidence: Math.max(0.1, preflight.confidence - 0.08) },
      { year: '后续', original: '等待模型补全', branch: '世界线进入多人物交互', confidence: Math.max(0.1, preflight.confidence - 0.16) },
    ],
    metrics: [
      { id: 'metric-preflight', label: '预检置信', value: `${Math.round(preflight.confidence * 100)}%`, delta: preflight.canSimulate ? '可创建' : '不足', tone: preflight.canSimulate ? 'stable' : 'speculative' },
    ],
  };
}

function actorsRelationHint(actors: WorldPreflightActor[], index: number): string[] {
  const next = actors[(index + 1) % actors.length]?.name;
  const other = actors[(index + 2) % actors.length]?.name;
  return [next ? `与${next}存在事件关联` : '', other ? `可能牵动${other}的选择` : ''].filter(Boolean);
}

const nonPersonNamePatterns = [
  /集团/,
  /阶层/,
  /势力/,
  /派/,
  /君主$/,
  /民众/,
  /贵族/,
  /官僚/,
  /军队/,
  /国家/,
  /政府/,
  /组织/,
  /公司/,
  /公众/,
  /决策者/,
  /代表$/,
  /阵营/,
  /宗室/,
];

const neutralPersonNames = ['李衡', '陈策', '周岚', '赵闻', '沈砚', '顾行', '许昭'];

function isNonPersonName(value: string): boolean {
  return nonPersonNamePatterns.some((pattern) => pattern.test(value)) || /^人物\s*\d+$/u.test(value) || /^agent[-_\s]*\d+$/iu.test(value);
}

function normalizeAgentName(value: unknown, index: number, fallbackName?: string): string {
  const raw = asString(value, fallbackName || neutralPersonNames[index % neutralPersonNames.length]);
  if (!isNonPersonName(raw)) return raw;
  if (fallbackName && !isNonPersonName(fallbackName)) return fallbackName;
  return neutralPersonNames[index % neutralPersonNames.length];
}

function mergeFinalAgents(generatedAgents: AgentProfile[], fallbackAgents: AgentProfile[]): AgentProfile[] {
  const used = new Set<string>();
  const result: AgentProfile[] = [];
  [...generatedAgents, ...fallbackAgents].forEach((agent, index) => {
    const name = normalizeAgentName(agent.name, index);
    if (used.has(name)) return;
    used.add(name);
    result.push({ ...agent, name });
  });
  return result.slice(0, Math.max(5, generatedAgents.length || fallbackAgents.length));
}

function agentFromActionName(name: string, index: number): AgentProfile {
  return {
    id: `agent-log-${index + 1}-${name.replace(/[^\p{Script=Han}a-zA-Z0-9]+/gu, '').slice(0, 16) || index + 1}`,
    name,
    role: '事件参与者',
    identity: `${name}在模型行动日志中被识别为具体人物。`,
    dilemma: '需要在中心事件改变后的压力中选择立场。',
    currentPressure: '其行动已经影响到其他人物对局势的判断。',
    goals: ['保全自身利益', '回应中心事件带来的局势变化'],
    constraints: ['信息不完整', '受到其他关键人物牵制'],
    leverage: ['既有人脉与历史位置'],
    actions: ['根据局势变化采取具体行动'],
    relationships: [],
    riskTolerance: 0.5,
    confidence: 0.54,
  };
}

function supplementAgentsFromActionLogs(agents: AgentProfile[], rawActionLogs: unknown): AgentProfile[] {
  if (!Array.isArray(rawActionLogs)) return agents;
  const usedNames = new Set(agents.map((agent) => agent.name));
  const additions: AgentProfile[] = [];
  rawActionLogs.forEach((item) => {
    const row = typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : {};
    const name = typeof row.agentName === 'string' ? row.agentName.trim() : '';
    if (!name || isNonPersonName(name) || usedNames.has(name)) return;
    usedNames.add(name);
    additions.push(agentFromActionName(name, agents.length + additions.length));
  });
  return [...agents, ...additions].slice(0, Math.max(5, agents.length + additions.length));
}

export function buildRelevanceTerms(eventText: string): string[] {
  const stopWords = new Set(['如果', '之后', '没有', '如何', '发展', '事件', '影响', '什么', '可能', '产生']);
  const compact = eventText.replace(/[^\p{Script=Han}a-zA-Z0-9]+/gu, '');
  const terms = new Set<string>();

  for (let size = 2; size <= 4; size += 1) {
    for (let index = 0; index <= compact.length - size; index += 1) {
      const term = compact.slice(index, index + size);
      if (!stopWords.has(term)) terms.add(term);
    }
  }

  return Array.from(terms).filter((term) => /[\p{Script=Han}a-zA-Z0-9]/u.test(term)).slice(0, 28);
}

export function isGeneratedWorldRelevant(eventText: string, generatedText: string): boolean {
  const terms = buildRelevanceTerms(eventText);
  if (!terms.length) return true;
  const hitCount = terms.filter((term) => generatedText.includes(term)).length;
  return hitCount >= Math.min(2, terms.length);
}

export function extractJsonObject(content: string): unknown {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? content;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('模型没有返回 JSON 对象');
  }
  const jsonText = candidate.slice(start, end + 1);
  try {
    return JSON.parse(jsonText);
  } catch (primaryError) {
    try {
      return JSON.parse(jsonrepair(jsonText));
    } catch (repairError) {
      const squashed = jsonText.replace(/,\s*,+/g, ',').replace(/([,[{])\s*,+/g, '$1');
      try {
        return JSON.parse(jsonrepair(squashed));
      } catch {
        throw repairError instanceof Error ? repairError : primaryError;
      }
    }
  }
}

function fallbackBranch(fallback: SimulationWorld, index: number): SimulationBranch {
  return fallback.branches[index] ?? fallback.branches[0] ?? {
    id: `branch-fallback-${index + 1}`,
    title: '模型生成分支',
    horizon: fallback.horizon,
    credibility: fallback.confidence || 0.58,
    divergence: 0.35,
    trigger: fallback.centralQuestion || fallback.eventText,
    summary: fallback.simulationPlan.stopReason || '等待模型补全分支走向。',
    causalChain: [fallback.eventText],
    storyBeats: [],
    metrics: [],
    tone: 'volatile',
  };
}

function fallbackTimelinePoint(fallback: SimulationWorld, index: number): TimelinePoint {
  return fallback.timeline[index] ?? fallback.timeline[0] ?? {
    year: `阶段 ${index + 1}`,
    original: fallback.eventText,
    branch: fallback.centralQuestion || fallback.eventText,
    confidence: fallback.confidence || 0.58,
  };
}

export function normalizeGeneratedWorld(raw: unknown, fallback: SimulationWorld): SimulationWorld {
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};

  const evidence = asArray<EvidenceItem>(source.evidence, (item, index) => {
    const row = typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : {};
    return {
      id: asString(row.id, `ev-llm-${index + 1}`),
      claim: asString(row.claim, fallback.evidence[index]?.claim ?? '模型补全证据'),
      source: 'llm_background',
      confidence: clamp(row.confidence, fallback.evidence[index]?.confidence ?? 0.58),
      usedIn: Array.isArray(row.usedIn) ? row.usedIn.map(String) : ['llm-generation'],
    };
  });

  const generatedAgents = asArray<AgentProfile>(source.agents, (item, index) => {
    const row = typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : {};
    return {
      id: asString(row.id, `agent-llm-${index + 1}`),
      name: normalizeAgentName(row.name, index, fallback.agents[index]?.name),
      role: asString(row.role, fallback.agents[index]?.role ?? '事件参与者'),
      identity: asString(row.identity, fallback.agents[index]?.identity ?? ''),
      dilemma: asString(row.dilemma, fallback.agents[index]?.dilemma ?? ''),
      currentPressure: asString(row.currentPressure, fallback.agents[index]?.currentPressure ?? ''),
      goals: Array.isArray(row.goals) ? row.goals.map(String).slice(0, 4) : fallback.agents[index]?.goals ?? [],
      constraints: Array.isArray(row.constraints)
        ? row.constraints.map(String).slice(0, 4)
        : fallback.agents[index]?.constraints ?? [],
      leverage: Array.isArray(row.leverage) ? row.leverage.map(String).slice(0, 4) : fallback.agents[index]?.leverage ?? [],
      actions: Array.isArray(row.actions) ? row.actions.map(String).slice(0, 5) : fallback.agents[index]?.actions ?? [],
      relationships: Array.isArray(row.relationships)
        ? row.relationships.map(String).slice(0, 5)
        : fallback.agents[index]?.relationships ?? [],
      riskTolerance: clamp(row.riskTolerance, fallback.agents[index]?.riskTolerance ?? 0.5),
      confidence: clamp(row.confidence, fallback.agents[index]?.confidence ?? 0.58),
    };
  });
  const agents = supplementAgentsFromActionLogs(mergeFinalAgents(generatedAgents, fallback.agents), source.actionLogs);

  const branches = asArray<SimulationBranch>(source.branches, (item, index) => {
    const row = typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : {};
    const base = fallbackBranch(fallback, index);
    return {
      id: asString(row.id, `branch-llm-${index + 1}`),
      title: asString(row.title, base.title),
      horizon: fallback.horizon,
      credibility: clamp(row.credibility, base.credibility),
      divergence: clamp(row.divergence, base.divergence),
      trigger: asString(row.trigger, base.trigger),
      summary: asString(row.summary, base.summary),
      causalChain: Array.isArray(row.causalChain) ? row.causalChain.map(String).slice(0, 8) : base.causalChain,
      storyBeats: Array.isArray(row.storyBeats) ? row.storyBeats.map(String).slice(0, 6) : base.storyBeats ?? [],
      metrics: asArray<WorldMetric>(row.metrics, (metric, metricIndex) => {
        const metricRow = typeof metric === 'object' && metric !== null ? (metric as Record<string, unknown>) : {};
        return {
          id: asString(metricRow.id, `${base.id}-metric-${metricIndex + 1}`),
          label: asString(metricRow.label, base.metrics[metricIndex]?.label ?? '影响指标'),
          value: asString(metricRow.value, base.metrics[metricIndex]?.value ?? '中'),
          delta: asString(metricRow.delta, base.metrics[metricIndex]?.delta ?? '+0%'),
          tone: base.tone,
        };
      }),
      tone: base.tone,
    };
  });

  const timeline = asArray<TimelinePoint>(source.timeline, (item, index) => {
    const row = typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : {};
    const base = fallbackTimelinePoint(fallback, index);
    return {
      year: asString(row.year, base.year),
      original: asString(row.original, base.original),
      branch: asString(row.branch, base.branch),
      confidence: clamp(row.confidence, base.confidence),
    };
  });

  const planRow =
    typeof source.simulationPlan === 'object' && source.simulationPlan !== null
      ? (source.simulationPlan as Record<string, unknown>)
      : {};
  const simulationPlan: SimulationPlan = {
    startLabel: asString(planRow.startLabel, fallback.simulationPlan.startLabel),
    endLabel: asString(planRow.endLabel, fallback.simulationPlan.endLabel),
    durationLabel: asString(planRow.durationLabel, fallback.simulationPlan.durationLabel),
    totalSteps: Math.max(2, Math.round(asNumber(planRow.totalSteps, fallback.simulationPlan.totalSteps))),
    stopReason: asString(planRow.stopReason, fallback.simulationPlan.stopReason),
  };

  const analysisRow =
    typeof source.eventAnalysis === 'object' && source.eventAnalysis !== null
      ? (source.eventAnalysis as Record<string, unknown>)
      : {};
  const eventAnalysis: EventAnalysis = {
    facts: Array.isArray(analysisRow.facts) ? analysisRow.facts.map(String).slice(0, 8) : fallback.eventAnalysis.facts,
    assumptions: Array.isArray(analysisRow.assumptions)
      ? analysisRow.assumptions.map(String).slice(0, 8)
      : fallback.eventAnalysis.assumptions,
    causes: Array.isArray(analysisRow.causes) ? analysisRow.causes.map(String).slice(0, 8) : fallback.eventAnalysis.causes,
    openQuestions: Array.isArray(analysisRow.openQuestions)
      ? analysisRow.openQuestions.map(String).slice(0, 8)
      : fallback.eventAnalysis.openQuestions,
  };

  const graphMemory = asArray<GraphMemoryNode>(source.graphMemory, (item, index) => {
    const row = typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : {};
    return {
      id: asString(row.id, `mem-${index + 1}`),
      label: asString(row.label, `记忆节点 ${index + 1}`),
      type: ['event', 'person', 'group', 'place', 'cause', 'assumption', 'consequence'].includes(String(row.type))
        ? (String(row.type) as GraphMemoryNode['type'])
        : 'event',
      summary: asString(row.summary, ''),
      confidence: clamp(row.confidence, 0.62),
      links: Array.isArray(row.links) ? row.links.map(String).slice(0, 8) : [],
    };
  });

  let actionLogs = asArray<AgentActionLog>(source.actionLogs, (item, index) => {
    const row = typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : {};
    const step = Math.max(0, Math.min(simulationPlan.totalSteps - 1, Math.round(asNumber(row.step, index))));
    const knownAgentIds = new Set(agents.map((agent) => agent.id));
    const rawAgentId = asString(row.agentId, '');
    const rawAgentName = typeof row.agentName === 'string' ? row.agentName.trim() : '';
    const nameMatchedAgent = rawAgentName ? agents.find((agent) => agent.name === rawAgentName) : undefined;
    const fallbackAgent = agents[index % Math.max(agents.length, 1)];
    const agentId = knownAgentIds.has(rawAgentId) ? rawAgentId : nameMatchedAgent?.id ?? fallbackAgent?.id ?? `agent-${index + 1}`;
    const matchedAgent = agents.find((agent) => agent.id === agentId);
    const agentName = matchedAgent?.name ?? normalizeAgentName(row.agentName, index);
    const initiatorActorId = asString(row.initiatorActorId, agentId);
    const targetActorIds = Array.isArray(row.targetActorIds)
      ? row.targetActorIds.map(String).filter((id) => knownAgentIds.has(id) && id !== initiatorActorId).slice(0, 4)
      : [];
    const responderActorIds = Array.isArray(row.responderActorIds)
      ? row.responderActorIds.map(String).filter((id) => knownAgentIds.has(id) && id !== initiatorActorId).slice(0, 4)
      : [];
    const affectedActorIds = Array.isArray(row.affectedActorIds)
      ? row.affectedActorIds.map(String).filter((id) => knownAgentIds.has(id) && id !== initiatorActorId).slice(0, 4)
      : [];
    const action = asString(row.action, '行动未说明');
    const detail = asString(row.detail, '');
    const impact = asString(row.impact, '');
    return {
      id: asString(row.id, `act-${index + 1}`),
      step,
      timeLabel: asString(row.timeLabel, `T+${step}`),
      agentId,
      agentName,
      initiatorActorId: knownAgentIds.has(initiatorActorId) ? initiatorActorId : agentId,
      targetActorIds,
      responderActorIds,
      affectedActorIds,
      actionText: asString(row.actionText, detail || action),
      responseText: asString(row.responseText, ''),
      effectText: asString(row.effectText, impact),
      action,
      detail,
      impact,
      branchId: typeof row.branchId === 'string' ? row.branchId : undefined,
      confidence: clamp(row.confidence, 0.58),
    };
  });

  if (agents.length) {
    const nextLogIndex = () => actionLogs.length + 1;
    const coveredAgents = new Set(actionLogs.map((log) => log.agentId));
    agents.forEach((agent, index) => {
      if (coveredAgents.has(agent.id)) return;
      const step = Math.min(simulationPlan.totalSteps - 1, index % simulationPlan.totalSteps);
      actionLogs.push({
        id: `act-agent-${nextLogIndex()}`,
        step,
        timeLabel: timeline[step]?.year ?? `阶段 ${step + 1}`,
        agentId: agent.id,
        agentName: agent.name,
        initiatorActorId: agent.id,
        targetActorIds: [],
        responderActorIds: [],
        affectedActorIds: [],
        action: agent.actions?.[0] ?? agent.currentPressure ?? agent.dilemma ?? '做出关键选择',
        detail: agent.dilemma || agent.currentPressure || agent.identity || agent.role,
        impact: agent.relationships?.[0] || agent.constraints[0] || '改变周围人物对事件走向的判断。',
        actionText: agent.actions?.[0] ?? agent.dilemma ?? agent.currentPressure ?? agent.identity ?? agent.role,
        responseText: '',
        effectText: agent.relationships?.[0] || agent.constraints[0] || '改变周围人物对事件走向的判断。',
        branchId: branches[0]?.id,
        confidence: agent.confidence,
      });
    });

    for (let step = 0; step < simulationPlan.totalSteps; step += 1) {
      if (actionLogs.some((log) => log.step === step)) continue;
      const agent = agents[step % agents.length];
      const branch = branches[step % Math.max(branches.length, 1)];
      const beat = branch?.storyBeats?.[step % Math.max(branch.storyBeats.length, 1)] || branch?.causalChain?.[0];
      actionLogs.push({
        id: `act-step-${nextLogIndex()}`,
        step,
        timeLabel: timeline[step]?.year ?? `阶段 ${step + 1}`,
        agentId: agent.id,
        agentName: agent.name,
        initiatorActorId: agent.id,
        targetActorIds: [],
        responderActorIds: [],
        affectedActorIds: [],
        action: agent.actions?.[0] ?? beat ?? '推进事件',
        detail: beat || agent.dilemma || agent.currentPressure || `${agent.name}围绕中心事件采取行动。`,
        impact: branch?.summary || agent.constraints[0] || '事件线继续分叉。',
        actionText: agent.actions?.[0] ?? beat ?? agent.dilemma ?? agent.currentPressure ?? '推进事件',
        responseText: '',
        effectText: branch?.summary || agent.constraints[0] || '事件线继续分叉。',
        branchId: branch?.id,
        confidence: Math.min(agent.confidence, branch?.credibility ?? 0.58),
      });
    }

    actionLogs = actionLogs.sort((left, right) => left.step - right.step);
  }

  const normalized: SimulationWorld = {
    ...fallback,
    title: asString(source.title, fallback.title),
    eventSummary: asString(source.eventSummary, fallback.eventSummary || summarizeEventText(fallback.eventText)),
    domain: asString(source.domain, fallback.domain),
    centralQuestion: asString(source.centralQuestion, fallback.centralQuestion),
    confidence: clamp(source.confidence, fallback.confidence),
    simulationPlan,
    eventAnalysis,
    graphMemory: graphMemory.length ? graphMemory : fallback.graphMemory,
    evidence: evidence.length ? evidence : fallback.evidence,
    agents,
    actionLogs,
    branches: branches.length ? branches : fallback.branches,
    timeline: timeline.length ? timeline : fallback.timeline,
  };

  return normalized;
}

export async function generateSimulationWorld(options: {
  eventText: string;
  horizon: HorizonMode;
  provider: ProviderConfig;
  preflight?: WorldPreflightResult | null;
}): Promise<SimulationGenerateResult> {
  const localFallback = createSimulationWorld(options.eventText, options.horizon);
  const fallback =
    !localFallback.agents.length && options.preflight?.canSimulate
      ? createPreflightFallbackWorld(options.eventText, options.horizon, options.preflight)
      : localFallback;

  if (!options.provider.apiKey.trim()) {
    return {
      world: fallback,
      source: 'local',
      message: fallback.agents.length ? '未填写 API Key，已启动本地离线骨架。' : fallback.simulationPlan.stopReason,
    };
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), SIMULATION_REQUEST_TIMEOUT_MS);
  let response: Response;
  let payload: SimulationApiResponse;

  try {
    response = await fetch('/api/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
      signal: controller.signal,
    });
    payload = (await response.json()) as SimulationApiResponse;
  } catch (error) {
    return {
      world: fallback,
      source: 'local',
      message: error instanceof DOMException && error.name === 'AbortError'
        ? '模型生成等待超过 10 分钟，未展示本地骨架，请稍后重试。'
        : '模型生成失败，未展示本地骨架，请检查模型配置后重试。',
    };
  } finally {
    window.clearTimeout(timeoutId);
  }

  if (!response.ok || !payload.ok || !payload.content) {
    return {
      world: fallback,
      source: 'local',
      message: payload.message || '模型生成失败，未展示本地骨架，请检查模型配置后重试。',
      latencyMs: payload.latencyMs,
    };
  }

  try {
    const raw = extractJsonObject(payload.content);
    if (!isGeneratedWorldRelevant(options.eventText, JSON.stringify(raw))) {
      throw new Error('模型返回内容与中心事件相关性不足');
    }
    return {
      world: normalizeGeneratedWorld(raw, fallback),
      source: 'llm',
      message: '模型沙盘生成成功。',
      latencyMs: payload.latencyMs,
    };
  } catch (error) {
    return {
      world: fallback,
      source: 'local',
      message: error instanceof Error ? `${error.message}，未展示本地骨架，请重新生成。` : '解析失败，未展示本地骨架，请重新生成。',
      latencyMs: payload.latencyMs,
    };
  }
}

export async function requestWorldPreflight(options: {
  eventText: string;
  provider: ProviderConfig;
}): Promise<WorldPreflightResult> {
  if (!options.eventText.trim()) {
    return {
      ...emptyPreflight,
      message: '请先输入中心事件。',
      missing: ['中心事件不能为空'],
    };
  }
  if (!options.provider.apiKey.trim()) {
    return {
      ...emptyPreflight,
      eventSummary: summarizeEventText(options.eventText),
      enrichedEventText: options.eventText,
      message: '需要先配置模型 API Key，才能做创建前分析。',
      missing: ['未配置模型 API Key'],
    };
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), PREFLIGHT_REQUEST_TIMEOUT_MS);
  let response: Response;
  let payload: SimulationApiResponse;

  try {
    response = await fetch('/api/preflight', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
      signal: controller.signal,
    });
    payload = (await response.json()) as SimulationApiResponse;
  } catch (error) {
    return {
      ...emptyPreflight,
      eventSummary: summarizeEventText(options.eventText),
      enrichedEventText: options.eventText,
      message: error instanceof DOMException && error.name === 'AbortError' ? '预检等待超过 4 分钟，请稍后重试。' : '预检请求失败，请检查模型连接。',
      missing: ['模型预检请求失败'],
    };
  } finally {
    window.clearTimeout(timeoutId);
  }

  if (!response.ok || !payload.ok || !payload.content) {
    return {
      ...emptyPreflight,
      eventSummary: summarizeEventText(options.eventText),
      enrichedEventText: options.eventText,
      message: payload.message || '预检失败。',
      missing: [payload.message || '模型未返回预检内容'],
      latencyMs: payload.latencyMs,
    };
  }

  try {
    const raw = extractJsonObject(payload.content);
    return normalizeWorldPreflight(raw, options.eventText, payload.latencyMs);
  } catch (error) {
    return {
      ...emptyPreflight,
      eventSummary: summarizeEventText(options.eventText),
      enrichedEventText: options.eventText,
      message: error instanceof Error ? `预检解析失败：${error.message}` : '预检解析失败。',
      missing: ['模型预检 JSON 无法解析'],
      latencyMs: payload.latencyMs,
    };
  }
}
