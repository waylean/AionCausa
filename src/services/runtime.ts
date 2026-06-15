import { jsonrepair } from 'jsonrepair';
import type {
  RuntimeActor,
  RuntimeActorUpdate,
  RuntimeAgentSignal,
  RuntimeEventType,
  RuntimeVisibility,
  RuntimeWorld,
  RuntimeWorldEvent,
  SimulationWorld,
} from '../domain/types';
import {
  buildActorVisibleContexts,
  buildRuntimeDialogueExchanges,
  buildRuntimePressureThreads,
  buildRuntimeReactionChains,
} from '../domain/worldRuntime';
import type { ProviderConfig } from './providers';

interface RuntimePulseApiResponse {
  ok: boolean;
  content?: string;
  message?: string;
  latencyMs?: number;
}

export interface RuntimePulseResult {
  events: RuntimeWorldEvent[];
  signals: RuntimeAgentSignal[];
  actorUpdates: RuntimeActorUpdate[];
  source: 'llm' | 'local';
  message: string;
  latencyMs?: number;
}

const eventTypes: RuntimeEventType[] = ['speech', 'move', 'conflict', 'alliance', 'betrayal', 'death', 'policy', 'rumor', 'convergence'];
const visibilityTypes: RuntimeVisibility[] = ['public', 'faction', 'private', 'rumor', 'secret', 'observer_only'];
const actorStatuses: RuntimeActorUpdate['status'][] = ['alive', 'dead', 'exiled', 'imprisoned', 'missing', 'retired', 'disgraced', 'underground'];
const actorUpdateActions: RuntimeActorUpdate['action'][] = ['add', 'update', 'exit'];
const actorMoods: RuntimeActor['mood'][] = ['calculating', 'defensive', 'aggressive', 'fragile', 'withdrawn'];
const RUNTIME_PULSE_TIMEOUT_MS = 5 * 60 * 1000;

function asString(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function asNumber(value: unknown, fallback: number) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function clamp(value: unknown, fallback: number) {
  return Math.min(0.98, Math.max(0.06, asNumber(value, fallback)));
}

function slugActorName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/agent[-_\s]*\d+/gi, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36);
}

function isConcreteActorName(value: string) {
  const text = value.trim();
  if (!text || /^agent[-_\s]*\d+$/i.test(text)) return false;
  if (/^(某人|有人|一名|亲信|侍从|信使|集团|势力|旧部|官员|大臣|将领|幕僚)$/u.test(text)) return false;
  return text.length >= 2 && text.length <= 18;
}

function actorFromUpdate(update: RuntimeActorUpdate): RuntimeActor {
  return {
    id: update.actorId,
    name: update.name,
    role: update.role,
    faction: update.faction || update.role,
    status: update.status || 'alive',
    pressure: update.pressure || update.reason,
    intent: update.intent || update.reason,
    risk: clamp(update.risk, 0.5),
    influence: clamp(update.influence, update.confidence || 0.52),
    mood: update.mood || 'calculating',
    memory: [update.reason, ...(update.memory || [])].filter(Boolean).slice(0, 6),
  };
}

function extractJsonObject(content: string): unknown {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? content;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) throw new Error('模型没有返回 JSON 对象');
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

