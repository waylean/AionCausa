import type {
  AgentActionLog,
  AgentProfile,
  EvidenceItem,
  HorizonMode,
  PremiseNode,
  SimulationBranch,
  SimulationWorld,
  TimelinePoint,
  WorldMetric,
} from './types';

export const horizonLabels: Record<HorizonMode, string> = {
  short: '短期 1-5 年',
  strategic: '战略 5-30 年',
  generational: '代际 30-100 年',
  mythic: '极远期 100+ 年',
};

const horizonDecay: Record<HorizonMode, number> = {
  short: 0.92,
  strategic: 0.78,
  generational: 0.56,
  mythic: 0.32,
};

export function clampConfidence(value: number): number {
  return Math.min(0.98, Math.max(0.08, Number(value.toFixed(2))));
}

export function summarizeEventText(value: string, maxLength = 24): string {
  const cleaned = value
    .replace(/\s+/gu, '')
    .replace(/^如果/u, '')
    .replace(/[?？。！!]+$/u, '');
  if (!cleaned) return '待生成事件';

  if (/鸿门宴/.test(cleaned) && /项羽/.test(cleaned) && /刘邦/.test(cleaned)) {
    return '鸿门宴杀刘邦';
  }

  const knownMatch = cleaned.match(
    /(商鞅[^，,。；;]{0,10}|玄武门之变|鸿门宴|项羽|刘邦|俄乌战争|全球AI治理|三体舰队|伏地魔|霍格沃茨大战|北境女王|古巴导弹危机|南北战争)/u,
  );
  if (knownMatch?.[0]) return knownMatch[0].slice(0, maxLength);

  const stopIndex = cleaned.search(/[，,；;：:]/u);
  const candidate = stopIndex > 4 ? cleaned.slice(0, stopIndex) : cleaned;
  return candidate.length > maxLength ? `${candidate.slice(0, maxLength - 1)}…` : candidate;
}

export function calculateCredibility(options: {
  evidenceCount: number;
  inferenceCount: number;
  horizon: HorizonMode;
  branchDivergence: number;
}): number {
  const evidenceLift = Math.min(options.evidenceCount * 0.035, 0.22);
  const inferencePenalty = Math.min(options.inferenceCount * 0.028, 0.24);
  const divergencePenalty = options.branchDivergence * 0.31;
  return clampConfidence((0.58 + evidenceLift - inferencePenalty - divergencePenalty) * horizonDecay[options.horizon]);
}

export function inferDomain(input: string): string {
  const normalized = input.toLowerCase();
  if (/商鞅|秦国|玄武门|唐朝|鸿门宴|项羽|刘邦|楚汉|变法|王朝|历史|南北战争|邦联|林肯|古巴导弹|苏联潜艇|civil war|confederacy|lincoln|cuban missile|soviet submarine/.test(normalized + input)) return '历史政治';
  if (/世界杯|比赛|篮球|足球|nba|球员|伤病/.test(normalized + input)) return '体育赛事';
  if (/小说|奇幻|魔法|王国|龙骑士|霍格沃茨|伏地魔|哈利|魔戒|索伦|中土|三体|面壁者|执剑人|舰队|fantasy|novel|hogwarts|voldemort|harry potter|lord of the rings|sauron|middle-earth|three-body/i.test(normalized + input)) return '虚构叙事';
  if (/公司|市场|金融|经济|政策|股价|产品|ai治理|人工智能|科技公司|欧盟监管|开源ai|ai governance|artificial intelligence|tech company|open source ai/i.test(normalized + input)) return '经济商业';
  if (/战争|冲突|外交|选举|国家|俄乌|俄罗斯|乌克兰|北约|停火|核升级|russia|ukraine|nato|ceasefire|nuclear escalation/.test(normalized + input)) return '地缘战略';
  return '通用事件';
}

function buildEvidence(input: string): EvidenceItem[] {
  return [
    {
      id: 'ev-user',
      claim: input.trim() || '用户尚未输入事件，系统使用示例事件初始化沙盘。',
      source: 'user_input',
      confidence: 0.9,
      usedIn: ['event', 'premise-root'],
    },
    {
      id: 'ev-cause',
      claim: '事件推演需要先拆分事实、假设、背景补全与争议解释。',
      source: 'system_inference',
      confidence: 0.76,
      usedIn: ['world-model', 'credibility'],
    },
    {
      id: 'ev-context',
      claim: '关键人物的目标、资源、约束和信息差会决定分支走向。',
      source: 'llm_background',
      confidence: 0.68,
      usedIn: ['agents', 'branches'],
    },
    {
      id: 'ev-decay',
      claim: '推演跨度越长，分支数量和不确定性会快速增长。',
      source: 'system_inference',
      confidence: 0.82,
      usedIn: ['horizon', 'credibility'],
    },
  ];
}

type AgentSeed = Omit<AgentProfile, 'id' | 'goals' | 'constraints' | 'leverage' | 'riskTolerance' | 'confidence'> &
  Partial<Pick<AgentProfile, 'goals' | 'constraints' | 'leverage' | 'riskTolerance' | 'confidence'>> & {
    id?: string;
  };

export interface WorldSeedViability {
  canSimulate: boolean;
  score: number;
  reasons: string[];
  missing: string[];
}

export interface WorldSeed {
  eventText: string;
  domainLabel: string;
  actors: AgentProfile[];
  source: 'known_source' | 'user_grounded' | 'insufficient';
  viability: WorldSeedViability;
}

function makeAgent(index: number, seed: AgentSeed): AgentProfile {
  return {
    id: seed.id ?? `agent-${index + 1}`,
    name: seed.name,
    role: seed.role,
    identity: seed.identity,
    dilemma: seed.dilemma,
    currentPressure: seed.currentPressure,
    goals: seed.goals ?? ['守住核心利益', '争取信息优势', '避免失去主动权'],
    constraints: seed.constraints ?? ['信息不完整', '盟友承诺不稳定', '行动会被其他人物解读'],
    leverage: seed.leverage ?? ['制度位置', '资源调配权', '叙事影响力'],
    actions: seed.actions ?? ['先向关键对手释放试探信号，再根据回应调整下一步行动'],
    relationships: seed.relationships ?? ['与其他关键人物既互相需要又彼此防备'],
    riskTolerance: seed.riskTolerance ?? clampConfidence(0.58 + index * 0.03),
    confidence: seed.confidence ?? clampConfidence(0.66 - index * 0.02),
  };
}

