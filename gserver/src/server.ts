import * as glob from 'glob';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

import {
    createConnection,
    TextDocuments,
    InitializeResult,
    Diagnostic,
    TextDocumentPositionParams,
    CompletionItem,
    Range,
    Position,
    DocumentFormattingParams,
    TextEdit,
    DocumentRangeFormattingParams,
    Location,
    ProposedFeatures,
    InitializeParams,
    DidChangeConfigurationNotification,
    TextDocumentSyncKind,
    DocumentDiagnosticReportKind,
    DocumentDiagnosticReport,
    SemanticTokensBuilder,
    ReferenceParams,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';

import { format, clearText, getIndent } from './format';
import StepsHandler from './steps.handler';
import PagesHandler from './pages.handler';
import { getReferenceFilePatterns, normalizeSettings } from './settings';
import { getOSPath, clearGherkinComments } from './util';
import { Settings } from './types';
import { getParameterRanges, ParameterGroup } from './parameter.tokens';

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager.
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
let hasSemanticRefreshCapability = false;

//Path to the root of our workspace
let workspaceRoot: string;
// Object, which contains current configuration
let globalSettings: Settings | undefined;
// Elements handlers
let stepsHandler: StepsHandler;
let pagesHandler: PagesHandler;

connection.onInitialize((params: InitializeParams) => {
    workspaceRoot = params.rootPath || '';

    const capabilities = params.capabilities;

    // Does the client support the `workspace/configuration` request?
    // If not, we fall back using global settings.
    hasConfigurationCapability = !!(
        capabilities.workspace && !!capabilities.workspace.configuration
    );
    hasWorkspaceFolderCapability = !!(
        capabilities.workspace && !!capabilities.workspace.workspaceFolders
    );
    hasSemanticRefreshCapability = !!capabilities.workspace?.semanticTokens?.refreshSupport;

    const result: InitializeResult = {
        capabilities: {
            // Full text sync mode
            textDocumentSync: TextDocumentSyncKind.Full,
            //Completion will be triggered after every character pressing
            completionProvider: {
                resolveProvider: true,
            },
            diagnosticProvider: {
                interFileDependencies: false,
                workspaceDiagnostics: false
            },
            definitionProvider: true,
            referencesProvider: true,
            semanticTokensProvider: {
                legend: { tokenTypes: ['gherkinParameterValue', 'gherkinOutlineParameter'], tokenModifiers: [] },
                full: true,
            },
            documentFormattingProvider: true,
            documentRangeFormattingProvider: true,
            documentOnTypeFormattingProvider: {
                firstTriggerCharacter: ' ',
                moreTriggerCharacter: ['@', '#', ':'],
            },
        },
    };
    if (hasWorkspaceFolderCapability) {
        result.capabilities.workspace = {
            workspaceFolders: {
                supported: true
            }
        };
    }
    return result;
});

connection.onInitialized(() => {
    if (hasConfigurationCapability) {
        // Register for all configuration changes.
        connection.client.register(DidChangeConfigurationNotification.type, undefined);
    }
    if (hasWorkspaceFolderCapability) {
        connection.workspace.onDidChangeWorkspaceFolders(_event => {
            connection.console.log('Workspace folder change event received.');
        });
    }
});

async function getSettings(forceReset?: boolean) {
    if (!globalSettings || forceReset) {
        const baseSettings = await connection.workspace.getConfiguration({
            section: 'cucumberautocomplete'
        });
        globalSettings = normalizeSettings(baseSettings);
    }
    return globalSettings;
}

function shouldHandleSteps(settings: Settings) {
    return settings.steps.length > 0;
}

function shouldHandlePages(settings: Settings) {
    const p = settings.pages;
    return p && Object.keys(p).length ? true : false;
}

function pagesPosition(line: string, char: number, settings: Settings) {
    if (
        shouldHandlePages(settings) &&
    pagesHandler &&
    pagesHandler.getFeaturePosition(line, char)
    ) {
        return true;
    } else {
        return false;
    }
}

async function revalidateAllDocuments() {
    connection.languages.diagnostics.refresh();
}

function refreshParameterHighlighting() {
    // Semantic tokens color each part; the custom notification refreshes whole-group italics.
    if (hasSemanticRefreshCapability) {
        connection.languages.semanticTokens.refresh();
    }
    connection.sendNotification('cucumberautocomplete/parameterGroupsChanged');
}

function watchStepsFiles(settings: Settings) {    
    settings.steps.forEach((path) => {
        glob
            .sync(workspaceRoot + '/' + path, { ignore: '.gitignore' })
            .forEach((f) => {
                fs.unwatchFile(f);
                fs.watchFile(f, async () => {
                    const settings = await getSettings();
                    populateHandlers(settings);
                    revalidateAllDocuments();
                    refreshParameterHighlighting();
                });
            });
    });
}

function initStepsAndPagesSetup(settings: Settings) {
    watchStepsFiles(settings);
    initHandlers(settings);
    populateHandlers(settings);
    validateStepsConfiguration(settings);
}

function validateStepsConfiguration(settings: Settings) {
    const { steps } = settings;
    if (shouldHandleSteps(settings)) {
        const sFile = '.vscode/settings.json';
        const diagnostics = stepsHandler.validateConfiguration(
            sFile,
            steps,
            workspaceRoot
        );
        connection.sendDiagnostics({
            uri: getOSPath(workspaceRoot + '/' + sFile),
            diagnostics,
        });
    }
}

connection.onDidChangeConfiguration(async (change) => {
    const settings = await getSettings(true);
    // TODO - should we check that our settings were changed before do this?
    initStepsAndPagesSetup(settings);
    revalidateAllDocuments();
    refreshParameterHighlighting();
});

connection.onRequest('cucumberautocomplete/parameterGroups', async (params: { text: string }) => {
    const settings = await getSettings();
    const groups: ParameterGroup[] = [];
    if (typeof params?.text === 'string' && shouldHandleSteps(settings) && stepsHandler) {
        getParameterRanges(stepsHandler, params.text, groups);
    }
    return groups;
});

connection.languages.semanticTokens.on(async (params) => {
    const builder = new SemanticTokensBuilder();
    const document = documents.get(params.textDocument.uri);
    const settings = await getSettings();
    if (document && shouldHandleSteps(settings) && stepsHandler) {
        getParameterRanges(stepsHandler, document.getText()).forEach((range) => {
            builder.push(range.line, range.start, range.end - range.start, range.type === 'parameter' ? 0 : 1, 0);
        });
    }
    return builder.build();
});

function initHandlers(settings: Settings) {
    if (shouldHandleSteps(settings)) {
        stepsHandler = new StepsHandler(workspaceRoot, settings);
    }
    if (shouldHandlePages(settings)) {
        pagesHandler = new PagesHandler(workspaceRoot, settings);
    }
}

function populateHandlers(settings: Settings) {
    if (shouldHandleSteps(settings)) {
        stepsHandler?.populate(workspaceRoot, settings.steps);
    }
    if (shouldHandlePages(settings)) {
        pagesHandler?.populate(workspaceRoot, settings.pages);
    }
}

documents.onDidOpen(async () => {
    const settings = await getSettings(true);
    initStepsAndPagesSetup(settings);
    connection.sendNotification('cucumberautocomplete/parameterGroupsChanged');
});

connection.onCompletion(
    async (position: TextDocumentPositionParams) => {
        const settings = await getSettings();
        const textDocument = documents.get(position.textDocument.uri);
        const text = textDocument?.getText() || '';
        const line = text.split(/\r?\n/g)[position.position.line];
        const char = position.position.character;
        if (pagesPosition(line, char, settings) && pagesHandler) {
            return pagesHandler.getCompletion(line, position.position);
        }
        if (shouldHandleSteps(settings) && stepsHandler) {
            return stepsHandler.getCompletion(line, position.position.line, text);
        }
    }
);

connection.onCompletionResolve((item: CompletionItem) => {
    if (~item.data.indexOf('step')) {
        return stepsHandler.getCompletionResolve(item);
    }
    if (~item.data.indexOf('page')) {
        return pagesHandler.getCompletionResolve(item);
    }
    return item;
});

function validate(text: string, settings: Settings) {
    return text.split(/\r?\n/g).reduce((res, line, i) => {
        let diagnostic;
        if (
            shouldHandleSteps(settings) &&
      stepsHandler &&
      (diagnostic = stepsHandler.validate(line, i, text))
        ) {
            res.push(diagnostic);
        } else if (shouldHandlePages(settings) && pagesHandler) {
            const pagesDiagnosticArr = pagesHandler.validate(line, i);
            res = res.concat(pagesDiagnosticArr);
        }
        return res;
    }, [] as Diagnostic[]);
}

connection.languages.diagnostics.on(async (params) => {
    const document = documents.get(params.textDocument.uri);
    if (document !== undefined) {
        const settings = await getSettings();
        const text = document.getText();
        const diagnostics = validate(clearGherkinComments(text), settings);
        return {
            kind: DocumentDiagnosticReportKind.Full,
            items: diagnostics,
        } satisfies DocumentDiagnosticReport;
    } else {
        // We don't know the document. We can either try to read it from disk
        // or we don't report problems for it.
        return {
            kind: DocumentDiagnosticReportKind.Full,
            items: []
        } satisfies DocumentDiagnosticReport;
    }
});

connection.onDefinition(async (position: TextDocumentPositionParams) => {
    const settings = await getSettings();
    const textDocument = documents.get(position.textDocument.uri);
    const text = textDocument?.getText() || '';
    const line = text.split(/\r?\n/g)[position.position.line];
    // Fixture tags are resolved by the client's Python definition provider.
    if (/^\s*@/.test(line || '') && /(?:^|\s)@fixture\./.test(line)) return null;
    const char = position.position.character;
    const pos = position.position;
    const { uri } = position.textDocument;
    if (pagesPosition(line, char, settings) && pagesHandler) {
        return pagesHandler.getDefinition(line, char);
    }
    if (shouldHandleSteps(settings) && stepsHandler) {
        return stepsHandler.getDefinition(line, text);
    }
    return Location.create(uri, Range.create(pos, pos));
});

function sameFile(first: string, second: string): boolean {
    try {
        const firstPath = path.normalize(fileURLToPath(first));
        const secondPath = path.normalize(fileURLToPath(second));
        return process.platform === 'win32'
            ? firstPath.toLowerCase() === secondPath.toLowerCase()
            : firstPath === secondPath;
    } catch {
        return first === second;
    }
}

async function findStepReferences(params: ReferenceParams): Promise<Location[]> {
    const settings = await getSettings();
    if (!shouldHandleSteps(settings)) return [];
    if (!stepsHandler) initHandlers(settings);
    if (!stepsHandler) return [];

    const { uri } = params.textDocument;
    const document = documents.get(uri);
    const selected = document
        ? stepsHandler.getDocumentSteps(uri, document.getText())
            .filter((entry) => entry.location.range.start.line === params.position.line)
            .map((entry) => entry.step)
        : stepsHandler.getElements().filter((step) => {
            const definition = step.def as Location;
            return sameFile(definition.uri, uri) && definition.range.start.line === params.position.line;
        });
    if (!selected.length) return [];
    // Variants of one definition can have different completion IDs, but are the same step.
    const definitions = selected.map((step) => step.def as Location);
    const files = new Set<string>();
    for (const pattern of getReferenceFilePatterns(settings.featureFiles)) {
        try {
            glob.sync(workspaceRoot + '/' + pattern, { absolute: true, nodir: true })
                .forEach((file) => files.add(file));
        } catch {
            // Ignore malformed patterns.
        }
    }
    const references: Location[] = [];
    for (const file of files) {
        if (!/\.(?:feature|testcase)$/i.test(file) || /(?:^|[\\/])(?:credentials|secrets)(?:[\\/]|$)/i.test(file)) {
            continue;
        }
        const fileUri = getOSPath(file);
        const openDocument = documents.all().find((item) => sameFile(item.uri, fileUri));
        const featureUri = openDocument?.uri ?? fileUri;
        let text: string;
        try {
            text = openDocument?.getText() ?? fs.readFileSync(file, 'utf8');
        } catch {
            continue;
        }
        stepsHandler.getDocumentSteps(featureUri, text).forEach((entry) => {
            const definition = entry.step.def as Location;
            if (definitions.some((candidate) => sameFile(candidate.uri, definition.uri) &&
                candidate.range.start.line === definition.range.start.line &&
                candidate.range.start.character === definition.range.start.character)) {
                references.push(entry.location);
            }
        });
    }
    if (params.context.includeDeclaration) {
        const seen = new Set<string>();
        selected.forEach((step) => {
            const definition = step.def as Location;
            const key = `${definition.uri}:${definition.range.start.line}:${definition.range.start.character}`;
            if (!seen.has(key)) {
                seen.add(key);
                references.push(definition);
            }
        });
    }
    return references;
}

connection.onReferences(findStepReferences);
// Step definition documents are handled by the client and are not synchronized with this server.
connection.onRequest('cucumberautocomplete/stepReferences', findStepReferences);

connection.onDocumentFormatting(
    async (params: DocumentFormattingParams) => {
        const settings = await getSettings();
        const textDocument = documents.get(params.textDocument.uri);
        const text = textDocument?.getText() || '';
        const textArr = text.split(/\r?\n/g);
        const indent = getIndent(params.options);
        const range = Range.create(
            Position.create(0, 0),
            Position.create(textArr.length - 1, textArr[textArr.length - 1].length)
        );
        const formattedText = format(indent, text, settings);
        const clearedText = clearText(formattedText);
        return [TextEdit.replace(range, clearedText)];
    }
);

connection.onDocumentRangeFormatting(
    async (params: DocumentRangeFormattingParams) => {
        const settings = await getSettings();
        const textDocument = documents.get(params.textDocument.uri);
        const text = textDocument?.getText() || '';
        const textArr = text.split(/\r?\n/g);
        const range = params.range;
        const indent = getIndent(params.options);
        const finalRange = Range.create(
            Position.create(range.start.line, 0),
            Position.create(range.end.line, textArr[range.end.line].length)
        );
        const finalText = textArr
            .splice(
                finalRange.start.line,
                finalRange.end.line - finalRange.start.line + 1
            )
            .join('\r\n');
        const formattedText = format(indent, finalText, settings);
        const clearedText = clearText(formattedText);
        return [TextEdit.replace(finalRange, clearedText)];
    }
);

connection.onDocumentOnTypeFormatting(
    async (params: DocumentFormattingParams) => {
        const settings = await getSettings();
        if (settings.onTypeFormat === true) {
            const textDocument = documents.get(params.textDocument.uri);
            const text = textDocument?.getText() || '';
            const textArr = text.split(/\r?\n/g);
            const indent = getIndent(params.options);
            const range = Range.create(
                Position.create(0, 0),
                Position.create(textArr.length - 1, textArr[textArr.length - 1].length)
            );
            const formattedText = format(indent, text, settings);
            return [TextEdit.replace(range, formattedText)];
        } else {
            return [];
        }
    }
);

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
