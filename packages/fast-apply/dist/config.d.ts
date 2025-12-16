import type { ModelVariant, ModelDefinition } from './types';
/**
 * Available model variants and their specifications
 */
export declare const MODELS: Record<ModelVariant, ModelDefinition>;
/**
 * Default model to use (smallest, fastest download)
 */
export declare const DEFAULT_MODEL: ModelVariant;
/**
 * HuggingFace repository containing the models
 */
export declare const MODEL_REPO = "Kortix/FastApply-1.5B-v1.0_GGUF";
/**
 * Default storage directory for models (relative to home)
 */
export declare const DEFAULT_STORAGE_DIR = ".cluso/models/fast-apply";
/**
 * Inference timeout in milliseconds (30s - reduced from 60s for better UX)
 */
export declare const INFERENCE_TIMEOUT = 30000;
/**
 * Temperature for inference
 * Note: 0 causes instability in fine-tuned models, use small positive value
 */
export declare const TEMPERATURE = 0.1;
/**
 * Maximum tokens to generate (8192 for complete file outputs)
 */
export declare const MAX_TOKENS = 8192;
/**
 * System prompt for the FastApply model
 * Note: Must be specific about the model's task - vague prompts cause prose fallback
 */
export declare const SYSTEM_PROMPT = "You are a coding assistant that applies code updates by REPLACING matching elements in-place. When given an update snippet, find the matching element in the original code and REPLACE it - do NOT insert a duplicate. Preserve all other code exactly. Return only the complete updated code.";
/**
 * User prompt template for the FastApply model
 * Uses {original_code} and {update_snippet} placeholders
 * Note: Model outputs code directly, not wrapped in tags - it wasn't trained for that
 */
export declare const USER_PROMPT_TEMPLATE = "Apply the update to the code. If the update shows \"FIND: X\" and \"REPLACE WITH: Y\", find X in the code and replace it with Y. Do NOT insert duplicates - replace in-place.\n\n<code>\n{original_code}\n</code>\n\n<update>\n{update_snippet}\n</update>\n\nReturn the complete updated code with the change applied.";
/**
 * Build the full chat prompt for inference
 */
export declare function buildPrompt(originalCode: string, updateSnippet: string): string;
/**
 * Parse the model output to extract the updated code
 * Note: FastApply model outputs code directly without wrapper tags
 */
export declare function parseOutput(output: string): string | null;
//# sourceMappingURL=config.d.ts.map