function buildRecognizedScenarioAgents(input: string): AgentProfile[] | null {
  if (/鸿门宴|范增|项伯|樊哙|项羽.*刘邦|刘邦.*项羽/.test(input)) {
    return [
      makeAgent(0, {
        id: 'agent-xiang-yu',
        name: '项羽',
        role: '西楚军事主导者',
        identity: '在关中胜利后掌握压倒性军力，却必须把军事威望转化为稳定政治秩序的楚军领袖',
        dilemma: '强杀刘邦可以立刻清除潜在对手，但也会让诸侯相信项羽会在宴席与盟约中任意杀人。',
        currentPressure: '鸿门宴上杀机一旦落下，他必须马上解释杀刘邦的合法性，并压住诸侯与刘邦旧部的反弹。',
        goals: ['清除关中竞争者', '维持楚军威望', '重塑诸侯秩序'],
        constraints: ['诸侯信任脆弱', '楚军长期占领能力有限', '范增与项伯意见相左'],
        leverage: ['楚军主力', '巨鹿战后威望', '分封裁决权'],
        actions: ['在宴席上命亲兵控制刘邦随从，并以“背约入关”为名宣布处死刘邦'],
        relationships: ['依赖范增判断刘邦威胁', '被项伯牵制对张良与刘邦的处置', '与刘邦由盟友转为生死敌手'],
        riskTolerance: 0.82,
        confidence: 0.76,
      }),
      makeAgent(1, {
        id: 'agent-liu-bang',
        name: '刘邦',
        role: '沛公，关中先入者',
        identity: '以先入关中获得政治筹码、却在鸿门宴处于绝对军力劣势的诸侯领袖',
        dilemma: '他若被项羽强杀，刘邦集团必须在失去核心人物后决定投降、逃散或拥立替代旗帜。',
        currentPressure: '宴席危机从政治低头变成性命危机，他的随从与旧部将被迫立刻选择是否突围。',
        goals: ['保住沛公集团', '守住关中合法性叙事', '避免被楚军一网打尽'],
        constraints: ['兵力远弱于项羽', '身处项羽营中', '内部继承秩序尚未稳固'],
        leverage: ['先入关中名义', '沛县旧部', '张良与萧何等谋臣网络'],
        actions: ['在项羽下令前尝试以退让和交还关中权力换取离营机会'],
        relationships: ['倚重张良周旋', '与项羽在关中归属上不可调和'],
        riskTolerance: 0.64,
        confidence: 0.72,
      }),
      makeAgent(2, {
        id: 'agent-fan-zeng',
        name: '范增',
        role: '项羽谋主',
        identity: '最早判断刘邦会成为楚军最大政治威胁，并推动项羽在鸿门宴动手的谋臣',
        dilemma: '若杀刘邦，他要承担破坏盟约名义的政治代价；若不杀，楚军可能放走未来对手。',
        currentPressure: '项羽若真的强杀刘邦，范增必须立刻安排后续清洗与对诸侯的解释。',
        goals: ['彻底拔除刘邦集团', '防止关中成为反楚根据地', '强化项羽决断'],
        constraints: ['项羽重义轻谋', '项伯可能泄密或阻挠', '诸侯对楚军猜忌加深'],
        leverage: ['谋略判断', '对项羽的长期影响', '宴席伏杀方案'],
        actions: ['催促项羽同时扣押张良、樊哙等刘邦核心随从，避免刘邦死后集团转入地下'],
        relationships: ['与项伯路线冲突', '试图压过项羽的犹豫'],
        riskTolerance: 0.78,
        confidence: 0.7,
      }),
      makeAgent(3, {
        id: 'agent-xiang-bo',
        name: '项伯',
        role: '项氏宗亲，张良旧交',
        identity: '夹在项氏宗族利益、张良私交和鸿门宴杀局之间的关键缓冲者',
        dilemma: '刘邦被杀后，他会被范增怀疑通敌，也会失去用私交缓和局势的空间。',
        currentPressure: '项羽强杀刘邦会使项伯此前保护张良和刘邦的行为变得危险。',
        goals: ['保住项氏内部位置', '保护张良不被连坐', '避免楚军因过度清洗失信诸侯'],
        constraints: ['无法公开反对项羽', '已与张良有私下牵连', '范增会追究泄密责任'],
        leverage: ['项氏宗亲身份', '与张良的私交', '对宴席内情的掌握'],
        actions: ['在刘邦被杀后请求项羽只诛刘邦本人，放张良回去安抚沛公旧部'],
        relationships: ['与范增互不信任', '保护张良但必须向项羽证明忠诚'],
        riskTolerance: 0.55,
        confidence: 0.68,
      }),
      makeAgent(4, {
        id: 'agent-zhang-liang',
        name: '张良',
        role: '刘邦谋臣',
        identity: '负责在鸿门宴中为刘邦寻找生路，并能在危机后重组政治叙事的谋士',
        dilemma: '刘邦若被杀，他必须决定是救出残余核心、转投他处，还是扶持刘邦集团继续抗楚。',
        currentPressure: '宴席杀局一旦完成，张良会成为楚军追捕与刘邦旧部求援的共同焦点。',
        goals: ['保存刘邦集团火种', '传出项羽背盟杀人的叙事', '寻找新的组织核心'],
        constraints: ['身处敌营附近', '刘邦死亡会造成指挥真空', '必须避开范增清洗'],
        leverage: ['谋略声望', '与项伯私交', '对刘邦旧部的联络能力'],
        actions: ['借项伯关系脱身，把刘邦被杀的消息送往霸上与沛公旧部'],
        relationships: ['受项伯保护但不能完全信任项氏', '需要说服萧何、樊哙等人不要立刻溃散'],
        riskTolerance: 0.7,
        confidence: 0.73,
      }),
      makeAgent(5, {
        id: 'agent-fan-kuai',
        name: '樊哙',
        role: '刘邦武将',
        identity: '在鸿门宴现场以武力与胆气保护刘邦的沛公集团将领',
        dilemma: '刘邦若遭强杀，他必须在救主失败、突围复仇和保存残部之间快速选择。',
        currentPressure: '项羽动手后，樊哙会最先面对楚军包围与沛公随从失控。',
        goals: ['救出刘邦或遗体', '保护沛公随从突围', '维持军心不散'],
        constraints: ['楚军兵力压倒性优势', '缺乏政治解释权', '容易被项羽视为必须清除的武力威胁'],
        leverage: ['近身武力', '沛公旧部威望', '现场冲击力'],
        actions: ['率随从冲击宴席外围，试图制造混乱掩护张良传出消息'],
        relationships: ['忠于刘邦', '需要张良把武力突围转化为后续政治行动'],
        riskTolerance: 0.86,
        confidence: 0.68,
      }),
    ];
  }

  if (/玄武门|李世民|李建成|李元吉|李渊/.test(input)) {
    return [
      makeAgent(0, {
        id: 'agent-li-shimin',
        name: '李世民',
        role: '秦王，唐初军事功臣',
        identity: '在功勋、军权与继承秩序之间被推到危险边缘的皇子',
        dilemma: '若不发动政变，他必须找到保住军功集团和自身安全的替代路径。',
        currentPressure: '太子集团与秦王府长期对立，宫廷猜忌正在逼近摊牌。',
        goals: ['保住秦王府', '避免被太子集团清算', '争取李渊重新裁决继承安排'],
        constraints: ['名分低于太子', '宫廷情报不完全', '军功集团不愿坐以待毙'],
        leverage: ['秦王府幕僚', '军功威望', '边疆战功'],
        actions: ['秘密召集长孙无忌等幕僚，讨论不经玄武门伏击的自保方案'],
        relationships: ['与李建成互相猜忌', '仍需争取李渊的最终裁决'],
        riskTolerance: 0.72,
        confidence: 0.72,
      }),
      makeAgent(1, {
        id: 'agent-li-jiancheng',
        name: '李建成',
        role: '唐高祖太子',
        identity: '拥有继承名分，却被秦王军功威望持续压迫的储君',
        dilemma: '若继续压制秦王，可能逼出兵变；若退让，又会削弱太子权威。',
        currentPressure: '秦王府不再轻易退让，太子必须重新选择公开制衡或暗中削权。',
        goals: ['稳固太子地位', '拆解秦王府军功集团', '避免父皇怀疑自己逼宫'],
        constraints: ['李世民军功太重', '朝臣立场分裂', '不能公开破坏储君名分'],
        leverage: ['太子名分', '东宫网络', '宫廷日常接近权'],
        actions: ['向李渊进言要求秦王外镇，以远离长安军政核心'],
        relationships: ['与李元吉形成短期同盟', '与李世民的信任已经接近破裂'],
        riskTolerance: 0.62,
        confidence: 0.68,
      }),
      makeAgent(2, {
        id: 'agent-li-yuanji',
        name: '李元吉',
        role: '齐王，太子同盟者',
        identity: '在储位斗争中押注太子集团、同时希望扩张自身权力的皇子',
        dilemma: '他越激进，越能推动太子行动，也越可能成为冲突替罪羊。',
        currentPressure: '秦王府若不被削弱，齐王府也会被军功集团压制。',
        goals: ['促使太子尽快行动', '削弱秦王军权', '扩大自身宫廷影响'],
        constraints: ['个人威望不如李世民', '过度激进会引发李渊警惕'],
        leverage: ['太子同盟', '宫廷谗言', '亲王身份'],
        actions: ['私下催促李建成先发制人，要求把秦王亲信调离长安'],
        relationships: ['依附李建成', '敌视李世民'],
        riskTolerance: 0.76,
        confidence: 0.64,
      }),
      makeAgent(3, {
        id: 'agent-li-yuan',
        name: '李渊',
        role: '唐高祖',
        identity: '必须在储君名分、秦王军功和皇族内战风险之间维持皇权的开国皇帝',
        dilemma: '压制秦王会损害军功体系，放任秦王又会动摇太子名分。',
        currentPressure: '诸子冲突已经威胁唐初政权稳定，他必须选择调停、分封或强制裁断。',
        goals: ['避免皇族内战', '保住皇权裁决权', '维持新朝秩序'],
        constraints: ['父子私情', '功臣集团分裂', '继承制度尚未稳固'],
        leverage: ['皇帝任免权', '宫禁控制', '最终裁决权'],
        actions: ['召见太子和秦王分别陈述，试图以外镇和分权拖延冲突'],
        relationships: ['既依赖李世民战功，也不能轻易废弃李建成名分'],
        riskTolerance: 0.48,
        confidence: 0.7,
      }),
      makeAgent(4, {
        id: 'agent-changsun',
        name: '长孙无忌',
        role: '秦王府核心谋臣',
        identity: '把秦王府安全问题转化为可执行政治方案的幕僚',
        dilemma: '过于保守会让秦王被动受制，过于激进又会背负谋逆风险。',
        currentPressure: '秦王府需要一个不以玄武门伏击为前提的生存方案。',
        goals: ['保护李世民', '保住军功集团', '设计合法化自保路径'],
        constraints: ['名分不在秦王一侧', '情报窗口短暂'],
        leverage: ['秦王府谋士网络', '对宫廷节奏的判断', '与军功集团的联络'],
        actions: ['建议李世民用请外镇为名争取兵权与地盘，而非立刻宫门决战'],
        relationships: ['深度绑定李世民', '被太子集团视为危险谋主'],
        riskTolerance: 0.66,
        confidence: 0.69,
      }),
    ];
  }

  if (/伏地魔|霍格沃茨|哈利|harry potter|hogwarts|voldemort/i.test(input)) {
    return [
      makeAgent(0, {
        id: 'agent-voldemort',
        name: '伏地魔',
        role: '黑魔法统治者',
        identity: '试图把战场胜利转化为魔法部、霍格沃茨和纯血秩序全面控制的胜利者',
        dilemma: '恐惧能迅速压服反抗者，但过度清洗会逼出更隐蔽的地下抵抗。',
        currentPressure: '霍格沃茨胜利后，他必须立刻决定是公开加冕还是继续用傀儡机构统治。',
        goals: ['清除抵抗网络', '控制魔法部', '重塑血统秩序'],
        leverage: ['食死徒网络', '恐惧威慑', '魔法部渗透'],
        actions: ['命令食死徒接管魔法部档案，列出所有参与霍格沃茨抵抗的人'],
        relationships: ['把哈利·波特残余盟友视为必须追捕的象征', '需要德拉科·马尔福这类摇摆纯血家族表态效忠'],
        riskTolerance: 0.82,
        confidence: 0.7,
      }),
      makeAgent(1, {
        id: 'agent-harry',
        name: '哈利·波特',
        role: '幸存抵抗象征',
        identity: '即使战败也会被地下抵抗者视作继续反抗的精神坐标',
        dilemma: '公开现身可以鼓舞士气，但也会让追随者暴露在清洗中。',
        currentPressure: '霍格沃茨失败后，他必须在逃亡、营救同伴和重建抵抗之间取舍。',
        goals: ['保存抵抗火种', '营救被捕同伴', '寻找伏地魔统治漏洞'],
        leverage: ['象征号召力', '凤凰社残余网络', '对伏地魔的特殊认知'],
        actions: ['通过凤凰社残余成员发布暗号，要求幸存学生不要立刻公开复仇'],
        relationships: ['信任赫敏的组织判断', '会牵动伏地魔的政治恐惧'],
      }),
      makeAgent(2, {
        id: 'agent-hermione',
        name: '赫敏·格兰杰',
        role: '地下抵抗组织者',
        identity: '把战败后的零散幸存者重新编成情报、救援和宣传网络的行动人物',
        dilemma: '她需要快速行动救人，但每一次联络都可能暴露整条网络。',
        goals: ['保存名单', '救出被捕者', '建立安全屋'],
        leverage: ['组织能力', '咒语知识', '麻瓜世界通道'],
        actions: ['销毁抵抗者名单副本，并把幸存学生分散送入麻瓜社区安全屋'],
      }),
      makeAgent(3, {
        id: 'agent-kingsley',
        name: '金斯莱·沙克尔',
        role: '凤凰社政治联系人',
        identity: '在魔法部被接管后仍试图保住行政系统里少数可用暗线的抵抗者',
        dilemma: '留在体制内能救更多人，但越久越可能被迫配合新政权。',
        goals: ['保护潜伏者', '转移魔法部档案', '维持外部联络'],
        leverage: ['魔法部旧关系', '傲罗经验', '国际联络'],
        actions: ['假意接受审查，暗中把傲罗名单交给赫敏转移'],
      }),
      makeAgent(4, {
        id: 'agent-draco',
        name: '德拉科·马尔福',
        role: '摇摆纯血继承人',
        identity: '夹在家族自保、伏地魔恐惧和个人负罪之间的年轻纯血贵族',
        dilemma: '表态效忠能保住家族，但也会让他参与更深的清洗。',
        goals: ['保住家族', '避免亲手清洗同学', '寻找脱身空间'],
        leverage: ['纯血身份', '马尔福家族渠道', '食死徒内部消息'],
        actions: ['向赫敏传出一份不完整抓捕名单，试图换取家族未来的退路'],
      }),
    ];
  }

  if (/魔戒|索伦|中土|至尊魔戒|lord of the rings|sauron|middle-earth/i.test(input)) {
    return [
      makeAgent(0, {
        id: 'agent-sauron',
        name: '索伦',
        role: '魔戒持有者与黑暗统治者',
        identity: '夺回至尊魔戒后试图把军事胜利变成中土意志控制体系的黑暗君主',
        dilemma: '魔戒能压倒对手，却也会让所有自由族群放弃妥协、转入绝望抵抗。',
        goals: ['摧毁自由联盟', '控制人类诸国', '追捕残余持戒相关者'],
        leverage: ['至尊魔戒', '魔多军团', '恐惧支配'],
        actions: ['命令戒灵分头追捕护戒队残余，并要求东方盟军压向刚铎边境'],
      }),
      makeAgent(1, {
        id: 'agent-aragorn',
        name: '阿拉贡',
        role: '刚铎国王与自由联盟领袖',
        identity: '在魔戒失败后仍必须把人类、精灵和矮人残余力量凝成防线的统帅',
        dilemma: '守城能保存火种，主动出击又可能争取最后的联盟士气。',
        goals: ['保住米那斯提力斯', '重建联盟', '争取撤离时间'],
        leverage: ['王权合法性', '战场威望', '人类诸国残军'],
        actions: ['召集洛汗与刚铎残军，准备把防线从城墙转为山地持久战'],
      }),
      makeAgent(2, {
        id: 'agent-gandalf',
        name: '甘道夫',
        role: '自由族群的战略引导者',
        identity: '在正面失败后寻找索伦权力结构裂缝的智者',
        dilemma: '希望几乎耗尽，但他必须阻止各族因绝望而各自逃散。',
        goals: ['保留反抗意志', '寻找魔戒副作用', '维系跨族信任'],
        leverage: ['古老知识', '各族信任', '精神号召'],
        actions: ['劝说阿拉贡不要立刻决战，而是诱使索伦分兵追击残余护戒者'],
      }),
      makeAgent(3, {
        id: 'agent-galadriel',
        name: '凯兰崔尔',
        role: '精灵领主',
        identity: '必须决定精灵是撤离中土还是留下承担最后抵抗的古老统治者',
        dilemma: '继续留守可能让族人灭亡，撤离又等于把中土交给黑暗。',
        goals: ['保护精灵族人', '支援自由联盟', '保存古老知识'],
        leverage: ['洛丝罗瑞恩', '精灵情报', '精神威望'],
        actions: ['秘密派出信使联络阿拉贡，提出用精灵撤离路线转移平民'],
      }),
      makeAgent(4, {
        id: 'agent-sam',
        name: '山姆卫斯·詹吉',
        role: '护戒失败后的幸存者',
        identity: '从失败现场带回关键信息、也最能证明索伦并非全知的普通人',
        dilemma: '他想救弗罗多，却也知道任何行动都会被魔戒力量追踪。',
        goals: ['救回同伴', '把失败细节告诉甘道夫', '保护夏尔'],
        leverage: ['现场记忆', '不起眼身份', '对弗罗多的忠诚'],
        actions: ['躲过戒灵搜索后寻找甘道夫，把魔戒重新回到索伦手中的细节说出'],
      }),
    ];
  }

  if (/三体|面壁者|执剑人|黑暗森林|三体舰队|three-body/i.test(input)) {
    return [
      makeAgent(0, {
        id: 'agent-luoji',
        name: '罗辑',
        role: '黑暗森林威慑建立者',
        identity: '最理解宇宙威慑逻辑、也最清楚人类政治会稀释威慑意志的人物',
        dilemma: '提前到来的舰队会压缩威慑准备时间，也会放大人类内部投降与冒险的争执。',
        goals: ['维持威慑可信度', '阻止人类内部崩溃', '争取技术时间'],
        leverage: ['黑暗森林威慑知识', '公众象征', '战略判断'],
        actions: ['要求联合政府公开确认威慑底线，同时私下评估执剑权是否需要提前集中'],
      }),
      makeAgent(1, {
        id: 'agent-chengxin',
        name: '程心',
        role: '人类文明伦理代表',
        identity: '在生存压力下仍坚持文明不能完全让位于威慑逻辑的关键人物',
        dilemma: '仁慈能保住文明自我理解，却可能被三体世界视为威慑软弱。',
        goals: ['避免文明自毁', '保住人类道德底线', '寻找非灭绝性谈判空间'],
        leverage: ['公众信任', '伦理号召', '制度合法性'],
        actions: ['呼吁联合政府不要把所有权力交给单一执剑者，提出透明监督方案'],
      }),
      makeAgent(2, {
        id: 'agent-un',
        name: '联合政府主席',
        role: '人类政治协调者',
        identity: '需要把恐慌社会、军方和科学界压进同一套应急秩序的行政人物',
        dilemma: '越集中权力越能快速行动，也越可能造成全球政治合法性崩塌。',
        goals: ['稳定社会秩序', '统一资源调度', '维持威慑指挥链'],
        leverage: ['全球紧急权力', '资源分配', '舆论发布'],
        actions: ['宣布进入文明紧急状态，并要求各大舰队提交真实战备数据'],
      }),
      makeAgent(3, {
        id: 'agent-fleet',
        name: '舰队司令',
        role: '太空军事实力代表',
        identity: '最先面对三体舰队实际接触风险的军事指挥者',
        dilemma: '提前交战可能暴露弱点，等待又可能错过唯一拦截窗口。',
        goals: ['保存舰队', '确认敌方能力', '争取主动接触位置'],
        leverage: ['太空舰队', '侦察数据', '军事纪律'],
        actions: ['派出高速侦察编队接近三体舰队前缘，同时隐瞒部分损失数据'],
      }),
      makeAgent(4, {
        id: 'agent-trisolaran',
        name: '三体监听者',
        role: '三体世界前线情报节点',
        identity: '负责判断人类威慑是否仍可信，并把地球内部裂缝传回舰队的人物',
        dilemma: '若低估人类威慑会招致宇宙广播风险，若高估则错失提前压制窗口。',
        goals: ['识别人类威慑弱点', '诱导投降派', '保护舰队航路'],
        leverage: ['智子监听', '心理战信息', '舰队时间表'],
        actions: ['向人类社会释放模糊信号，试探程心路线是否会削弱执剑威慑'],
      }),
    ];
  }

  if (/奇幻|王国|龙骑士|女王|联盟|fantasy|kingdom|dragon rider|queen|alliance/i.test(input)) {
    return [
      makeAgent(0, {
        id: 'agent-north-queen',
        name: '北境女王',
        role: '背叛联盟的地方君主',
        identity: '把联盟胜利前景转化为北境独立筹码的统治者',
        dilemma: '背叛能换取短期自主，但会让她失去旧盟友和民众信任。',
        goals: ['保住北境自治', '控制龙骑士威胁', '争取王都承认'],
        leverage: ['北境军队', '山口要塞', '寒地补给线'],
        actions: ['扣押龙骑士联盟使者，并向王都摄政递交秘密停战条件'],
      }),
      makeAgent(1, {
        id: 'agent-dragon-rider',
        name: '龙骑士统领',
        role: '被背叛联盟的军事领袖',
        identity: '依靠龙骑士威慑维系各地诸侯共同作战的联盟统帅',
        dilemma: '立即报复会摧毁联盟名义，忍让又会让更多诸侯效仿背叛。',
        goals: ['救回使者', '维持联盟威慑', '防止龙群分裂'],
        leverage: ['龙骑士部队', '盟约誓言', '空中机动'],
        actions: ['派一名亲信骑士潜入北境，同时公开要求北境女王释放使者'],
      }),
      makeAgent(2, {
        id: 'agent-regent',
        name: '王都摄政',
        role: '旧王国中央权力代表',
        identity: '试图利用联盟内裂缝恢复王都对北境与龙骑士的控制',
        dilemma: '支持北境能削弱龙骑士，但也会鼓励地方诸侯继续坐大。',
        goals: ['恢复王都权威', '拆分龙骑士联盟', '避免全面内战'],
        leverage: ['王室法统', '金库', '贵族议会'],
        actions: ['秘密承诺承认北境自治，条件是北境交出一处龙巢入口'],
      }),
      makeAgent(3, {
        id: 'agent-border-general',
        name: '边境将军',
        role: '掌握前线军队的摇摆军人',
        identity: '既受北境女王任命，又依赖龙骑士联盟守住边境的军事人物',
        dilemma: '服从女王会背叛战友，倒向联盟又会使家族成为叛臣。',
        goals: ['保住边防军', '避免北境被焚毁', '寻找中间方案'],
        leverage: ['边防军忠诚', '关隘控制', '前线情报'],
        actions: ['延迟执行扣押令，暗中允许龙骑士统领的信使穿过边境'],
      }),
      makeAgent(4, {
        id: 'agent-city-envoy',
        name: '商港使者',
        role: '依赖贸易和平的城邦代表',
        identity: '代表被战争断供威胁的商港与平民城市，在强权之间寻找生路',
        dilemma: '公开站队会招来报复，保持中立又无法阻止粮道被切断。',
        goals: ['恢复贸易线', '保护难民', '阻止龙焰战争'],
        leverage: ['粮食船队', '金币贷款', '城邦情报网'],
        actions: ['向北境女王和龙骑士统领同时提出赎回使者与开放粮道的交换方案'],
      }),
    ];
  }

  if (/南北战争|邦联|林肯|美国内战|civil war|confederacy|lincoln/i.test(input)) {
    return [
      makeAgent(0, {
        id: 'agent-lincoln',
        name: '亚伯拉罕·林肯',
        role: '北方联邦总统',
        identity: '必须在承认邦联独立的压力下重组联邦政治合法性的战时总统',
        dilemma: '继续战争可能耗尽北方耐心，接受独立又会动摇联邦不可分裂的原则。',
        currentPressure: '邦联胜利让国会、军队和废奴派同时要求他给出新的底线。',
        goals: ['保住联邦核心', '维持北方工业动员', '避免废奴目标彻底破产'],
        leverage: ['北方工业能力', '总统战时权力', '废奴道义叙事'],
        actions: ['召集内阁讨论是否接受停战，同时要求格兰特重整边境防线'],
        relationships: ['与杰斐逊·戴维斯谈判对立', '依赖弗雷德里克·道格拉斯稳住废奴联盟'],
      }),
      makeAgent(1, {
        id: 'agent-davis',
        name: '杰斐逊·戴维斯',
        role: '邦联总统',
        identity: '把军事胜利转化为国际承认与长期国家生存的邦联领导者',
        dilemma: '胜利窗口短暂，若无法获得外部承认和财政稳定，独立也会迅速空心化。',
        goals: ['获得英法承认', '巩固邦联财政', '压住州权派内耗'],
        leverage: ['胜利叙事', '棉花外交', '邦联军队士气'],
        actions: ['派使节向英国强调棉花供应与制衡美国的价值'],
        relationships: ['与罗伯特·李互相依赖', '把林肯的停战条件视为谈判筹码'],
      }),
      makeAgent(2, {
        id: 'agent-lee',
        name: '罗伯特·李',
        role: '邦联主力统帅',
        identity: '以战场威望支撑邦联谈判地位的军事人物',
        dilemma: '继续进攻可扩大筹码，但军队补给和伤亡已接近极限。',
        goals: ['保住军队主力', '迫使北方接受停战', '降低本土损耗'],
        leverage: ['战场威望', '军官团忠诚', '北方舆论压力'],
        actions: ['建议戴维斯停止冒险北进，改用边境防御换取谈判时间'],
      }),
      makeAgent(3, {
        id: 'agent-palmerston',
        name: '帕默斯顿',
        role: '英国首相',
        identity: '在棉花利益、反奴隶制舆论与制衡美国之间权衡的外部决策者',
        dilemma: '承认邦联能牵制美国，但会激怒英国国内反奴隶制力量。',
        goals: ['维护英国贸易', '避免直接卷入战争', '扩大外交筹码'],
        leverage: ['外交承认', '海军存在', '金融市场影响'],
        actions: ['要求外交部秘密评估承认邦联的国内舆论成本'],
      }),
      makeAgent(4, {
        id: 'agent-douglass',
        name: '弗雷德里克·道格拉斯',
        role: '废奴运动领袖',
        identity: '迫使北方政治不能把黑人自由作为停战牺牲品的公共人物',
        dilemma: '战争失败会削弱废奴派，但沉默会让停战成为奴隶制扩张的通行证。',
        goals: ['保住解放议程', '推动黑人参军和公民权', '约束林肯妥协边界'],
        leverage: ['公共演讲', '废奴网络', '道义压力'],
        actions: ['公开要求林肯把解放条款写入任何停战谈判'],
      }),
    ];
  }

  if (/古巴导弹|核升级|苏联潜艇|肯尼迪|赫鲁晓夫|卡斯特罗|cuban missile|nuclear escalation|soviet submarine|kennedy|khrushchev|castro/i.test(input)) {
    return [
      makeAgent(0, {
        id: 'agent-kennedy',
        name: '约翰·肯尼迪',
        role: '美国总统',
        identity: '在军方报复压力与核战争风险之间寻找可控出口的危机决策者',
        dilemma: '若不强硬回应会被视为软弱，若升级报复则可能触发无法收束的核交换。',
        goals: ['阻止苏联继续部署', '保住美国信誉', '避免核战争失控'],
        leverage: ['海上封锁', '白宫危机委员会', '公开讲话'],
        actions: ['召集危机委员会，要求军方拿出不触发全面核战的回应方案'],
      }),
      makeAgent(1, {
        id: 'agent-khrushchev',
        name: '尼基塔·赫鲁晓夫',
        role: '苏联领导人',
        identity: '必须证明苏联不会被美国威慑压退，同时又不能让危机越过核门槛',
        dilemma: '撤退会损害威信，坚持到底又会把苏联带入高烈度战争。',
        goals: ['保住苏联战略颜面', '换取美国让步', '控制军方误判'],
        leverage: ['导弹部署', '外交信件', '华约压力'],
        actions: ['向肯尼迪发送秘密信件，提出以撤导换取美国不入侵古巴'],
      }),
      makeAgent(2, {
        id: 'agent-castro',
        name: '菲德尔·卡斯特罗',
        role: '古巴领导人',
        identity: '担心美苏交易牺牲古巴安全的革命政权领导者',
        dilemma: '依赖苏联保护，却不能让古巴只成为大国谈判桌上的筹码。',
        goals: ['防止美国入侵', '保持革命自主性', '锁定苏联安全承诺'],
        leverage: ['古巴领土位置', '革命动员', '对苏联的前线价值'],
        actions: ['要求苏联公开保证古巴安全，并准备全国防空和民兵动员'],
      }),
      makeAgent(3, {
        id: 'agent-mcnamara',
        name: '罗伯特·麦克纳马拉',
        role: '美国国防部长',
        identity: '把军方报复冲动压入可计算风险框架的技术官僚',
        dilemma: '军方要求迅速打击，但他必须把每一步升级的核后果说清楚。',
        goals: ['降低误判', '维持封锁纪律', '控制军方行动边界'],
        leverage: ['国防部指挥链', '战情评估', '危机委员会话语权'],
        actions: ['命令海军调整接触规则，避免舰长自行把拦截升级为攻击'],
      }),
      makeAgent(4, {
        id: 'agent-arkhipov',
        name: '瓦西里·阿尔希波夫',
        role: '苏联潜艇军官',
        identity: '在战术隔绝环境中阻止局部误判变成核发射的现场人物',
        dilemma: '潜艇通信中断、爆炸声逼近，他必须判断眼前是战争开始还是威慑测试。',
        goals: ['阻止误发核鱼雷', '让潜艇重新获得通信', '保住艇员生命'],
        leverage: ['发射否决权', '艇内威望', '冷静判断'],
        actions: ['要求艇长上浮确认莫斯科命令，拒绝立即发射核鱼雷'],
      }),
    ];
  }

  if (/俄乌|俄罗斯|乌克兰|北约|停火|russia|ukraine|nato|ceasefire/i.test(input)) {
    return [
      makeAgent(0, {
        id: 'agent-putin',
        name: '弗拉基米尔·普京',
        role: '俄罗斯总统',
        identity: '试图把战场优势转化为长期安全缓冲和国内政治叙事的领导者',
        dilemma: '扩大胜利果实会加剧制裁与军费压力，过早停手又可能被国内强硬派质疑。',
        goals: ['锁定停火线', '削弱乌克兰外援', '维护国内胜利叙事'],
        leverage: ['能源压力', '军事占领区', '核威慑话语'],
        actions: ['要求外交团队把停火条件与解除部分制裁绑定'],
      }),
      makeAgent(1, {
        id: 'agent-zelensky',
        name: '弗拉基米尔·泽连斯基',
        role: '乌克兰总统',
        identity: '在不利停火后维持国家动员、国际支持和政治合法性的战时领导者',
        dilemma: '接受停火能保住国家运转，但会被国内质疑放弃领土。',
        goals: ['保住国际援助', '维持军队士气', '避免政治崩盘'],
        leverage: ['国际舆论', '抵抗象征', '安全承诺谈判'],
        actions: ['向欧洲盟友提出长期安全保证和重建资金清单'],
      }),
      makeAgent(2, {
        id: 'agent-eu',
        name: '欧盟委员会主席',
        role: '欧洲政策协调者',
        identity: '需要在成员国疲劳、能源成本和欧洲安全秩序之间重建共识',
        dilemma: '强硬援助会拉高财政和能源成本，妥协又会削弱欧盟战略信誉。',
        goals: ['稳定欧盟内部共识', '重建安全架构', '控制能源冲击'],
        leverage: ['制裁工具', '重建资金', '入盟议程'],
        actions: ['召集成员国讨论对乌安全承诺与对俄制裁分层方案'],
      }),
      makeAgent(3, {
        id: 'agent-us-president',
        name: '美国总统',
        role: '美国最高决策者',
        identity: '在国内选举压力与维持联盟信誉之间重新计算援助成本的领导者',
        dilemma: '继续投入会遭遇国内反弹，减少投入会让盟友质疑美国承诺。',
        goals: ['维持北约信誉', '控制财政和选举成本', '避免直接与俄罗斯升级'],
        leverage: ['军援节奏', '金融制裁', '北约协调权'],
        actions: ['要求国务院和五角大楼提出低成本维持威慑的援助组合'],
      }),
      makeAgent(4, {
        id: 'agent-nato',
        name: '北约秘书长',
        role: '联盟协调者',
        identity: '把分散成员国的安全焦虑转换成可执行军事部署的协调人物',
        dilemma: '东翼国家要求前推部署，西欧国家担心升级和财政承压。',
        goals: ['维持联盟一致', '强化东翼威慑', '避免误判升级'],
        leverage: ['联盟会议议程', '联合演训', '防务承诺'],
        actions: ['推动东翼轮换驻军方案，同时避免宣布永久性越线部署'],
      }),
    ];
  }

  if (/ai治理|人工智能|科技公司|大型科技|欧盟|开源ai|模型阵营|ai governance|artificial intelligence|tech company|open source ai|model bloc/i.test(input)) {
    return [
      makeAgent(0, {
        id: 'agent-us-executive',
        name: '美国总统',
        role: '美国行政决策者',
        identity: '在国家安全、产业优势与开放创新之间重设 AI 政策边界的领导者',
        dilemma: '严格管制能降低安全风险，但可能削弱本国科技公司的全球扩张。',
        goals: ['保持技术领先', '压低安全事故', '协调盟友标准'],
        leverage: ['出口管制', '行政令', '政府采购'],
        actions: ['召集科技公司和安全部门制定高算力模型许可制度'],
      }),
      makeAgent(1, {
        id: 'agent-china-regulator',
        name: '中国监管层',
        role: '中国 AI 治理与产业协调者',
        identity: '在自主可控、产业落地和社会风险之间寻找制度节奏的政策主体',
        dilemma: '开放太慢会落后，开放太快会带来安全与舆论治理压力。',
        goals: ['建立自主生态', '稳定产业预期', '控制模型风险'],
        leverage: ['牌照制度', '算力调度', '产业政策'],
        actions: ['要求头部企业提交跨境模型调用和算力来源清单'],
      }),
      makeAgent(2, {
        id: 'agent-eu-commission',
        name: '欧盟委员会主席',
        role: '欧盟监管协调者',
        identity: '试图把欧盟标准变成全球 AI 合规底座的政治人物',
        dilemma: '标准越严格越有规则影响力，但也可能迫使企业把欧洲市场边缘化。',
        goals: ['输出合规标准', '保护公民权利', '保持产业参与度'],
        leverage: ['AI 法案', '市场准入', '罚款权'],
        actions: ['推动成员国建立统一模型审计入口，要求企业公开高风险用途'],
      }),
      makeAgent(3, {
        id: 'agent-tech-ceo',
        name: '大型科技公司 CEO',
        role: '跨国 AI 平台经营者',
        identity: '在监管阵营分裂后必须决定产品、模型和云基础设施如何分区运营的企业领袖',
        dilemma: '顺从各地监管会推高成本，坚持统一产品又可能失去市场准入。',
        goals: ['保住全球市场', '降低合规成本', '维持模型迭代速度'],
        leverage: ['模型能力', '云平台生态', '开发者网络'],
        actions: ['宣布把模型版本按监管区域拆分，并私下游说互认审计标准'],
      }),
      makeAgent(4, {
        id: 'agent-open-source',
        name: '开源 AI 社区代表',
        role: '开放模型生态的组织者',
        identity: '维护开放研究与开发者自由，同时面对滥用风险和监管收紧的压力',
        dilemma: '完全开放会引来管制，主动设限又会分裂社区信任。',
        goals: ['保住开放生态', '降低滥用风险', '争取公共研究空间'],
        leverage: ['开发者动员', '模型复现能力', '公共舆论'],
        actions: ['发布社区安全许可草案，要求大型平台不要把开源生态排除在标准制定外'],
      }),
    ];
  }

  return null;
}

