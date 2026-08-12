/**
 * Minimal ambient typings for the NLP.js alpha packages (they ship plain
 * JavaScript without declarations). Only the surface actually used by the
 * offline Trivo Support engine is declared.
 */
declare module "@nlpjs/core" {
  export interface NlpContainer {
    use(plugin: unknown): void;
    get<T = unknown>(name: string): T;
    register(name: string, item: unknown, isSingleton?: boolean): void;
  }
  export function containerBootstrap(): Promise<NlpContainer>;
  export const defaultContainer: NlpContainer;
  export class Container {
    use(plugin: unknown): void;
    get<T = unknown>(name: string): T;
  }
}

declare module "@nlpjs/nlp" {
  export interface NlpClassification {
    intent: string;
    score: number;
  }
  export interface NlpResult {
    locale: string;
    intent: string;
    score: number;
    answer?: string;
    classifications?: NlpClassification[];
  }
  export class Nlp {
    settings: Record<string, unknown>;
    addLanguage(locale: string | string[]): void;
    addDocument(locale: string, utterance: string, intent: string): void;
    addAnswer(locale: string, intent: string, answer: string): void;
    train(): Promise<unknown>;
    process(locale: string, utterance: string): Promise<NlpResult>;
  }
  const _default: unknown;
  export default _default;
}

declare module "@nlpjs/lang-ru" {
  export class LangRu {}
  const _default: unknown;
  export default _default;
}

declare module "@nlpjs/lang-en" {
  export class LangEn {}
  const _default: unknown;
  export default _default;
}