export function normalizeRuntimeActorUpdates(raw: unknown, runtimeWorld: RuntimeWorld): RuntimeActorUpdate[] {
  const row = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const rawUpdates = Array.isArray(row.actorUpdates) ? row.actorUpdates : [];
  const actorById = new Map(runtimeWorld.actors.map((actor) => [actor.id, actor]));
  const actorByName = new Map(runtimeWorld.actors.map((actor) => [actor.name, actor]));
  const nextPulse = runtimeWorld.pulse + 1;
  const seen = new Set<string>();

  return rawUpdates
    .map((item, index): RuntimeActorUpdate | null => {
      const update = typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : {};
      const action = actorUpdateActions.includes(String(update.action) as RuntimeActorUpdate['action'])
        ? (String(update.action) as RuntimeActorUpdate['action'])
        : 'update';
      const rawName = asString(update.name, '');
      const existingById = actorById.get(asString(update.actorId, ''));
      const existingByName = actorByName.get(rawName);
      const existing = existingById || existingByName;
      if (action === 'add' && (!isConcreteActorName(rawName) || existing)) return null;
      if (action !== 'add' && !existing) return null;

      const name = action === 'add' ? rawName : existing?.name || rawName;
      const actorId =
        action === 'add'
          ? asString(update.actorId, `runtime-actor-${slugActorName(name) || index + 1}-${nextPulse}`)
          : existing?.id || asString(update.actorId, '');
      if (!actorId || seen.has(actorId)) return null;
      seen.add(actorId);
      const status = actorStatuses.includes(String(update.status) as RuntimeActorUpdate['status'])
        ? (String(update.status) as RuntimeActorUpdate['status'])
        : action === 'exit'
          ? 'retired'
          : existing?.status || 'alive';
      const mood = actorMoods.includes(String(update.mood) as RuntimeActor['mood'])
        ? (String(update.mood) as RuntimeActor['mood'])
        : existing?.mood;
      const reason = asString(update.reason, asString(update.pressure, action === 'add' ? `${name}进入事件世界。` : `${name}状态发生变化。`));

      return {
        id: asString(update.id, `actor-update-${nextPulse}-${index + 1}`),
        pulse: nextPulse,
        action,
        actorId,
        name,
        role: asString(update.role, existing?.role || '新进入事件现场的人物'),
        faction: asString(update.faction, existing?.faction || asString(update.role, '事件新变量')),
        status,
        pressure: asString(update.pressure, existing?.pressure || reason),
        intent: asString(update.intent, existing?.intent || reason),
        risk: clamp(update.risk, existing?.risk ?? 0.5),
        influence: clamp(update.influence, existing?.influence ?? 0.52),
        mood,
        memory: Array.isArray(update.memory) ? update.memory.map(String).filter(Boolean).slice(0, 6) : [],
        reason,
        sourceEventId: asString(update.sourceEventId, ''),
        confidence: clamp(update.confidence, runtimeWorld.confidence),
      };
    })
    .filter((update): update is RuntimeActorUpdate => Boolean(update));
}

export function normalizeRuntimePulse(raw: unknown, runtimeWorld: RuntimeWorld, actorUpdates: RuntimeActorUpdate[] = []): RuntimeWorldEvent[] {
  const row = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const rawEvents = Array.isArray(row.events) ? row.events : [];
  const knownActorIds = new Set([...runtimeWorld.actors.map((actor) => actor.id), ...actorUpdates.filter((update) => update.action === 'add').map((update) => update.actorId)]);
  const nextPulse = runtimeWorld.pulse + 1;

  return rawEvents
    .map((item, index): RuntimeWorldEvent => {
      const event = typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : {};
      const type = eventTypes.includes(String(event.type) as RuntimeEventType) ? (String(event.type) as RuntimeEventType) : 'move';
      const visibility = visibilityTypes.includes(String(event.visibility) as RuntimeVisibility)
        ? (String(event.visibility) as RuntimeVisibility)
        : 'public';
      const initiatorActorId = asString(event.initiatorActorId, '');
      const targetActorIds = Array.isArray(event.targetActorIds)
        ? event.targetActorIds.map(String).filter((id) => knownActorIds.has(id) && id !== initiatorActorId).slice(0, 4)
        : [];
      const responderActorIds = Array.isArray(event.responderActorIds)
        ? event.responderActorIds.map(String).filter((id) => knownActorIds.has(id) && id !== initiatorActorId).slice(0, 4)
        : [];
      const affectedActorIds = Array.isArray(event.affectedActorIds)
        ? event.affectedActorIds.map(String).filter((id) => knownActorIds.has(id) && id !== initiatorActorId).slice(0, 4)
        : [];
      const explicitActorIds = Array.isArray(event.actorIds)
        ? event.actorIds.map(String).filter((id) => knownActorIds.has(id)).slice(0, 4)
        : [];
      const actorIds = Array.from(
        new Set([
          ...(knownActorIds.has(initiatorActorId) ? [initiatorActorId] : []),
          ...targetActorIds,
          ...responderActorIds,
          ...affectedActorIds,
          ...explicitActorIds,
        ]),
      ).slice(0, 6);

      return {
        id: asString(event.id, `llm-pulse-${Date.now()}-${index + 1}`),
        pulse: nextPulse,
        timeLabel: asString(event.timeLabel, `第 ${nextPulse + 1} 幕`),
        type,
        visibility,
        actorIds,
        initiatorActorId: knownActorIds.has(initiatorActorId) ? initiatorActorId : actorIds[0],
        targetActorIds,
        responderActorIds,
        affectedActorIds,
        actionText: asString(event.actionText, asString(event.body, '')),
        responseText: asString(event.responseText, ''),
        effectText: asString(event.effectText, asString(event.impact, '')),
        title: asString(event.title, '世界出现新的微小扰动'),
        body: asString(event.body, 'Agent 根据可见信息调整了下一步行动。'),
        impact: asString(event.impact, '其他 Agent 将据此重新判断局势。'),
        confidence: clamp(event.confidence, runtimeWorld.confidence),
      };
    })
    .filter((event) => event.title && event.body && event.actorIds.length);
}