function viabilityForActors(actors: AgentProfile[], source: WorldSeed['source']): WorldSeedViability {
  const actionableActors = actors.filter(
    (actor) =>
      actor.name.trim() &&
      actor.goals.length &&
      actor.constraints.length &&
      actor.leverage.length &&
      (actor.actions?.length || actor.dilemma || actor.currentPressure),
  );
  const relationCount = actors.reduce((sum, actor) => sum + (actor.relationships?.length ?? 0), 0);
  const score = clampConfidence(
    0.18 +
      Math.min(actionableActors.length, 5) * 0.12 +
      Math.min(relationCount, 6) * 0.035 +
      (source === 'known_source' ? 0.16 : source === 'user_grounded' ? 0.08 : 0),
  );
  const missing: string[] = [];
  if (actionableActors.length < 3) missing.push('至少 3 个可行动人物或稳定势力');
  if (relationCount < 2) missing.push('至少 2 条人物关系或冲突关系');
  if (!actors.some((actor) => actor.actions?.length)) missing.push('至少 1 个明确可执行行动');

  return {
    canSimulate: actionableActors.length >= 3 && relationCount >= 2 && score >= 0.45,
    score,
    reasons: actionableActors.length
      ? [`识别到 ${actionableActors.length} 个可行动人物`, `人物关系数量 ${relationCount}`]
      : ['没有识别到可行动人物'],
    missing,
  };
}

