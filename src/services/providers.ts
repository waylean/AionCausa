export type ProviderProtocol = 'openai-compatible' | 'anthropic-compatible';

export interface ProviderPreset {
  id: string;
  name: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  defaultModel: string;
  supportsResponseFormat?: boolean;
}

export interface ProviderConfig {
  presetId: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  supportsResponseFormat?: boolean;
}

export interface ProviderTestResult {
  ok: boolean;
  message: string;
  latencyMs?: number;
}

export const providerPresets: ProviderPreset[] = [
  {
    id: 'mimo-openai',
    name: 'Xiaomi Mimo OpenAI',
    protocol: 'openai-compatible',
    baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
    defaultModel: 'mimo-v2.5-pro',
    supportsResponseFormat: true,
  },
  {
    id: 'openai',
    name: 'OpenAI / GPT',
    protocol: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    supportsResponseFormat: true,
  },
  {
    id: 'gemini-openai',
    name: 'Google Gemini OpenAI-compatible',
    protocol: 'openai-compatible',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.5-flash',
    supportsResponseFormat: false,
  },
  {
    id: 'kimi',
    name: 'Kimi / Moonshot',
    protocol: 'openai-compatible',
    baseUrl: 'https://api.moonshot.ai/v1',
    defaultModel: 'kimi-k2.6',
    supportsResponseFormat: false,
  },
  {
    id: 'zhipu',
    name: 'Zhipu GLM',
    protocol: 'openai-compatible',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-flash',
    supportsResponseFormat: false,
  },
  {
    id: 'minimax',
    name: 'MiniMax OpenAI-compatible',
    protocol: 'openai-compatible',
    baseUrl: 'https://api.minimax.io/v1',
    defaultModel: 'MiniMax-M2.5',
    supportsResponseFormat: false,
  },
  {
    id: 'mimo-anthropic',
    name: 'Xiaomi Mimo Anthropic',
    protocol: 'anthropic-compatible',
    baseUrl: 'https://token-plan-cn.xiaomimimo.com/anthropic',
    defaultModel: 'mimo-v2.5-pro',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    protocol: 'anthropic-compatible',
    baseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-3-5-sonnet-latest',
  },
  {
    id: 'custom-openai',
    name: 'Custom OpenAI-compatible',
    protocol: 'openai-compatible',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: 'llama3.1',
    supportsResponseFormat: false,
  },
];

export const defaultProviderConfig: ProviderConfig = {
  presetId: providerPresets[0].id,
  protocol: providerPresets[0].protocol,
  baseUrl: providerPresets[0].baseUrl,
  apiKey: '',
  model: providerPresets[0].defaultModel,
  temperature: 0.3,
  maxTokens: 900,
  supportsResponseFormat: providerPresets[0].supportsResponseFormat,
};

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

export function resolveAnthropicMessagesUrl(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl);
  return normalized.endsWith('/anthropic') ? `${normalized}/v1/messages` : `${normalized}/messages`;
}

export function applyPreset(current: ProviderConfig, presetId: string): ProviderConfig {
  const preset = providerPresets.find((item) => item.id === presetId);
  if (!preset) return current;
  return {
    ...current,
    presetId: preset.id,
    protocol: preset.protocol,
    baseUrl: preset.baseUrl,
    model: preset.defaultModel,
    supportsResponseFormat: preset.supportsResponseFormat,
  };
}

export function buildOpenAICompatibleRequest(config: ProviderConfig, prompt: string) {
  return {
    url: `${normalizeBaseUrl(config.baseUrl)}/chat/completions`,
    init: {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        temperature: config.temperature,
        max_tokens: config.maxTokens,
        messages: [
          {
            role: 'system',
            content: 'You are AionCausa, an event-world simulation engine. Return concise structured reasoning.',
          },
          { role: 'user', content: prompt },
        ],
      }),
    },
  };
}

export function buildAnthropicCompatibleRequest(config: ProviderConfig, prompt: string) {
  return {
    url: resolveAnthropicMessagesUrl(config.baseUrl),
    init: {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: config.model,
        temperature: config.temperature,
        max_tokens: config.maxTokens,
        messages: [{ role: 'user', content: prompt }],
      }),
    },
  };
}

export async function testProviderConnection(config: ProviderConfig): Promise<ProviderTestResult> {
  if (!config.apiKey.trim()) {
    return { ok: false, message: 'API Key 为空' };
  }
  if (!config.baseUrl.trim() || !config.model.trim()) {
    return { ok: false, message: 'Base URL 或模型名为空' };
  }

  try {
    const response = await fetch('/api/provider-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    const payload = (await response.json()) as ProviderTestResult;
    if (!response.ok) {
      return {
        ok: false,
        message: payload.message || `连接失败 ${response.status}`,
        latencyMs: payload.latencyMs,
      };
    }
    return payload;
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? `${error.message}。可改用 npm run test:provider 做本地 CLI 测试。` : '未知连接错误',
    };
  }
}
