import { CancellationToken, DefinitionProvider, Disposable, Location, Position, Range, RelativePattern, TextDocument, WorkspaceFolder, workspace } from 'vscode';
import { findRegisteredTypeDefinitions, getStepTypeAtPosition, normalizeStepParserFiles } from './pythonStepTypes';

// Avoid generated environments and credential directories when searching the workspace.
const excludedPythonFiles = '**/{.git,.venv,venv,node_modules,__pycache__,credentials,secrets}/**';

export class PythonStepTypeDefinitionProvider implements DefinitionProvider, Disposable {
    private readonly cache = new Map<string, Location[]>();
    private readonly subscriptions: Disposable[];
    private generation = 0;

    constructor() {
        const watcher = workspace.createFileSystemWatcher('**/*.py');
        const invalidate = () => {
            this.generation++;
            this.cache.clear();
        };
        this.subscriptions = [
            watcher,
            watcher.onDidCreate(invalidate),
            watcher.onDidChange(invalidate),
            watcher.onDidDelete(invalidate),
            workspace.onDidChangeWorkspaceFolders(invalidate),
            workspace.onDidChangeConfiguration((event) => {
                if (event.affectsConfiguration('cucumberautocomplete.stepParserFiles')) invalidate();
            }),
        ];
    }

    dispose(): void {
        this.subscriptions.forEach((subscription) => subscription.dispose());
        this.cache.clear();
    }

    async provideDefinition(document: TextDocument, position: Position, token: CancellationToken): Promise<Location[]> {
        const typeName = getStepTypeAtPosition(document.getText(), position);
        const folder = workspace.getWorkspaceFolder(document.uri);
        if (!typeName || !folder) return [];

        while (!token.isCancellationRequested) {
            const generation = this.generation;
            const configuration = workspace.getConfiguration('cucumberautocomplete', folder.uri);
            const patterns = normalizeStepParserFiles(configuration.get<unknown>('stepParserFiles'));
            const key = JSON.stringify([folder.uri.toString(), patterns, typeName]);
            const cached = this.cache.get(key);
            if (cached) return cached;
            const { locations, complete } = await this.findDefinitions(folder, patterns, typeName, token);
            if (token.isCancellationRequested) return [];
            // A file may have changed while the search was running; retry rather than cache stale results.
            if (generation !== this.generation) continue;
            if (complete) this.cache.set(key, locations);
            return locations;
        }
        return [];
    }

    private async findDefinitions(folder: WorkspaceFolder, patterns: string[], typeName: string, token: CancellationToken): Promise<{ locations: Location[]; complete: boolean }> {
        let complete = true;
        const matches = await Promise.all(patterns.map(async (pattern) => {
            try {
                return await workspace.findFiles(new RelativePattern(folder, pattern), excludedPythonFiles);
            } catch {
                complete = false;
                return [];
            }
        }));
        const files = [...new Map(matches.flat()
            .filter((uri) => /\.py$/i.test(uri.fsPath) &&
                !uri.fsPath.split(/[\\/]/).some((part) => /^(?:credentials|secrets)$/i.test(part)))
            .map((uri) => [uri.toString(), uri])).values()];
        files.sort((a, b) => a.toString().localeCompare(b.toString()));
        const locations: Location[] = [];
        // Limit concurrent reads when the workspace contains many Python files.
        for (let i = 0; i < files.length && !token.isCancellationRequested; i += 32) {
            const results = await Promise.all(files.slice(i, i + 32).map(async (uri) => {
                try {
                    const source = Buffer.from(await workspace.fs.readFile(uri)).toString('utf8');
                    return findRegisteredTypeDefinitions(source, typeName).map((target) => {
                        const start = new Position(target.line, target.character);
                        return new Location(uri, new Range(start, start));
                    });
                } catch {
                    complete = false;
                    return [];
                }
            }));
            locations.push(...results.flat());
        }
        return { locations: token.isCancellationRequested ? [] : locations, complete };
    }
}