function inferSeedSource(input: string, actors: AgentProfile[]): WorldSeed['source'] {
  if (!actors.length) return 'insufficient';
  if (/原创|自创|一本|小说中|王国|北境|龙骑士|fantasy|novel/i.test(input)) return 'user_grounded';
  return 'known_source';
}

export function buildWorldSeed(input: string): WorldSeed {
  const actors = buildAgents(inferDomain(input), input);
  const source = inferSeedSource(input, actors);
  const viability = viabilityForActors(actors, source);
  return {
    eventText: input,
    domainLabel: inferDomain(input),
    actors: viability.canSimulate ? actors : [],
    source: viability.canSimulate ? source : 'insufficient',
    viability,
  };
}

function createInsufficientWorld(eventText: string, horizon: HorizonMode, seed: WorldSeed): SimulationWorld {
  const missing = seed.viability.missing.length
    ? seed.viability.missing
    : ['更具体的人物、势力、关系、资料或原文设定'];
  return {
    title: 'AionCausa 事件沙盘',
    eventText,
    eventSummary: summarizeEventText(eventText),
    domain: '信息不足',
    centralQuestion: eventText,
    confidence: seed.viability.score,
    horizon,
    simulationPlan: {
      startLabel: '等待补充资料',
      endLabel: '暂不创建世界',
      durationLabel: horizonLabels[horizon],
      totalSteps: 0,
      stopReason: `当前输入不足以创建可观察世界。请补充：${missing.join('、')}。`,
    },
    eventAnalysis: {
      facts: [eventText],
      assumptions: [],
      causes: ['系统无法确认足够具体的行动主体与冲突关系'],
      openQuestions: missing,
    },
    graphMemory: [],
    evidence: [
      {
        id: 'ev-user',
        claim: eventText,
        source: 'user_input',
        confidence: 0.9,
        usedIn: ['event'],
      },
      {
        id: 'ev-viability',
        claim: `可模拟性不足：${missing.join('、')}`,
        source: 'system_inference',
        confidence: seed.viability.score,
        usedIn: ['viability'],
      },
    ],
    agents: [],
    actionLogs: [],
    premises: [
      {
        id: 'premise-root',
        label: eventText,
        plausibility: seed.viability.score,
        impact: 0.4,
      },
    ],
    branches: [],
    timeline: [],
    metrics: [
      {
        id: 'metric-viability',
        label: '可模拟性',
        value: `${Math.round(seed.viability.score * 100)}%`,
        delta: '需补充',
        tone: 'speculative',
      },
    ],
  };
}