export function normalizeRuntimeSignals(raw: unknown, runtimeWorld: RuntimeWorld, actorUpdates: RuntimeActorUpdate[] = []): RuntimeAgentSignal[] {
  const row = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const rawSignals = Array.isArray(row.signals) ? row.signals : [];
  const addedActors = actorUpdates.filter((update) => update.action === 'add').map(actorFromUpdate);
  const actorById = new Map([...runtimeWorld.actors, ...addedActors].map((actor) => [actor.id, actor]));
  const nextPulse = runtimeWorld.pulse + 1;

  return rawSignals
    .map((item, index): RuntimeAgentSignal | null => {
      const signal = typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : {};
      const actorId = asString(signal.actorId, '');
      const actor = actorById.get(actorId);
      if (!actor) return null;
      const visibility = visibilityTypes.includes(String(signal.visibility) as RuntimeVisibility)
        ? (String(signal.visibility) as RuntimeVisibility)
        : 'private';
      const targetActorIds = Array.isArray(signal.targetActorIds)
        ? signal.targetActorIds.map(String).filter((id) => actorById.has(id)).slice(0, 4)
        : [];

      return {
        id: asString(signal.id, `llm-signal-${Date.now()}-${index + 1}`),
        pulse: nextPulse,
        actorId,
        actorName: actor.name,
        visibility,
        readSignals: Array.isArray(signal.readSignals) ? signal.readSignals.map(String).slice(0, 4) : [],
        privateIntent: asString(signal.privateIntent, actor.pressure),
        plannedAction: asString(signal.plannedAction, actor.intent),
        targetActorIds,
        emotionalState: asString(signal.emotionalState, actor.mood),
        confidence: clamp(signal.confidence, runtimeWorld.confidence),
      };
    })
    .filter((signal): signal is RuntimeAgentSignal => Boolean(signal));
}

