import { findFixtureDefinitions, getFixtureAtPosition, getFixtureReferenceAtPosition } from '../../gclient/src/pythonFixtures';

describe('Python fixture navigation', () => {
  it('returns the whole tag range, excluding indentation, arguments and adjacent tags', () => {
    const tag = '@fixture.setup.dante.discover.in.5d.rack';
    const line = `  @other ${tag}(value=1) @fixture.setup.clear.all`;
    const start = line.indexOf(tag);
    for (const character of [start, start + 2, line.indexOf('5d'), start + tag.length - 1]) {
      expect(getFixtureReferenceAtPosition(line, { line: 0, character })).toEqual({
        name: 'setup.dante.discover.in.5d.rack', start, end: start + tag.length,
      });
    }
    expect(getFixtureReferenceAtPosition(line, { line: 0, character: start + tag.length })).toBeUndefined();
  });
  it.each(['5d', '5', '48k'])('resolves numeric fixture segments such as %s', (segment) => {
    const name = `setup.dante.discover.in.${segment}.rack`;
    const tag = `@fixture.${name}`;
    const position = { line: 0, character: tag.indexOf(segment) };
    expect(getFixtureAtPosition(tag, position)).toBe(name);
    const source = `@fixture\ndef ${name.replace(/\./g, '_')}(context: Context) -> None:\n    pass`;
    expect(findFixtureDefinitions(source, name)).toEqual([{ line: 1, character: 4 }]);
  });

  it('finds the fixture under the cursor among multiple tags and ignores arguments', () => {
    const text = '  @other @fixture.setup.clear.all(value=1) @fixture.setup.device';
    expect(getFixtureAtPosition(text, { line: 0, character: text.indexOf('clear') + 2 })).toBe('setup.clear.all');
    expect(getFixtureAtPosition(text, { line: 0, character: text.indexOf('device') + 2 })).toBe('setup.device');
    expect(getFixtureAtPosition(text, { line: 0, character: text.indexOf('value') })).toBeUndefined();
    expect(getFixtureAtPosition(text, { line: 0, character: text.indexOf('@other') })).toBeUndefined();
  });

  it.each(['\n', '\r\n'])('ignores comments, descriptions and doc strings with %j line endings', (newline) => {
    const lines = ['# @fixture.setup.clear.all', 'description @fixture.setup.clear.all',
      ' """', '@fixture.setup.clear.all', ' """', '@fixture.setup.clear.all'];
    const text = lines.join(newline);
    for (const line of [0, 1, 3]) {
      expect(getFixtureAtPosition(text, { line, character: lines[line].indexOf('setup') + 1 })).toBeUndefined();
    }
    expect(getFixtureAtPosition(text, { line: 5, character: 12 })).toBe('setup.clear.all');
  });

  it('finds decorated functions and classes while ignoring commented or quoted definitions', () => {
    const text = [
      '# @fixture', '# def setup_clear_all(context): pass',
      '"""', '@fixture', 'def setup_clear_all(context): pass', '"""',
      '@fixture', '# comment', 'def setup_clear_all(context):', '    pass',
      '@behave.fixture()', 'class setup_device:', '    pass',
      'def undecorated(context): pass',
    ].join('\r\n');
    expect(findFixtureDefinitions(text, 'setup.clear.all')).toEqual([{ line: 8, character: 4 }]);
    expect(findFixtureDefinitions(text, 'setup.device')).toEqual([{ line: 11, character: 6 }]);
    expect(findFixtureDefinitions(text, 'undecorated')).toEqual([]);
    expect(findFixtureDefinitions(text, 'missing')).toEqual([]);
  });

  it('handles malformed and single-line doc strings deterministically', () => {
    expect(getFixtureAtPosition('""" text """\n@fixture.setup.device', { line: 1, character: 12 })).toBe('setup.device');
    expect(getFixtureAtPosition('@fixture.\n@fixture.setup.', { line: 1, character: 12 })).toBeUndefined();
    expect(findFixtureDefinitions('@fixture\ndef ', 'setup')).toEqual([]);
  });
});
