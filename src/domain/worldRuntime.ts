import type {
  AgentActionLog,
  AgentProfile,
  RuntimeActor,
  RuntimeActorContext,
  RuntimeActorLedger,
  RuntimeActorLedgerEntry,
  RuntimeActorRelation,
  RuntimeActorUpdate,
  RuntimeFocusedThreadContext,
  RuntimeObservationFlowFrame,
  RuntimeReactionChain,
  RuntimeAgentSignal,
  RuntimeActorStatus,
  RuntimeConvergence,
  RuntimeConfrontationScene,
  RuntimeDialogueExchange,
  RuntimeDialogueLine,
  RuntimeEventType,
  RuntimePulseSlice,
  RuntimePressureThread,
  RuntimeRelationKind,
  RuntimeVisibility,
  RuntimeWorld,
  RuntimeWorldEvent,
  SimulationWorld,
} from './types';

function clamp(value: number, min = 0.04, max = 0.98) {
  return Math.min(max, Math.max(min, Number(value.toFixed(2))));
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function actorFaction(agent: AgentProfile) {
  const identity = `${agent.identity || ''}${agent.role || ''}${agent.name || ''}`;
  if (/外部|外交|竞争|对手|敌|入侵|境外|rival|opponent|enemy/u.test(identity)) return '外部变量';
  if (/王|君主|总统|首相|部长|校长|领袖|统治|决策|指挥|leader|ruler|president|minister/u.test(identity)) return '决策核心';
  if (/组织|集团|家族|宗室|贵族|旧臣|保守|阵营|军队|学院|社群|company|order|faction/u.test(identity)) return '组织网络';
  if (/改革|制度|法令|技术|研究|魔法|军功|政策|工程|science|magic|policy|system/u.test(identity)) return '行动体系';
  return agent.role || '事件参与者';
}

function actorIntent(agent: AgentProfile) {
  return agent.actions?.[0] || agent.goals[0] || agent.currentPressure || agent.dilemma || '等待局势露出可行动的裂缝';
}

function actorMood(agent: AgentProfile): RuntimeActor['mood'] {
  if (agent.riskTolerance > 0.7) return 'aggressive';
  if (agent.riskTolerance < 0.42) return 'defensive';
  if (/失|危|疑|怨|死|杀|压力/u.test(`${agent.dilemma || ''}${agent.currentPressure || ''}`)) return 'fragile';
  return 'calculating';
}

function createActors(agents: AgentProfile[]): RuntimeActor[] {
  return agents.map((agent, index) => ({
    id: agent.id,
    name: agent.name,
    role: agent.role,
    faction: actorFaction(agent),
    status: 'alive',
    pressure: agent.currentPressure || agent.dilemma || agent.constraints[0] || '局势尚未完全展开',
    intent: actorIntent(agent),
    risk: clamp(agent.riskTolerance || 0.5),
    influence: clamp((agent.confidence || 0.58) + Math.max(0, 4 - index) * 0.04),
    mood: actorMood(agent),
    memory: [agent.dilemma, agent.currentPressure, ...(agent.relationships || [])].filter(Boolean).slice(0, 4) as string[],
  }));
}

function classifyRuntimeEvent(log: AgentActionLog): RuntimeEventType {
  const text = `${log.action}${log.detail}${log.impact}`;
  if (/死|杀|刺|处决|战死|车裂/u.test(text)) return 'death';
  if (/盟|联合|合作|拉拢|结盟/u.test(text)) return 'alliance';
  if (/背叛|倒戈|出卖|反噬/u.test(text)) return 'betrayal';
  if (/冲突|施压|威胁|审判|对抗|争斗/u.test(text)) return 'conflict';
  if (/法|制度|政策|命令|诏令|改革/u.test(text)) return 'policy';
  if (/传闻|谣|探查|试探|秘密/u.test(text)) return 'rumor';
  if (/说|召见|劝|谈|问|奏/u.test(text)) return 'speech';
  return 'move';
}

function eventVisibility(type: RuntimeEventType, log: AgentActionLog): RuntimeVisibility {
  const text = `${log.action}${log.detail}${log.impact}`;
  if (/秘密|暗中|私下|密/u.test(text)) return 'secret';
  if (type === 'rumor') return 'rumor';
  if (/内心|犹豫|盘算/u.test(text)) return 'private';
  if (/宗室|旧臣|集团|阵营/u.test(text)) return 'faction';
  return 'public';
}

function createSeedEvent(world: SimulationWorld): RuntimeWorldEvent {
  return {
    id: 'runtime-seed',
    pulse: 0,
    timeLabel: world.simulationPlan.startLabel,
    type: 'convergence',
    visibility: 'public',
    actorIds: world.agents.slice(0, 3).map((agent) => agent.id),
    title: '中心事件被放入沙盘',
    body: world.centralQuestion,
    impact: world.simulationPlan.stopReason,
    confidence: world.confidence || 0.58,
  };
}

function mapLogToRuntimeEvent(log: AgentActionLog, pulse: number): RuntimeWorldEvent {
  const type = classifyRuntimeEvent(log);
  const initiatorActorId = log.initiatorActorId || log.agentId;
  const targetActorIds = log.targetActorIds ?? [];
  const responderActorIds = log.responderActorIds ?? [];
  const affectedActorIds = log.affectedActorIds ?? [];
  return {
    id: `runtime-${log.id}-${pulse}`,
    pulse,
    timeLabel: log.timeLabel,
    type,
    visibility: eventVisibility(type, log),
    actorIds: Array.from(new Set([initiatorActorId, ...targetActorIds, ...responderActorIds, ...affectedActorIds, log.agentId])).filter(Boolean),
    initiatorActorId,
    targetActorIds,
    responderActorIds,
    affectedActorIds,
    actionText: log.actionText || log.detail || log.action,
    responseText: log.responseText || '',
    effectText: log.effectText || log.impact,
    title: `${log.agentName}：${log.action}`,
    body: log.detail,
    impact: log.impact,
    confidence: log.confidence,
  };
}

function deriveFallbackEvent(runtime: RuntimeWorld, pulse: number): RuntimeWorldEvent {
  const aliveActors = runtime.actors.filter((actor) => actor.status === 'alive');
  const actor = aliveActors[pulse % Math.max(aliveActors.length, 1)] ?? runtime.actors[0];
  const antagonist = aliveActors.find((item) => item.faction !== actor?.faction) ?? aliveActors[(pulse + 1) % Math.max(aliveActors.length, 1)];
  const title = antagonist
    ? `${actor?.name || '关键人物'}向${antagonist.name}发起一次试探`
    : `${actor?.name || '关键人物'}暂缓公开行动`;
  const body = antagonist
    ? `${actor.name}通过一次低可见度接触，向${antagonist.name}提出试探性要求，观察对方会让步、回避，还是反击。`
    : `${actor?.name || '关键人物'}整理现有信息，暂时推迟公开行动。`;
  const impact = antagonist
    ? `${antagonist.name}必须判断这次接触是合作窗口、威胁，还是误导；双方关系进入更谨慎的试探状态。`
    : '世界暂时保持低烈度，但下一次行动会更依赖具体人物的选择。';

  return {
    id: `runtime-emergent-${pulse}`,
    pulse,
    timeLabel: `第 ${pulse + 1} 幕`,
    type: pulse % 3 === 0 ? 'conflict' : pulse % 3 === 1 ? 'speech' : 'move',
    visibility: pulse % 4 === 0 ? 'secret' : 'public',
    actorIds: [actor?.id, antagonist?.id].filter(Boolean),
    initiatorActorId: actor?.id,
    targetActorIds: antagonist?.id ? [antagonist.id] : [],
    responderActorIds: [],
    affectedActorIds: antagonist?.id ? [antagonist.id] : [],
    actionText: body,
    responseText: '',
    effectText: impact,
    title,
    body,
    impact,
    confidence: clamp(runtime.confidence - pulse * 0.03),
  };
}

function statusFromText(text: string, actorName: string): RuntimeActorStatus | null {
  const name = escapeRegExp(actorName);
  const nearby = (words: string) => new RegExp(`${name}.{0,12}(${words})|(${words}).{0,12}${name}`, 'u').test(text);

  if (nearby('死亡|被杀|遇刺身亡|遭刺杀身亡|被处决|战死|车裂|病故')) return 'dead';
  if (nearby('被流放|遭流放|被驱逐|遭驱逐|放逐|出逃|逃亡')) return 'exiled';
  if (nearby('被囚|囚禁|软禁|下狱|关押|拘押')) return 'imprisoned';
  if (nearby('被罢免|遭罢免|被削权|遭削权|夺爵|失权|失势|被审判')) return 'disgraced';
  if (nearby('转入地下|潜伏|秘密潜逃')) return 'underground';
  if (nearby('失踪|不知所终')) return 'missing';
  return null;
}

function updateActorsFromEvent(actors: RuntimeActor[], event: RuntimeWorldEvent): RuntimeActor[] {
  return actors.map((actor) => {
    if (!event.actorIds.includes(actor.id)) return actor;
    const nextStatus = statusFromText(`${event.title}${event.body}${event.impact}`, actor.name);
    const isRemoved = nextStatus && nextStatus !== 'underground';
    const pressure =
      event.type === 'conflict' || event.type === 'betrayal'
        ? `刚刚卷入「${event.title}」，必须重新判断敌友边界。`
        : event.impact;

    return {
      ...actor,
      status: nextStatus ?? actor.status,
      pressure,
      influence: isRemoved ? clamp(actor.influence - 0.28) : clamp(actor.influence + (event.type === 'policy' ? 0.04 : -0.01)),
      mood: isRemoved ? 'withdrawn' : event.type === 'conflict' || event.type === 'betrayal' ? 'aggressive' : actor.mood,
      memory: [event.title, event.impact, ...actor.memory].slice(0, 6),
    };
  });
}

function updateActorsFromSignals(actors: RuntimeActor[], signals: RuntimeAgentSignal[]): RuntimeActor[] {
  return actors.map((actor) => {
    const signal = signals.find((item) => item.actorId === actor.id);
    if (!signal) return actor;
    return {
      ...actor,
      intent: signal.plannedAction || signal.privateIntent || actor.intent,
      pressure: signal.privateIntent || actor.pressure,
      mood:
        /怒|恨|报复|威胁|清算|进攻/u.test(signal.emotionalState + signal.privateIntent)
          ? 'aggressive'
          : /惧|怕|疑|退让|自保/u.test(signal.emotionalState + signal.privateIntent)
            ? 'defensive'
            : actor.mood,
      memory: [signal.privateIntent, signal.plannedAction, ...signal.readSignals, ...actor.memory].filter(Boolean).slice(0, 6),
    };
  });
}

function actorFromRosterUpdate(update: RuntimeActorUpdate): RuntimeActor {
  return {
    id: update.actorId,
    name: update.name,
    role: update.role,
    faction: update.faction || update.role,
    status: update.status || 'alive',
    pressure: update.pressure || update.reason,
    intent: update.intent || update.reason,
    risk: clamp(update.risk ?? 0.5),
    influence: clamp(update.influence ?? update.confidence ?? 0.52),
    mood: update.mood || 'calculating',
    memory: [update.reason, ...(update.memory || [])].filter(Boolean).slice(0, 6),
  };
}

function applyActorRosterUpdates(actors: RuntimeActor[], updates: RuntimeActorUpdate[]): RuntimeActor[] {
  if (!updates.length) return actors;
  const actorById = new Map(actors.map((actor) => [actor.id, actor]));

  updates.forEach((update) => {
    const current = actorById.get(update.actorId);
    if (update.action === 'add' && !current) {
      actorById.set(update.actorId, actorFromRosterUpdate(update));
      return;
    }
    if (!current) return;
    actorById.set(update.actorId, {
      ...current,
      role: update.role || current.role,
      faction: update.faction || current.faction,
      status: update.status || (update.action === 'exit' ? 'retired' : current.status),
      pressure: update.pressure || update.reason || current.pressure,
      intent: update.intent || current.intent,
      risk: clamp(update.risk ?? current.risk),
      influence: update.action === 'exit' ? clamp((update.influence ?? current.influence) - 0.12) : clamp(update.influence ?? current.influence),
      mood: update.mood || (update.action === 'exit' ? 'withdrawn' : current.mood),
      memory: [update.reason, ...(update.memory || []), ...current.memory].filter(Boolean).slice(0, 8),
    });
  });

  return Array.from(actorById.values());
}

export function canActorSeeEvent(actor: RuntimeActor, event: RuntimeWorldEvent, actors: RuntimeActor[]): boolean {
  if (event.visibility === 'observer_only') return false;
  if (event.visibility === 'public' || event.visibility === 'rumor') return true;
  if (event.actorIds.includes(actor.id)) return true;
  if (event.visibility === 'faction') {
    const eventFactions = new Set(event.actorIds.map((id) => actors.find((item) => item.id === id)?.faction).filter(Boolean));
    return eventFactions.has(actor.faction);
  }
  return false;
}

export function canActorSeeSignal(actor: RuntimeActor, signal: RuntimeAgentSignal, actors: RuntimeActor[]): boolean {
  if (signal.visibility === 'observer_only') return false;
  if (signal.visibility === 'public' || signal.visibility === 'rumor') return true;
  if (signal.actorId === actor.id || signal.targetActorIds.includes(actor.id)) return true;
  if (signal.visibility === 'faction') {
    const ownerFaction = actors.find((item) => item.id === signal.actorId)?.faction;
    return ownerFaction === actor.faction;
  }
  return false;
}

export function buildActorVisibleContexts(runtime: RuntimeWorld): RuntimeActorContext[] {
  const rules = [
    'public/rumor: all living agents can read',
    'faction: only agents in the same faction or directly involved can read',
    'private/secret: only the owner, target, or directly involved agents can read',
    'observer_only: visible to the user, hidden from agents',
  ];

  return runtime.actors.map((actor) => {
    const visibleEvents = runtime.stream.filter((event) => canActorSeeEvent(actor, event, runtime.actors)).slice(0, 8);
    const visibleSignals = runtime.signals.filter((signal) => canActorSeeSignal(actor, signal, runtime.actors)).slice(0, 8);
    const hiddenCount = runtime.stream.length + runtime.signals.length - visibleEvents.length - visibleSignals.length;
    return {
      actorId: actor.id,
      actorName: actor.name,
      faction: actor.faction,
      visibleEventIds: visibleEvents.map((event) => event.id),
      visibleSignalIds: visibleSignals.map((signal) => signal.id),
      visibleSummaries: [
        ...visibleEvents.map((event) => `${event.timeLabel}｜${event.visibility}｜${event.title}：${event.impact}`),
        ...visibleSignals.map((signal) => `${signal.visibility}｜${signal.actorName}意图：${signal.privateIntent}`),
        ...actor.memory.map((memory) => `memory｜${memory}`),
      ].slice(0, 12),
      hiddenCount: Math.max(0, hiddenCount),
      rules,
    };
  });
}

function relationKindFromEvent(event: RuntimeWorldEvent): RuntimeRelationKind {
  if (event.type === 'death') return 'fatal';
  if (event.type === 'betrayal') return 'betrayal';
  if (event.type === 'conflict') return 'conflict';
  if (event.type === 'alliance') return 'alliance';
  if (event.type === 'policy') return 'influence';
  return 'attention';
}

function relationWeight(kind: RuntimeRelationKind) {
  if (kind === 'fatal') return 0.95;
  if (kind === 'betrayal') return 0.84;
  if (kind === 'conflict') return 0.74;
  if (kind === 'alliance') return 0.66;
  if (kind === 'influence') return 0.56;
  return 0.42;
}

function mergeRuntimeRelation(
  relations: Map<string, RuntimeActorRelation>,
  relation: RuntimeActorRelation,
) {
  const key = relation.sourceActorId < relation.targetActorId
    ? `${relation.sourceActorId}::${relation.targetActorId}`
    : `${relation.targetActorId}::${relation.sourceActorId}`;
  const existing = relations.get(key);
  if (!existing) {
    relations.set(key, relation);
    return;
  }

  const nextIntensity = clamp(existing.intensity + relation.intensity * 0.32);
  const shouldReplaceLabel = relation.pulse >= existing.pulse || relation.intensity > existing.intensity;
  relations.set(key, {
    ...existing,
    kind: relation.intensity >= existing.intensity ? relation.kind : existing.kind,
    intensity: nextIntensity,
    confidence: Math.max(existing.confidence, relation.confidence),
    label: shouldReplaceLabel ? relation.label : existing.label,
    lastEventTitle: shouldReplaceLabel ? relation.lastEventTitle : existing.lastEventTitle,
    pulse: Math.max(existing.pulse, relation.pulse),
  });
}

export function buildRuntimeRelations(runtime: RuntimeWorld): RuntimeActorRelation[] {
  const actorIds = new Set(runtime.actors.map((actor) => actor.id));
  const relations = new Map<string, RuntimeActorRelation>();

  runtime.stream.slice(0, 28).forEach((event) => {
    const ids = event.actorIds.filter((id) => actorIds.has(id));
    if (ids.length < 2) return;
    const kind = relationKindFromEvent(event);
    for (let index = 0; index < ids.length - 1; index += 1) {
      for (let nextIndex = index + 1; nextIndex < ids.length; nextIndex += 1) {
        mergeRuntimeRelation(relations, {
          id: `rel-event-${event.id}-${ids[index]}-${ids[nextIndex]}`,
          sourceActorId: ids[index],
          targetActorId: ids[nextIndex],
          kind,
          intensity: clamp(relationWeight(kind) * event.confidence),
          confidence: event.confidence,
          label: event.impact || event.body,
          lastEventTitle: event.title,
          pulse: event.pulse,
        });
      }
    }
  });

  runtime.signals.slice(0, 32).forEach((signal) => {
    signal.targetActorIds
      .filter((id) => actorIds.has(id) && id !== signal.actorId)
      .forEach((targetId) => {
        mergeRuntimeRelation(relations, {
          id: `rel-signal-${signal.id}-${signal.actorId}-${targetId}`,
          sourceActorId: signal.actorId,
          targetActorId: targetId,
          kind: 'attention',
          intensity: clamp(0.34 + signal.confidence * 0.34),
          confidence: signal.confidence,
          label: signal.plannedAction || signal.privateIntent,
          lastEventTitle: `${signal.actorName} read world signal`,
          pulse: signal.pulse,
        });
      });
  });

  runtime.conflicts.forEach((conflict) => {
    const ids = conflict.actors.filter((id) => actorIds.has(id));
    if (ids.length < 2) return;
    for (let index = 0; index < ids.length - 1; index += 1) {
      mergeRuntimeRelation(relations, {
        id: `rel-conflict-${conflict.id}-${ids[index]}-${ids[index + 1]}`,
        sourceActorId: ids[index],
        targetActorId: ids[index + 1],
        kind: 'conflict',
        intensity: conflict.intensity,
        confidence: runtime.confidence,
        label: conflict.description,
        lastEventTitle: conflict.title,
        pulse: runtime.pulse,
      });
    }
  });

  return Array.from(relations.values())
    .sort((left, right) => right.intensity - left.intensity || right.pulse - left.pulse)
    .slice(0, 16);
}

function pulseSliceSummary(events: RuntimeWorldEvent[], signals: RuntimeAgentSignal[]) {
  const eventTitle = events[0]?.title;
  const signalActor = signals[0]?.actorName;
  const signalIntent = signals[0]?.privateIntent;
  if (eventTitle && signalActor) return `${signalActor}的私下意图推动了“${eventTitle}”这一轮变化。`;
  if (eventTitle) return `世界裁决产生了“${eventTitle}”。`;
  if (signalActor) return `${signalActor}正在形成新的私下谋划：${signalIntent}`;
  return '这一轮尚未出现可观察的 Agent 信号。';
}

export function buildRuntimePulseSlices(runtime: RuntimeWorld): RuntimePulseSlice[] {
  const pulseNumbers = new Set<number>();
  runtime.stream.forEach((event) => pulseNumbers.add(event.pulse));
  runtime.signals.forEach((signal) => pulseNumbers.add(signal.pulse));

  return Array.from(pulseNumbers)
    .sort((left, right) => right - left)
    .map((pulse) => {
      const events = runtime.stream.filter((event) => event.pulse === pulse);
      const signals = runtime.signals.filter((signal) => signal.pulse === pulse);
      const actorIds = new Set<string>();
      events.forEach((event) => event.actorIds.forEach((id) => actorIds.add(id)));
      signals.forEach((signal) => {
        actorIds.add(signal.actorId);
        signal.targetActorIds.forEach((id) => actorIds.add(id));
      });
      return {
        pulse,
        timeLabel: events[0]?.timeLabel || `第 ${pulse + 1} 幕`,
        phase: pulse === runtime.pulse ? runtime.phase : events[0]?.timeLabel || `第 ${pulse + 1} 幕`,
        signals,
        events,
        actorIds: Array.from(actorIds),
        privateSignalCount: signals.filter((signal) => signal.visibility === 'private' || signal.visibility === 'secret').length,
        publicEventCount: events.filter((event) => event.visibility === 'public' || event.visibility === 'rumor').length,
        hiddenEventCount: events.filter((event) => event.visibility === 'private' || event.visibility === 'secret').length,
        summary: pulseSliceSummary(events, signals),
      };
    })
    .slice(0, 8);
}

function textOverlaps(left: string, right: string) {
  const compactLeft = left.replace(/\s+/g, '');
  const compactRight = right.replace(/\s+/g, '');
  if (!compactLeft || !compactRight) return false;
  if (compactLeft.includes(compactRight) || compactRight.includes(compactLeft)) return true;
  return compactLeft.length > 12 && compactRight.length > 12
    ? compactLeft.includes(compactRight.slice(0, 12)) || compactRight.includes(compactLeft.slice(0, 12))
    : false;
}

function findReactionSourceEvent(signal: RuntimeAgentSignal, runtime: RuntimeWorld): RuntimeWorldEvent | undefined {
  const actor = runtime.actors.find((item) => item.id === signal.actorId);
  const recentEvents = runtime.stream.slice(0, 36);
  const explicitSource = recentEvents.find((event) => {
    const eventText = `${event.timeLabel} ${event.title} ${event.impact} ${event.body}`;
    return signal.readSignals.some((readSignal) => textOverlaps(readSignal, eventText));
  });
  if (explicitSource) return explicitSource;
  if (!actor) return recentEvents.find((event) => event.pulse <= signal.pulse);

  return recentEvents.find((event) => {
    if (event.pulse > signal.pulse || event.pulse < signal.pulse - 1) return false;
    if (!canActorSeeEvent(actor, event, runtime.actors)) return false;
    if (event.actorIds.includes(signal.actorId)) return false;
    return event.actorIds.some((id) => signal.targetActorIds.includes(id)) || event.visibility === 'public' || event.visibility === 'rumor';
  });
}

export function buildRuntimeReactionChains(runtime: RuntimeWorld): RuntimeReactionChain[] {
  const actorById = new Map(runtime.actors.map((actor) => [actor.id, actor]));

  return runtime.signals
    .slice(0, 32)
    .map((signal, index): RuntimeReactionChain => {
      const sourceEvent = findReactionSourceEvent(signal, runtime);
      const targetActorIds = signal.targetActorIds.length
        ? signal.targetActorIds
        : sourceEvent?.actorIds.filter((id) => id !== signal.actorId) ?? [];
      const sourceTitle = sourceEvent?.title || signal.readSignals[0] || `${signal.actorName} reads the world`;
      const triggerSummary = signal.readSignals[0] || sourceEvent?.impact || sourceEvent?.body || signal.privateIntent;

      return {
        id: `reaction-${signal.id}-${index}`,
        pulse: signal.pulse,
        sourceEventId: sourceEvent?.id,
        sourceTitle,
        readerActorId: signal.actorId,
        readerActorName: signal.actorName || actorById.get(signal.actorId)?.name || 'Agent',
        triggerSummary,
        reactionSummary: signal.plannedAction || signal.privateIntent,
        targetActorIds: targetActorIds.filter((id) => actorById.has(id)).slice(0, 4),
        visibility: signal.visibility,
        confidence: signal.confidence,
      };
    })
    .filter((chain) => chain.triggerSummary && chain.reactionSummary)
    .sort((left, right) => right.pulse - left.pulse || right.confidence - left.confidence)
    .slice(0, 8);
}

function compactDialogueText(value: string, fallback: string) {
  const text = (value || fallback).replace(/\s+/g, ' ').trim();
  return text.length > 96 ? `${text.slice(0, 94)}...` : text;
}

function joinDialogueParts(...parts: string[]) {
  return parts
    .map((part) => part.replace(/[。.!?！？]+$/u, '').trim())
    .filter(Boolean)
    .join('。');
}

function createDialogueLine(actor: RuntimeActor, stance: string, text: string): RuntimeDialogueLine {
  return {
    actorId: actor.id,
    actorName: actor.name,
    stance,
    text: `${actor.name}：${compactDialogueText(text, actor.intent || actor.pressure)}`,
  };
}

export function buildRuntimeDialogueExchanges(runtime: RuntimeWorld): RuntimeDialogueExchange[] {
  const actorById = new Map(runtime.actors.map((actor) => [actor.id, actor]));

  return buildRuntimeReactionChains(runtime)
    .map((chain): RuntimeDialogueExchange | null => {
      const reader = actorById.get(chain.readerActorId);
      if (!reader) return null;
      const targets = chain.targetActorIds
        .map((id) => actorById.get(id))
        .filter((actor): actor is RuntimeActor => Boolean(actor))
        .slice(0, 2);
      const participants = [reader.id, ...targets.map((actor) => actor.id)].filter(
        (id, index, ids) => ids.indexOf(id) === index,
      );
      const targetNames = targets.map((actor) => actor.name).join('、');
      const lines: RuntimeDialogueLine[] = [
        createDialogueLine(
          reader,
          targets.length ? '回应压力' : '内心推演',
          joinDialogueParts(chain.triggerSummary, chain.reactionSummary),
        ),
      ];

      targets.forEach((target, index) => {
        lines.push(
          createDialogueLine(
            target,
            index === 0 ? '施压/试探' : '旁观下注',
            joinDialogueParts(
              target.pressure || target.intent,
              `面对${reader.name}的动作，${target.name}会先守住自己的利益边界`,
            ),
          ),
        );
      });

      if (!targets.length) {
        lines.push(
          createDialogueLine(
            reader,
            '自我约束',
            joinDialogueParts(reader.intent, `${reader.name}暂时没有可信听众，只能把计划压回私下行动`),
          ),
        );
      }

      return {
        id: `dialogue-${chain.id}`,
        pulse: chain.pulse,
        chainId: chain.id,
        topic: chain.sourceTitle,
        participants,
        visibility: chain.visibility,
        stakes: targetNames
          ? `${reader.name}必须判断如何回应${targetNames}，否则${chain.triggerSummary}`
          : `${reader.name}正在把外部刺激转化为下一步行动`,
        lines: lines.slice(0, 3),
        confidence: chain.confidence,
      };
    })
    .filter((exchange): exchange is RuntimeDialogueExchange => Boolean(exchange))
    .sort((left, right) => right.pulse - left.pulse || right.confidence - left.confidence)
    .slice(0, 6);
}

function pressureTitleFromActors(actorIds: string[], actorById: Map<string, RuntimeActor>, fallback: string) {
  const names = actorIds.map((id) => actorById.get(id)?.name).filter(Boolean).slice(0, 3);
  return names.length >= 2 ? `${names.join(' / ')}：${fallback}` : fallback;
}

export function buildRuntimePressureThreads(runtime: RuntimeWorld): RuntimePressureThread[] {
  const actorById = new Map(runtime.actors.map((actor) => [actor.id, actor]));
  const dialogueThreads = buildRuntimeDialogueExchanges(runtime).map((exchange): RuntimePressureThread => {
    const actorPressure = exchange.participants
      .map((id) => actorById.get(id)?.pressure || actorById.get(id)?.intent)
      .filter(Boolean)
      .join(' / ');
    return {
      id: `pressure-dialogue-${exchange.id}`,
      pulse: exchange.pulse,
      title: pressureTitleFromActors(exchange.participants, actorById, exchange.topic),
      actorIds: exchange.participants.slice(0, 4),
      sourceDialogueId: exchange.id,
      sourceChainId: exchange.chainId,
      tension: clamp(0.42 + exchange.confidence * 0.42),
      urgency: clamp(0.38 + (runtime.conflictLevel * 0.34) + (exchange.pulse >= runtime.pulse ? 0.12 : 0)),
      unresolvedQuestion: exchange.stakes,
      nextPressure: exchange.lines[0]?.text || actorPressure || exchange.topic,
      confidence: exchange.confidence,
    };
  });

  const reactionThreads = buildRuntimeReactionChains(runtime).slice(0, 4).map((chain): RuntimePressureThread => {
    const actorIds = [chain.readerActorId, ...chain.targetActorIds].filter((id, index, ids) => ids.indexOf(id) === index);
    return {
      id: `pressure-chain-${chain.id}`,
      pulse: chain.pulse,
      title: pressureTitleFromActors(actorIds, actorById, chain.sourceTitle),
      actorIds: actorIds.slice(0, 4),
      sourceChainId: chain.id,
      tension: clamp(0.36 + chain.confidence * 0.38),
      urgency: clamp(0.32 + runtime.conflictLevel * 0.32),
      unresolvedQuestion: `${chain.readerActorName}会如何处理：${chain.triggerSummary}`,
      nextPressure: chain.reactionSummary,
      confidence: chain.confidence,
    };
  });

  const conflictThreads = runtime.conflicts.slice(0, 3).map((conflict): RuntimePressureThread => ({
    id: `pressure-conflict-${conflict.id}`,
    pulse: runtime.pulse,
    title: pressureTitleFromActors(conflict.actors, actorById, conflict.title),
    actorIds: conflict.actors.slice(0, 4),
    tension: conflict.intensity,
    urgency: clamp(conflict.intensity * 0.72 + runtime.conflictLevel * 0.22),
    unresolvedQuestion: conflict.possibleBreaks[0] || conflict.description,
    nextPressure: conflict.description,
    confidence: runtime.confidence,
  }));

  const byId = new Map<string, RuntimePressureThread>();
  [...dialogueThreads, ...reactionThreads, ...conflictThreads].forEach((thread) => {
    if (!thread.actorIds.length) return;
    byId.set(thread.id, thread);
  });

  return Array.from(byId.values())
    .sort((left, right) => right.urgency - left.urgency || right.tension - left.tension || right.pulse - left.pulse)
    .slice(0, 6);
}

export function buildFocusedPressureThreadContext(
  runtime: RuntimeWorld,
  threadId: string,
): RuntimeFocusedThreadContext | null {
  const threads = buildRuntimePressureThreads(runtime);
  const thread = threads.find((item) => item.id === threadId);
  if (!thread) return null;

  const actorById = new Map(runtime.actors.map((actor) => [actor.id, actor]));
  const threadActorIds = new Set(thread.actorIds);
  const threadSourceChainId = thread.sourceChainId ?? '';
  const threadSourceDialogueId = thread.sourceDialogueId ?? '';

  const actors = thread.actorIds
    .map((id) => actorById.get(id))
    .filter((actor): actor is RuntimeActor => Boolean(actor));

  const chains = buildRuntimeReactionChains(runtime)
    .filter((chain) => {
      if (chain.id === threadSourceChainId || chain.sourceEventId === threadSourceChainId) return true;
      if (threadActorIds.has(chain.readerActorId)) return true;
      return chain.targetActorIds.some((id) => threadActorIds.has(id));
    })
    .slice(0, 3);

  const relatedChainIds = new Set(chains.map((chain) => chain.id));

  const dialogues = buildRuntimeDialogueExchanges(runtime)
    .filter((exchange) => {
      if (exchange.id === threadSourceDialogueId || exchange.chainId === threadSourceChainId) return true;
      if (relatedChainIds.has(exchange.chainId)) return true;
      return exchange.participants.some((id) => threadActorIds.has(id));
    })
    .slice(0, 3);

  const chainSourceEventIds = new Set(chains.map((chain) => chain.sourceEventId).filter(Boolean));

  const events = runtime.stream
    .filter((event) => {
      if (event.actorIds.some((id) => threadActorIds.has(id))) return true;
      if (chainSourceEventIds.has(event.id)) return true;
      if (event.id === threadSourceChainId || event.id === threadSourceDialogueId) return true;
      return false;
    })
    .slice(0, 4);

  const actorNames = actors.map((actor) => actor.name).join('、');
  const unresolved = thread.unresolvedQuestion || '压力尚未完全暴露';
  const summary = `线程「${thread.title}」涉及${actorNames}，核心未解问题：${unresolved}`;

  return {
    thread,
    actors,
    relatedChains: chains,
    relatedDialogues: dialogues,
    relatedEvents: events,
    summary,
  };
}

function uniqueActorIds(...groups: string[][]) {
  return Array.from(new Set(groups.flat().filter(Boolean))).slice(0, 8);
}

function averageConfidence(values: number[], fallback: number) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (!valid.length) return fallback;
  return clamp(valid.reduce((sum, value) => sum + value, 0) / valid.length);
}

