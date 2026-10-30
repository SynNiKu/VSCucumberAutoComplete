import { maskPythonText, SourcePosition } from './pythonStepTypes';

export interface FixtureReference {
    name: string;
    start: number;
    end: number;
}

export function getFixtureAtPosition(text: string, position: SourcePosition): string | undefined {
    return getFixtureReferenceAtPosition(text, position)?.name;
}

// Fixture references are tags, rather than arbitrary text in descriptions or doc strings.
export function getFixtureReferenceAtPosition(text: string, position: SourcePosition): FixtureReference | undefined {
    const lines = text.split(/\r?\n/);
    let docString = '';
    for (let lineNumber = 0; lineNumber <= position.line && lineNumber < lines.length; lineNumber++) {
        const line = lines[lineNumber];
        const delimiter = line.match(/^\s*("""|'''|```)/);
        if (delimiter) {
            if (!docString && line.slice(delimiter[0].length).includes(delimiter[1])) continue;
            if (!docString) docString = delimiter[1];
            else if (docString === delimiter[1]) docString = '';
            continue;
        }
        if (docString || lineNumber !== position.line || !/^\s*@/.test(line)) continue;
        // Only the full Python name must start with a letter; later segments may start with digits.
        for (const match of line.matchAll(/(?:^|\s)@fixture\.([A-Za-z_]\w*(?:\.\w+)*)(?=[\s(]|$)/g)) {
            const start = match.index! + match[0].indexOf('@fixture.');
            const end = start + '@fixture.'.length + match[1].length;
            if (position.character >= start && position.character < end) return { name: match[1], start, end };
        }
    }
    return undefined;
}

// Match the wrapper's registration convention: setup_clear_all becomes setup.clear.all.
export function findFixtureDefinitions(text: string, name: string): SourcePosition[] {
    const source = maskPythonText(text);
    const definitions: SourcePosition[] = [];
    const declaration = /^[ \t]*@(?:behave\.)?fixture(?:[ \t]*\([^)]*\))?[ \t]*\r?\n(?:[ \t]*\r?\n)*[ \t]*(?:async[ \t]+)?(?:def|class)[ \t]+([A-Za-z_]\w*)/gm;
    for (const match of source.matchAll(declaration)) {
        if (match[1].replace(/_/g, '.') !== name) continue;
        const offset = match.index! + match[0].lastIndexOf(match[1]);
        const lines = source.slice(0, offset).split('\n');
        definitions.push({ line: lines.length - 1, character: lines[lines.length - 1].length });
    }
    return definitions;
}