function buildAgents(domain: string, input: string): AgentProfile[] {
  if (domain === '历史政治' && /商鞅|秦国|变法/.test(input)) {
    return [
      {
        id: 'agent-reformer',
        name: '商鞅',
        role: '秦国变法主导者',
        identity: '以法令、县制和军功爵推动秦国国家能力重组的政治人物',
        dilemma: '必须证明继续掌权不会威胁新君权威，同时又不能让旧制反扑瓦解新法。',
        currentPressure: '秦孝公去世后，旧怨与新君疑惧同时压向他。',
        goals: ['延续核心制度', '扩大执行权', '压低旧利益集团反弹'],
        constraints: ['君主信任不稳定', '制度触碰既得利益'],
        leverage: ['法令体系', '基层治理网络', '改革成果'],
        actions: ['向嬴驷提出保留新法、交出部分人事权的折中方案'],
        relationships: ['与嬴驷互相需要但彼此戒备', '曾与公子虔结下深怨'],
        riskTolerance: 0.72,
        confidence: 0.74,
      },
      {
        id: 'agent-ruler',
        name: '嬴驷',
        role: '秦惠文王，新继位的秦国君主',
        identity: '继承秦孝公改革成果、同时需要重建个人权威的新君',
        dilemma: '杀商鞅可以安抚旧贵族，但保留商鞅又能继续利用新法增强秦国。',
        currentPressure: '继位合法性、宗室压力与秦国扩张需求同时摆在眼前。',
        goals: ['巩固权威', '保留国家能力', '避免内部分裂'],
        constraints: ['继位合法性', '贵族压力', '外部战争'],
        leverage: ['任免权', '军队授权', '政治裁决'],
        actions: ['召见商鞅与旧臣分开听取处置方案'],
        relationships: ['需要商鞅的制度成果', '也必须回应公子虔等宗室的怨气'],
        riskTolerance: 0.54,
        confidence: 0.7,
      },
      {
        id: 'agent-elite',
        name: '公子虔',
        role: '秦国宗室旧贵族代表',
        identity: '曾因太子犯法被商鞅处罚而受辱的宗室人物',
        dilemma: '若公开反扑可能损害秦国新政收益，若沉默则宗室旧权继续流失。',
        currentPressure: '商鞅若幸存，他必须重新选择报复、妥协或借新君制衡。',
        goals: ['恢复特权', '限制改革派', '保护宗族利益'],
        constraints: ['国家能力已依赖新制度', '军功阶层上升'],
        leverage: ['朝堂关系', '社会声望', '暗中阻挠'],
        actions: ['联合旧臣向嬴驷施压，要求削去商鞅兵权与封地'],
        relationships: ['与商鞅有旧怨', '试图影响嬴驷继位初期的判断'],
        riskTolerance: 0.63,
        confidence: 0.69,
      },
      {
        id: 'agent-rivals',
        name: '魏惠王',
        role: '关注秦国内部震荡的魏国君主',
        identity: '在秦魏竞争中寻找反制秦国扩张窗口的外部权力者',
        dilemma: '秦国内乱越深，魏国机会越大；但误判秦国稳定性会付出军事代价。',
        currentPressure: '秦国若保留商鞅新法，魏国西部压力将继续加重。',
        goals: ['延缓对手集权', '寻找军事或外交窗口'],
        constraints: ['自身联盟脆弱', '信息滞后'],
        leverage: ['外交牵制', '军事压力', '舆论离间'],
        actions: ['派人探查咸阳争斗，并试探是否能拉拢秦国失势旧臣'],
        relationships: ['把嬴驷的继位危机视作魏国缓冲机会'],
        riskTolerance: 0.58,
        confidence: 0.62,
      },
      {
        id: 'agent-minister',
        name: '甘龙',
        role: '保守旧臣',
        identity: '反对急进变法、主张恢复旧礼旧制的秦国老臣',
        dilemma: '他想削弱商鞅，却不能让秦国因废法而重新变弱。',
        currentPressure: '新君需要政治支持，甘龙必须把旧臣诉求包装成稳定方案。',
        goals: ['限制商鞅权力', '恢复旧臣影响', '避免秦国政局失控'],
        constraints: ['新法已带来军政收益', '嬴驷不愿放弃国家能力'],
        leverage: ['旧臣网络', '礼制话语', '宗室同情'],
        actions: ['劝嬴驷保留法令但审判商鞅个人专权'],
        relationships: ['与公子虔形成短期同盟', '与商鞅在制度理念上冲突'],
        riskTolerance: 0.58,
        confidence: 0.62,
      },
    ];
  }

  return buildRecognizedScenarioAgents(input) ?? [];
}