function observationSummary(
  actorNames: string[],
  signals: RuntimeAgentSignal[],
  dialogues: RuntimeDialogueExchange[],
  events: RuntimeWorldEvent[],
  threads: RuntimePressureThread[],
) {
  const names = actorNames.length ? actorNames.slice(0, 3).join('、') : '世界旁白';
  const firstDialogue = dialogues[0];
  const firstSignal = signals[0];
  const firstEvent = events[0];
  const firstThread = threads[0];

  if (firstDialogue) {
    return `${names}围绕「${firstDialogue.topic}」发生直接交锋，私下意图开始压迫公开秩序。`;
  }

  if (firstSignal && firstEvent) {
    return `${firstSignal.actorName}读入局势后调整谋划，并推动「${firstEvent.title}」成为新的世界结果。`;
  }

  if (firstSignal) {
    return `${firstSignal.actorName}正在消化可见信息，下一步行动指向${firstSignal.targetActorIds.length ? '具体对手' : '尚未公开的局面'}。`;
  }

  if (firstEvent) {
    return `${names}使「${firstEvent.title}」进入世界表层，其他人物将据此重新判断。`;
  }

  if (firstThread) {
    return `${names}之间的压力线仍在积累，核心问题是：${firstThread.unresolvedQuestion}`;
  }

  return '世界仍在沉默运行，新的可观察动作尚未浮出水面。';
}

