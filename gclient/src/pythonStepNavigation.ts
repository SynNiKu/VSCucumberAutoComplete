import { CancellationToken, DefinitionLink, DefinitionProvider, Disposable, Location, Position, Range, RelativePattern, TextDocument, WorkspaceFolder, workspace } from 'vscode';
import { findRegisteredTypeDefinitions, getStepTypeAtPosition, normalizeStepParserFiles } from './pythonStepTypes';
import { findFixtureDefinitions, getFixtureReferenceAtPosition } from './pythonFixtures';

// Avoid generated environments and credential directories when searching the workspace.
const excludedPythonFiles = '**/{.git,.venv,venv,node_modules,__pycache__,credentials,secrets}/**';

export class PythonDefinitionProvider implements DefinitionProvider, Disposable {
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
                if (event.affectsConfiguration('cucumberautocomplete.stepParserFiles') ||
                    event.affectsConfiguration('cucumberautocomplete.fixtureFiles')) invalidate();
            }),
        ];
    }

    dispose(): void {
        this.subscriptions.forEach((subscription) => subscription.dispose());
        this.cache.clear();
    }

    async provideDefinition(document: TextDocument, position: Position, token: CancellationToken): Promise<Location[] | DefinitionLink[]> {
        const kind = document.languageId === 'feature' ? 'fixture' : 'type';
        const fixture = kind === 'fixture' ? getFixtureReferenceAtPosition(document.getText(), position) : undefined;
        const name = kind === 'fixture'
            ? fixture?.name
            : getStepTypeAtPosition(document.getText(), position);
        const folder = workspace.getWorkspaceFolder(document.uri);
        if (!name || !folder) return [];

        // Keep only targets in the cache: the origin range belongs to this particular tag occurrence.
        const definitions = (locations: Location[]): Location[] | DefinitionLink[] => fixture
            ? locations.map((location) => ({
                originSelectionRange: new Range(position.line, fixture.start, position.line, fixture.end),
                targetUri: location.uri,
                targetRange: location.range,
                targetSelectionRange: location.range,
            }))
            : locations;

        while (!token.isCancellationRequested) {
            const generation = this.generation;
            const configuration = workspace.getConfiguration('cucumberautocomplete', folder.uri);
            const patterns = normalizeStepParserFiles(configuration.get<unknown>(kind === 'fixture' ? 'fixtureFiles' : 'stepParserFiles'));
            const key = JSON.stringify([folder.uri.toString(), patterns, kind, name]);
            const cached = this.cache.get(key);
            if (cached) return definitions(cached);
            const { locations, complete } = await this.findDefinitions(folder, patterns, name, kind, token);
            if (token.isCancellationRequested) return [];
            // A file may have changed while the search was running; retry rather than cache stale results.
            if (generation !== this.generation) continue;
            if (complete) this.cache.set(key, locations);
            return definitions(locations);
        }
        return [];
    }

    private async findDefinitions(folder: WorkspaceFolder, patterns: string[], name: string, kind: 'fixture' | 'type', token: CancellationToken): Promise<{ locations: Location[]; complete: boolean }> {
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
                    const definitions = kind === 'fixture' ? findFixtureDefinitions(source, name) : findRegisteredTypeDefinitions(source, name);
                    return definitions.map((target) => {
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
