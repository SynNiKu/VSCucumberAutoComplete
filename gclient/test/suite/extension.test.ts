import * as assert from 'node:assert';
import * as vscode from 'vscode';

import {
    applyTextEdits,
    definitionUri,
    getDefinitions,
    getExtension,
    getWorkspaceFolder,
    isWorkspaceRelativePath,
    openFixture,
    waitFor,
} from './helpers';

suite('Extension E2E', () => {
    test('activation', async () => {
        const extension = getExtension();
        assert.strictEqual(extension.isActive, false);

        await openFixture('completion.feature');
        await waitFor(
            'automatic extension activation',
            () => Promise.resolve(extension.isActive),
            Boolean
        );
    });

    test('provides semantic tokens for step parameters', async () => {
        const document = await openFixture('parameter-highlighting.feature');
        const tokens = await waitFor(
            'step parameter semantic tokens',
            () => vscode.commands.executeCommand<vscode.SemanticTokens>(
                'vscode.provideDocumentSemanticTokens', document.uri
            ),
            (result) => Boolean(result && result.data.length >= 10)
        );
        assert.ok(tokens);
        assert.deepStrictEqual(Array.from(tokens.data), [2, 24, 6, 0, 0, 0, 11, 2, 0, 0]);
    });

    test('finds step references from feature and definition files', async () => {
        const feature = await openFixture('reference-parameters.feature');
        const folder = getWorkspaceFolder();
        const definition = await vscode.workspace.openTextDocument(
            vscode.Uri.joinPath(folder.uri, 'steps', 'parameter-highlighting.js')
        );
        const getReferences = (document: vscode.TextDocument, position: vscode.Position) =>
            vscode.commands.executeCommand<vscode.Location[]>(
                'vscode.executeReferenceProvider', document.uri, position
            );
        const hasFeatureReference = (locations: vscode.Location[] | undefined) => Boolean(locations?.some(
            (location) => isWorkspaceRelativePath(location.uri, 'features', 'parameter-highlighting.feature') &&
                location.range.start.line === 2
        ));
        const featureReferences = await waitFor('feature references',
            () => getReferences(feature, new vscode.Position(2, 15)), hasFeatureReference);
        assert.ok(hasFeatureReference(featureReferences));
        const definitionReferences = await waitFor('definition references',
            () => getReferences(definition, new vscode.Position(0, 10)), hasFeatureReference);
        assert.ok(hasFeatureReference(definitionReferences));
        for (const references of [featureReferences, definitionReferences]) {
            const lines = references.filter((location) => isWorkspaceRelativePath(
                location.uri, 'features', 'reference-parameters.feature'
            )).map((location) => location.range.start.line);
            assert.deepStrictEqual(lines.sort(), [2, 3]);
        }
    });

    test('shows references on a Python step decorator', async () => {
        const folder = getWorkspaceFolder();
        const configuration = vscode.workspace.getConfiguration('cucumberautocomplete', folder.uri);
        const original = configuration.inspect<string | string[]>('steps')?.workspaceValue;
        const document = await vscode.workspace.openTextDocument(
            vscode.Uri.joinPath(folder.uri, 'steps', 'type-navigation.py')
        );
        const position = new vscode.Position(0, 3);
        try {
            await configuration.update('steps', ['steps/**/*.js', 'steps/**/*.py'], vscode.ConfigurationTarget.Workspace);
            const references = await waitFor('Python step references',
                () => vscode.commands.executeCommand<vscode.Location[]>('vscode.executeReferenceProvider', document.uri, position),
                (locations) => Boolean(locations?.filter((location) => isWorkspaceRelativePath(
                    location.uri, 'features', 'python-step-references.feature'
                )).length === 2));
            assert.ok(references);
            const hovers = await waitFor('Python step references hover',
                () => vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', document.uri, position),
                (result) => Boolean(result?.some((hover) => hover.contents.some((content) =>
                    content instanceof vscode.MarkdownString && content.value.includes('Find all references (2)')
                ))));
            assert.ok(hovers);
        } finally {
            await configuration.update('steps', original, vscode.ConfigurationTarget.Workspace);
        }
    });

    test('limits reference searches to configured feature files', async () => {
        const folder = getWorkspaceFolder();
        const configuration = vscode.workspace.getConfiguration('cucumberautocomplete', folder.uri);
        const original = configuration.inspect<string>('featureFiles')?.workspaceValue;
        const document = await openFixture('reference-parameters.feature');
        const references = () => vscode.commands.executeCommand<vscode.Location[]>(
            'vscode.executeReferenceProvider', document.uri, new vscode.Position(2, 15)
        );
        const featureLocations = (locations: vscode.Location[]) => locations.filter((location) =>
            location.uri.fsPath.endsWith('.feature'));
        try {
            await configuration.update('featureFiles', 'features/reference-parameters.feature', vscode.ConfigurationTarget.Workspace);
            const restricted = await waitFor('restricted reference paths', references, (locations) =>
                Boolean(locations && featureLocations(locations).length === 2 && featureLocations(locations).every((location) =>
                    isWorkspaceRelativePath(location.uri, 'features', 'reference-parameters.feature'))));
            assert.strictEqual(featureLocations(restricted).length, 2);

            await configuration.update('featureFiles', 'features/*.feature', vscode.ConfigurationTarget.Workspace);
            const expanded = await waitFor('expanded reference paths', references, (locations) =>
                Boolean(locations?.some((location) => isWorkspaceRelativePath(
                    location.uri, 'features', 'parameter-highlighting.feature'
                ))));
            assert.strictEqual(featureLocations(expanded).filter((location) => isWorkspaceRelativePath(
                location.uri, 'features', 'reference-parameters.feature'
            )).length, 2);

            await configuration.update('featureFiles', '', vscode.ConfigurationTarget.Workspace);
            const disabled = await waitFor('disabled reference search', references,
                (locations) => Boolean(locations && featureLocations(locations).length === 0));
            assert.strictEqual(featureLocations(disabled).length, 0);
        } finally {
            await configuration.update('featureFiles', original, vscode.ConfigurationTarget.Workspace);
        }
    });

    test('distinguishes outline placeholders from step parameter values', async () => {
        const document = await openFixture('outline-highlighting.feature');
        const tokens = await waitFor(
            'outline placeholder semantic tokens',
            () => vscode.commands.executeCommand<vscode.SemanticTokens>(
                'vscode.provideDocumentSemanticTokens', document.uri
            ),
            (result) => Boolean(result && result.data.length >= 10)
        );
        assert.ok(tokens);
        assert.deepStrictEqual(Array.from(tokens.data), [2, 24, 6, 1, 0, 0, 11, 2, 0, 0]);
    });

    test('navigates from a Python step type to its registered parser', async () => {
        const folder = getWorkspaceFolder();
        const uri = vscode.Uri.joinPath(folder.uri, 'steps', 'type-navigation.py');
        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document);
        const character = document.lineAt(0).text.indexOf('NoWhitespaceString') + 2;
        const definitions = await waitFor(
            'Python step type definition',
            () => getDefinitions(document, new vscode.Position(0, character)),
            (result) => result.some((definition) => isWorkspaceRelativePath(
                definitionUri(definition), 'parsers', 'step_types.py'
            ))
        );
        assert.ok(definitions.some((definition) => isWorkspaceRelativePath(
            definitionUri(definition), 'parsers', 'step_types.py'
        )));
    });

    test('limits Python parser navigation to configured paths', async () => {
        const folder = getWorkspaceFolder();
        const uri = vscode.Uri.joinPath(folder.uri, 'steps', 'type-navigation.py');
        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document);
        const position = new vscode.Position(0, document.lineAt(0).text.indexOf('NoWhitespaceString') + 2);
        const configuration = vscode.workspace.getConfiguration('cucumberautocomplete', folder.uri);
        const original = configuration.inspect<string | string[]>('stepParserFiles')?.workspaceValue;
        const isParser = (definition: vscode.Location | vscode.LocationLink) => isWorkspaceRelativePath(
            definitionUri(definition), 'parsers', 'step_types.py'
        );
        try {
            await configuration.update('stepParserFiles', 'steps/**/*.py', vscode.ConfigurationTarget.Workspace);
            assert.strictEqual((await getDefinitions(document, position)).some(isParser), false);

            await configuration.update('stepParserFiles', ['steps/**/*.py', 'parsers/**/*.py'], vscode.ConfigurationTarget.Workspace);
            const definitions = await waitFor('configured Python parser', () => getDefinitions(document, position),
                (result) => result.some(isParser));
            assert.ok(definitions.some(isParser));

            await configuration.update('stepParserFiles', [], vscode.ConfigurationTarget.Workspace);
            assert.strictEqual((await getDefinitions(document, position)).some(isParser), false);
        } finally {
            await configuration.update('stepParserFiles', original, vscode.ConfigurationTarget.Workspace);
        }
    });

    test('refreshes cached Python parser locations after a file changes', async () => {
        const folder = getWorkspaceFolder();
        const sourceUri = vscode.Uri.joinPath(folder.uri, 'steps', 'type-navigation.py');
        const parserUri = vscode.Uri.joinPath(folder.uri, 'parsers', 'step_types.py');
        const document = await vscode.workspace.openTextDocument(sourceUri);
        await vscode.window.showTextDocument(document);
        const position = new vscode.Position(0, document.lineAt(0).text.indexOf('NoWhitespaceString') + 2);
        const original = await vscode.workspace.fs.readFile(parserUri);
        const parserLine = (definition: vscode.Location | vscode.LocationLink) =>
            definition instanceof vscode.Location ? definition.range.start.line : definition.targetRange.start.line;
        const hasParserAtLine = (line: number) => (definitions: readonly (vscode.Location | vscode.LocationLink)[]) =>
            definitions.some((definition) => isWorkspaceRelativePath(
                definitionUri(definition), 'parsers', 'step_types.py'
            ) && parserLine(definition) === line);
        try {
            await waitFor('initial Python parser', () => getDefinitions(document, position), hasParserAtLine(0));
            await vscode.workspace.fs.writeFile(parserUri, Buffer.concat([Buffer.from('\n'), Buffer.from(original)]));
            await waitFor('updated Python parser', () => getDefinitions(document, position), hasParserAtLine(1));
        } finally {
            await vscode.workspace.fs.writeFile(parserUri, original);
        }
    });

    test('navigates from a feature fixture tag and respects fixture search paths', async () => {
        const document = await openFixture('fixture-navigation.feature');
        const position = new vscode.Position(0, document.lineAt(0).text.indexOf('clear') + 1);
        const configuration = vscode.workspace.getConfiguration('cucumberautocomplete', getWorkspaceFolder().uri);
        const original = configuration.inspect<string | string[]>('fixtureFiles')?.workspaceValue;
        const isFixture = (definition: vscode.Location | vscode.LocationLink) => isWorkspaceRelativePath(
            definitionUri(definition), 'fixtures', 'fixtures.py'
        );
        try {
            await configuration.update('fixtureFiles', 'fixtures/**/*.py', vscode.ConfigurationTarget.Workspace);
            const definitions = await waitFor('Python fixture definition', () => getDefinitions(document, position),
                (result) => result.some(isFixture));
            const fixtureLink = definitions.find(isFixture);
            assert.ok(fixtureLink && 'targetUri' in fixtureLink);
            assert.ok(fixtureLink.originSelectionRange);
            assert.strictEqual(document.getText(fixtureLink.originSelectionRange), '@fixture.setup.clear.all');

            const cachedDefinitions = await getDefinitions(document, new vscode.Position(2, 3));
            const cachedLink = cachedDefinitions.find(isFixture);
            assert.ok(cachedLink && 'targetUri' in cachedLink);
            assert.ok(cachedLink.originSelectionRange);
            assert.strictEqual(cachedLink.originSelectionRange.start.line, 2);
            assert.strictEqual(document.getText(cachedLink.originSelectionRange), '@fixture.setup.clear.all');

            const numericPosition = new vscode.Position(0, document.lineAt(0).text.indexOf('5d'));
            await waitFor('fixture with a numeric name segment', () => getDefinitions(document, numericPosition),
                (result) => result.some((definition) => {
                    const range = definition instanceof vscode.Location ? definition.range : definition.targetRange;
                    return isFixture(definition) && range.start.line === 5;
                }));

            await configuration.update('fixtureFiles', [], vscode.ConfigurationTarget.Workspace);
            assert.strictEqual((await getDefinitions(document, position)).some(isFixture), false);
        } finally {
            await configuration.update('fixtureFiles', original, vscode.ConfigurationTarget.Workspace);
        }
    });

    test('completion and completion resolve', async () => {
        const document = await openFixture('completion.feature');
        const line = 2;
        const position = document.lineAt(line).range.end;
        const executeCompletions = (itemResolveCount?: number) =>
            vscode.commands.executeCommand<vscode.CompletionList>(
                'vscode.executeCompletionItemProvider',
                document.uri,
                position,
                undefined,
                itemResolveCount
            );
        const unresolvedCompletions = await waitFor(
            'unresolved step completion',
            () => executeCompletions(),
            (result) =>
                result.items.some((item) => item.label === 'I complete an e2e step')
        );
        const unresolvedCompletion = unresolvedCompletions.items.find(
            (item) => item.label === 'I complete an e2e step'
        );
        assert.ok(unresolvedCompletion, 'Expected the unresolved step completion.');
        const originalSortText = unresolvedCompletion.sortText;
        assert.ok(originalSortText, 'Expected the completion to have sort text.');

        const resolvedCompletions = await waitFor(
            'resolved step completion',
            () => executeCompletions(10),
            (result) =>
                result.items.some((item) => item.label === 'I complete an e2e step')
        );

        const completion = resolvedCompletions.items.find(
            (item) => item.label === 'I complete an e2e step'
        );
        assert.ok(completion, 'Expected the resolved step completion.');
        assert.ok(completion.insertText instanceof vscode.SnippetString);
        assert.strictEqual(completion.insertText.value, 'e2e step');

        const reorderedCompletions = await waitFor(
            'completion usage ordering after resolve',
            () => executeCompletions(),
            (result) => {
                const reordered = result.items.find(
                    (item) => item.label === 'I complete an e2e step'
                );
                return Boolean(
                    reordered && reordered.sortText !== originalSortText
                );
            }
        );
        const reorderedCompletion = reorderedCompletions.items.find(
            (item) => item.label === 'I complete an e2e step'
        );
        assert.ok(reorderedCompletion);
        assert.notStrictEqual(reorderedCompletion.sortText, originalSortText);
    });

    test('diagnostics', async () => {
        const document = await openFixture('diagnostics.feature');
        const diagnostics = await waitFor(
            'missing-step diagnostics',
            () => Promise.resolve(vscode.languages.getDiagnostics(document.uri)),
            (items) =>
                items.some(
                    (item) =>
                        item.source === 'cucumberautocomplete' &&
                        item.message.includes('undefined e2e step')
                )
        );

        assert.ok(
            diagnostics.some(
                (item) => item.severity === vscode.DiagnosticSeverity.Warning
            )
        );
    });

    test('configuration reload and definition fallback', async () => {
        const document = await openFixture('definition.feature');
        const position = document.lineAt(2).range.end;
        const folder = getWorkspaceFolder();
        const configuration = vscode.workspace.getConfiguration(
            'cucumberautocomplete',
            folder.uri
        );
        const originalSteps = configuration.get<string | string[]>('steps');

        try {
            await configuration.update(
                'steps',
                [],
                vscode.ConfigurationTarget.Workspace
            );
            const definitions = await waitFor(
                'definition fallback after disabling steps',
                () => getDefinitions(document, position),
                (result) =>
                    result.some(
                        (definition) =>
                            definitionUri(definition).toString() ===
                            document.uri.toString()
                    )
            );

            assert.ok(
                definitions.some(
                    (definition) =>
                        definitionUri(definition).toString() ===
                        document.uri.toString()
                )
            );
        } finally {
            await configuration.update(
                'steps',
                originalSteps,
                vscode.ConfigurationTarget.Workspace
            );
        }

        await waitFor(
            'step definition after restoring configuration',
            () => getDefinitions(document, position),
            (result) =>
                result.some((definition) =>
                    isWorkspaceRelativePath(
                        definitionUri(definition),
                        'steps',
                        'steps.js'
                    )
                )
        );
    });

    test('go to definition', async () => {
        const document = await openFixture('definition.feature');
        const line = 2;
        const position = new vscode.Position(
            line,
            document.lineAt(line).text.length - 1
        );
        const definitions = await waitFor(
            'step definition',
            () => getDefinitions(document, position),
            (result) => Array.isArray(result) && result.length > 0
        );
        const [definition] = definitions;
        const targetUri = definitionUri(definition);

        assert.ok(targetUri, 'Definition result did not contain a target URI.');
        assert.ok(isWorkspaceRelativePath(targetUri, 'steps', 'steps.js'));
    });

    test('step configuration accepts a string', async () => {
        const document = await openFixture('definition.feature');
        const position = document.lineAt(2).range.end;
        const folder = getWorkspaceFolder();
        const configuration = vscode.workspace.getConfiguration(
            'cucumberautocomplete',
            folder.uri
        );
        const originalSteps = configuration.get<string | string[]>('steps');

        try {
            await configuration.update(
                'steps',
                [],
                vscode.ConfigurationTarget.Workspace
            );
            const fallbackDefinitions = await waitFor(
                'definition fallback before applying a string configuration',
                () => getDefinitions(document, position),
                (result) =>
                    result.some(
                        (definition) =>
                            definitionUri(definition).toString() ===
                            document.uri.toString()
                    )
            );
            assert.ok(
                fallbackDefinitions.some(
                    (definition) =>
                        definitionUri(definition).toString() ===
                        document.uri.toString()
                )
            );

            await configuration.update(
                'steps',
                'steps/**/*.js',
                vscode.ConfigurationTarget.Workspace
            );
            const definitions = await waitFor(
                'step definition with a string configuration',
                () => getDefinitions(document, position),
                (result) =>
                    result.some((definition) =>
                        isWorkspaceRelativePath(
                            definitionUri(definition),
                            'steps',
                            'steps.js'
                        )
                    )
            );

            assert.ok(
                definitions.some((definition) =>
                    isWorkspaceRelativePath(
                        definitionUri(definition),
                        'steps',
                        'steps.js'
                    )
                )
            );
        } finally {
            await configuration.update(
                'steps',
                originalSteps,
                vscode.ConfigurationTarget.Workspace
            );
        }
    });

    test('formatting', async () => {
        const document = await openFixture('formatting.feature');
        const edits = await waitFor(
            'document formatting edits',
            () =>
                vscode.commands.executeCommand<readonly vscode.TextEdit[]>(
                    'vscode.executeFormatDocumentProvider',
                    document.uri,
                    { insertSpaces: true, tabSize: 2 }
                ),
            (result) => Array.isArray(result) && result.length > 0
        );

        assert.ok(
            edits.some(
                (edit) => edit.range.start.line === 1 && edit.newText === '  '
            ),
            `Expected a Scenario indent edit, got: ${JSON.stringify(edits)}`
        );
        assert.ok(
            edits.some(
                (edit) => edit.range.start.line === 2 && edit.newText === '    '
            ),
            `Expected a step indent edit, got: ${JSON.stringify(edits)}`
        );
    });

    test('range formatting', async () => {
        const document = await openFixture('formatting.feature');
        const range = new vscode.Range(
            new vscode.Position(1, 0),
            document.lineAt(2).range.end
        );
        const edits = await vscode.commands.executeCommand<
            readonly vscode.TextEdit[]
        >(
            'vscode.executeFormatRangeProvider',
            document.uri,
            range,
            { insertSpaces: true, tabSize: 2 }
        );
        const formatted = applyTextEdits(document, edits).split(/\r?\n/);

        assert.strictEqual(formatted[0], 'Feature: E2E formatting');
        assert.strictEqual(formatted[1], '  Scenario: format a feature');
        assert.strictEqual(formatted[2], '    Given I complete an e2e step');
    });

    test('on-type formatting setting', async () => {
        const document = await openFixture('formatting.feature');
        const folder = getWorkspaceFolder();
        const configuration = vscode.workspace.getConfiguration(
            'cucumberautocomplete',
            folder.uri
        );
        const position = document.lineAt(2).range.end;
        const executeOnTypeFormatting = () =>
            vscode.commands.executeCommand<readonly vscode.TextEdit[] | undefined>(
                'vscode.executeFormatOnTypeProvider',
                document.uri,
                position,
                ' ',
                { insertSpaces: true, tabSize: 2 }
            );

        const disabledEdits = await executeOnTypeFormatting();
        assert.strictEqual(disabledEdits, undefined);

        try {
            await configuration.update(
                'onTypeFormat',
                true,
                vscode.ConfigurationTarget.Workspace
            );
            const enabledEdits = await waitFor(
                'enabled on-type formatting',
                executeOnTypeFormatting,
                (edits) => Boolean(edits?.length)
            );
            assert.ok(enabledEdits);
            const formatted = applyTextEdits(document, enabledEdits).split(
                /\r?\n/
            );

            assert.strictEqual(formatted[1], '  Scenario: format a feature');
            assert.strictEqual(
                formatted[2],
                '    Given I complete an e2e step'
            );
        } finally {
            await configuration.update(
                'onTypeFormat',
                false,
                vscode.ConfigurationTarget.Workspace
            );
        }
    });

    test('step file watcher reloads step definitions', async () => {
        const document = await openFixture('watcher.feature');
        const missingMessage = 'I watch a new e2e step';
        const position = document.lineAt(2).range.end;
        await waitFor(
            'missing watched step diagnostics',
            () => Promise.resolve(vscode.languages.getDiagnostics(document.uri)),
            (diagnostics) =>
                diagnostics.some((item) => item.message.includes(missingMessage))
        );

        const folder = getWorkspaceFolder();
        const stepsUri = vscode.Uri.joinPath(folder.uri, 'steps', 'steps.js');
        const originalSteps = await vscode.workspace.fs.readFile(stepsUri);
        const appendedSteps = Buffer.concat([
            Buffer.from(originalSteps),
            Buffer.from(
                '\nWhen(/^I watch a new e2e step$/, function () {});\n'
            ),
        ]);

        try {
            await vscode.workspace.fs.writeFile(stepsUri, appendedSteps);
            const definitions = await waitFor(
                'watched step definition reload',
                () => getDefinitions(document, position),
                (result) =>
                    result.some((definition) =>
                        isWorkspaceRelativePath(
                            definitionUri(definition),
                            'steps',
                            'steps.js'
                        )
                    )
            );
            assert.ok(
                definitions.some((definition) =>
                    isWorkspaceRelativePath(
                        definitionUri(definition),
                        'steps',
                        'steps.js'
                    )
                )
            );

            const diagnostics = await waitFor(
                'watched step diagnostic removal',
                () =>
                    Promise.resolve(
                        vscode.languages.getDiagnostics(document.uri)
                    ),
                (items) =>
                    !items.some((item) =>
                        item.message.includes(missingMessage)
                    )
            );
            assert.ok(
                !diagnostics.some((item) =>
                    item.message.includes(missingMessage)
                )
            );
        } finally {
            await vscode.workspace.fs.writeFile(stepsUri, originalSteps);
        }
    });
});