export function buildRuntimeObservationFlow(runtime: RuntimeWorld): RuntimeObservationFlowFrame[] {
  const actorById = new Map(runtime.actors.map((actor) => [actor.id, actor]));
  const dialogues = buildRuntimeDialogueExchanges(runtime);
  const threads = buildRuntimePressureThreads(runtime);
  const pulseNumbers = new Set<number>();

  runtime.stream.forEach((event) => pulseNumbers.add(event.pulse));
  runtime.signals.forEach((signal) => pulseNumbers.add(signal.pulse));
  dialogues.forEach((dialogue) => pulseNumbers.add(dialogue.pulse));
  threads.forEach((thread) => pulseNumbers.add(thread.pulse));

  return Array.from(pulseNumbers)
    .sort((left, right) => right - left)
    .slice(0, 6)
    .map((pulse) => {
      const events = runtime.stream.filter((event) => event.pulse === pulse);
      const signals = runtime.signals.filter((signal) => signal.pulse === pulse);
      const pulseDialogues = dialogues.filter((dialogue) => dialogue.pulse === pulse);
      const pulseThreads = threads.filter((thread) => thread.pulse === pulse);
      const actorIds = uniqueActorIds(
        events.flatMap((event) => event.actorIds),
        signals.flatMap((signal) => [signal.actorId, ...signal.targetActorIds]),
        pulseDialogues.flatMap((dialogue) => dialogue.participants),
        pulseThreads.flatMap((thread) => thread.actorIds),
      );
      const actorNames = actorIds.map((id) => actorById.get(id)?.name ?? id);
      const hasExitOrDeath =
        events.some((event) => event.type === 'death') ||
        actorIds.some((id) => {
          const status = actorById.get(id)?.status;
          return Boolean(status && status !== 'alive');
        });
      const eventTension = events.reduce((max, event) => {
        if (event.type === 'death') return Math.max(max, 0.95);
        if (event.type === 'conflict' || event.type === 'betrayal') return Math.max(max, 0.82);
        if (event.visibility === 'secret' || event.visibility === 'private') return Math.max(max, 0.58);
        return Math.max(max, 0.38);
      }, 0);
      const threadTension = pulseThreads.reduce((max, thread) => Math.max(max, thread.tension, thread.urgency), 0);
      const signalTension = signals.length ? Math.min(0.72, 0.36 + signals.length * 0.12) : 0;
      const confidence = averageConfidence(
        [
          ...events.map((event) => event.confidence),
          ...signals.map((signal) => signal.confidence),
          ...pulseDialogues.map((dialogue) => dialogue.confidence),
          ...pulseThreads.map((thread) => thread.confidence),
        ],
        runtime.confidence,
      );

      return {
        pulse,
        timeLabel: events[0]?.timeLabel || (pulse === runtime.pulse ? runtime.phase : `第 ${pulse + 1} 幕`),
        phase: pulse === runtime.pulse ? runtime.phase : events[0]?.timeLabel || `第 ${pulse + 1} 幕`,
        summary: observationSummary(actorNames, signals, pulseDialogues, events, pulseThreads),
        actorIds,
        signals,
        dialogues: pulseDialogues,
        events,
        threads: pulseThreads,
        dominantTension: clamp(Math.max(eventTension, threadTension, signalTension, runtime.conflictLevel * 0.58)),
        confidence,
        hasExitOrDeath,
      };
    });
}

