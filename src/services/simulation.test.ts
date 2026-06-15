import { describe, expect, it, vi } from 'vitest';
import { createSimulationWorld } from '../domain/simulator';
import { defaultProviderConfig } from './providers';
import { extractJsonObject, generateSimulationWorld, isGeneratedWorldRelevant, normalizeGeneratedWorld, normalizeWorldPreflight } from './simulation';

describe('simulation generation parsing', () => {
  it('extracts fenced JSON returned by a model', () => {
    const raw = extractJsonObject('```json\n{"title":"沙盘","confidence":0.7}\n```');
    expect(raw).toMatchObject({ title: '沙盘', confidence: 0.7 });
  });

  it('repairs common trailing commas in model JSON', () => {
    const raw = extractJsonObject('{"title":"沙盘","evidence":[{"id":"ev-1",}],}');
    expect(raw).toMatchObject({ title: '沙盘', evidence: [{ id: 'ev-1' }] });
  });

  it('repairs missing commas between array elements', () => {
    const raw = extractJsonObject('{"items":[{"id":"a"} {"id":"b"}]}');
    expect(raw).toMatchObject({ items: [{ id: 'a' }, { id: 'b' }] });
  });

  it('repairs duplicate commas in model JSON', () => {
    const raw = extractJsonObject('{"items":[{"id":"a"},,{"id":"b"}],,"title":"ok"}');
    expect(raw).toMatchObject({ title: 'ok', items: [{ id: 'a' }, { id: 'b' }] });
  });

  it('normalizes partial model output with local fallback fields', () => {
    const fallback = createSimulationWorld('如果商鞅没有被杀？', 'strategic');
    const world = normalizeGeneratedWorld(
      {
        title: '模型生成沙盘',
        branches: [
          {
            title: '改革深化',
            credibility: 0.81,
            causalChain: ['商鞅存活', '制度继续执行'],
          },
        ],
      },
      fallback,
    );
    expect(world.title).toBe('模型生成沙盘');
    expect(world.branches[0].title).toBe('改革深化');
    expect(world.branches[0].trigger).toBe(fallback.branches[0].trigger);
    expect(world.evidence).toHaveLength(fallback.evidence.length);
  });

  it('supplements action logs to cover agents and simulation steps', () => {
    const fallback = createSimulationWorld('如果商鞅没有被杀？', 'strategic');
    const world = normalizeGeneratedWorld(
      {
        simulationPlan: {
          startLabel: '开始',
          endLabel: '结束',
          durationLabel: '二十年',
          totalSteps: 5,
          stopReason: '权力结构稳定',
        },
        agents: [
          { id: 'agent-1', name: '商鞅', role: '变法者', actions: ['呈上新法续行方案'], confidence: 0.7 },
          { id: 'agent-2', name: '嬴驷', role: '新君', actions: ['召见旧贵族'], confidence: 0.7 },
        ],
        branches: [
          {
            id: 'branch-1',
            title: '制衡线',
            trigger: '新君制衡商鞅',
            summary: '权力重新分配',
            causalChain: ['商鞅存活'],
            storyBeats: ['商鞅入宫议政'],
          },
        ],
        actionLogs: [{ id: 'act-1', step: 0, agentId: 'agent-1', agentName: '商鞅', action: '入宫' }],
      },
      fallback,
    );
    expect(new Set(world.actionLogs.map((log) => log.step)).size).toBeGreaterThanOrEqual(5);
    expect(new Set(world.actionLogs.map((log) => log.agentId)).has('agent-2')).toBe(true);
    expect(world.actionLogs.every((log) => log.initiatorActorId)).toBe(true);
    expect(world.actionLogs.every((log) => Array.isArray(log.targetActorIds))).toBe(true);
    expect(world.actionLogs.every((log) => typeof log.actionText === 'string')).toBe(true);
  });

  it('preserves structured action fields from generated action logs', () => {
    const fallback = createSimulationWorld('如果商鞅变法之后，商鞅没有被杀，秦国会如何发展？', 'strategic');
    const world = normalizeGeneratedWorld(
      {
        simulationPlan: { totalSteps: 3 },
        agents: [
          { id: 'agent-a', name: 'Agent A', role: 'actor', confidence: 0.7 },
          { id: 'agent-b', name: 'Agent B', role: 'target', confidence: 0.7 },
        ],
        actionLogs: [
          {
            id: 'structured-act',
            step: 0,
            agentId: 'agent-a',
            agentName: 'Agent A',
            initiatorActorId: 'agent-a',
            targetActorIds: ['agent-b'],
            responderActorIds: ['agent-b'],
            affectedActorIds: [],
            action: 'opens a negotiation',
            detail: 'Agent A sends a sealed proposal',
            actionText: 'Agent A sends a sealed proposal',
            responseText: 'Agent B delays the answer',
            effectText: 'The negotiation becomes visible to both camps',
            impact: 'pressure rises',
            confidence: 0.7,
          },
        ],
      },
      fallback,
    );

    const structured = world.actionLogs.find((log) => log.id === 'structured-act');
    expect(structured?.initiatorActorId).toBe('agent-a');
    expect(structured?.targetActorIds).toEqual(['agent-b']);
    expect(structured?.responderActorIds).toEqual(['agent-b']);
    expect(structured?.actionText).toContain('sealed proposal');
    expect(structured?.responseText).toContain('delays');
    expect(structured?.effectText).toContain('visible');
  });

  it('guards against faction-like agent names and aligns action log names', () => {
    const fallback = createSimulationWorld('如果商鞅没有被杀？', 'strategic');
    const world = normalizeGeneratedWorld(
      {
        agents: [{ id: 'agent-ruler', name: '秦国君主', role: '秦国王权代表', confidence: 0.7 }],
        actionLogs: [
          {
            id: 'act-1',
            step: 0,
            agentId: 'agent-ruler',
            agentName: '秦国君主',
            action: '召见商鞅',
          },
        ],
      },
      fallback,
    );
    expect(world.agents[0].name).not.toBe('秦国君主');
    expect(world.actionLogs[0].agentName).toBe(world.agents[0].name);
  });

  it('materializes concrete people from action logs and removes dangling agent ids', () => {
    const fallback = createSimulationWorld('如果刘邦没有杀韩信，后续会怎么发展？', 'strategic');
    const world = normalizeGeneratedWorld(
      {
        agents: [
          { id: 'agent-liu-bang', name: '刘邦', role: '汉朝皇帝', confidence: 0.72 },
          { id: 'agent-han-xin', name: '韩信', role: '汉初名将', confidence: 0.7 },
          { id: 'agent-lv-hou', name: '吕后', role: '皇后', confidence: 0.68 },
        ],
        actionLogs: [
          {
            id: 'act-zhang-liang',
            step: 0,
            agentId: 'agent-5',
            agentName: '张良',
            initiatorActorId: 'agent-5',
            targetActorIds: ['agent-liu-bang'],
            responderActorIds: ['agent-liu-bang'],
            affectedActorIds: ['agent-han-xin'],
            action: '劝刘邦暂缓处置韩信',
            actionText: '张良私下劝刘邦暂缓处置韩信',
            responseText: '刘邦要求张良提出可控方案',
            effectText: '韩信暂时被纳入观察',
            detail: '张良以功臣震动为由提出缓杀方案',
            impact: '刘邦转向试探韩信忠诚',
            confidence: 0.66,
          },
        ],
      },
      fallback,
    );

    expect(world.agents.map((agent) => agent.name)).toContain('张良');
    expect(world.agents.map((agent) => agent.name)).not.toContain('agent-5');
    expect(world.actionLogs[0].agentName).toBe('张良');
    expect(world.actionLogs[0].agentId).not.toBe('agent-5');
    expect(world.actionLogs[0].initiatorActorId).toBe(world.actionLogs[0].agentId);
  });

  it('does not fall back to abstract group agents when model omits agents', () => {
    const fallback = createSimulationWorld('如果商鞅没有被杀？', 'strategic');
    const world = normalizeGeneratedWorld(
      {
        eventAnalysis: {
          facts: ['商鞅在秦孝公支持下推行变法'],
          assumptions: ['商鞅没有被处死'],
          causes: ['秦惠文王需要保留新法收益'],
        },
        simulationPlan: {
          startLabel: '秦孝公去世',
          endLabel: '新旧权力重新平衡',
          durationLabel: '约十五年',
          totalSteps: 6,
          stopReason: '秦国权力结构形成稳定再平衡',
        },
      },
      fallback,
    );

    expect(world.agents.map((agent) => agent.name)).toEqual(
      expect.arrayContaining(['商鞅', '嬴驷', '公子虔']),
    );
    expect(world.agents.map((agent) => agent.name)).not.toContain('改革执行者');
    expect(world.agents.map((agent) => agent.name)).not.toContain('最高决策者');
    expect(world.agents.map((agent) => agent.name)).not.toContain('旧利益集团');
    expect(new Set(world.actionLogs.map((log) => log.step)).size).toBeGreaterThanOrEqual(6);
  });

  it('does not call the model for underspecified worlds when no API key is configured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateSimulationWorld({
      eventText: '如果一个神秘帝国突然崛起，世界会怎样？',
      horizon: 'strategic',
      provider: { ...defaultProviderConfig, apiKey: '' },
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.source).toBe('local');
    expect(result.world.agents).toHaveLength(0);
    expect(result.message).toContain('当前输入不足以创建可观察世界');
    vi.unstubAllGlobals();
  });

  it('calls the model for Liu Bang and Han Xin prompts instead of using unrelated local worlds', async () => {
    const eventText = '如果刘邦没有杀韩信，后续会怎么发展？';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        latencyMs: 234,
        content: JSON.stringify({
          title: '刘邦未杀韩信事件世界',
          eventSummary: '刘邦未杀韩信',
          domain: '历史政治',
          centralQuestion: eventText,
          confidence: 0.72,
          simulationPlan: {
            startLabel: '韩信被疑时',
            endLabel: '汉初权力重新稳定',
            durationLabel: '由模型判断',
            totalSteps: 3,
            stopReason: '汉初君臣权力结构阶段性收敛',
          },
          eventAnalysis: {
            facts: ['刘邦、韩信、吕后、萧何均为汉初关键人物'],
            assumptions: ['刘邦没有杀韩信'],
            causes: ['军功集团与皇权之间仍有张力'],
            openQuestions: [],
          },
          agents: [
            { id: 'agent-liu-bang', name: '刘邦', role: '汉朝皇帝', goals: ['稳住皇权'], constraints: ['功臣军权'], leverage: ['皇帝名分'], actions: ['安置韩信'], confidence: 0.74 },
            { id: 'agent-han-xin', name: '韩信', role: '汉初名将', goals: ['保全自身'], constraints: ['君主猜忌'], leverage: ['军事威望'], actions: ['表态交权'], confidence: 0.72 },
            { id: 'agent-lv-hou', name: '吕后', role: '皇后与政治操盘者', goals: ['压制不稳定因素'], constraints: ['朝臣观望'], leverage: ['宫廷网络'], actions: ['观察韩信动向'], confidence: 0.68 },
          ],
          branches: [
            {
              id: 'branch-1',
              title: '功臣纳入新秩序',
              credibility: 0.66,
              divergence: 0.42,
              trigger: '刘邦放弃处死韩信',
              summary: '韩信被迫从军事自主转向受控合作',
              causalChain: ['赦免韩信', '重谈军权', '朝廷观察'],
              storyBeats: ['刘邦召见韩信', '韩信交出部分兵权'],
              metrics: [],
            },
          ],
          actionLogs: [
            {
              id: 'act-1',
              step: 0,
              timeLabel: '赦免后',
              agentId: 'agent-liu-bang',
              agentName: '刘邦',
              initiatorActorId: 'agent-liu-bang',
              targetActorIds: ['agent-han-xin'],
              responderActorIds: ['agent-han-xin'],
              affectedActorIds: ['agent-lv-hou'],
              action: '召见韩信',
              actionText: '召见韩信并要求他公开表态交出部分兵权',
              responseText: '韩信接受约束，但要求保留名誉与封地',
              effectText: '功臣集团暂时被纳入皇权秩序',
              detail: '刘邦以赦免为条件重塑君臣边界',
              impact: '吕后继续观察韩信是否仍有军事号召力',
              confidence: 0.7,
            },
          ],
          timeline: [
            { year: '第一幕', original: '韩信被杀', branch: '韩信被赦免并受控', confidence: 0.7 },
          ],
        }),
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateSimulationWorld({
      eventText,
      horizon: 'strategic',
      provider: { ...defaultProviderConfig, apiKey: 'test-key' },
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/simulate', expect.objectContaining({ method: 'POST' }));
    expect(result.source).toBe('llm');
    expect(result.world.eventSummary).toBe('刘邦未杀韩信');
    expect(result.world.agents.map((agent) => agent.name)).toEqual(expect.arrayContaining(['刘邦', '韩信']));
    expect(result.world.agents.map((agent) => agent.name)).not.toContain('项羽');
    vi.unstubAllGlobals();
  });

  it('normalizes model preflight into a usable world-creation decision', () => {
    const result = normalizeWorldPreflight(
      {
        canSimulate: true,
        confidence: 0.76,
        domain: '历史政治',
        eventSummary: '滑铁卢获胜',
        enrichedEventText: '拿破仑在滑铁卢获胜，欧洲联盟体系被迫重组。',
        reasons: ['有明确改变点', '可识别拿破仑、威灵顿、布吕歇尔等行动者'],
        missing: [],
        backgroundNotes: ['滑铁卢战役是拿破仑战争末期关键节点'],
        suggestedActors: [
          { name: '拿破仑', role: '法国皇帝', confidence: 0.8 },
          { name: '威灵顿', role: '英军统帅', confidence: 0.75 },
          { name: '布吕歇尔', role: '普鲁士统帅', confidence: 0.72 },
        ],
      },
      '如果拿破仑在滑铁卢获胜，欧洲会如何发展？',
      321,
    );

    expect(result.canSimulate).toBe(true);
    expect(result.suggestedActors.map((actor) => actor.name)).toEqual(expect.arrayContaining(['拿破仑', '威灵顿', '布吕歇尔']));
    expect(result.latencyMs).toBe(321);
  });

  it('uses preflight to bypass local unknown-event rejection and call the model', async () => {
    const eventText = '如果拿破仑在滑铁卢获胜，欧洲会如何发展？';
    const preflight = normalizeWorldPreflight(
      {
        canSimulate: true,
        confidence: 0.74,
        domain: '历史政治',
        eventSummary: '滑铁卢获胜',
        enrichedEventText: '拿破仑在滑铁卢获胜，欧洲反法联盟出现裂缝。',
        reasons: ['该问题有明确历史节点与行动者'],
        missing: [],
        backgroundNotes: ['拿破仑战争后欧洲秩序会被重新谈判'],
        suggestedActors: [
          { name: '拿破仑', role: '法国皇帝' },
          { name: '威灵顿', role: '英军统帅' },
          { name: '布吕歇尔', role: '普鲁士统帅' },
          { name: '梅特涅', role: '奥地利外交主导者' },
        ],
      },
      eventText,
    );
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        latencyMs: 456,
        content: JSON.stringify({
          title: '滑铁卢反事实沙盘',
          eventSummary: '滑铁卢获胜',
          domain: '历史政治',
          centralQuestion: eventText,
          confidence: 0.66,
          simulationPlan: { startLabel: '滑铁卢战后', endLabel: '欧洲新均衡', durationLabel: '由 LLM 判断', totalSteps: 4, stopReason: '欧洲联盟结构阶段性稳定' },
          eventAnalysis: { facts: [eventText], assumptions: ['拿破仑获胜'], causes: ['反法联盟受挫'], openQuestions: [] },
          evidence: [{ id: 'ev-1', claim: eventText, confidence: 0.8, usedIn: ['event'] }],
          agents: [
            { id: 'agent-napoleon', name: '拿破仑', role: '法国皇帝', goals: ['保住政权'], constraints: ['兵力损耗'], leverage: ['胜利威望'], confidence: 0.7 },
            { id: 'agent-wellington', name: '威灵顿', role: '英军统帅', goals: ['保存英军'], constraints: ['战败压力'], leverage: ['英国资源'], confidence: 0.68 },
            { id: 'agent-blucher', name: '布吕歇尔', role: '普鲁士统帅', goals: ['重组普军'], constraints: ['败退'], leverage: ['普鲁士动员'], confidence: 0.65 },
            { id: 'agent-metternich', name: '梅特涅', role: '奥地利外交主导者', goals: ['重建均衡'], constraints: ['联盟分歧'], leverage: ['外交网络'], confidence: 0.66 },
          ],
          branches: [{ id: 'branch-1', title: '法国续命线', credibility: 0.62, divergence: 0.4, trigger: '拿破仑获胜', summary: '欧洲谈判被迫重启', causalChain: ['战场胜利', '联盟重组'], storyBeats: ['拿破仑提出停战条件'], metrics: [] }],
          actionLogs: [{ id: 'act-1', step: 0, timeLabel: '战后', agentId: 'agent-napoleon', agentName: '拿破仑', initiatorActorId: 'agent-napoleon', targetActorIds: ['agent-wellington'], responderActorIds: ['agent-wellington'], affectedActorIds: [], action: '提出停战条件', actionText: '提出停战条件', responseText: '威灵顿请求伦敦指示', effectText: '联盟谈判被迫提前', detail: '拿破仑利用胜利释放谈判信号', impact: '英国必须重新评估战争成本', confidence: 0.66 }],
          timeline: [{ year: '战后第一阶段', original: '拿破仑失败', branch: '拿破仑胜利', confidence: 0.62 }],
        }),
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateSimulationWorld({
      eventText,
      horizon: 'strategic',
      provider: { ...defaultProviderConfig, apiKey: 'test-key' },
      preflight,
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/simulate', expect.objectContaining({ method: 'POST' }));
    expect(result.source).toBe('llm');
    expect(result.world.agents.map((agent) => agent.name)).toEqual(expect.arrayContaining(['拿破仑', '威灵顿']));
    vi.unstubAllGlobals();
  });

  it('rejects generated worlds that drift away from the center event', () => {
    expect(isGeneratedWorldRelevant('如果商鞅没有被杀，秦国会如何发展？', '商鞅与秦国制度继续演化')).toBe(true);
    expect(isGeneratedWorldRelevant('如果商鞅没有被杀，秦国会如何发展？', '全球人工智能战略竞争')).toBe(false);
  });
});
