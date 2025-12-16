/**
 * Language Extension Mappings
 * Maps file extensions to LSP language identifiers
 */
export declare const LANGUAGE_EXTENSIONS: Record<string, string>;
/**
 * Get the LSP language ID for a file path
 */
export declare function getLanguageId(filePath: string): string;
/**
 * Get the file extension for a language ID
 */
export declare function getExtensionForLanguage(languageId: string): string | null;
//# sourceMappingURL=language.d.ts.map