function buildPremises(input: string): PremiseNode[] {
  return [
    {
      id: 'premise-root',
      label: input.trim() || '示例事件成立',
      plausibility: 0.78,
      impact: 0.86,
    },
    {
      id: 'premise-survival',
      label: '改变点需要一个可解释的前置条件',
      parentId: 'premise-root',
      plausibility: 0.64,
      impact: 0.78,
    },
    {
      id: 'premise-balance',
      label: '关键权力方选择保留收益而非彻底清算',
      parentId: 'premise-survival',
      plausibility: 0.58,
      impact: 0.72,
    },
    {
      id: 'premise-resistance',
      label: '受损集团不会消失，只会改变反制方式',
      parentId: 'premise-root',
      plausibility: 0.74,
      impact: 0.68,
    },
  ];
}

function buildBranches(horizon: HorizonMode, evidenceCount: number): SimulationBranch[] {
  const base = [
    {
      id: 'branch-a',
      title: '制度深化线',
      divergence: 0.22,
      trigger: '最高决策者继续借助改革派压制旧结构。',
      summary: '核心制度更早稳定，国家动员能力上升，但政治斗争变得更集中。',
      causalChain: ['改变点成立', '改革派保留执行权', '旧集团被迫转入低烈度抵抗', '中央集权提前固化'],
      tone: 'stable' as const,
    },
    {
      id: 'branch-b',
      title: '有限妥协线',
      divergence: 0.36,
      trigger: '改革人物保全生命，但被降权或转为制度顾问。',
      summary: '制度成果保留，人物影响下降，世界线与原历史偏离有限。',
      causalChain: ['改变点成立', '政治清算被软化', '制度保留但执行降温', '新旧集团形成再平衡'],
      tone: 'volatile' as const,
    },
    {
      id: 'branch-c',
      title: '反扑震荡线',
      divergence: 0.51,
      trigger: '旧利益集团认为改革派继续存在会威胁生存。',
      summary: '冲突升级，短期国家能力受损，但也可能逼出更强硬的权力整合。',
      causalChain: ['改变点成立', '旧集团加速结盟', '决策者面临站队压力', '内部震荡改变扩张节奏'],
      tone: 'speculative' as const,
    },
  ];

  return base.map((branch, index) => ({
    ...branch,
    horizon,
    credibility: calculateCredibility({
      evidenceCount,
      inferenceCount: index + 2,
      horizon,
      branchDivergence: branch.divergence,
    }),
    metrics: [
      {
        id: `${branch.id}-order`,
        label: '秩序稳定',
        value: index === 0 ? '高' : index === 1 ? '中' : '低',
        delta: index === 0 ? '+18%' : index === 1 ? '+4%' : '-16%',
        tone: branch.tone,
      },
      {
        id: `${branch.id}-agency`,
        label: '制度延续',
        value: index === 0 ? '强' : index === 1 ? '中强' : '不稳',
        delta: index === 2 ? '-11%' : '+12%',
        tone: branch.tone,
      },
    ],
  }));
}

