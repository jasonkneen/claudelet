/**
 * Task Analyzer
 *
 * Analyzes user tasks to determine:
 * - Complexity (1-10 scale)
 * - Intent classification
 * - Required tools
 * - Suggested model for execution
 * - Whether task can be parallelized
 * - Whether task needs planning (Opus)
 */

import type { ModelPreference } from './types.js';
import type { OrchestrationPlan } from './orchestrator.js';

/**
 * Result of task analysis
 */
export interface TaskAnalysis {
  /** Intent classification */
  intent: string;
  /** Complexity score 1-10 */
  complexity: number;
  /** Estimated execution time */
  estimatedTime: 'fast' | 'medium' | 'slow';
  /** Tools likely needed */
  requiredTools: string[];
  /** Suggested model based on analysis */
  suggestedModel: ModelPreference;
  /** Can this task be split into parallel sub-tasks? */
  canParallelize: boolean;
  /** Does this task need Opus planning first? */
  needsPlanning: boolean;
  /** Optional plan if Opus was consulted */
  plan?: OrchestrationPlan;
  /** Confidence in the analysis (0-1) */
  confidence: number;
}

/**
 * Context for more accurate analysis
 */
export interface TaskContext {
  files?: string[];
  previousMessages?: Array<{ role: string; content: string }>;
  constraints?: string[];
}

/**
 * Patterns that indicate Haiku is appropriate (fast/simple tasks)
 */
const HAIKU_PATTERNS = [
  /\b(hi|hello|hey|greetings?|thanks?|thank\s*you|bye|goodbye)\b/i, // 🚀 Conversational/greetings
  /\b(ok|okay|yes|no|sure|cool|great|awesome|nice)\b/i, // 🚀 Acknowledgments
  /\b(search|find|grep|look\s*for)\b/i,
  /\b(read|cat|show|display|print)\b/i,
  /\b(list|ls|dir)\b/i,
  /\b(fetch|get|download)\b/i,
  /\b(typo|spelling|syntax)\b/i,
  /\b(simple|quick|fast|easy)\b/i,
  /\b(format|lint|prettier)\b/i,
  /\b(rename|move|copy|delete)\b/i,
  /\bwhat\s+(is|are|does)\b/i,
  /\b(check|verify|validate)\b/i
];

/**
 * Patterns that indicate Opus is appropriate (planning/complex tasks)
 */
const OPUS_PATTERNS = [
  /\b(plan|architect|design|strategy)\b/i,
  /\b(complex|complicated|intricate)\b/i,
  /\b(refactor|restructure|reorganize)\b/i,
  /\b(system|architecture|infrastructure)\b/i,
  /\b(critical|important|crucial|essential)\b/i,
  /\b(decide|choose|evaluate|compare)\b/i,
  /\b(migrate|upgrade|overhaul)\b/i,
  /\b(implement\s+entire|build\s+complete|create\s+full)\b/i,
  /\b(breaking\s+changes?|major\s+update)\b/i,
  /\b(security|authentication|authorization)\b/i
];

/**
 * Patterns that indicate multi-file/complex work
 */
const COMPLEXITY_PATTERNS = [
  { pattern: /\b(multiple|several|many|all)\s+(files?|components?|modules?)\b/i, score: 3 },
  { pattern: /\b(across|throughout|entire)\s+(codebase|project|repo)\b/i, score: 4 },
  { pattern: /\b(api|endpoint|route|controller)\b/i, score: 2 },
  { pattern: /\b(database|schema|migration|model)\b/i, score: 3 },
  { pattern: /\b(test|spec|coverage)\b/i, score: 2 },
  { pattern: /\b(error\s*handling|exception|try\s*catch)\b/i, score: 2 },
  { pattern: /\b(state|context|store|redux)\b/i, score: 2 },
  { pattern: /\b(async|await|promise|callback)\b/i, score: 1 },
  { pattern: /\b(type|interface|generic)\b/i, score: 1 },
  { pattern: /\b(integration|e2e|end.to.end)\b/i, score: 3 }
];

/**
 * Tools commonly needed for different task types
 */
const TOOL_INDICATORS: Record<string, RegExp[]> = {
  Bash: [
    /\b(run|execute|npm|yarn|pnpm|bun|git|docker|make)\b/i,
    /\b(install|build|test|deploy|start|stop)\b/i
  ],
  Read: [
    /\b(read|show|display|cat|view)\b/i,
    /\b(file|code|content|source)\b/i
  ],
  Write: [
    /\b(write|create|add|new)\b/i,
    /\b(file|component|module|class)\b/i
  ],
  Edit: [
    /\b(edit|modify|change|update|fix)\b/i,
    /\b(replace|remove|delete|insert)\b/i
  ],
  Grep: [
    /\b(search|find|grep|locate|look\s*for)\b/i,
    /\b(pattern|regex|match)\b/i
  ],
  WebFetch: [
    /\b(fetch|download|http|api|url)\b/i,
    /\b(web|online|remote)\b/i
  ],
  WebSearch: [
    /\b(search|google|look\s*up|research)\b/i,
    /\b(documentation|docs|how\s*to)\b/i
  ]
};

/**
 * Analyze a user task and determine routing
 */
