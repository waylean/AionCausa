import { describe, expect, it } from 'vitest';
import { createSimulationWorld } from './simulator';
import {
  advanceRuntimeWorld,
  applyRuntimeEvents,
  buildActorVisibleContexts,
  buildFocusedPressureThreadContext,
  buildRuntimeActorLedgers,
  buildRuntimeConfrontationScenes,
  buildRuntimeObservationFlow,
  buildRuntimeDialogueExchanges,
  buildRuntimePressureThreads,
  buildRuntimeReactionChains,
  buildRuntimePulseSlices,
  buildRuntimeRelations,
  continueRuntimeWorld,
  createRuntimeWorld,
} from './worldRuntime';

describe('world runtime', () => {
  it('creates a continuous runtime world from a generated simulation', () => {
    const world = createSimulationWorld('如果商鞅变法之后，商鞅没有被杀，秦国会如何发展？', 'strategic');
    const runtime = createRuntimeWorld(world);

    expect(runtime.actors.length).toBeGreaterThanOrEqual(5);
    expect(runtime.stream[0]?.title).toContain('中心事件');
    expect(runtime.convergence.shouldPause).toBe(false);
  });

  it('caps the visible scene budget for a finite strategic world', () => {
    const world = createSimulationWorld('strategic scene cap test', 'strategic');
    world.simulationPlan.totalSteps = 99;
    const runtime = createRuntimeWorld(world);

    expect(runtime.maxPulses).toBe(12);
  });

  it('advances pulses and writes observable stream events', () => {
    const world = createSimulationWorld('如果商鞅变法之后，商鞅没有被杀，秦国会如何发展？', 'strategic');
    world.actionLogs = [
      {
        id: 'act-test',
        step: 0,
        timeLabel: '秦惠文王初年',
        agentId: world.agents[0].id,
        agentName: world.agents[0].name,
        action: '私下会见新君',
        detail: '商鞅向嬴驷提出交出部分人事权，以保留县制和军功爵。',
        impact: '嬴驷暂缓清算，但旧贵族开始转入暗中结盟。',
        confidence: 0.7,
      },
    ];
    const runtime = advanceRuntimeWorld(createRuntimeWorld(world), world);

    expect(runtime.pulse).toBe(1);
    expect(runtime.stream[0]?.title).toContain(world.agents[0].name);
    expect(runtime.actors[0].memory[0]).toContain(world.agents[0].name);
  });

  it('uses generic fallback events when no model actions are available', () => {
    const world = createSimulationWorld('如果伏地魔在霍格沃茨公开获胜，魔法世界会如何发展？', 'strategic');
    world.actionLogs = [];
    const runtime = advanceRuntimeWorld(createRuntimeWorld(world), world);
    const eventText = `${runtime.stream[0]?.title} ${runtime.stream[0]?.body} ${runtime.stream[0]?.impact}`;

    expect(eventText).not.toMatch(/王权中枢|旧制网络|变法秩序|公开姿态|私下安排|改变了下一步试探方式/u);
    expect(runtime.stream[0]?.initiatorActorId).toBeTruthy();
  });

  it('allows actor exit and then continuing from a convergence snapshot', () => {
    const world = createSimulationWorld('如果商鞅变法之后，商鞅没有被杀，秦国会如何发展？', 'short');
    world.simulationPlan.totalSteps = 1;
    world.actionLogs = [
      {
        id: 'act-death',
        step: 0,
        timeLabel: '危机夜',
        agentId: world.agents[0].id,
        agentName: world.agents[0].name,
        action: '遭到刺杀',
        detail: '商鞅在入宫前被旧臣刺杀。',
        impact: '商鞅死亡，新法成为幸存者争夺的政治遗产。',
        confidence: 0.62,
      },
    ];

    const paused = advanceRuntimeWorld({ ...createRuntimeWorld(world), maxPulses: 1 }, world);
    expect(paused.actors[0].status).toBe('dead');
    expect(paused.convergence.shouldPause).toBe(true);

    const continued = continueRuntimeWorld(paused);
    expect(continued.convergence.shouldPause).toBe(false);
    expect(continued.maxPulses).toBeGreaterThan(paused.maxPulses);
    expect(continued.stream[0]?.title).toContain('继续生长');
  });

  it('applies private agent signals to runtime actor intent', () => {
    const world = createSimulationWorld('如果商鞅变法之后，商鞅没有被杀，秦国会如何发展？', 'strategic');
    const runtime = createRuntimeWorld(world);
    const actor = runtime.actors[0];
    const next = applyRuntimeEvents(runtime, world, [], [
      {
        id: 'signal-test',
        pulse: 1,
        actorId: actor.id,
        actorName: actor.name,
        visibility: 'private',
        readSignals: ['嬴驷没有立即清算'],
        privateIntent: '商鞅决定用退让换取新法延续。',
        plannedAction: '主动交出部分封地，保住县制执行网。',
        targetActorIds: [runtime.actors[1].id],
        emotionalState: '戒备',
        confidence: 0.68,
      },
    ]);

    expect(next.signals[0].actorId).toBe(actor.id);
    expect(next.actors[0].intent).toContain('交出部分封地');
    expect(next.stream[0].pulse).toBe(1);
  });

  it('does not remove an actor because unrelated status words appear in an event', () => {
    const world = createSimulationWorld('如果商鞅变法之后，商鞅没有被杀，秦国会如何发展？', 'strategic');
    const runtime = createRuntimeWorld(world);
    const ruler = runtime.actors[1];
    const next = applyRuntimeEvents(runtime, world, [
      {
        id: 'event-generic-kill-word',
        pulse: 1,
        timeLabel: '朝议',
        type: 'policy',
        visibility: 'public',
        actorIds: [ruler.id],
        title: '嬴驷要求评估新法',
        body: '嬴驷把朝堂争论从保人杀人转向制度考核。',
        impact: '商鞅的个人命运暂时悬置。',
        confidence: 0.66,
      },
    ]);

    expect(next.actors.find((actor) => actor.id === ruler.id)?.status).toBe('alive');
  });

  it('builds per-agent visible contexts without omniscient secret access', () => {
    const world = createSimulationWorld('如果商鞅变法之后，商鞅没有被杀，秦国会如何发展？', 'strategic');
    const runtime = createRuntimeWorld(world);
    const reformer = runtime.actors[0];
    const ruler = runtime.actors[1];
    const outsider = runtime.actors.find((actor) => actor.faction === '外部势力') ?? runtime.actors[3];

    const next = applyRuntimeEvents(
      runtime,
      world,
      [
        {
          id: 'secret-event',
          pulse: 1,
          timeLabel: '密议',
          type: 'move',
          visibility: 'secret',
          actorIds: [reformer.id, ruler.id],
          title: '商鞅与嬴驷密议交权',
          body: '两人讨论以退为进。',
          impact: '旧贵族暂时无法确认真实内容。',
          confidence: 0.7,
        },
        {
          id: 'observer-event',
          pulse: 1,
          timeLabel: '旁白',
          type: 'convergence',
          visibility: 'observer_only',
          actorIds: [],
          title: '用户可见的世界旁白',
          body: '这不应进入任何 Agent 上下文。',
          impact: '仅供观察。',
          confidence: 0.7,
        },
      ],
      [],
    );

    const contexts = buildActorVisibleContexts(next);
    const reformerContext = contexts.find((context) => context.actorId === reformer.id);
    const outsiderContext = contexts.find((context) => context.actorId === outsider.id);

    expect(reformerContext?.visibleEventIds).toContain('secret-event');
    expect(outsiderContext?.visibleEventIds).not.toContain('secret-event');
    expect(contexts.every((context) => !context.visibleEventIds.includes('observer-event'))).toBe(true);
  });

  it('derives active actor relations from events and private signals', () => {
    const world = createSimulationWorld('如果商鞅没有被杀，秦国会如何发展？', 'strategic');
    const runtime = createRuntimeWorld(world);
    const reformer = runtime.actors[0];
    const ruler = runtime.actors[1];
    const opponent = runtime.actors[2];

    const next = applyRuntimeEvents(
      runtime,
      world,
      [
        {
          id: 'relation-conflict-event',
          pulse: 1,
          timeLabel: '朝会',
          type: 'conflict',
          visibility: 'public',
          actorIds: [reformer.id, opponent.id],
          title: '商鞅与旧臣公开交锋',
          body: '双方围绕新法存废互相逼迫。',
          impact: '改革秩序与旧制网络的冲突公开化。',
          confidence: 0.72,
        },
      ],
      [
        {
          id: 'relation-signal',
          pulse: 1,
          actorId: reformer.id,
          actorName: reformer.name,
          visibility: 'private',
          readSignals: ['旧臣公开施压'],
          privateIntent: '先稳住君主，再切断旧臣同盟。',
          plannedAction: '秘密说服君主压低旧臣声量。',
          targetActorIds: [ruler.id],
          emotionalState: '戒备',
          confidence: 0.7,
        },
      ],
    );

    const relations = buildRuntimeRelations(next);
    expect(relations.some((relation) => relation.kind === 'conflict')).toBe(true);
    expect(relations.some((relation) => relation.sourceActorId === reformer.id && relation.targetActorId === ruler.id)).toBe(true);
    expect(relations[0].intensity).toBeGreaterThan(0.3);
  });

  it('groups events and agent signals into recent observation pulse slices', () => {
    const world = createSimulationWorld('如果商鞅没有被杀，秦国会如何发展？', 'strategic');
    const runtime = createRuntimeWorld(world);
    const reformer = runtime.actors[0];
    const ruler = runtime.actors[1];

    const next = applyRuntimeEvents(
      runtime,
      world,
      [
        {
          id: 'pulse-public-event',
          pulse: 1,
          timeLabel: '朝会',
          type: 'speech',
          visibility: 'public',
          actorIds: [reformer.id, ruler.id],
          title: '商鞅入宫陈述新法',
          body: '商鞅公开承诺交出部分封地。',
          impact: '秦君暂缓处置商鞅，旧臣开始重新结盟。',
          confidence: 0.72,
        },
        {
          id: 'pulse-secret-event',
          pulse: 1,
          timeLabel: '夜谈',
          type: 'move',
          visibility: 'secret',
          actorIds: [reformer.id],
          title: '商鞅秘密转移文书',
          body: '他把县制账册交给亲信保管。',
          impact: '旧臣即使夺权也难以立刻拆除执行网。',
          confidence: 0.68,
        },
      ],
      [
        {
          id: 'pulse-signal',
          pulse: 1,
          actorId: reformer.id,
          actorName: reformer.name,
          visibility: 'private',
          readSignals: ['秦君没有立即清算'],
          privateIntent: '用退让换取新法延续。',
          plannedAction: '先稳住秦君，再拆解旧臣同盟。',
          targetActorIds: [ruler.id],
          emotionalState: '戒备',
          confidence: 0.7,
        },
      ],
    );

    const slices = buildRuntimePulseSlices(next);
    expect(slices[0].pulse).toBe(1);
    expect(slices[0].signals).toHaveLength(1);
    expect(slices[0].events).toHaveLength(2);
    expect(slices[0].publicEventCount).toBe(1);
    expect(slices[0].hiddenEventCount).toBe(1);
    expect(slices[0].summary).toContain(reformer.name);
  });

  it('derives reaction chains from visible world events and private agent plans', () => {
    const world = createSimulationWorld('如果商鞅变法之后，商鞅没有被杀，秦国会如何发展？', 'strategic');
    const runtime = createRuntimeWorld(world);
    const reformer = runtime.actors[0];
    const ruler = runtime.actors[1];

    const next = applyRuntimeEvents(
      runtime,
      world,
      [
        {
          id: 'trigger-event',
          pulse: 1,
          timeLabel: 'court morning',
          type: 'speech',
          visibility: 'public',
          actorIds: [reformer.id],
          title: 'the reformer submits a public concession',
          body: 'the reformer gives up direct military authority to preserve the system',
          impact: 'the ruler must decide whether the concession is sincere or tactical',
          confidence: 0.72,
        },
      ],
      [
        {
          id: 'reaction-signal',
          pulse: 1,
          actorId: ruler.id,
          actorName: ruler.name,
          visibility: 'private',
          readSignals: ['the reformer submits a public concession'],
          privateIntent: 'test whether the concession is a trap',
          plannedAction: 'summon the reformer and an opponent into the same chamber',
          targetActorIds: [reformer.id],
          emotionalState: 'watchful',
          confidence: 0.69,
        },
      ],
    );

    const chains = buildRuntimeReactionChains(next);
    expect(chains[0].sourceEventId).toBe('trigger-event');
    expect(chains[0].readerActorId).toBe(ruler.id);
    expect(chains[0].targetActorIds).toEqual([reformer.id]);
    expect(chains[0].reactionSummary).toContain('summon');
  });

  it('derives compact dialogue exchanges from reaction chains', () => {
    const world = createSimulationWorld('如果商鞅变法之后，商鞅没有被杀，秦国会如何发展？', 'strategic');
    const runtime = createRuntimeWorld(world);
    const reformer = runtime.actors[0];
    const ruler = runtime.actors[1];

    const next = applyRuntimeEvents(
      runtime,
      world,
      [
        {
          id: 'dialogue-trigger-event',
          pulse: 1,
          timeLabel: 'court morning',
          type: 'speech',
          visibility: 'public',
          actorIds: [ruler.id],
          title: 'the ruler demands proof of loyalty',
          body: 'the ruler asks whether the reformer will give up direct command',
          impact: 'the reformer must answer or lose trust',
          confidence: 0.7,
        },
      ],
      [
        {
          id: 'dialogue-reaction-signal',
          pulse: 1,
          actorId: reformer.id,
          actorName: reformer.name,
          visibility: 'private',
          readSignals: ['the ruler demands proof of loyalty'],
          privateIntent: 'turn suspicion into a bargaining opening',
          plannedAction: 'offer a visible concession while preserving institutional control',
          targetActorIds: [ruler.id],
          emotionalState: 'calculating',
          confidence: 0.67,
        },
      ],
    );

    const exchanges = buildRuntimeDialogueExchanges(next);
    expect(exchanges.length).toBeGreaterThan(0);
    expect(exchanges[0].participants).toEqual(expect.arrayContaining([reformer.id, ruler.id]));
    expect(exchanges[0].visibility).toBe('private');
    expect(exchanges[0].confidence).toBe(0.67);
    expect(exchanges[0].lines.some((line) => line.text.includes(reformer.name))).toBe(true);
    expect(exchanges[0].lines.some((line) => line.text.includes('concession') || line.text.includes('loyalty'))).toBe(true);
  });

  it('derives unresolved pressure threads from dialogue and conflict state', () => {
    const world = createSimulationWorld('如果商鞅变法之后，商鞅没有被杀，秦国会如何发展？', 'strategic');
    const runtime = createRuntimeWorld(world);
    const reformer = runtime.actors[0];
    const ruler = runtime.actors[1];

    const next = applyRuntimeEvents(
      runtime,
      world,
      [
        {
          id: 'pressure-thread-trigger',
          pulse: 1,
          timeLabel: 'court morning',
          type: 'speech',
          visibility: 'public',
          actorIds: [ruler.id],
          title: 'the ruler demands proof of loyalty',
          body: 'the ruler asks whether the reformer will give up direct command',
          impact: 'the reformer must answer or lose trust',
          confidence: 0.7,
        },
      ],
      [
        {
          id: 'pressure-thread-signal',
          pulse: 1,
          actorId: reformer.id,
          actorName: reformer.name,
          visibility: 'private',
          readSignals: ['the ruler demands proof of loyalty'],
          privateIntent: 'turn suspicion into a bargaining opening',
          plannedAction: 'offer a visible concession while preserving institutional control',
          targetActorIds: [ruler.id],
          emotionalState: 'calculating',
          confidence: 0.67,
        },
      ],
    );

    const threads = buildRuntimePressureThreads(next);
    expect(threads.length).toBeGreaterThan(0);
    expect(threads[0].actorIds.length).toBeGreaterThan(0);
    expect(threads.some((thread) => thread.actorIds.includes(reformer.id) && thread.actorIds.includes(ruler.id))).toBe(true);
    expect(threads[0].urgency).toBeGreaterThan(0.3);
    expect(threads[0].unresolvedQuestion || threads[0].nextPressure).toBeTruthy();
  });

  it('builds a focused thread context with related actors, chains, dialogues, and events', () => {
    const world = createSimulationWorld('如果商鞅变法之后，商鞅没有被杀，秦国会如何发展？', 'strategic');
    const runtime = createRuntimeWorld(world);
    const reformer = runtime.actors[0];
    const ruler = runtime.actors[1];

    const next = applyRuntimeEvents(
      runtime,
      world,
      [
        {
          id: 'focused-trigger-event',
          pulse: 1,
          timeLabel: 'court morning',
          type: 'speech',
          visibility: 'public',
          actorIds: [ruler.id],
          title: 'the ruler demands proof of loyalty',
          body: 'the ruler asks whether the reformer will give up direct command',
          impact: 'the reformer must answer or lose trust',
          confidence: 0.7,
        },
      ],
      [
        {
          id: 'focused-reaction-signal',
          pulse: 1,
          actorId: reformer.id,
          actorName: reformer.name,
          visibility: 'private',
          readSignals: ['the ruler demands proof of loyalty'],
          privateIntent: 'turn suspicion into a bargaining opening',
          plannedAction: 'offer a visible concession while preserving institutional control',
          targetActorIds: [ruler.id],
          emotionalState: 'calculating',
          confidence: 0.67,
        },
      ],
    );

    const threads = buildRuntimePressureThreads(next);
    expect(threads.length).toBeGreaterThan(0);

    const threadId = threads[0].id;
    const context = buildFocusedPressureThreadContext(next, threadId);

    expect(context).not.toBeNull();
    expect(context!.thread.id).toBe(threadId);
    expect(context!.actors.length).toBeGreaterThan(0);
    expect(context!.summary).toBeTruthy();
    expect(context!.summary.length).toBeGreaterThan(0);

    expect(
      context!.relatedEvents.length > 0 ||
        context!.relatedChains.length > 0 ||
        context!.relatedDialogues.length > 0,
    ).toBe(true);
  });

  it('returns null for a nonexistent thread id', () => {
    const world = createSimulationWorld('如果商鞅变法之后，商鞅没有被杀，秦国会如何发展？', 'strategic');
    const runtime = createRuntimeWorld(world);
    const context = buildFocusedPressureThreadContext(runtime, 'nonexistent-thread-id');
    expect(context).toBeNull();
  });

  it('builds an observation flow from signals and world events', () => {
    const world = createSimulationWorld('如果商鞅变法之后，商鞅没有被杀，秦国会如何发展？', 'strategic');
    const runtime = createRuntimeWorld(world);
    const reformer = runtime.actors[0];
    const ruler = runtime.actors[1];

    const next = applyRuntimeEvents(
      runtime,
      world,
      [
        {
          id: 'flow-public-event',
          pulse: 1,
          timeLabel: 'court morning',
          type: 'speech',
          visibility: 'public',
          actorIds: [ruler.id],
          title: 'the ruler demands proof of loyalty',
          body: 'the ruler asks the reformer to surrender direct command',
          impact: 'the reformer must answer before opponents frame the issue',
          confidence: 0.74,
        },
      ],
      [
        {
          id: 'flow-private-signal',
          pulse: 1,
          actorId: reformer.id,
          actorName: reformer.name,
          visibility: 'private',
          readSignals: ['the ruler demands proof of loyalty'],
          privateIntent: 'turn suspicion into a controlled concession',
          plannedAction: 'offer a concession while preserving institutional control',
          targetActorIds: [ruler.id],
          emotionalState: 'calculating',
          confidence: 0.68,
        },
      ],
    );

    const flow = buildRuntimeObservationFlow(next);
    expect(flow[0].pulse).toBe(1);
    expect(flow[0].signals).toHaveLength(1);
    expect(flow[0].events).toHaveLength(1);
    expect(flow[0].actorIds).toEqual(expect.arrayContaining([reformer.id, ruler.id]));
    expect(flow[0].summary).toContain(reformer.name);
    expect(flow[0].dominantTension).toBeGreaterThan(0.3);
  });

  it('groups dialogue exchanges and pressure threads into the same observation frame', () => {
    const world = createSimulationWorld('如果商鞅变法之后，商鞅没有被杀，秦国会如何发展？', 'strategic');
    const runtime = createRuntimeWorld(world);
    const reformer = runtime.actors[0];
    const ruler = runtime.actors[1];

    const next = applyRuntimeEvents(
      runtime,
      world,
      [
        {
          id: 'flow-dialogue-trigger',
          pulse: 1,
          timeLabel: 'inner court',
          type: 'speech',
          visibility: 'public',
          actorIds: [ruler.id],
          title: 'the ruler opens a loyalty hearing',
          body: 'the ruler invites competing factions to test the reformer',
          impact: 'a visible confrontation becomes unavoidable',
          confidence: 0.7,
        },
      ],
      [
        {
          id: 'flow-dialogue-signal',
          pulse: 1,
          actorId: reformer.id,
          actorName: reformer.name,
          visibility: 'private',
          readSignals: ['the ruler opens a loyalty hearing'],
          privateIntent: 'force the ruler to choose between law and old privilege',
          plannedAction: 'answer in public and name the cost of retreat',
          targetActorIds: [ruler.id],
          emotionalState: 'aggressive',
          confidence: 0.69,
        },
      ],
    );

    const flow = buildRuntimeObservationFlow(next);
    expect(flow[0].dialogues.length).toBeGreaterThan(0);
    expect(flow[0].threads.length).toBeGreaterThan(0);
    expect(flow[0].dialogues[0].participants).toEqual(expect.arrayContaining([reformer.id, ruler.id]));
    expect(flow[0].summary).toContain('交锋');
  });

  it('marks observation frames that contain death or exit states', () => {
    const world = createSimulationWorld('如果商鞅变法之后，商鞅没有被杀，秦国会如何发展？', 'strategic');
    const runtime = createRuntimeWorld(world);
    const reformer = runtime.actors[0];
    const opponent = runtime.actors[2];

    const next = applyRuntimeEvents(runtime, world, [
      {
        id: 'flow-death-event',
        pulse: 1,
        timeLabel: 'night ambush',
        type: 'death',
        visibility: 'rumor',
        actorIds: [reformer.id, opponent.id],
        title: 'the opponent is killed in a failed ambush',
        body: 'the ambush collapses and one faction loses its central operator',
        impact: 'the balance of fear changes immediately',
        confidence: 0.62,
      },
    ]);

    const flow = buildRuntimeObservationFlow(next);
    expect(flow[0].hasExitOrDeath).toBe(true);
    expect(flow[0].dominantTension).toBeGreaterThan(0.9);
  });

  it('builds a personal ledger for every runtime actor', () => {
    const world = createSimulationWorld('如果商鞅变法之后，商鞅没有被杀，秦国会如何发展？', 'strategic');
    const runtime = createRuntimeWorld(world);

    const ledgers = buildRuntimeActorLedgers(runtime);
    expect(ledgers).toHaveLength(runtime.actors.length);
    expect(ledgers[0].actor.id).toBe(runtime.actors[0].id);
    expect(ledgers[0].statusSummary).toBeTruthy();
    expect(ledgers[0].lastActionSummary).toBeTruthy();
  });

  it('includes signal and event entries with known actor ids in an actor ledger', () => {
    const world = createSimulationWorld('如果商鞅变法之后，商鞅没有被杀，秦国会如何发展？', 'strategic');
    const runtime = createRuntimeWorld(world);
    const reformer = runtime.actors[0];
    const ruler = runtime.actors[1];

    const next = applyRuntimeEvents(
      runtime,
      world,
      [
        {
          id: 'ledger-public-event',
          pulse: 1,
          timeLabel: 'court morning',
          type: 'speech',
          visibility: 'public',
          actorIds: [reformer.id, ruler.id],
          title: 'the reformer answers the ruler',
          body: 'the reformer offers concession while naming the cost of retreat',
          impact: 'the ruler must choose whether to accept a limited compromise',
          confidence: 0.72,
        },
      ],
      [
        {
          id: 'ledger-private-signal',
          pulse: 1,
          actorId: reformer.id,
          actorName: reformer.name,
          visibility: 'private',
          readSignals: ['the ruler demands proof of loyalty'],
          privateIntent: 'preserve institutional control while lowering personal threat',
          plannedAction: 'offer a visible concession and force the ruler to answer publicly',
          targetActorIds: [ruler.id],
          emotionalState: 'calculating',
          confidence: 0.68,
        },
      ],
    );

    const ledger = buildRuntimeActorLedgers(next).find((item) => item.actor.id === reformer.id);
    expect(ledger).toBeTruthy();
    expect(ledger!.entries.some((entry) => entry.kind === 'event')).toBe(true);
    expect(ledger!.entries.some((entry) => entry.kind === 'signal')).toBe(true);
    expect(ledger!.knownActorIds).toContain(ruler.id);
    expect(ledger!.lastActionSummary).toContain('the reformer');
  });

  it('raises ledger risk and describes actors who exit the world surface', () => {
    const world = createSimulationWorld('如果商鞅变法之后，商鞅没有被杀，秦国会如何发展？', 'strategic');
    const runtime = createRuntimeWorld(world);
    const reformer = runtime.actors[0];
    const opponent = runtime.actors[2];

    const next = applyRuntimeEvents(runtime, world, [
      {
        id: 'ledger-death-event',
        pulse: 1,
        timeLabel: 'night ambush',
        type: 'death',
        visibility: 'rumor',
        actorIds: [reformer.id, opponent.id],
        title: 'the opponent dies after a failed ambush',
        body: 'the ambush collapses and the opponent disappears from the power game',
        impact: 'the reformer gains space but also inherits fear',
        confidence: 0.62,
      },
    ]);

    const opponentLedger = buildRuntimeActorLedgers(next).find((item) => item.actor.id === opponent.id);
    expect(opponentLedger).toBeTruthy();
    expect(opponentLedger!.riskScore).toBeGreaterThan(0.9);
    expect(opponentLedger!.statusSummary).toContain('死亡');
    expect(opponentLedger!.entries.some((entry) => entry.kind === 'status')).toBe(true);
  });

  it('derives confrontation scenes from dialogue and reaction pressure', () => {
    const world = createSimulationWorld('如果商鞅变法之后，商鞅没有被杀，秦国会如何发展？', 'strategic');
    const runtime = createRuntimeWorld(world);
    const reformer = runtime.actors[0];
    const ruler = runtime.actors[1];

    const next = applyRuntimeEvents(
      runtime,
      world,
      [
        {
          id: 'confrontation-trigger',
          pulse: 1,
          timeLabel: 'court morning',
          type: 'speech',
          visibility: 'public',
          actorIds: [ruler.id],
          title: 'the ruler demands proof of loyalty',
          body: 'the ruler forces the reformer to answer before the court',
          impact: 'the reformer must answer or lose the center',
          confidence: 0.74,
        },
      ],
      [
        {
          id: 'confrontation-signal',
          pulse: 1,
          actorId: reformer.id,
          actorName: reformer.name,
          visibility: 'private',
          readSignals: ['the ruler demands proof of loyalty'],
          privateIntent: 'turn the hearing into a test of the ruler',
          plannedAction: 'name the cost of retreat and force the ruler to choose',
          targetActorIds: [ruler.id],
          emotionalState: 'aggressive',
          confidence: 0.7,
        },
      ],
    );

    const scenes = buildRuntimeConfrontationScenes(next);
    expect(scenes.length).toBeGreaterThan(0);
    expect(scenes[0].actorIds).toEqual(expect.arrayContaining([reformer.id, ruler.id]));
    expect(scenes.some((scene) => scene.source === 'dialogue' || scene.source === 'reaction')).toBe(true);
    expect(scenes[0].trigger || scenes[0].response).toBeTruthy();
  });

  it('ranks fatal confrontation events as high tension scenes', () => {
    const world = createSimulationWorld('如果商鞅变法之后，商鞅没有被杀，秦国会如何发展？', 'strategic');
    const runtime = createRuntimeWorld(world);
    const reformer = runtime.actors[0];
    const opponent = runtime.actors[2];

    const next = applyRuntimeEvents(runtime, world, [
      {
        id: 'confrontation-death',
        pulse: 1,
        timeLabel: 'night ambush',
        type: 'death',
        visibility: 'rumor',
        actorIds: [reformer.id, opponent.id],
        title: 'the ambush ends in death',
        body: 'the opponent is killed after the ambush collapses',
        impact: 'fear spreads through both camps',
        confidence: 0.63,
      },
    ]);

    const scenes = buildRuntimeConfrontationScenes(next);
    expect(scenes[0].source).toBe('event');
    expect(scenes[0].tension).toBeGreaterThan(0.9);
    expect(scenes[0].actorIds).toEqual(expect.arrayContaining([reformer.id, opponent.id]));
  });
});
