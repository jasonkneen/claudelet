/**
 * Theme types for customization
 */

export interface Theme {
  name: string;
  description: string;
  colors: {
    // Primary colors
    primary: string;
    secondary: string;
    accent: string;
    muted: string;
    // Messages
    userMessage: string;
    assistantMessage: string;
    systemMessage: string;
    errorMessage: string;
    // UI elements
    border: string;
    inputBorder: string;
    statusBar: string;
    highlight: string;
    background: string;
    // Chips/badges
    toolChip: string;
    toolChipActive: string;
    thinkingChip: string;
    // KITT animation
    kittColor: string;
    kittBracket: string;
    kittLit: string;
    kittDim: string;
    kittFaint: string;
    kittOff: string;
    // Status indicators
    success: string;
    warning: string;
    error: string;
    info: string;
    // Separators
    separator: string;
  };
}
