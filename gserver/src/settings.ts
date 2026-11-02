import { BaseSettings, Settings } from './types';

export function getReferenceFilePatterns(value: unknown): string[] {
    if (typeof value !== 'string') return [];
    const pattern = value.trim().replace(/\\/g, '/');
    return pattern && !/^(?:[A-Za-z]:|\/)/.test(pattern) &&
        !/(?:^|[/{,])\.\.(?:$|[\/},])/.test(pattern) ? [pattern] : [];
}

export function normalizeSettings(baseSettings: BaseSettings): Settings {
    return {
        ...baseSettings,
        steps: new Array<string>()
            .concat(baseSettings?.steps ?? [])
            .filter((step) => typeof step === 'string' && step.trim().length > 0),
    };
}
