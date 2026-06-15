import type { RuntimeWorld, SimulationWorld } from '../domain/types';
import type { ProviderConfig } from './providers';

interface WorldSummaryApiResponse {
  ok?: boolean;
  content?: string;
  message?: string;
  latencyMs?: number;
}

export interface WorldSummaryResult {
  ok: boolean;
  summary: string;
  message: string;
  latencyMs?: number;
}

function cleanSummaryText(value: string) {
  return value
    .replace(/^[\s"'“”‘’]*(?:总结|世界总结|当前世界总结)[：:]\s*/u, '')
    .replace(/([。！？；;，,])\1+/gu, '$1')
    .replace(/；。/gu, '。')
    .replace(/。；/gu, '。')
    .replace(/\s+/gu, ' ')
    .trim();
}

export async function requestWorldSummary(options: {
  provider: ProviderConfig;
  runtimeWorld: RuntimeWorld;
  world: SimulationWorld;
}): Promise<WorldSummaryResult> {
  if (!options.provider.apiKey.trim()) {
    return { ok: false, summary: '', message: '未配置 API Key，使用本地总结。' };
  }

  const response = await fetch('/api/world-summary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  });
  const payload = (await response.json()) as WorldSummaryApiResponse;
  const summary = cleanSummaryText(String(payload.content || ''));
  return {
    ok: response.ok && Boolean(payload.ok) && Boolean(summary),
    summary,
    message: payload.message || (response.ok ? '世界总结已刷新。' : '世界总结刷新失败。'),
    latencyMs: payload.latencyMs,
  };
}
