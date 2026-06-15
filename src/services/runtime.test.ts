import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSimulationWorld } from '../domain/simulator';
import { applyRuntimeEvents, buildRuntimePressureThreads, createRuntimeWorld } from '../domain/worldRuntime';
import { defaultProviderConfig } from './providers';
import { normalizeRuntimeActorUpdates, normalizeRuntimePulse, normalizeRuntimeSignals, requestActorPerspectivePulse, requestRuntimePulse } from './runtime';

afterEach(() => {
  vi.unstubAllGlobals();
});

function createRuntimeWorldWithActors() {
  const world = createSimulationWorld('roster manager test', 'strategic');
  world.agents = [
    {
      id: 'actor-ruler',
      name: 'Ruler',
      role: 'ruler',
      identity: 'ruler',
      dilemma: 'keep the court stable',
      currentPressure: 'the court is testing the ruler',
      goals: ['preserve authority'],
      constraints: ['must avoid open revolt'],
      leverage: ['formal command'],
      actions: ['summon a close heir'],
      relationships: ['trusted by minister'],
      riskTolerance: 0.55,
      confidence: 0.72,
    },
    {
      id: 'actor-minister',
      name: 'Minister',
      role: 'minister',
      identity: 'minister',
      dilemma: 'choose whether to obey',
      currentPressure: 'both sides ask for proof of loyalty',
      goals: ['survive the court split'],
      constraints: ['limited troops'],
      leverage: ['bureaucratic network'],
      actions: ['delay a public answer'],
      relationships: ['watched by ruler'],
      riskTolerance: 0.44,
      confidence: 0.66,
    },
  ];
  return world;
}

