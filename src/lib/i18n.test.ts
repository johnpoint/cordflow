import { describe, expect, it } from 'vitest';
import { detectLocale, translate } from './i18n';

describe('i18n', () => {
  it('prefers a supported stored locale', () => {
    expect(detectLocale('en', ['zh-CN'])).toBe('en');
    expect(detectLocale('zh-CN', ['en-US'])).toBe('zh-CN');
  });

  it('detects Chinese and falls back to English for unknown languages', () => {
    expect(detectLocale(null, ['zh-Hans-CN', 'en'])).toBe('zh-CN');
    expect(detectLocale(null, ['fr-FR', 'de'])).toBe('en');
  });

  it('interpolates translated values', () => {
    expect(translate('en', 'nodesCount', { count: 4 })).toBe('4 nodes');
    expect(translate('zh-CN', 'nodesCount', { count: 4 })).toBe('4 个节点');
  });
});
