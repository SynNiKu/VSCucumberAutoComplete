import * as path from 'path';

import { workspace, window, languages, ExtensionContext, Range, TextEditor } from 'vscode';
import { getExamplesHeaderLines } from './examplesHeaders';
import { PythonDefinitionProvider } from './pythonStepNavigation';
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind,
} from 'vscode-languageclient/node';

let client: LanguageClient;

interface ParameterGroup {
    line: number;
    start: number;
    end: number;
}

export function activate(context: ExtensionContext) {
    const pythonDefinitions = new PythonDefinitionProvider();
    context.subscriptions.push(languages.registerDefinitionProvider(
        [{ scheme: 'file', language: 'python' }, { scheme: 'file', language: 'feature' }],
        pythonDefinitions
    ));
    context.subscriptions.push(pythonDefinitions);
    // Node server module
    const serverModule = context.asAbsolutePath(
        path.join('gserver', 'out', 'server.js')
    );

    // If the extension is launched in debug mode then the debug server options are used
    // Otherwise the run options are used
    const serverOptions: ServerOptions = {
        run: { module: serverModule, transport: TransportKind.ipc },
        debug: {
            module: serverModule,
            transport: TransportKind.ipc,
        },
    };

    // Options to control the language client
    const clientOptions: LanguageClientOptions = {
    // Register the server for Cucumber feature files
        documentSelector: [{ scheme: 'file', language: 'feature' }],
        synchronize: {
            // Notify the server about file changes to '.clientrc files contain in the workspace
            fileEvents: workspace.createFileSystemWatcher('**/.clientrc'),
        },
    };

    // Create the language client and start the client.
    client = new LanguageClient(
        'cucumberautocomplete-client',
        'Cucumber auto complete plugin',
        serverOptions,
        clientOptions
    );

    const parameterDecoration = window.createTextEditorDecorationType({
        fontStyle: 'italic',
        fontWeight: 'normal',
    });
    const examplesHeaderDecoration = window.createTextEditorDecorationType({
        fontWeight: 'bold',
        textDecoration: 'underline',
    });
    context.subscriptions.push(parameterDecoration, examplesHeaderDecoration);

    // The server returns whole parameter groups so italics span embedded placeholders.
    // Discard replies for older edits or requests that completed out of order.
    const versions = new WeakMap<TextEditor, number>();
    let ready = false;
    const updateEditor = async (editor: TextEditor) => {
        const sequence = (versions.get(editor) || 0) + 1;
        versions.set(editor, sequence);
        const document = editor.document;
        const isFeatureFile = document.languageId === 'feature' && document.uri.scheme === 'file';
        const headerRanges = isFeatureFile
            ? getExamplesHeaderLines(document.getText()).map((line) => {
                const text = document.lineAt(line).text;
                return new Range(line, text.indexOf('|'), line, text.length);
            })
            : [];
        editor.setDecorations(examplesHeaderDecoration, headerRanges);
        if (!ready || !isFeatureFile ||
            workspace.getConfiguration('editor', document.uri).get('semanticHighlighting.enabled') === false) {
            editor.setDecorations(parameterDecoration, []);
            return;
        }
        const version = document.version;
        try {
            const groups = await client.sendRequest<ParameterGroup[]>('cucumberautocomplete/parameterGroups', {
                text: document.getText(),
            });
            if (
                versions.get(editor) !== sequence ||
                document.version !== version ||
                !window.visibleTextEditors.includes(editor)
            ) {
                return;
            }
            editor.setDecorations(parameterDecoration, groups.map((group) =>
                new Range(group.line, group.start, group.line, group.end)
            ));
        } catch {
            if (versions.get(editor) === sequence) editor.setDecorations(parameterDecoration, []);
        }
    };
    const updateVisibleEditors = () => window.visibleTextEditors.forEach((editor) => { void updateEditor(editor); });
    context.subscriptions.push(
        window.onDidChangeVisibleTextEditors(updateVisibleEditors),
        workspace.onDidChangeTextDocument((event) => {
            window.visibleTextEditors.filter((editor) => editor.document === event.document)
                .forEach((editor) => { void updateEditor(editor); });
        }),
        workspace.onDidChangeConfiguration(updateVisibleEditors),
    );
    // Starting the client also launches the server.
    client.start().then(() => {
        ready = true;
        context.subscriptions.push(client.onNotification('cucumberautocomplete/parameterGroupsChanged', updateVisibleEditors));
        updateVisibleEditors();
    });
}

export function deactivate(): Thenable<void> | undefined {
    if (!client) {
        return undefined;
    }
    return client.stop();
}