function actorStatusSummary(actor: RuntimeActor, riskScore: number, hasExitEvent = false) {
  if (actor.status === 'dead') return '已死亡，个人线终止，但其死亡仍会改变其他人的判断。';
  if (actor.status === 'exiled') return '已被流放，离开权力中心但仍可能成为远端变量。';
  if (actor.status === 'imprisoned') return '被囚禁，行动受限但仍可能通过名望、证词或盟友影响局势。';
  if (actor.status === 'missing') return '失踪，存在信息真空，其他人会围绕其去向产生误判。';
  if (actor.status === 'retired') return '退隐，直接行动减少，但旧关系仍可能被重新调用。';
  if (actor.status === 'disgraced') return '失权，公开影响力下降，可能转向报复、求生或投靠。';
  if (actor.status === 'underground') return '转入地下，公开存在感降低，秘密行动风险上升。';
  if (hasExitEvent) return '卷入死亡或退出事件，个人线进入高风险不确定状态。';
  if (riskScore > 0.72) return '仍在场，但正承受高压，下一步可能出现极端选择。';
  if (riskScore > 0.48) return '仍在场，正在多方压力中寻找可行动窗口。';
  return '仍在场，暂时保有行动余地。';
}

export function buildRuntimeActorLedgers(runtime: RuntimeWorld): RuntimeActorLedger[] {
  const dialogues = buildRuntimeDialogueExchanges(runtime);
  const pressureThreads = buildRuntimePressureThreads(runtime);
  const exitStatuses = new Set<RuntimeActorStatus>(['dead', 'exiled', 'imprisoned', 'missing', 'disgraced', 'underground']);

  return runtime.actors.map((actor) => {
    const events = runtime.stream.filter((event) => event.actorIds.includes(actor.id));
    const signals = runtime.signals.filter((signal) => signal.actorId === actor.id || signal.targetActorIds.includes(actor.id));
    const actorDialogues = dialogues.filter((dialogue) => dialogue.participants.includes(actor.id));
    const actorThreads = pressureThreads.filter((thread) => thread.actorIds.includes(actor.id));
    const hasExitEvent = events.some((event) => event.type === 'death');
    const knownActorIds = uniqueActorIds(
      events.flatMap((event) => event.actorIds.filter((id) => id !== actor.id)),
      signals.flatMap((signal) => [signal.actorId, ...signal.targetActorIds].filter((id) => id !== actor.id)),
      actorDialogues.flatMap((dialogue) => dialogue.participants.filter((id) => id !== actor.id)),
      actorThreads.flatMap((thread) => thread.actorIds.filter((id) => id !== actor.id)),
    );
    const statusEntry: RuntimeActorLedgerEntry | null =
      actor.status === 'alive' && !hasExitEvent
        ? null
        : {
            id: `ledger-status-${actor.id}-${actor.status}`,
            pulse: runtime.pulse,
            kind: 'status',
            title: actorStatusSummary(actor, 1, hasExitEvent),
            body: `${actor.name}当前状态为${actor.status}，这会改变其可行动范围与他人判断。`,
            actorIds: [actor.id],
            confidence: runtime.confidence,
          };
    const entries: RuntimeActorLedgerEntry[] = [
      ...events.map((event): RuntimeActorLedgerEntry => ({
        id: `ledger-event-${event.id}-${actor.id}`,
        pulse: event.pulse,
        kind: 'event',
        title: event.title,
        body: event.body || event.impact,
        actorIds: event.actorIds,
        confidence: event.confidence,
      })),
      ...signals.map((signal): RuntimeActorLedgerEntry => ({
        id: `ledger-signal-${signal.id}-${actor.id}`,
        pulse: signal.pulse,
        kind: 'signal',
        title: signal.actorId === actor.id ? '个人谋划' : `${signal.actorName}将其纳入谋划`,
        body: signal.actorId === actor.id ? signal.plannedAction : signal.privateIntent,
        actorIds: [signal.actorId, ...signal.targetActorIds],
        confidence: signal.confidence,
      })),
      ...actorDialogues.map((dialogue): RuntimeActorLedgerEntry => ({
        id: `ledger-dialogue-${dialogue.id}-${actor.id}`,
        pulse: dialogue.pulse,
        kind: 'dialogue',
        title: dialogue.topic,
        body: dialogue.lines.find((line) => line.actorId === actor.id)?.text || dialogue.stakes,
        actorIds: dialogue.participants,
        confidence: dialogue.confidence,
      })),
      ...actorThreads.map((thread): RuntimeActorLedgerEntry => ({
        id: `ledger-pressure-${thread.id}-${actor.id}`,
        pulse: thread.pulse,
        kind: 'pressure',
        title: thread.title,
        body: thread.nextPressure || thread.unresolvedQuestion,
        actorIds: thread.actorIds,
        confidence: thread.confidence,
      })),
      ...(statusEntry ? [statusEntry] : []),
    ]
      .sort((left, right) => right.pulse - left.pulse || right.confidence - left.confidence)
      .slice(0, 10);
    const pressureRisk = actorThreads.reduce((max, thread) => Math.max(max, thread.tension, thread.urgency), 0);
    const exitRisk = exitStatuses.has(actor.status) || hasExitEvent ? 0.96 : 0;
    const riskScore = clamp(Math.max(actor.risk, pressureRisk, exitRisk, runtime.conflictLevel * 0.58));
    const influenceScore = clamp(actor.influence + Math.min(0.18, knownActorIds.length * 0.025) - (actor.status === 'alive' ? 0 : 0.16));
    const lastEntry = entries[0];

    return {
      actor,
      entries,
      pressureThreads: actorThreads,
      dialogues: actorDialogues,
      signals,
      events,
      knownActorIds,
      riskScore,
      influenceScore,
      statusSummary: actorStatusSummary(actor, riskScore, hasExitEvent),
      lastActionSummary: lastEntry ? `${lastEntry.title}：${lastEntry.body}` : '尚未留下可观察的个人行动。',
    };
  });
}

