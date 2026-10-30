export interface SourcePosition {
    line: number;
    character: number;
}

// Search only non-empty, workspace-relative patterns; malformed settings must not broaden the search.
export function normalizeStepParserFiles(value: unknown): string[] {
    if (value === undefined) return ['**/*.py'];
    const patterns = Array.isArray(value) ? value : [value];
    return patterns.filter((pattern): pattern is string => typeof pattern === 'string')
        .map((pattern) => pattern.trim())
        .filter((pattern) => pattern.length > 0 && !/^(?:[A-Za-z]:|[\\/])/.test(pattern) &&
            !pattern.split(/[\\/]/).includes('..'));
}

// Find a type name only inside a quoted string belonging to a Behave step decorator.
export function getStepTypeAtPosition(text: string, position: SourcePosition): string | undefined {
    const lines = text.split(/\r?\n/);
    const codeLines = maskPythonText(text).split(/\r?\n/);
    let depth = 0;
    let quote = '';
    for (let lineNumber = 0; lineNumber <= position.line && lineNumber < lines.length; lineNumber++) {
        const line = lines[lineNumber];
        let start = 0;
        if (!depth) {
            const decorator = codeLines[lineNumber].match(/^\s*@(?:given|when|then|step)\s*\(/i);
            if (!decorator) continue;
            depth = 1;
            start = decorator[0].length;
        }
        for (let i = start; i < line.length; i++) {
            const character = line[i];
            if (quote) {
                if (character === '\\') {
                    i++;
                } else if (character === quote) {
                    quote = '';
                } else if (character === '{' && lineNumber === position.line) {
                    const match = line.slice(i).match(/^\{\s*\w+\s*:\s*([A-Za-z_]\w*)[^}]*\}/);
                    if (match) {
                        const typeStart = i + match[0].indexOf(match[1], match[0].indexOf(':') + 1);
                        if (position.character >= typeStart && position.character < typeStart + match[1].length) {
                            return match[1];
                        }
                    }
                }
            } else if (character === '#') {
                break;
            } else if (character === '"' || character === "'") {
                quote = character;
            } else if (character === '(') {
                depth++;
            } else if (character === ')' && --depth === 0) {
                break;
            }
        }
        // An unfinished ordinary string is malformed; do not consume later decorators.
        quote = '';
    }
    return undefined;
}

// Mask Python strings and comments while preserving offsets for navigation locations.
export function maskPythonText(text: string): string {
    let result = '';
    let quote = '';
    let comment = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '\n' || c === '\r') {
            result += c;
            comment = false;
            if (quote.length === 1) quote = '';
        } else if (comment) {
            result += ' ';
        } else if (quote) {
            if (c === '\\' && i + 1 < text.length && text[i + 1] !== '\n' && text[i + 1] !== '\r') {
                result += '  ';
                i++;
            } else if (text.slice(i, i + quote.length) === quote) {
                result += ' '.repeat(quote.length);
                i += quote.length - 1;
                quote = '';
            } else result += ' ';
        } else if (c === '#') {
            comment = true;
            result += ' ';
        } else if (c === '"' || c === "'") {
            quote = text.slice(i, i + 3) === c.repeat(3) ? c.repeat(3) : c;
            result += ' '.repeat(quote.length);
            i += quote.length - 1;
        } else result += c;
    }
    return result;
}

// Resolve register_type(TypeName=converter) to a definition in the same file.
export function findRegisteredTypeDefinitions(text: string, typeName: string): SourcePosition[] {
    if (!/^[A-Za-z_]\w*$/.test(typeName)) return [];
    const masked = maskPythonText(text);
    const definitions: SourcePosition[] = [];
    const registrations = /\bregister_type\s*\(([^)]*)\)/g;
    let registration: RegExpExecArray | null;
    while ((registration = registrations.exec(masked))) {
        const argumentsText = registration[1];
        const assignment = new RegExp(`(?:^|,)\\s*${typeName}\\s*=\\s*([A-Za-z_]\\w*)\\b`).exec(argumentsText);
        if (!assignment) continue;
        const converter = assignment[1];
        const declaration = new RegExp(`^\\s*(?:async\\s+)?(?:def|class)\\s+(${converter})\\b`, 'm').exec(masked);
        if (!declaration) continue;
        const offset = declaration.index + declaration[0].lastIndexOf(converter);
        const previousLines = masked.slice(0, offset).split('\n');
        definitions.push({ line: previousLines.length - 1, character: previousLines[previousLines.length - 1].length });
    }
    return definitions;
}
