// Find the first table row after an Examples heading, excluding step tables and doc strings.
export function getExamplesHeaderLines(text: string): number[] {
    const lines = text.split(/\r?\n/);
    const headers: number[] = [];
    let waitingForTable = false;
    let docString = '';

    lines.forEach((line, index) => {
        const delimiter = line.match(/^\s*("""|''')/);

        if (delimiter) {
            if (!docString && !line.slice(delimiter[0].length).includes(delimiter[1])) {
                docString = delimiter[1];
            } else if (docString === delimiter[1]) {
                docString = '';
            }
            waitingForTable = false;
            return;
        }

        if (docString) return;

        if (/^\s*(?:Examples|Scenarios)\s*:/i.test(line)) {
            waitingForTable = true;
        } else if (waitingForTable && /^\s*\|/.test(line)) {
            headers.push(index);
            waitingForTable = false;
        } else if (waitingForTable && !/^\s*(?:#.*)?$/.test(line)) {
            waitingForTable = false;
        }
    });

    return headers;
}