export async function requestRuntimePulse(options: {
  provider: ProviderConfig;
  runtimeWorld: RuntimeWorld;
  world: SimulationWorld;
  focusedPressureThreadId?: string;
}): Promise<RuntimePulseResult> {
  if (!options.provider.apiKey.trim() || options.runtimeWorld.convergence.shouldPause) {
    return { actorUpdates: [], events: [], signals: [], source: 'local', message: '本地推进' };
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), RUNTIME_PULSE_TIMEOUT_MS);

  try {
    const reactionChains = buildRuntimeReactionChains(options.runtimeWorld).slice(0, 6);
    const dialogueExchanges = buildRuntimeDialogueExchanges(options.runtimeWorld).slice(0, 5);
    const allPressureThreads = buildRuntimePressureThreads(options.runtimeWorld);
    const focusedIndex = options.focusedPressureThreadId
      ? allPressureThreads.findIndex((thread) => thread.id === options.focusedPressureThreadId)
      : -1;
    const pressureThreads = (
      focusedIndex > 0
        ? [allPressureThreads[focusedIndex], ...allPressureThreads.slice(0, focusedIndex), ...allPressureThreads.slice(focusedIndex + 1)]
        : allPressureThreads
    ).slice(0, 6);
    const bodyPayload: Record<string, unknown> = {
      provider: options.provider,
      runtimeWorld: options.runtimeWorld,
      world: options.world,
      actorContexts: buildActorVisibleContexts(options.runtimeWorld),
      reactionChains,
      dialogueExchanges,
      pressureThreads,
    };
    if (options.focusedPressureThreadId) {
      bodyPayload.focusedPressureThreadId = options.focusedPressureThreadId;
    }
    const response = await fetch('/api/world-pulse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyPayload),
      signal: controller.signal,
    });
    const payload = (await response.json()) as RuntimePulseApiResponse;

    if (!response.ok || !payload.ok || !payload.content) {
      return { actorUpdates: [], events: [], signals: [], source: 'local', message: payload.message || '模型脉冲失败，未推进本地世界。', latencyMs: payload.latencyMs };
    }

    const parsed = extractJsonObject(payload.content);
    const actorUpdates = normalizeRuntimeActorUpdates(parsed, options.runtimeWorld);
    const events = normalizeRuntimePulse(parsed, options.runtimeWorld, actorUpdates);
    const signals = normalizeRuntimeSignals(parsed, options.runtimeWorld, actorUpdates);
    return {
      actorUpdates,
      events,
      signals,
      source: events.length || signals.length || actorUpdates.length ? 'llm' : 'local',
      message: events.length || signals.length || actorUpdates.length ? '模型脉冲已写入世界。' : '模型脉冲为空，回退本地推进。',
      latencyMs: payload.latencyMs,
    };
  } catch (error) {
    return {
      actorUpdates: [],
      events: [],
      signals: [],
      source: 'local',
      message:
        error instanceof DOMException && error.name === 'AbortError'
          ? '模型脉冲等待超过 5 分钟，未推进本地世界。'
          : '模型脉冲异常，未推进本地世界。',
    };
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export async function requestActorPerspectivePulse(options: {
  actorId: string;
  provider: ProviderConfig;
  runtimeWorld: RuntimeWorld;
  world: SimulationWorld;
}): Promise<RuntimePulseResult> {
  if (!options.provider.apiKey.trim() || options.runtimeWorld.convergence.shouldPause) {
    return { actorUpdates: [], events: [], signals: [], source: 'local', message: '本地视角推进' };
  }

  const actorContext = buildActorVisibleContexts(options.runtimeWorld).find((context) => context.actorId === options.actorId);
  if (!actorContext) {
    return { actorUpdates: [], events: [], signals: [], source: 'local', message: '未找到 Agent 视角，回退本地推进。' };
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), RUNTIME_PULSE_TIMEOUT_MS);

  try {
    const reactionChains = buildRuntimeReactionChains(options.runtimeWorld)
      .filter(
        (chain) =>
          chain.readerActorId === options.actorId ||
          chain.targetActorIds.includes(options.actorId) ||
          actorContext.visibleEventIds.includes(chain.sourceEventId || ''),
      )
      .slice(0, 5);
    const dialogueExchanges = buildRuntimeDialogueExchanges(options.runtimeWorld)
      .filter((exchange) => exchange.participants.includes(options.actorId))
      .slice(0, 4);
    const pressureThreads = buildRuntimePressureThreads(options.runtimeWorld)
      .filter((thread) => thread.actorIds.includes(options.actorId))
      .slice(0, 4);
    const response = await fetch('/api/actor-pulse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...options, actorContext, reactionChains, dialogueExchanges, pressureThreads }),
      signal: controller.signal,
    });
    const payload = (await response.json()) as RuntimePulseApiResponse;

    if (!response.ok || !payload.ok || !payload.content) {
      return { actorUpdates: [], events: [], signals: [], source: 'local', message: payload.message || 'Agent 视角脉冲失败，未推进本地世界。', latencyMs: payload.latencyMs };
    }

    const parsed = extractJsonObject(payload.content);
    const events = normalizeRuntimePulse(parsed, options.runtimeWorld);
    const signals = normalizeRuntimeSignals(parsed, options.runtimeWorld).filter((signal) => signal.actorId === options.actorId);
    return {
      actorUpdates: [],
      events,
      signals,
      source: events.length || signals.length ? 'llm' : 'local',
      message: events.length || signals.length ? 'Agent 视角脉冲已写入世界。' : 'Agent 视角脉冲为空，回退本地推进。',
      latencyMs: payload.latencyMs,
    };
  } catch (error) {
    return {
      actorUpdates: [],
      events: [],
      signals: [],
      source: 'local',
      message:
        error instanceof DOMException && error.name === 'AbortError'
          ? 'Agent 视角脉冲等待超过 5 分钟，未推进本地世界。'
          : 'Agent 视角脉冲异常，未推进本地世界。',
    };
  } finally {
    window.clearTimeout(timeoutId);
  }
}
