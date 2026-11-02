import { getReferenceFilePatterns, normalizeSettings } from '../src/settings';
import { BaseSettings } from '../src/types';
import { defaultSettings } from './data/defaultSettings';

describe('getReferenceFilePatterns', () => {
  it('accepts a path and normalizes separators', () => {
    expect(getReferenceFilePatterns(' features\\**\\*.feature ')).toEqual(['features/**/*.feature']);
  });

  it('ignores malformed, absolute, and parent-directory paths', () => {
    for (const value of [undefined, null, true, false, 42, [], '', ' ', '/absolute/*.feature', 'C:\\outside\\*.feature',
      '../outside/*.feature', 'features/../outside/*.feature', '{../outside,features}/*.feature']) {
      expect(getReferenceFilePatterns(value)).toEqual([]);
    }
  });
});

describe('normalizeSettings', () => {
  it('normalizes a single step path', () => {
    const settings: BaseSettings = {
      ...defaultSettings,
      steps: 'steps/**/*.js',
    };

    expect(normalizeSettings(settings)).toStrictEqual({
      ...settings,
      steps: ['steps/**/*.js'],
    });
  });

  it('preserves an array of step paths', () => {
    const settings: BaseSettings = {
      ...defaultSettings,
      steps: ['steps/**/*.js', 'more-steps/**/*.js'],
    };

    expect(normalizeSettings(settings)).toStrictEqual(settings);
  });

  it.each([undefined, null, 42, {}, [], '', '   '])(
    'uses no step paths for malformed value %p',
    (steps) => {
      const settings = {
        ...defaultSettings,
        steps: steps as unknown as BaseSettings['steps'],
      };

      expect(normalizeSettings(settings)).toStrictEqual({
        ...settings,
        steps: [],
      });
    }
  );

  it('keeps only non-empty string paths from an array', () => {
    const settings = {
      ...defaultSettings,
      steps: ['steps/**/*.js', 42, null, {}, '', '   '] as unknown as BaseSettings['steps'],
    };

    expect(normalizeSettings(settings)).toStrictEqual({
      ...settings,
      steps: ['steps/**/*.js'],
    });
  });

  it.each([undefined, null, 42, []])(
    'uses a stable empty configuration for malformed settings object %p',
    (settings) => {
      expect(normalizeSettings(settings as unknown as BaseSettings)).toStrictEqual({ steps: [] });
    }
  );
});
