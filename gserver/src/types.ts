export type StepSettings = string[];

export type PagesSettings = {
    [page: string]: string
};

export type CustomParameter = {
    isRegex?: false,
    parameter: string,
    value: string,
} | {
    isRegex: true,
    parameter: string,
    value: string,
    flags?: string;
};

type FormatConfVal = number | 'relative' | 'relativeUp';

export interface FormatConf {
    [key: string]: FormatConfVal
}

export interface BaseSettings {
    fixtureFiles?: string | string[],
    customParameters: CustomParameter[],
    formatConfOverride: FormatConf,
    gherkinDefinitionPart?: string,
    onTypeFormat: boolean,
    pages: PagesSettings,
    pureTextSteps: boolean
    skipDocStringsFormat: boolean,
    smartSnippets: boolean,
    stepRegExSymbol?: string
    stepParserFiles?: string | string[],
    steps: string | string[],
    stepsInvariants: boolean,
    strictGherkinCompletion: boolean,
    strictGherkinValidation: boolean,
    featureFiles: string,
}

export interface Settings {
    fixtureFiles?: string | string[],
    customParameters: CustomParameter[],
    formatConfOverride: FormatConf,
    gherkinDefinitionPart?: string,
    onTypeFormat: boolean,
    pages: PagesSettings,
    pureTextSteps: boolean
    skipDocStringsFormat: boolean,
    smartSnippets: boolean,
    stepRegExSymbol?: string
    stepParserFiles?: string | string[],
    steps: StepSettings,
    stepsInvariants: boolean,
    strictGherkinCompletion: boolean,
    strictGherkinValidation: boolean,
    featureFiles: string,
}