describe('runtime pulse service', () => {
  it('normalizes model pulse events against known runtime actors', () => {
    const world = createSimulationWorld('如果商鞅变法之后，商鞅没有被杀，秦国会如何发展？', 'strategic');
    const runtime = createRuntimeWorld(world);
    const actor = runtime.actors[0];
    const otherActor = runtime.actors[1];

    const events = normalizeRuntimePulse(
      {
        events: [
          {
            id: 'pulse-1',
            timeLabel: '密议之后',
            type: 'betrayal',
            visibility: 'secret',
            actorIds: [actor.id, 'unknown-agent'],
            initiatorActorId: actor.id,
            targetActorIds: [otherActor.id],
            responderActorIds: [otherActor.id],
            affectedActorIds: [],
            title: '商鞅发现朝堂暗线',
            body: '商鞅从一名旧吏口中得知公子虔正在组织弹劾。',
            impact: '商鞅决定公开退让，私下保住县制执行网。',
            actionText: 'the actor sends a probe',
            responseText: 'the target delays the answer',
            effectText: 'the court pressure becomes harder to hide',
            confidence: 0.71,
          },
        ],
      },
      runtime,
    );

    expect(events).toHaveLength(1);
    expect(events[0].actorIds).toEqual([actor.id, otherActor.id]);
    expect(events[0].initiatorActorId).toBe(actor.id);
    expect(events[0].targetActorIds).toEqual([otherActor.id]);
    expect(events[0].responderActorIds).toEqual([otherActor.id]);
    expect(events[0].actionText).toContain('probe');
    expect(events[0].responseText).toContain('delays');
    expect(events[0].effectText).toContain('harder to hide');
    expect(events[0].type).toBe('betrayal');
    expect(events[0].visibility).toBe('secret');
    expect(events[0].pulse).toBe(runtime.pulse + 1);
  });

  it('normalizes actor roster additions before pulse events reference them', () => {
    const world = createSimulationWorld('濡傛灉鍟嗛瀰鍙樻硶涔嬪悗锛屽晢闉呮病鏈夎鏉€锛岀Е鍥戒細濡備綍鍙戝睍锛?', 'strategic');
    const runtime = createRuntimeWorld(world);
    if (!runtime.actors.length) Object.assign(runtime, createRuntimeWorld(createRuntimeWorldWithActors()));
    runtime.convergence = { ...runtime.convergence, shouldPause: false };
    const ruler = runtime.actors[0];
    const rawPulse = {
      actorUpdates: [
        {
          action: 'add',
          actorId: 'runtime-actor-liu-ying',
          name: '刘盈',
          role: '太子，吕后与刘邦权力安排中的继承变量',
          faction: '汉初皇室',
          pressure: '韩信未死使继承安全重新成为吕后的焦虑来源',
          intent: '避免自己成为各方试探刘邦态度的工具',
          reason: '刘盈被吕后和刘邦的继承安排直接拉入局势',
          confidence: 0.72,
        },
      ],
      events: [
        {
          id: 'liu-ying-enters',
          timeLabel: '长安入夜',
          type: 'move',
          visibility: 'private',
          actorIds: [ruler.id, 'runtime-actor-liu-ying'],
          initiatorActorId: ruler.id,
          targetActorIds: ['runtime-actor-liu-ying'],
          title: '刘邦召见刘盈',
          body: '刘邦召见刘盈，询问宫中对韩信未死的议论是否已经传到太子身边。',
          impact: '刘盈开始成为韩信问题之外的继承压力节点。',
          confidence: 0.68,
        },
      ],
    };

    const actorUpdates = normalizeRuntimeActorUpdates(rawPulse, runtime);
    const events = normalizeRuntimePulse(rawPulse, runtime, actorUpdates);

    expect(actorUpdates).toHaveLength(1);
    expect(actorUpdates[0].actorId).toBe('runtime-actor-liu-ying');
    expect(events).toHaveLength(1);
    expect(events[0].actorIds).toEqual(expect.arrayContaining([ruler.id, 'runtime-actor-liu-ying']));
    expect(events[0].targetActorIds).toEqual(['runtime-actor-liu-ying']);
  });

  it('applies actor roster additions and exits to the runtime world', () => {
    const world = createSimulationWorld('濡傛灉鍟嗛瀰鍙樻硶涔嬪悗锛屽晢闉呮病鏈夎鏉€锛岀Е鍥戒細濡備綍鍙戝睍锛?', 'strategic');
    const runtime = createRuntimeWorld(world);
    if (!runtime.actors.length) Object.assign(runtime, createRuntimeWorld(createRuntimeWorldWithActors()));
    runtime.convergence = { ...runtime.convergence, shouldPause: false };
    const oldActor = runtime.actors[0];
    const next = applyRuntimeEvents(
      runtime,
      world,
      [],
      [],
      [
        {
          id: 'add-liu-ying',
          pulse: 1,
          action: 'add',
          actorId: 'runtime-actor-liu-ying',
          name: '刘盈',
          role: '太子',
          faction: '汉初皇室',
          status: 'alive',
          pressure: '继承安全被重新推到台前',
          intent: '避免成为权力斗争中的借口',
          reason: '继承问题进入韩信未死后的权力连锁',
          confidence: 0.7,
        },
        {
          id: 'exit-old-actor',
          pulse: 1,
          action: 'exit',
          actorId: oldActor.id,
          name: oldActor.name,
          role: oldActor.role,
          status: 'retired',
          reason: `${oldActor.name}暂时离开权力现场，影响转入旧关系和记忆层。`,
          confidence: 0.66,
        },
      ],
    );

    expect(next.actors.some((actor) => actor.id === 'runtime-actor-liu-ying' && actor.name === '刘盈')).toBe(true);
    expect(next.actors.find((actor) => actor.id === oldActor.id)?.status).toBe('retired');
  });

  it('normalizes private agent signals and drops unknown actors', () => {
    const world = createSimulationWorld('如果商鞅变法之后，商鞅没有被杀，秦国会如何发展？', 'strategic');
    const runtime = createRuntimeWorld(world);
    const actor = runtime.actors[1];

    const signals = normalizeRuntimeSignals(
      {
        signals: [
          {
            actorId: actor.id,
            visibility: 'private',
            readSignals: ['商鞅上书请辞', '公子虔暗中联络旧臣'],
            privateIntent: '先利用商鞅保住新法，再削弱其人事权。',
            plannedAction: '分别召见甘龙与商鞅，测试双方底线。',
            targetActorIds: [runtime.actors[0].id, 'missing'],
            emotionalState: '戒备但冷静',
            confidence: 0.66,
          },
          {
            actorId: 'missing',
            privateIntent: '不应出现',
          },
        ],
      },
      runtime,
    );

    expect(signals).toHaveLength(1);
    expect(signals[0].actorId).toBe(actor.id);
    expect(signals[0].targetActorIds).toEqual([runtime.actors[0].id]);
    expect(signals[0].privateIntent).toContain('新法');
  });

  it('drops pulse events that do not involve any known actor', () => {
    const world = createSimulationWorld('如果某本小说中的主角没有离开故乡，世界会如何发展？', 'strategic');
    const runtime = createRuntimeWorld(world);

    const events = normalizeRuntimePulse(
      {
        events: [
          {
            actorIds: ['missing'],
            title: '无名阵营改变策略',
            body: '抽象势力开始行动。',
          },
        ],
      },
      runtime,
    );

    expect(events).toHaveLength(0);
  });

  it('requests a focused actor perspective pulse and filters other actor signals', async () => {
    const world = createSimulationWorld('如果商鞅变法之后，商鞅没有被杀，秦国会如何发展？', 'strategic');
    const runtime = createRuntimeWorld(world);
    const actor = runtime.actors[0];
    const otherActor = runtime.actors[1];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        latencyMs: 128,
        content: JSON.stringify({
          signals: [
            {
              actorId: actor.id,
              visibility: 'private',
              privateIntent: 'preserve the new institutions while testing the ruler',
              plannedAction: 'send a trusted messenger to probe the court faction',
              targetActorIds: [otherActor.id],
              emotionalState: 'watchful',
              confidence: 0.68,
            },
            {
              actorId: otherActor.id,
              visibility: 'private',
              privateIntent: 'this should be filtered out',
              plannedAction: 'this should be filtered out',
            },
          ],
          events: [
            {
              id: 'focused-event-1',
              timeLabel: 'after the private warning',
              type: 'move',
              visibility: 'secret',
              actorIds: [actor.id, otherActor.id],
              title: 'the reformer tests a hidden channel',
              body: 'the selected actor turns limited information into a cautious probe',
              impact: 'the other faction now has a reason to react',
              confidence: 0.64,
            },
          ],
        }),
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await requestActorPerspectivePulse({
      actorId: actor.id,
      provider: { ...defaultProviderConfig, apiKey: 'test-key' },
      runtimeWorld: runtime,
      world,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/actor-pulse',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(requestBody.actorId).toBe(actor.id);
    expect(requestBody.actorContext.actorId).toBe(actor.id);
    expect(result.source).toBe('llm');
    expect(result.latencyMs).toBe(128);
    expect(result.signals).toHaveLength(1);
    expect(result.signals[0].actorId).toBe(actor.id);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].actorIds).toEqual([actor.id, otherActor.id]);
  });

  it('sends recent reaction chains into world pulse requests', async () => {
    const world = createSimulationWorld('如果商鞅变法之后，商鞅没有被杀，秦国会如何发展？', 'strategic');
    const runtime = createRuntimeWorld(world);
    const actor = runtime.actors[0];
    const otherActor = runtime.actors[1];
    const runtimeWithPressure = applyRuntimeEvents(
      runtime,
      world,
      [
        {
          id: 'world-pressure-event',
          pulse: 1,
          timeLabel: 'court morning',
          type: 'speech',
          visibility: 'public',
          actorIds: [otherActor.id],
          title: 'the ruler forces a public answer',
          body: 'the ruler asks whether the reformer will yield authority',
          impact: 'the reformer has to answer before opponents define the story',
          confidence: 0.7,
        },
      ],
      [
        {
          id: 'world-pressure-signal',
          pulse: 1,
          actorId: actor.id,
          actorName: actor.name,
          visibility: 'private',
          readSignals: ['the ruler forces a public answer'],
          privateIntent: 'avoid being framed as a usurper',
          plannedAction: 'answer publicly before opponents gather momentum',
          targetActorIds: [otherActor.id],
          emotionalState: 'controlled urgency',
          confidence: 0.67,
        },
      ],
    );
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        content: JSON.stringify({
          signals: [
            {
              actorId: otherActor.id,
              visibility: 'private',
              privateIntent: 'test whether the public answer is sincere',
              plannedAction: 'delay judgment and watch the rival faction',
              targetActorIds: [actor.id],
              emotionalState: 'watchful',
              confidence: 0.66,
            },
          ],
          events: [],
        }),
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await requestRuntimePulse({
      provider: { ...defaultProviderConfig, apiKey: 'test-key' },
      runtimeWorld: runtimeWithPressure,
      world,
    });

    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(requestBody.reactionChains).toHaveLength(1);
    expect(requestBody.reactionChains[0].sourceTitle).toContain('public answer');
    expect(requestBody.dialogueExchanges).toHaveLength(1);
    expect(requestBody.dialogueExchanges[0].participants).toEqual(expect.arrayContaining([actor.id, otherActor.id]));
    expect(requestBody.pressureThreads.length).toBeGreaterThan(0);
    expect(requestBody.pressureThreads[0].actorIds.length).toBeGreaterThan(0);
    expect(requestBody.actorContexts.length).toBeGreaterThan(0);
  });

  it('prioritizes the focused pressure thread in world pulse requests', async () => {
    const world = createSimulationWorld('如果商鞅变法之后，商鞅没有被杀，秦国会如何发展？', 'strategic');
    const runtime = createRuntimeWorld(world);
    const actor = runtime.actors[0];
    const otherActor = runtime.actors[1];
    const outsider = runtime.actors[2];
    const runtimeWithPressure = applyRuntimeEvents(
      runtime,
      world,
      [
        {
          id: 'focus-pressure-event',
          pulse: 1,
          timeLabel: 'court morning',
          type: 'conflict',
          visibility: 'public',
          actorIds: [otherActor.id, outsider.id],
          title: 'the court splits over the reformer',
          body: 'two rivals compete to define whether the reformer is loyal',
          impact: 'the reformer faces pressure from both ruler and opponent',
          confidence: 0.72,
        },
      ],
      [
        {
          id: 'focus-pressure-signal',
          pulse: 1,
          actorId: actor.id,
          actorName: actor.name,
          visibility: 'private',
          readSignals: ['the court splits over the reformer'],
          privateIntent: 'choose which pressure line to answer first',
          plannedAction: 'answer one pressure thread while delaying another',
          targetActorIds: [otherActor.id, outsider.id],
          emotionalState: 'compressed',
          confidence: 0.68,
        },
      ],
    );
    const pressureThreads = buildRuntimePressureThreads(runtimeWithPressure);
    const focusedPressureThread = pressureThreads[1] ?? pressureThreads[0];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        content: JSON.stringify({
          signals: [
            {
              actorId: actor.id,
              visibility: 'private',
              privateIntent: 'follow the selected pressure thread',
              plannedAction: 'make a focused answer',
              targetActorIds: [otherActor.id],
              emotionalState: 'focused',
              confidence: 0.63,
            },
          ],
          events: [],
        }),
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await requestRuntimePulse({
      focusedPressureThreadId: focusedPressureThread.id,
      provider: { ...defaultProviderConfig, apiKey: 'test-key' },
      runtimeWorld: runtimeWithPressure,
      world,
    });

    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(requestBody.focusedPressureThreadId).toBe(focusedPressureThread.id);
    expect(requestBody.pressureThreads[0].id).toBe(focusedPressureThread.id);
  });

  it('sends recent reaction chains into focused actor pulse requests', async () => {
    const world = createSimulationWorld('如果商鞅变法之后，商鞅没有被杀，秦国会如何发展？', 'strategic');
    const runtime = createRuntimeWorld(world);
    const actor = runtime.actors[0];
    const otherActor = runtime.actors[1];
    const runtimeWithPressure = applyRuntimeEvents(
      runtime,
      world,
      [
        {
          id: 'pressure-event',
          pulse: 1,
          timeLabel: 'court morning',
          type: 'speech',
          visibility: 'public',
          actorIds: [otherActor.id],
          title: 'the ruler demands proof of loyalty',
          body: 'the ruler asks whether the reformer will give up direct command',
          impact: 'the reformer must answer or lose trust',
          confidence: 0.7,
        },
      ],
      [
        {
          id: 'pressure-signal',
          pulse: 1,
          actorId: actor.id,
          actorName: actor.name,
          visibility: 'private',
          readSignals: ['the ruler demands proof of loyalty'],
          privateIntent: 'turn suspicion into a bargaining opening',
          plannedAction: 'offer a visible concession while preserving institutional control',
          targetActorIds: [otherActor.id],
          emotionalState: 'calculating',
          confidence: 0.67,
        },
      ],
    );
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        content: JSON.stringify({
          signals: [
            {
              actorId: actor.id,
              visibility: 'private',
              privateIntent: 'continue the pressure chain',
              plannedAction: 'answer the loyalty demand with a controlled concession',
              targetActorIds: [otherActor.id],
              emotionalState: 'steady',
              confidence: 0.64,
            },
          ],
          events: [],
        }),
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await requestActorPerspectivePulse({
      actorId: actor.id,
      provider: { ...defaultProviderConfig, apiKey: 'test-key' },
      runtimeWorld: runtimeWithPressure,
      world,
    });

    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(requestBody.reactionChains).toHaveLength(1);
    expect(requestBody.reactionChains[0].readerActorId).toBe(actor.id);
    expect(requestBody.reactionChains[0].sourceTitle).toContain('loyalty');
    expect(requestBody.dialogueExchanges).toHaveLength(1);
    expect(requestBody.dialogueExchanges[0].participants).toContain(actor.id);
    expect(requestBody.pressureThreads.length).toBeGreaterThan(0);
    expect(requestBody.pressureThreads.every((thread: { actorIds: string[] }) => thread.actorIds.includes(actor.id))).toBe(true);
  });
});
