import { describe, expect, it } from 'vitest';
import {
  applyPreset,
  buildAnthropicCompatibleRequest,
  buildOpenAICompatibleRequest,
  defaultProviderConfig,
  normalizeBaseUrl,
  providerPresets,
  resolveAnthropicMessagesUrl,
} from './providers';

describe('provider configuration', () => {
  it('normalizes trailing slashes', () => {
    expect(normalizeBaseUrl('https://token-plan-cn.xiaomimimo.com/v1///')).toBe(
      'https://token-plan-cn.xiaomimimo.com/v1',
    );
  });

  it('builds OpenAI-compatible chat completion requests', () => {
    const request = buildOpenAICompatibleRequest(
      { ...defaultProviderConfig, apiKey: 'secret', model: 'test-model' },
      'hello',
    );
    expect(request.url).toBe('https://token-plan-cn.xiaomimimo.com/v1/chat/completions');
    expect(request.init.headers.Authorization).toBe('Bearer secret');
    expect(JSON.parse(request.init.body).model).toBe('test-model');
  });

  it('builds Anthropic-compatible message requests', () => {
    const config = applyPreset(defaultProviderConfig, 'mimo-anthropic');
    const request = buildAnthropicCompatibleRequest({ ...config, apiKey: 'secret' }, 'hello');
    expect(request.url).toBe('https://token-plan-cn.xiaomimimo.com/anthropic/v1/messages');
    expect(request.init.headers['anthropic-version']).toBe('2023-06-01');
  });

  it('keeps standard Anthropic base URL behavior', () => {
    expect(resolveAnthropicMessagesUrl('https://api.anthropic.com/v1')).toBe('https://api.anthropic.com/v1/messages');
  });

  it('includes mainstream OpenAI-compatible provider presets', () => {
    expect(providerPresets.map((preset) => preset.id)).toEqual(
      expect.arrayContaining(['openai', 'mimo-openai', 'gemini-openai', 'kimi', 'zhipu', 'minimax']),
    );
  });

  it('applies provider-specific JSON mode compatibility flags', () => {
    const gemini = applyPreset(defaultProviderConfig, 'gemini-openai');
    const openai = applyPreset(defaultProviderConfig, 'openai');
    expect(gemini.supportsResponseFormat).toBe(false);
    expect(openai.supportsResponseFormat).toBe(true);
  });
});