function buildTimeline(horizon: HorizonMode): TimelinePoint[] {
  const suffix = horizon === 'short' ? ['第 1 年', '第 3 年', '第 5 年'] : ['初期', '中段', '远期'];
  const confidenceBase = horizonDecay[horizon];
  return [
    {
      year: suffix[0],
      original: '改变点未发生，原有权力结构按既定路径收束。',
      branch: '改变点成立，关键人物或组织获得继续影响事件的窗口。',
      confidence: clampConfidence(confidenceBase * 0.86),
    },
    {
      year: suffix[1],
      original: '制度与利益集团形成原始平衡。',
      branch: '多方围绕新平衡展开妥协、反制或升级冲突。',
      confidence: clampConfidence(confidenceBase * 0.66),
    },
    {
      year: suffix[2],
      original: '后续事件逐渐远离初始冲击。',
      branch: '初始改变被制度化、稀释，或引发二阶连锁反应。',
      confidence: clampConfidence(confidenceBase * 0.48),
    },
  ];
}

function buildMetrics(horizon: HorizonMode): WorldMetric[] {
  return [
    {
      id: 'metric-confidence',
      label: '总体置信度',
      value: `${Math.round(horizonDecay[horizon] * 76)}%`,
      delta: horizon === 'mythic' ? '-41%' : horizon === 'generational' ? '-24%' : '+6%',
      tone: horizon === 'short' ? 'stable' : horizon === 'strategic' ? 'volatile' : 'speculative',
    },
    {
      id: 'metric-branches',
      label: '分支压力',
      value: horizon === 'short' ? '低' : horizon === 'strategic' ? '中' : '高',
      delta: horizon === 'short' ? '+3' : '+9',
      tone: horizon === 'short' ? 'stable' : 'volatile',
    },
    {
      id: 'metric-evidence',
      label: '证据覆盖',
      value: '4 类',
      delta: '可扩展',
      tone: 'stable',
    },
  ];
}