function firstActorId(actorIds: string[], actorById: Map<string, RuntimeActor>) {
  return actorIds.find((id) => actorById.has(id)) || actorIds[0] || '';
}

function sceneTitle(actorIds: string[], actorById: Map<string, RuntimeActor>, fallback: string) {
  const names = actorIds
    .map((id) => actorById.get(id)?.name)
    .filter((name): name is string => Boolean(name))
    .slice(0, 3);
  if (names.length >= 2 && names.slice(0, 2).every((name) => fallback.includes(name))) return fallback;
  return names.length >= 2 ? `${names.join(' / ')}：${fallback}` : fallback;
}

export function buildRuntimeConfrontationScenes(runtime: RuntimeWorld): RuntimeConfrontationScene[] {
  const actorById = new Map(runtime.actors.map((actor) => [actor.id, actor]));
  const chains = buildRuntimeReactionChains(runtime);
  const dialogues = buildRuntimeDialogueExchanges(runtime);
  const pressureThreads = buildRuntimePressureThreads(runtime);
  const scenes: RuntimeConfrontationScene[] = [];

  dialogues.forEach((dialogue) => {
    const initiatorActorId = firstActorId(dialogue.participants, actorById);
    const targetActorIds = dialogue.participants.filter((id) => id !== initiatorActorId && actorById.has(id)).slice(0, 3);
    scenes.push({
      id: `confront-dialogue-${dialogue.id}`,
      pulse: dialogue.pulse,
      title: sceneTitle(dialogue.participants, actorById, dialogue.topic),
      source: 'dialogue',
      initiatorActorId,
      targetActorIds,
      actorIds: dialogue.participants.filter((id) => actorById.has(id)),
      trigger: dialogue.lines[0]?.text || dialogue.topic,
      response: dialogue.lines[1]?.text || dialogue.stakes,
      stakes: dialogue.stakes,
      tension: clamp(0.38 + dialogue.confidence * 0.42 + runtime.conflictLevel * 0.18),
      visibility: dialogue.visibility,
      confidence: dialogue.confidence,
    });
  });

  chains.forEach((chain) => {
    const actorIds = [chain.readerActorId, ...chain.targetActorIds].filter((id, index, ids) => actorById.has(id) && ids.indexOf(id) === index);
    if (actorIds.length < 2) return;
    scenes.push({
      id: `confront-reaction-${chain.id}`,
      pulse: chain.pulse,
      title: sceneTitle(actorIds, actorById, chain.sourceTitle),
      source: 'reaction',
      initiatorActorId: chain.readerActorId,
      targetActorIds: chain.targetActorIds.filter((id) => actorById.has(id)).slice(0, 3),
      actorIds,
      trigger: chain.triggerSummary,
      response: chain.reactionSummary,
      stakes: `${chain.readerActorName}必须决定如何回应这条刺激，否则主动权会转移给对手。`,
      tension: clamp(0.34 + chain.confidence * 0.36 + runtime.conflictLevel * 0.22),
      visibility: chain.visibility,
      confidence: chain.confidence,
    });
  });

  pressureThreads.forEach((thread) => {
    const actorIds = thread.actorIds.filter((id) => actorById.has(id));
    if (actorIds.length < 2) return;
    const initiatorActorId = firstActorId(actorIds, actorById);
    const pressureTension = Math.max(thread.tension, thread.urgency);
    const isDirectPressure = Boolean(thread.sourceDialogueId || thread.sourceChainId);
    scenes.push({
      id: `confront-pressure-${thread.id}`,
      pulse: thread.pulse,
      title: sceneTitle(actorIds, actorById, thread.title),
      source: 'pressure',
      initiatorActorId,
      targetActorIds: actorIds.filter((id) => id !== initiatorActorId).slice(0, 3),
      actorIds,
      trigger: thread.unresolvedQuestion,
      response: thread.nextPressure,
      stakes: thread.unresolvedQuestion,
      tension: clamp(isDirectPressure ? pressureTension : pressureTension * 0.82),
      visibility: 'observer_only',
      confidence: thread.confidence,
    });
  });

  runtime.stream
    .filter((event) => event.actorIds.length >= 2 && ['conflict', 'betrayal', 'death', 'speech'].includes(event.type))
    .slice(0, 12)
    .forEach((event) => {
      const actorIds = event.actorIds.filter((id) => actorById.has(id));
      const initiatorActorId = firstActorId(actorIds, actorById);
      scenes.push({
        id: `confront-event-${event.id}`,
        pulse: event.pulse,
        title: sceneTitle(actorIds, actorById, event.title),
        source: 'event',
        initiatorActorId,
        targetActorIds: actorIds.filter((id) => id !== initiatorActorId).slice(0, 3),
        actorIds,
        trigger: event.body,
        response: event.impact,
        stakes: event.impact,
        tension: clamp(event.type === 'death' ? 0.98 : event.type === 'conflict' || event.type === 'betrayal' ? 0.82 : 0.52),
        visibility: event.visibility,
        confidence: event.confidence,
      });
    });

  const byId = new Map<string, RuntimeConfrontationScene>();
  scenes.forEach((scene) => {
    if (!scene.initiatorActorId || scene.actorIds.length < 2) return;
    byId.set(scene.id, scene);
  });

  const sourcePriority: Record<RuntimeConfrontationScene['source'], number> = {
    event: 4,
    dialogue: 3,
    reaction: 2,
    pressure: 1,
  };

  return Array.from(byId.values())
    .sort(
      (left, right) =>
        right.tension - left.tension ||
        sourcePriority[right.source] - sourcePriority[left.source] ||
        right.pulse - left.pulse ||
        right.confidence - left.confidence,
    )
    .slice(0, 8);
}

