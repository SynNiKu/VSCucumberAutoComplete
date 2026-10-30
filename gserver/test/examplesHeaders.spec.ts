import { getExamplesHeaderLines } from '../../gclient/src/examplesHeaders';

describe('Examples table headers', () => {
  it.each(['\n', '\r\n'])('finds the first row of each named or unnamed section with %j line endings', (newline) => {
    const text = [
      'Scenario Outline: test', ' Examples: first', ' # comment', '',
      ' | input | output |', ' | 1 | 2 |', ' Examples:', ' | input |', ' | 3 |',
      ' Scenarios: alternative', ' | input |', ' | 4 |',
    ].join(newline);
    expect(getExamplesHeaderLines(text)).toEqual([4, 7, 10]);
  });

  it('ignores step tables, comments and Examples inside doc strings', () => {
    const text = [
      ' Given a table', ' | first |', ' | second |', '# Examples: not a section',
      ' """', ' Examples: inside a doc string', ' | not a header |', ' """',
      " '''", ' Examples: also inside a doc string', " '''", ' | not a header |',
    ].join('\n');
    expect(getExamplesHeaderLines(text)).toEqual([]);
  });

  it('stops after incomplete sections and handles single-line doc strings', () => {
    const text = [
      ' Examples: incomplete', ' Scenario: next', ' | step table |',
      ' """ example """', ' Examples: complete', ' | header |',
      ' Examples: malformed', ' """', ' | doc string |', ' """', ' | table |',
    ].join('\n');
    expect(getExamplesHeaderLines(text)).toEqual([5]);
  });
});