function buildActionLogs(agents: AgentProfile[], branches: SimulationBranch[]): AgentActionLog[] {
  const withStructuredFields = (log: AgentActionLog): AgentActionLog => ({
    ...log,
    initiatorActorId: log.initiatorActorId ?? log.agentId,
    targetActorIds: log.targetActorIds ?? [],
    responderActorIds: log.responderActorIds ?? [],
    affectedActorIds: log.affectedActorIds ?? [],
    actionText: log.actionText ?? log.detail ?? log.action,
    responseText: log.responseText ?? '',
    effectText: log.effectText ?? log.impact,
  });

  return agents.map((agent, index) => {
    const target = agents[(index + 1) % agents.length];
    const responder = agents[(index + 2) % agents.length];
    const affected = agents[(index + 3) % agents.length];
    const action = agent.actions?.[0] || agent.goals[0] || '采取试探行动';
    const response = `${responder.name}先守住自身底线，再判断是否借此影响${target.name}。`;
    const effect = `${affected.name}会把这次行动视为局势信号，重新评估站队成本。`;
    return {
      id: `local-act-${index + 1}`,
      step: index % 4,
      timeLabel: `观察阶段 ${index + 1}`,
      agentId: agent.id,
      agentName: agent.name,
      initiatorActorId: agent.id,
      targetActorIds: target ? [target.id] : [],
      responderActorIds: responder ? [responder.id] : [],
      affectedActorIds: affected ? [affected.id] : [],
      action,
      detail: action,
      impact: effect,
      actionText: action,
      responseText: response,
      effectText: effect,
      branchId: branches[index % Math.max(branches.length, 1)]?.id,
      confidence: agent.confidence,
    };
  }).map(withStructuredFields);
}

export function createSimulationWorld(eventText: string, horizon: HorizonMode): SimulationWorld {
  const cleanInput =
    eventText.trim() || '如果商鞅变法之后，商鞅没有被杀，秦国会如何发展？';
  const seed = buildWorldSeed(cleanInput);
  if (!seed.viability.canSimulate) {
    return createInsufficientWorld(cleanInput, horizon, seed);
  }
  const domain = seed.domainLabel;
  const evidence = buildEvidence(cleanInput);
  const branches = buildBranches(horizon, evidence.length);
  const agents = seed.actors;
  const confidence = clampConfidence(
    (branches.reduce((sum, branch) => sum + branch.credibility, 0) / branches.length) * 0.72 + seed.viability.score * 0.28,
  );

  return {
    title: 'AionCausa 事件沙盘',
    eventText: cleanInput,
    eventSummary: summarizeEventText(cleanInput),
    domain,
    centralQuestion: cleanInput.includes('？') || cleanInput.includes('?') ? cleanInput : `围绕「${cleanInput}」的后续影响是什么？`,
    confidence,
    horizon,
    simulationPlan: {
      startLabel: '事件改变点',
      endLabel: '战略后果稳定',
      durationLabel: horizonLabels[horizon],
      totalSteps: 4,
      stopReason: `统一世界种子已识别 ${agents.length} 个可行动人物；真实生成时由 LLM 判断停止时间。`,
    },
    eventAnalysis: {
      facts: [cleanInput],
      assumptions: ['改变点成立'],
      causes: ['既有权力结构受到扰动'],
      openQuestions: ['关键人物将如何选择'],
    },
    graphMemory: [],
    evidence,
    agents,
    actionLogs: buildActionLogs(agents, branches),
    premises: buildPremises(cleanInput),
    branches,
    timeline: buildTimeline(horizon),
    metrics: buildMetrics(horizon),
  };
}

export function createDraftWorld(eventText: string, horizon: HorizonMode): SimulationWorld {
  const cleanInput =
    eventText.trim() || '请输入一个事件，生成因时沙盘。';

  return {
    title: 'AionCausa 事件沙盘',
    eventText: cleanInput,
    eventSummary: summarizeEventText(cleanInput),
    domain: inferDomain(cleanInput),
    centralQuestion: cleanInput,
    confidence: 0,
    horizon,
    simulationPlan: {
      startLabel: '中心事件',
      endLabel: '等待 LLM 判断',
      durationLabel: '由 LLM 自动决定',
      totalSteps: 4,
      stopReason: '生成后由模型给出最佳模拟跨度和停止理由。',
    },
    eventAnalysis: {
      facts: [cleanInput],
      assumptions: [],
      causes: [],
      openQuestions: [],
    },
    graphMemory: [
      {
        id: 'mem-event',
        label: '中心事件',
        type: 'event',
        summary: cleanInput,
        confidence: 0.9,
        links: [],
      },
    ],
    evidence: [
      {
        id: 'ev-user',
        claim: cleanInput,
        source: 'user_input',
        confidence: 0.9,
        usedIn: ['event'],
      },
    ],
    agents: [],
    actionLogs: [],
    premises: [
      {
        id: 'premise-root',
        label: cleanInput,
        plausibility: 0.7,
        impact: 0.7,
      },
    ],
    branches: [],
    timeline: [],
    metrics: [
      {
        id: 'metric-status',
        label: '沙盘状态',
        value: '待生成',
        delta: 'LLM',
        tone: 'volatile',
      },
    ],
  };
}