function deriveConflicts(world: SimulationWorld) {
  const agents = world.agents;
  const first = agents[0];
  const second = agents[1];
  const third = agents[2];
  const fourth = agents[3];

  return [
    {
      id: 'conflict-core',
      title: '中心假设引发的权力重组',
      actors: [first?.id, second?.id, third?.id].filter(Boolean),
      intensity: clamp(0.56 + (world.branches[1]?.divergence || 0.2)),
      description: world.eventAnalysis.causes[0] || world.centralQuestion,
      possibleBreaks: world.eventAnalysis.openQuestions.slice(0, 3),
    },
    {
      id: 'conflict-shadow',
      title: '公开秩序与私下谋划的错位',
      actors: [first?.id, third?.id, fourth?.id].filter(Boolean),
      intensity: clamp(0.42 + (world.branches[2]?.divergence || 0.22)),
      description: world.branches[2]?.summary || '不同阵营开始把公开表态和真实意图拆开。',
      possibleBreaks: world.branches.flatMap((branch) => branch.storyBeats || branch.causalChain).slice(0, 3),
    },
  ];
}

function sceneLimitForWorld(world: SimulationWorld) {
  const horizonCaps = {
    short: 8,
    strategic: 12,
    generational: 16,
    mythic: 20,
  } satisfies Record<SimulationWorld['horizon'], number>;
  const minimum = world.horizon === 'short' ? 6 : 8;
  const planned = Math.max(world.simulationPlan.totalSteps, world.actionLogs.length, minimum);
  return Math.min(Math.max(planned, minimum), horizonCaps[world.horizon] ?? 12);
}

