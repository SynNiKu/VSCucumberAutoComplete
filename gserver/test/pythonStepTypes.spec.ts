import { findRegisteredTypeDefinitions, getStepTypeAtPosition, normalizeStepParserFiles } from '../../gclient/src/pythonStepTypes';

describe('Python step type navigation', () => {
  it('accepts a single glob, several globs, or an empty list', () => {
    expect(normalizeStepParserFiles(undefined)).toEqual(['**/*.py']);
    expect(normalizeStepParserFiles(' parsers/**/*.py ')).toEqual(['parsers/**/*.py']);
    expect(normalizeStepParserFiles(['parsers/**/*.py', 'other/*.py'])).toEqual(['parsers/**/*.py', 'other/*.py']);
    expect(normalizeStepParserFiles([])).toEqual([]);
  });

  it('ignores malformed and non-workspace-relative parser paths', () => {
    expect(normalizeStepParserFiles([null, 42, '', '  ', '../outside/*.py', 'parsers/../outside.py',
      '/outside/*.py', 'C:\\outside\\*.py', 'parsers/*.py'])).toEqual(['parsers/*.py']);
    expect(normalizeStepParserFiles(null)).toEqual([]);
  });

  it('finds a type at the cursor in multiline adjacent decorator strings', () => {
    const source = '@step(\n    "first "\n    "{name:NoWhitespaceString} and {Value:Value}"\n)';
    const line = source.split('\n')[2];
    expect(getStepTypeAtPosition(source, { line: 2, character: line.indexOf('NoWhitespaceString') + 2 }))
      .toBe('NoWhitespaceString');
    expect(getStepTypeAtPosition(source, { line: 2, character: line.lastIndexOf('Value') + 2 }))
      .toBe('Value');
    expect(getStepTypeAtPosition(source, { line: 2, character: line.indexOf('name') })).toBeUndefined();
  });

  it('ignores comments, ordinary strings, doc strings and incomplete expressions', () => {
    const sources = [
      '# @step("{name:Type}")',
      'text = "{name:Type}"',
      '"""\n@step("{name:Type}")\n"""',
      '@step("{name:Type")',
      '@other("{name:Type}")',
    ];
    for (const source of sources) {
      const lines = source.split('\n');
      const line = lines.findIndex((value) => value.includes('Type'));
      expect(getStepTypeAtPosition(source, { line, character: lines[line].indexOf('Type') + 1 })).toBeUndefined();
    }
  });

  it('locates registered functions and classes, including multiline registrations', () => {
    const source = [
      '# register_type(Type=wrong)', '"register_type(Type=wrong)"',
      'def parseType(text):', '    return text', 'class Parser:', '    pass',
      'register_type(', '    Type=parseType,', '    Other=Parser,', ')',
    ].join('\r\n');
    expect(findRegisteredTypeDefinitions(source, 'Type')).toEqual([{ line: 2, character: 4 }]);
    expect(findRegisteredTypeDefinitions(source, 'Other')).toEqual([{ line: 4, character: 6 }]);
    expect(findRegisteredTypeDefinitions(source, 'Missing')).toEqual([]);
    expect(findRegisteredTypeDefinitions(source, 'Type.*')).toEqual([]);
  });

  it('ignores fake declarations in strings and handles missing converters', () => {
    const source = '"""\ndef fake(text): pass\nregister_type(Fake=fake)\n"""\nregister_type(Fake=missing)';
    expect(findRegisteredTypeDefinitions(source, 'Fake')).toEqual([]);
  });
});
