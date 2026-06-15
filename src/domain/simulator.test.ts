import { describe, expect, it } from 'vitest';
import { buildWorldSeed, calculateCredibility, createSimulationWorld, inferDomain, summarizeEventText } from './simulator';

describe('event simulation model', () => {
  it('infers historical political domain for Shang Yang prompts', () => {
    expect(inferDomain('如果商鞅变法之后没有被杀')).toBe('历史政治');
  });

  it('creates branches, agents, evidence and a decaying timeline', () => {
    const world = createSimulationWorld('如果玄武门之变没有发生？', 'generational');
    expect(world.branches).toHaveLength(3);
    expect(world.agents.length).toBeGreaterThanOrEqual(4);
    expect(world.evidence).toHaveLength(4);
    expect(world.timeline[0].confidence).toBeGreaterThan(world.timeline[2].confidence);
  });

  it('recognizes Hongmen Banquet counterfactuals as grounded historical worlds', () => {
    const seed = buildWorldSeed('如果项羽在鸿门宴强杀刘邦，后续会怎么发展？');
    const world = createSimulationWorld('如果项羽在鸿门宴强杀刘邦，后续会怎么发展？', 'strategic');

    expect(seed.viability.canSimulate).toBe(true);
    expect(world.domain).toBe('历史政治');
    expect(world.eventSummary).toBe('鸿门宴杀刘邦');
    expect(world.agents.map((agent) => agent.name)).toEqual(
      expect.arrayContaining(['项羽', '刘邦', '范增', '项伯', '张良', '樊哙']),
    );
    expect(world.actionLogs.length).toBeGreaterThanOrEqual(5);
    expect(world.agents.map((agent) => agent.name)).not.toEqual(
      expect.arrayContaining(['核心决策者', '主要竞争者', '一线执行者']),
    );
  });

  it('does not mistake Liu Bang and Han Xin prompts for Hongmen Banquet worlds', () => {
    const world = createSimulationWorld('如果刘邦没有杀韩信，后续会怎么发展？', 'strategic');

    expect(world.eventSummary).not.toBe('鸿门宴杀刘邦');
    expect(world.agents.map((agent) => agent.name)).not.toContain('项羽');
  });

  it('creates a compact center-event summary for long prompts', () => {
    const prompt = '如果2026年前后全球AI治理失败，美国、中国、欧盟和大型科技公司形成互不兼容的AI阵营，世界秩序将如何演变？';
    const world = createSimulationWorld(prompt, 'strategic');

    expect(summarizeEventText(prompt).length).toBeLessThanOrEqual(24);
    expect(world.eventSummary).toBe('全球AI治理');
    expect(world.eventText).toBe(prompt);
  });

  it('uses concrete fallback actors for recognized modern and historical scenarios', () => {
    const forbiddenNames = ['事件发起方', '反制方', '受影响群体'];
    const missileWorld = createSimulationWorld(
      '如果古巴导弹危机中，美军击沉苏联潜艇并导致核升级，世界政治与主要人物的决策将如何演变？',
      'strategic',
    );
    const aiWorld = createSimulationWorld(
      '如果2026年前后全球AI治理失败，美国、中国、欧盟和大型科技公司形成互不兼容的AI阵营，世界秩序将如何演变？',
      'strategic',
    );

    expect(missileWorld.agents.map((agent) => agent.name)).toEqual(
      expect.arrayContaining(['约翰·肯尼迪', '尼基塔·赫鲁晓夫', '菲德尔·卡斯特罗']),
    );
    expect(aiWorld.agents.map((agent) => agent.name)).toEqual(
      expect.arrayContaining(['美国总统', '中国监管层', '欧盟委员会主席', '大型科技公司 CEO']),
    );
    expect([...missileWorld.agents, ...aiWorld.agents].map((agent) => agent.name)).not.toEqual(
      expect.arrayContaining(forbiddenNames),
    );
  });

  it('gives local action logs explicit initiators, targets and responders', () => {
    const world = createSimulationWorld('如果俄乌战争最终以俄罗斯获得有利停火和事实上的战略胜利告终？', 'strategic');
    expect(world.agents.map((agent) => agent.name)).toEqual(
      expect.arrayContaining(['弗拉基米尔·普京', '弗拉基米尔·泽连斯基']),
    );
    expect(world.actionLogs.length).toBeGreaterThanOrEqual(4);
    world.actionLogs.forEach((log) => {
      expect(log.initiatorActorId).toBeTruthy();
      expect(log.targetActorIds?.length).toBeGreaterThanOrEqual(1);
      expect(log.responderActorIds?.length).toBeGreaterThanOrEqual(1);
      expect(log.actionText).toBeTruthy();
    });
  });

  it('recognizes fictional and fantasy scenario actors instead of generic shells', () => {
    const magicWorld = createSimulationWorld('如果伏地魔在霍格沃茨大战中获胜，魔法世界会如何演变？', 'strategic');
    const fantasyWorld = createSimulationWorld('如果一本原创奇幻小说中，北境女王背叛龙骑士联盟，王国会如何变化？', 'strategic');

    expect(inferDomain(magicWorld.eventText)).toBe('虚构叙事');
    expect(magicWorld.agents.map((agent) => agent.name)).toEqual(
      expect.arrayContaining(['伏地魔', '哈利·波特', '赫敏·格兰杰']),
    );
    expect(fantasyWorld.agents.map((agent) => agent.name)).toEqual(
      expect.arrayContaining(['北境女王', '龙骑士统领', '王都摄政']),
    );
    expect([...magicWorld.agents, ...fantasyWorld.agents].map((agent) => agent.name)).not.toEqual(
      expect.arrayContaining(['核心决策者', '主要竞争者', '一线执行者']),
    );
  });

  it('rejects underspecified fictional prompts instead of creating generic shells', () => {
    const seed = buildWorldSeed('如果一个神秘帝国突然崛起，世界会怎样？');
    const world = createSimulationWorld('如果一个神秘帝国突然崛起，世界会怎样？', 'strategic');

    expect(seed.viability.canSimulate).toBe(false);
    expect(seed.actors).toHaveLength(0);
    expect(world.domain).toBe('信息不足');
    expect(world.agents).toHaveLength(0);
    expect(world.simulationPlan.stopReason).toContain('当前输入不足以创建可观察世界');
  });

  it('penalizes long horizons and divergent branches', () => {
    const short = calculateCredibility({
      evidenceCount: 5,
      inferenceCount: 2,
      horizon: 'short',
      branchDivergence: 0.15,
    });
    const mythic = calculateCredibility({
      evidenceCount: 5,
      inferenceCount: 2,
      horizon: 'mythic',
      branchDivergence: 0.65,
    });
    expect(short).toBeGreaterThan(mythic);
  });
});