function judgeConvergence(runtime: RuntimeWorld): RuntimeConvergence {
  const inactiveCount = runtime.actors.filter((actor) => actor.status !== 'alive').length;
  const livingConflictActors = runtime.actors.filter((actor) => actor.status === 'alive' && actor.influence > 0.42).length;
  const isLastPulse = runtime.pulse >= runtime.maxPulses;
  const confidenceLow = runtime.confidence < 0.34;
  const agentCollapse = inactiveCount >= Math.max(2, Math.ceil(runtime.actors.length * 0.45));
  const activeWorldTooThin = runtime.pulse >= 4 && livingConflictActors < 2;
  const stageStable = runtime.pulse >= Math.ceil(runtime.maxPulses * 0.85) && runtime.stability > runtime.conflictLevel + 0.08;

  if (isLastPulse || confidenceLow || agentCollapse || activeWorldTooThin || stageStable) {
    const pauseType = confidenceLow
      ? 'confidence_decay'
      : agentCollapse || activeWorldTooThin
        ? 'agent_collapse'
        : isLastPulse
          ? 'budget_limit'
          : 'stage_convergence';
    return {
      shouldPause: true,
      pauseType,
      summary:
        pauseType === 'confidence_decay'
          ? '世界线已经远离输入资料，继续推进会明显进入高发散区。'
          : pauseType === 'agent_collapse'
            ? '多个关键人物退出舞台，第一阶段权力结构已经被迫重排。'
            : '中心事件引发的第一波因果链已经形成阶段性收束。',
      confidence: runtime.confidence,
      unresolvedConflicts: runtime.conflicts.filter((conflict) => conflict.intensity > 0.44).map((conflict) => conflict.title),
      continueOptions: [
        '继续推进下一阶段',
        '放大最高强度冲突',
        '追踪幸存关键人物',
        livingConflictActors > 2 ? '生成平行分支世界' : '观察权力真空后的继承者',
      ],
    };
  }

  return {
    shouldPause: false,
    pauseType: 'running',
    summary: '世界仍在连续演化，关键人物尚未完成第一阶段博弈。',
    confidence: runtime.confidence,
    unresolvedConflicts: runtime.conflicts.filter((conflict) => conflict.intensity > 0.44).map((conflict) => conflict.title),
    continueOptions: [],
  };
}

