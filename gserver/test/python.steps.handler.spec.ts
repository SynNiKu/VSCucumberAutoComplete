import StepsHandler from '../src/steps.handler';
import * as util from '../src/util';
import { defaultSettings } from './data/defaultSettings';
import { Location } from 'vscode-languageserver';

function parseSteps(source: string, extension = 'py', settings = {}) {
  const handler = new StepsHandler(__dirname, {
    ...defaultSettings,
    featureFiles: '',
    ...settings,
  });
  const read = jest.spyOn(util, 'getFileContent').mockReturnValueOnce(source);
  try {
    handler.elements = handler.getFileSteps(`${__dirname}/steps.${extension}`);
  } finally {
    read.mockRestore();
  }
  return handler;
}

describe('Python adjacent step literals', () => {
  const prefix = 'a signal with RMS between {outputLvlMin:SignalLevel} and '
    + '{outputLvlMax:SignalLevel} shall have been present on ';
  const suffix = 'output {output:NoWhitespaceString}';

  it.each(['\n', '\r\n'])('indexes the entire decorator with %j line endings', (newline) => {
    const handler = parseSteps([
      '@step(',
      `    "${prefix}"`,
      `    "${suffix}",`,
      ')',
      'def check_signal(context):',
      '    pass',
    ].join(newline));
    const feature = [
      'Scenario Outline: signal levels',
      'Examples:',
      '| MinLvl | MaxLvl |',
      '| 2 | 4 |',
    ].join(newline);
    const [step] = handler.elements;

    expect(handler.elements).toHaveLength(1);
    expect(step.text).toBe(prefix + suffix);
    expect((step.def as Location).range).toEqual({
      start: { line: 0, character: 1 },
      end: { line: 0, character: 1 },
    });
    for (const keyword of ['Then', 'And']) {
      for (const output of ['A', 'B', 'C', 'D']) {
        const line = `${keyword} a signal with RMS between <MinLvl> dBu and `
          + `<MaxLvl> dBu shall have been present on output ${output}`;
        expect(handler.getDefinition(line, feature)).toEqual(step.def);
        expect(handler.validate(line, 0, feature)).toBeNull();
      }
    }
    expect(handler.getDefinition(
      'Then a signal with RMS between 2 dBu and 4 dBu shall have been present on another device',
      ''
    )).toBeNull();
    expect(handler.getDefinition(
      'Then a signal with RMS between 2 dBu and 4 dBu shall have been present on amp output A',
      ''
    )).toBeNull();
    expect(handler.getCompletion('Then a signal ', 0, '')![0].label).toBe(prefix + suffix);
  });

  it.each([
    ['@step("first " "second")', 'first second'],
    ['@step(\'first \' "second")', 'first second'],
    ['@step("" "second")', 'second'],
    ['@step("first "\n\n# a comment\n\'second \'\n"third")', 'first second third'],
    ['@step("first " # inline comment\n"second")', 'first second'],
    ['@step("first # "\n"second")', 'first # second'],
    ["@step('first # '\n'second') # comment", 'first # second'],
    [String.raw`@step("first \"#\" "` + '\n"second") # comment', 'first "#" second'],
    [String.raw`@step("say \"hello\" " 'to the output')`, 'say "hello" to the output'],
  ])('concatenates adjacent literals in %s', (source, text) => {
    expect(parseSteps(source).elements.map((step) => step.text)).toEqual([text]);
  });

  it('keeps separate arguments, function bodies and decorators separate', () => {
    const handler = parseSteps([
      '@step("first", "not part of the step")',
      'def first(context):',
      '    "not part of the step either"',
      '@step("second")',
      'def second(context):',
      '    pass',
    ].join('\n'));

    expect(handler.elements.map((step) => step.text)).toEqual(['first', 'second']);
    expect(handler.getDefinition('Given second', '')).toEqual(handler.elements[1].def);
  });

  it.each([
    '@step("first"\n"unterminated\n@step("second")',
    '@step("first"\n@step("second")',
    '@step("first"',
    '@step("first"\n',
  ])('handles malformed continuations deterministically in %s', (source) => {
    const handler = parseSteps(source);
    expect(handler.elements[0].text).toBe('first');
    expect(handler.elements).toHaveLength(source.includes('second') ? 2 : 1);
  });

  it('supports custom decorator matching and parameter replacements', () => {
    const handler = parseSteps('@step("first "\n"{level:SignalLevel}")', 'py', {
      gherkinDefinitionPart: '@(given|when|then|step)\\(',
      customParameters: [{ parameter: '{level:SignalLevel}', value: '{int}' }],
      pureTextSteps: true,
    });

    expect(handler.elements[0].text).toBe('first {int}');
    expect(handler.getDefinition('Then first -3', '')).toEqual(handler.elements[0].def);
    expect(handler.getDefinition('Then first invalid', '')).toBeNull();
  });

  it('preserves parsing for other languages and non-decorator calls', () => {
    expect(parseSteps('Given("first " "second")', 'js').elements[0].text).toBe('first ');
    expect(parseSteps('step("first " "second")').elements[0].text).toBe('first ');
  });
});
