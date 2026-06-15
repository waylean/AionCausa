import type {
  AgentProfile,
  RuntimeActorContext,
  RuntimeActorLedger,
  RuntimeConfrontationScene,
  RuntimeObservationFlowFrame,
  RuntimeWorld,
  SimulationWorld,
} from '../domain/types';
import type { ProviderConfig } from './providers';

interface InterviewApiResponse {
  ok?: boolean;
  content?: string;
  message?: string;
  latencyMs?: number;
}

export interface AgentInterviewResult {
  ok: boolean;
  answer: string;
  latencyMs?: number;
}

const providerStatusPatterns = [/^provider\s*请求成功$/i, /^aioncausa provider check ok\.?$/i, /^请求成功$/i];

export function polishInterviewAnswer(value: string) {
  const cleaned = value
    .replace(/^[\s"'“”‘’]*(?:[\u4e00-\u9fa5A-Za-z0-9·]{1,12})[：:]\s*/u, '')
    .replace(/我不会按旁观者的说法回答[，,。；;]?\s*我只能从自己看见的压力里判断[。；;]?\s*/gu, '')
    .replace(/(?:个人谋划|当前压力|可见世界|携带记忆|行动记录|观察流|人物行动)[：:]\s*/gu, '')
    .replace(/([。！？])\1+/gu, '$1')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!cleaned || /[。！？.!?]$/u.test(cleaned)) return cleaned;
  const lastStop = Math.max(cleaned.lastIndexOf('。'), cleaned.lastIndexOf('！'), cleaned.lastIndexOf('？'), cleaned.lastIndexOf(';'), cleaned.lastIndexOf('；'));
  return lastStop >= 0 ? cleaned.slice(0, lastStop + 1) : `${cleaned}。`;
}

export function sanitizeInterviewAnswer(content?: string, message?: string) {
  const answer = String(content || '').trim();
  if (answer && !providerStatusPatterns.some((pattern) => pattern.test(answer))) return polishInterviewAnswer(answer);

  const fallback = String(message || '').trim();
  if (fallback && !providerStatusPatterns.some((pattern) => pattern.test(fallback))) return polishInterviewAnswer(fallback);

  return '模型没有返回采访内容，请换一个问题重试。';
}

export async function requestAgentInterview(options: {
  actorContext?: RuntimeActorContext;
  actorLedger?: RuntimeActorLedger;
  agent: AgentProfile;
  confrontationScenes: RuntimeConfrontationScene[];
  observationFlow: RuntimeObservationFlowFrame[];
  provider: ProviderConfig;
  question: string;
  runtimeWorld: RuntimeWorld;
  world: SimulationWorld;
}): Promise<AgentInterviewResult> {
  const response = await fetch('/api/interview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  });
  const payload = (await response.json()) as InterviewApiResponse;
  const answer = sanitizeInterviewAnswer(payload.content, payload.message);
  return {
    ok: response.ok && Boolean(payload.ok) && answer !== '模型没有返回采访内容，请换一个问题重试。',
    answer,
    latencyMs: payload.latencyMs,
  };
}
