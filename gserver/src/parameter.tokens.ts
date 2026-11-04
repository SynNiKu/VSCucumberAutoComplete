import StepsHandler, { Step } from './steps.handler';

export type ParameterRange = {
    line: number;
    start: number;
    end: number;
    type: 'parameter' | 'outlineParameter';
};
export type ParameterGroup = { line: number; start: number; end: number };

type IndexedMatch = RegExpExecArray & {
    indices?: Array<[number, number] | undefined>;
};

const parameterPatterns: Record<string, string> = {
    '{int}': '-?\\d+',
    '{float}': '-?\\d*\\.?\\d+',
    '{word}': '[^\\s]+',
    '{string}': '(?:"[^"]*"|\'[^\']*\')',
    '{stringInDoubleQuotes}': '"[^"]+"',
};

// Compile a separate expression so that highlighting never changes step matching.
// The d flag returns capture offsets, including when the same value occurs more than once.
export function parameterExpression(
    handler: StepsHandler,
    step: Step,
): { reg: RegExp; groups: number[] } | undefined {
    if (step.parameterSource === undefined) return undefined;
    const replacements: string[] = [];
    // Protect expression parameters from the existing regex conversion, then turn them into captures.
    const source = step.parameterSource.replace(
        /#\{[^}]*\}|(?<!\\)\{(?![\d,])[^}]*\}/g,
        (value) => {
            if (
                handler.settings.pureTextSteps &&
                ![
                    '{int}',
                    '{float}',
                    '{word}',
                    '{string}',
                    '{stringInDoubleQuotes}',
                    '{}',
                ].includes(value)
            ) {
                return value;
            }
            const id = replacements.length;
            replacements.push(parameterPatterns[value] || '.*');
            return `ZZPARAMETER${id}ZZ`;
        },
    );
    const alternatives: string[] = [];
    const markedSource = handler.settings.pureTextSteps
        ? source
        : source.replace(/([a-zA-Z]+)(?:\/([a-zA-Z]+))+/g, (value) => {
            const id = alternatives.push(value.replace(/\//g, '|')) - 1;
            return `ZZALTERNATIVE${id}ZZ`;
        });
    const converted = handler.settings.pureTextSteps
        ? handler.getRegTextForPureStep(markedSource)
        : handler.getRegTextForStep(markedSource);
    const groups: number[] = [];
    // Added captures shift numeric backreferences, so track the old-to-new group numbers.
    const mapping: number[] = [0];
    const stack: boolean[] = [];
    let count = 0;
    let inClass = false;
    let result = '';
    for (let i = 0; i < converted.length; i++) {
        const alternative = converted.slice(i).match(/^ZZALTERNATIVE(\d+)ZZ/);
        if (alternative) {
            mapping.push(++count);
            result += `(${alternatives[Number(alternative[1])]})`;
            i += alternative[0].length - 1;
            continue;
        }
        const marker = converted.slice(i).match(/^ZZPARAMETER(\d+)ZZ/);
        if (marker) {
            count++;
            if (!stack.includes(true)) groups.push(count);
            result += `(${replacements[Number(marker[1])]})`;
            i += marker[0].length - 1;
            continue;
        }
        const c = converted[i];
        if (c === '\\' && i + 1 < converted.length) {
            const backref = !inClass && converted.slice(i).match(/^\\([1-9]\d*)/);
            if (backref) {
                // Resolve references after all groups have been counted, including forward references.
                result += `ZZBACKREF${backref[1]}ZZ`;
                i += backref[0].length - 1;
            } else result += c + converted[++i];
            continue;
        }
        if (c === '[') inClass = true;
        if (c === ']') inClass = false;
        if (!inClass && c === '(') {
            const lookaround = /^\(\?(?:[=!]|<[=!])/.test(converted.slice(i));
            const capturing =
                converted[i + 1] !== '?' || /^\(\?<[^=!]/.test(converted.slice(i));
            const generated = /^\([a-z\s]+\)\?/.test(converted.slice(i));
            if (capturing) {
                mapping.push(++count);
                if (!generated && !lookaround && !stack.includes(true)) {
                    groups.push(count);
                }
            }
            stack.push(lookaround || stack.includes(true));
        } else if (!inClass && c === ')') stack.pop();
        result += c;
    }
    result = result.replace(
        /ZZBACKREF(\d+)ZZ/g,
        (_, n: string) => `\\${mapping[Number(n)] || n}`,
    );
    try {
        return { reg: new RegExp(result, 'd'), groups };
    } catch {
        return undefined;
    }
}

function examples(lines: string[], start: number): Record<string, string>[] {
    const rows: Record<string, string>[] = [];
    for (
        let i = start + 1;
        i < lines.length &&
        !/^\s*(?:Scenario(?: Outline| Template)?|Example|Rule|Feature|Background):/i.test(
            lines[i],
        );
        i++
    ) {
        if (!/^\s*Examples\s*:/i.test(lines[i])) continue;
        while (i + 1 < lines.length && /^\s*(?:#.*)?$/.test(lines[i + 1])) i++;
        if (i + 1 >= lines.length || !/^\s*\|/.test(lines[i + 1])) continue;
        const parse = (line: string) =>
            line
                .trim()
                .replace(/^\||\|$/g, '')
                .split('|')
                .map((cell) => cell.trim());
        const headers = parse(lines[++i] || '');
        while (i + 1 < lines.length && /^\s*\|/.test(lines[i + 1])) {
            const values = parse(lines[++i]);
            rows.push(
                Object.fromEntries(
                    headers.map((header, index) => [header, values[index] || '']),
                ),
            );
        }
    }
    return rows;
}

// Return non-overlapping color ranges and optionally collect whole parameter groups for italics.
export function getParameterRanges(
    handler: StepsHandler,
    text: string,
    groups?: ParameterGroup[],
): ParameterRange[] {
    const lines = text.split(/\r?\n/);
    const ranges: ParameterRange[] = [];
    const exampleRows = new Map<number, Record<string, string>[]>();
    const expressions = new Map<Step, ReturnType<typeof parameterExpression>>();
    let scenario = -1;
    let docString = '';
    for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
        const line = lines[lineNumber];
        const delimiter = line.match(/^\s*("""|''')/);
        if (delimiter) {
            if (!docString && line.slice(delimiter[0].length).includes(delimiter[1])) {
                continue;
            }
            if (!docString) {
                docString = delimiter[1];
            } else if (docString === delimiter[1]) {
                docString = '';
            }
            continue;
        }
        if (docString) continue;
        if (/^\s*(?:Scenario(?: Outline| Template)?|Example):/i.test(line)) {
            scenario = lineNumber;
        }
        if (/^\s*(?:Feature|Background|Rule):/i.test(line)) scenario = -1;
        const match = line.match(handler.getGherkinRegEx());
        if (!match) continue;
        const offset = match[1].length + match[2].length + match[3].length;
        const body = match[4];
        const placeholders = [...body.matchAll(/<([^<>]+)>/g)];
        const placeholderRanges: ParameterRange[] = placeholders.map(
            (placeholder) => ({
                line: lineNumber,
                start: offset + placeholder.index!,
                end: offset + placeholder.index! + placeholder[0].length,
                type: 'outlineParameter',
            }),
        );
        const lineRanges = [...placeholderRanges];
        if (placeholders.length && scenario >= 0 && !exampleRows.has(scenario)) {
            exampleRows.set(scenario, examples(lines, scenario));
        }
        const candidates =
            placeholders.length && scenario >= 0 ? exampleRows.get(scenario)! : [{}];
        for (const row of candidates) {
            let expanded = '';
            // Map each substituted UTF-16 position back to its original feature-file range.
            const map: Array<[number, number]> = [];
            let cursor = 0;
            for (const placeholder of placeholders) {
                const start = placeholder.index!;
                for (let i = cursor; i < start; i++) {
                    expanded += body[i];
                    map.push([i, i + 1]);
                }
                const value = row[placeholder[1]];
                const replacement = value || placeholder[0];
                expanded += replacement;
                for (let i = 0; i < replacement.length; i++) {
                    map.push([start, start + placeholder[0].length]);
                }
                cursor = start + placeholder[0].length;
            }
            for (let i = cursor; i < body.length; i++) {
                expanded += body[i];
                map.push([i, i + 1]);
            }
            const step = handler.getPreferredSteps(expanded)[0] || handler.getStepByText(expanded);
            if (!step) continue;
            if (!expressions.has(step)) {
                expressions.set(step, parameterExpression(handler, step));
            }
            const expression = expressions.get(step);
            const result = expression?.reg.exec(expanded) as
                | IndexedMatch
                | null
                | undefined;
            if (!result?.indices || !expression) continue;
            const found: Array<[number, number]> = [];
            for (const group of expression.groups) {
                const span = result.indices[group];
                if (!span || span[0] === span[1] || !map[span[0]] || !map[span[1] - 1]) {
                    continue;
                }
                found.push([map[span[0]][0], map[span[1] - 1][1]]);
            }
            found.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
            // Merge nested captures before splitting them around outline placeholders.
            const merged: Array<[number, number]> = [];
            for (const [start, end] of found) {
                const previous = merged[merged.length - 1];
                if (previous && start < previous[1]) {
                    previous[1] = Math.max(previous[1], end);
                } else {
                    merged.push([start, end]);
                }
            }
            for (const [start, end] of merged) {
                groups?.push({
                    line: lineNumber,
                    start: offset + start,
                    end: offset + end,
                });
                let position = offset + start;
                const limit = offset + end;
                for (const placeholder of placeholderRanges) {
                    if (placeholder.end <= position || placeholder.start >= limit) {
                        continue;
                    }
                    if (position < placeholder.start) {
                        lineRanges.push({
                            line: lineNumber,
                            start: position,
                            end: placeholder.start,
                            type: 'parameter',
                        });
                    }
                    position = Math.max(position, placeholder.end);
                }
                if (position < limit) {
                    lineRanges.push({
                        line: lineNumber,
                        start: position,
                        end: limit,
                        type: 'parameter',
                    });
                }
            }
            break;
        }
        ranges.push(...lineRanges.sort((a, b) => a.start - b.start));
    }
    return ranges;
}