export function analyzeTask(content: string, context?: TaskContext): TaskAnalysis {
  const lowerContent = content.toLowerCase();

  // Calculate complexity score
  let complexity = 1; // 🚀 Base complexity reduced from 3 to 1 - start lower, scale up as needed

  // Add complexity from patterns
  for (const { pattern, score } of COMPLEXITY_PATTERNS) {
    if (pattern.test(content)) {
      complexity += score;
    }
  }

  // Add complexity from context
  if (context?.files && context.files.length > 3) {
    complexity += Math.min(context.files.length - 3, 3);
  }
  if (context?.constraints && context.constraints.length > 0) {
    complexity += 1;
  }

  // Content length factor
  if (content.length > 500) complexity += 1;
  if (content.length > 1000) complexity += 1;

  // Cap complexity at 10
  complexity = Math.min(complexity, 10);

  // Determine intent
  const intent = classifyIntent(content);

  // Detect required tools
  const requiredTools = detectRequiredTools(content);

  // Check for Haiku patterns (reduce complexity)
  const isHaikuTask = HAIKU_PATTERNS.some(p => p.test(content));
  if (isHaikuTask && complexity < 5) {
    complexity = Math.max(1, complexity - 2);
  }

  // Check for Opus patterns (increase complexity)
  const isOpusTask = OPUS_PATTERNS.some(p => p.test(content));
  if (isOpusTask) {
    complexity = Math.max(complexity, 8);
  }

  // Determine suggested model
  let suggestedModel: ModelPreference;
  if (complexity <= 2) {
    suggestedModel = 'fast';
  } else if (complexity <= 5) {
    suggestedModel = isHaikuTask ? 'fast' : 'smart-sonnet';
  } else if (complexity <= 7) {
    suggestedModel = 'smart-sonnet';
  } else {
    suggestedModel = 'smart-opus';
  }

  // Determine if planning is needed
  const needsPlanning = complexity >= 8 || isOpusTask ||
    /\b(plan|architect|design|strategy|decompose)\b/i.test(content);

  // Determine estimated time
  let estimatedTime: 'fast' | 'medium' | 'slow';
  if (complexity <= 3) {
    estimatedTime = 'fast';
  } else if (complexity <= 6) {
    estimatedTime = 'medium';
  } else {
    estimatedTime = 'slow';
  }

  // Determine if parallelizable
  const canParallelize =
    /\b(and|also|additionally|plus)\b/i.test(content) ||
    /\b(multiple|several|each|all)\b/i.test(content);

  // Calculate confidence
  const confidence = calculateConfidence(content, complexity, isHaikuTask, isOpusTask);

  return {
    intent,
    complexity,
    estimatedTime,
    requiredTools,
    suggestedModel,
    canParallelize,
    needsPlanning,
    confidence
  };
}

/**
 * Classify the intent of the task
 */
function classifyIntent(content: string): string {
  const intents: Array<{ pattern: RegExp; intent: string }> = [
    { pattern: /\b(fix|bug|error|issue|problem)\b/i, intent: 'bug_fix' },
    { pattern: /\b(add|implement|create|new|build)\b/i, intent: 'feature' },
    { pattern: /\b(refactor|clean|improve|optimize)\b/i, intent: 'refactor' },
    { pattern: /\b(test|spec|coverage)\b/i, intent: 'testing' },
    { pattern: /\b(document|comment|explain)\b/i, intent: 'documentation' },
    { pattern: /\b(search|find|locate|where)\b/i, intent: 'search' },
    { pattern: /\b(read|show|display|what)\b/i, intent: 'read' },
    { pattern: /\b(run|execute|deploy|start)\b/i, intent: 'execution' },
    { pattern: /\b(plan|design|architect)\b/i, intent: 'planning' },
    { pattern: /\b(review|check|verify|validate)\b/i, intent: 'review' }
  ];

  for (const { pattern, intent } of intents) {
    if (pattern.test(content)) {
      return intent;
    }
  }

  return 'general';
}

/**
 * Detect which tools are likely needed
 */
function detectRequiredTools(content: string): string[] {
  const tools: string[] = [];

  for (const [tool, patterns] of Object.entries(TOOL_INDICATORS)) {
    if (patterns.some(p => p.test(content))) {
      tools.push(tool);
    }
  }

  return tools;
}

/**
 * Calculate confidence in the analysis
 */
function calculateConfidence(
  content: string,
  complexity: number,
  isHaikuTask: boolean,
  isOpusTask: boolean
): number {
  let confidence = 0.5; // Base confidence

  // Clear indicators increase confidence
  if (isHaikuTask) confidence += 0.2;
  if (isOpusTask) confidence += 0.2;

  // Very short or very long content reduces confidence
  if (content.length < 20) confidence -= 0.2;
  if (content.length > 2000) confidence -= 0.1;

  // Moderate complexity is less certain
  if (complexity >= 4 && complexity <= 6) confidence -= 0.1;

  // Clamp to valid range
  return Math.max(0.1, Math.min(1.0, confidence));
}

/**
 * Quick check if a task should go directly to Haiku
 */
export function isQuickTask(content: string): boolean {
  // Very short tasks are quick
  if (content.length < 50) return true;

  // Check for quick patterns
  return HAIKU_PATTERNS.some(p => p.test(content)) &&
    !OPUS_PATTERNS.some(p => p.test(content));
}

/**
 * Quick check if a task needs Opus planning
 */
export function needsOpusPlanning(content: string): boolean {
  return OPUS_PATTERNS.some(p => p.test(content)) ||
    content.length > 1000 ||
    /\b(entire|complete|full|whole)\s+(system|project|codebase)\b/i.test(content);
}
