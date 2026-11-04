import StepsHandler from '../src/steps.handler';
import { getParameterRanges, parameterExpression, ParameterGroup } from '../src/parameter.tokens';
import { defaultSettings } from './data/defaultSettings';
import { GherkinType } from '../src/gherkin';
import { Location, Position, Range } from 'vscode-languageserver';

function handlerFor(source: string, pureTextSteps = false) {
  const handler = new StepsHandler(__dirname, { ...defaultSettings, steps: [], featureFiles: '', pureTextSteps });
  const position = Position.create(0, 0);
  handler.elements = handler.getSteps(source, source, Location.create('file:///step', Range.create(position, position)), GherkinType.Given, {});
  return handler;
}

function highlighted(handler: StepsHandler, text: string) {
  const lines = text.split(/\r?\n/);
  return getParameterRanges(handler, text).map((range) => lines[range.line].slice(range.start, range.end));
}

describe('step parameter highlighting', () => {
  it('uses the preferred whole-step definition for parameter ranges', () => {
    const short = 'login level shall be {value:Integer}';
    const long = 'login level shall be {value:Integer} within {timeout:Float} seconds';
    for (const sources of [[short, long], [long, short]]) {
      const handler = handlerFor(sources[0]);
      handler.elements.push(...handlerFor(sources[1]).elements);
      expect(highlighted(handler, 'Then login level shall be 2 within 3 seconds'))
        .toEqual(['2', '3']);
      expect(highlighted(handler, 'Then login level shall be 2')).toEqual(['2']);
    }
  });

  it('extracts Python and Cucumber expression parameters from their actual positions', () => {
    const handler = handlerFor('OCA object {object:Name} of record {record:Range} is set to {int}');
    expect(highlighted(handler, '  Given OCA object Input_Analog_Gain of record 1..4 is set to 0'))
      .toEqual(['Input_Analog_Gain', '1..4', '0']);
  });

  it('handles repeated values, quoted parameters and regex capture groups', () => {
    expect(highlighted(handlerFor('set {word} to {word} and {string}'), 'Given set same to same and "hello"'))
      .toEqual(['same', 'same', '"hello"']);
    expect(highlighted(handlerFor('^set (\\d+) to \\1$'), 'Given set 12 to 12')).toEqual(['12']);
    expect(highlighted(handlerFor('^set {word} to (\\d+) and \\1$'), 'Given set foo to 12 and 12')).toEqual(['foo', '12']);
    expect(highlighted(handlerFor('^set ((\\d+))$'), 'Given set 12')).toEqual(['12']);
  });

  it('maps substituted outline values back to placeholders and uses the current scenario', () => {
    const handler = handlerFor('set {int} to {word}');
    const text = [
      'Scenario Outline: first', ' Given set <number> to <name>', ' Examples: values',
      ' | number | name |', ' | 12 | 😀 |',
      'Scenario Outline: second', ' Given set <number> to <name>', ' Examples: other',
      ' | number | name |', ' | 3 | three |',
    ].join('\r\n');
    expect(highlighted(handler, text)).toEqual(['<number>', '<name>', '<number>', '<name>']);
    expect(getParameterRanges(handler, text).every((range) => range.type === 'outlineParameter')).toBe(true);
  });

  it('separates placeholders from concrete text within matched parameters', () => {
    const handler = handlerFor('set {word} to {word}');
    const text = [
      'Scenario Outline: mixed', ' Given set prefix<name> to fixed', ' Examples:',
      ' | name |', ' | value |',
    ].join('\n');
    const groups: ParameterGroup[] = [];
    expect(getParameterRanges(handler, text, groups).map((range) => ({
      text: text.split('\n')[range.line].slice(range.start, range.end), type: range.type,
    }))).toEqual([
      { text: 'prefix', type: 'parameter' },
      { text: '<name>', type: 'outlineParameter' },
      { text: 'fixed', type: 'parameter' },
    ]);
    expect(groups.map((range) => text.split('\n')[range.line].slice(range.start, range.end)))
      .toEqual(['prefix<name>', 'fixed']);
  });

  it('uses each scenario\'s examples for repeated steps and preserves parameter groups', () => {
    const handler = handlerFor('set {int} to {word}');
    const text = [
      'Scenario Outline: first', ' Given set <n> to first', ' And set <n> to again',
      ' Examples:', ' | n |', ' | 1 |',
      'Scenario Outline: second', ' Given set <n> to second',
      ' Examples:', ' | n |', ' | 2 |',
    ].join('\n');
    const groups: ParameterGroup[] = [];
    getParameterRanges(handler, text, groups);
    const lines = text.split('\n');
    expect(groups.map(({ line, start, end }) => lines[line].slice(start, end)))
      .toEqual(['<n>', 'first', '<n>', 'again', '<n>', 'second']);
  });

  it('highlights unresolved and quoted placeholders independently of matching definitions', () => {
    const handler = handlerFor('set {int}');
    const text = 'Scenario Outline: missing examples\n Given unknown "<name>" and <value>';
    expect(getParameterRanges(handler, text).map((range) => ({
      text: text.split('\n')[range.line].slice(range.start, range.end), type: range.type,
    }))).toEqual([
      { text: '<name>', type: 'outlineParameter' },
      { text: '<value>', type: 'outlineParameter' },
    ]);
  });

  it('ignores comments, tables, doc strings, unmatched lines and empty groups', () => {
    const handler = handlerFor('set (.*)');
    const text = ['# Given set x', 'Feature: Given set x', ' | Given set x |', '"""', 'Given set x', '"""', 'Given unknown', 'Given set '].join('\n');
    const groups: ParameterGroup[] = [];
    expect(getParameterRanges(handler, text, groups)).toEqual([]);
    expect(groups).toEqual([]);
  });

  it('handles pure expressions and rejects invalid highlight patterns', () => {
    expect(highlighted(handlerFor('set {int}', true), 'Given set 5')).toEqual(['5']);
    const handler = handlerFor('set {word}');
    expect(parameterExpression(handler, { ...handler.elements[0], parameterSource: '(' })).toBeUndefined();
    expect(parameterExpression(handler, { ...handler.elements[0], parameterSource: undefined })).toBeUndefined();
  });
});
