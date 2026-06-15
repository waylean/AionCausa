import { describe, expect, it } from 'vitest';
import { sanitizeInterviewAnswer } from './interview';

describe('interview service', () => {
  it('returns actual character interview content', () => {
    expect(sanitizeInterviewAnswer('我不会把底牌交给公子虔。', 'Provider 请求成功')).toBe('我不会把底牌交给公子虔。');
  });

  it('does not treat provider success status as an interview answer', () => {
    expect(sanitizeInterviewAnswer('', 'Provider 请求成功')).toBe('模型没有返回采访内容，请换一个问题重试。');
    expect(sanitizeInterviewAnswer('AionCausa provider check ok.', '')).toBe('模型没有返回采访内容，请换一个问题重试。');
  });

  it('removes observer disclaimers and internal labels from interview answers', () => {
    const answer = sanitizeInterviewAnswer(
      '商鞅：我不会按旁观者的说法回答，我只能从自己看见的压力里判断。个人谋划：在嬴驷面前提出交权保法。',
      '',
    );

    expect(answer).toBe('在嬴驷面前提出交权保法。');
  });

  it('keeps answers conversational instead of prefixed by the actor name', () => {
    expect(sanitizeInterviewAnswer('商鞅：我会先保住新法，再谈自己的去留。', '')).toBe('我会先保住新法，再谈自己的去留。');
  });

  it('cuts dangling incomplete endings back to the last complete sentence', () => {
    expect(sanitizeInterviewAnswer('我想活下去。公子虔已经动手，下一步他会动我的', '')).toBe('我想活下去。');
  });

  it('uses a meaningful error message when content is empty', () => {
    expect(sanitizeInterviewAnswer('', '模型没有返回采访内容，请换一个问题重试。')).toBe('模型没有返回采访内容，请换一个问题重试。');
  });
});
