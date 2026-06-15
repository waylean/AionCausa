import process from 'node:process';
import { performance } from 'node:perf_hooks';

const protocol = process.env.AIONCAUSA_PROTOCOL || 'openai-compatible';
const baseUrl = (process.env.AIONCAUSA_BASE_URL || '').replace(/\/+$/, '');
const apiKey = process.env.AIONCAUSA_API_KEY || '';
const model = process.env.AIONCAUSA_MODEL || '';
const anthropicMessagesUrl = baseUrl.endsWith('/anthropic') ? `${baseUrl}/v1/messages` : `${baseUrl}/messages`;

if (!baseUrl || !apiKey || !model) {
  console.error('Missing env: AIONCAUSA_BASE_URL, AIONCAUSA_API_KEY, AIONCAUSA_MODEL');
  process.exit(1);
}

const startedAt = performance.now();

const request =
  protocol === 'anthropic-compatible'
    ? {
        url: anthropicMessagesUrl,
        init: {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model,
            max_tokens: 80,
            temperature: 0.2,
            messages: [{ role: 'user', content: '请只用一句话回复：AionCausa provider check ok。' }],
          }),
        },
      }
    : {
        url: `${baseUrl}/chat/completions`,
        init: {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            max_tokens: 80,
            temperature: 0.2,
            messages: [{ role: 'user', content: '请只用一句话回复：AionCausa provider check ok。' }],
          }),
        },
      };

const response = await fetch(request.url, request.init);
const latencyMs = Math.round(performance.now() - startedAt);
const text = await response.text();

if (!response.ok) {
  console.error(`Provider check failed: ${response.status} ${response.statusText} (${latencyMs}ms)`);
  console.error(text.slice(0, 500));
  process.exit(1);
}

console.log(`Provider check ok (${latencyMs}ms)`);
console.log(text.slice(0, 500));