export function createRuntimeWorld(world: SimulationWorld): RuntimeWorld {
  const maxPulses = sceneLimitForWorld(world);
  const actors = createActors(world.agents);
  const runtime: RuntimeWorld = {
    id: `world-${Date.now()}`,
    worldTitle: world.title,
    centerEvent: world.eventText,
    centralQuestion: world.centralQuestion,
    phase: world.simulationPlan.startLabel,
    pulse: 0,
    maxPulses,
    stability: clamp(0.46 + world.confidence * 0.28),
    conflictLevel: clamp(0.52 + (world.branches[2]?.divergence || 0.22)),
    confidence: clamp(world.confidence || 0.58),
    actors,
    signals: [],
    stream: [createSeedEvent(world)],
    conflicts: deriveConflicts(world),
    convergence: {
      shouldPause: false,
      pauseType: 'running',
      summary: '世界刚被启动，Agent 正在读取公开事实与各自记忆。',
      confidence: clamp(world.confidence || 0.58),
      unresolvedConflicts: [],
      continueOptions: [],
    },
    snapshots: [],
  };

  return {
    ...runtime,
    convergence: judgeConvergence(runtime),
  };
}

export function advanceRuntimeWorld(runtime: RuntimeWorld, world: SimulationWorld): RuntimeWorld {
  if (runtime.convergence.shouldPause) return runtime;

  const nextPulse = runtime.pulse + 1;
  const matchingLogs = world.actionLogs.filter((log) => log.step === nextPulse - 1);
  const newEvents = matchingLogs.length
    ? matchingLogs.map((log) => mapLogToRuntimeEvent(log, nextPulse))
    : [deriveFallbackEvent(runtime, nextPulse)];
  return applyRuntimeEvents(runtime, world, newEvents);
}

export function applyRuntimeEvents(
  runtime: RuntimeWorld,
  world: SimulationWorld,
  events: RuntimeWorldEvent[],
  signals: RuntimeAgentSignal[] = [],
  actorUpdates: RuntimeActorUpdate[] = [],
): RuntimeWorld {
  if (runtime.convergence.shouldPause) return runtime;

  const nextPulse = runtime.pulse + 1;
  const newEvents = events.length
    ? events.map((event, index) => ({
        ...event,
        id: event.id || `runtime-generated-${nextPulse}-${index + 1}`,
        pulse: nextPulse,
      }))
    : [deriveFallbackEvent(runtime, nextPulse)];
  const signalPulse = signals.map((signal, index) => ({
    ...signal,
    id: signal.id || `signal-${nextPulse}-${index + 1}`,
    pulse: nextPulse,
  }));
  const rosterPulse = actorUpdates.map((update, index) => ({
    ...update,
    id: update.id || `actor-update-${nextPulse}-${index + 1}`,
    pulse: nextPulse,
  }));
  const actorsAfterRoster = applyActorRosterUpdates(runtime.actors, rosterPulse);
  const actorsAfterSignals = updateActorsFromSignals(actorsAfterRoster, signalPulse);
  const nextActors = newEvents.reduce((actors, event) => updateActorsFromEvent(actors, event), actorsAfterSignals);
  const conflictDelta = newEvents.some((event) => event.type === 'conflict' || event.type === 'betrayal' || event.type === 'death') ? 0.08 : -0.03;
  const nextRuntime: RuntimeWorld = {
    ...runtime,
    pulse: nextPulse,
    phase: world.timeline[nextPulse - 1]?.year || `第 ${nextPulse + 1} 幕`,
    actors: nextActors,
    signals: [...signalPulse, ...runtime.signals].slice(0, 40),
    stream: [...newEvents, ...runtime.stream].slice(0, 80),
    stability: clamp(runtime.stability + (conflictDelta < 0 ? 0.04 : -0.03)),
    conflictLevel: clamp(runtime.conflictLevel + conflictDelta),
    confidence: clamp(runtime.confidence - 0.025),
    conflicts: runtime.conflicts.map((conflict, index) => ({
      ...conflict,
      intensity: clamp(conflict.intensity + (index === nextPulse % runtime.conflicts.length ? conflictDelta : -0.01)),
    })),
  };

  const convergence = judgeConvergence(nextRuntime);
  return {
    ...nextRuntime,
    convergence,
    snapshots: convergence.shouldPause ? [convergence, ...runtime.snapshots].slice(0, 8) : runtime.snapshots,
  };
}

export function continueRuntimeWorld(runtime: RuntimeWorld): RuntimeWorld {
  const liveActors = runtime.actors.filter((actor) => actor.status === 'alive');
  const nextMaxPulses = runtime.maxPulses + Math.max(4, Math.ceil(runtime.maxPulses * 0.55));
  const continueEvent: RuntimeWorldEvent = {
    id: `runtime-continue-${Date.now()}`,
    pulse: runtime.pulse,
    timeLabel: '下一阶段开启',
    type: 'convergence',
    visibility: 'public',
    actorIds: liveActors.slice(0, 4).map((actor) => actor.id),
    title: '世界从阶段性收束点继续生长',
    body: '上一阶段的记忆被压缩为世界快照，幸存人物带着旧怨、债务和误判进入下一阶段。',
    impact: runtime.convergence.unresolvedConflicts[0] || '新的冲突焦点将从未解决问题中自然浮现。',
    confidence: clamp(runtime.confidence - 0.06),
  };

  return {
    ...runtime,
    maxPulses: nextMaxPulses,
    phase: '下一阶段',
    signals: runtime.signals.slice(0, 12),
    stream: [continueEvent, ...runtime.stream].slice(0, 80),
    conflicts: runtime.conflicts.map((conflict) => ({ ...conflict, intensity: clamp(conflict.intensity + 0.05) })),
    convergence: {
      shouldPause: false,
      pauseType: 'running',
      summary: '世界已经从快照继续，Agent 将携带前一阶段记忆继续行动。',
      confidence: clamp(runtime.confidence - 0.06),
      unresolvedConflicts: [],
      continueOptions: [],
    },
    confidence: clamp(runtime.confidence - 0.06),
  };
}
