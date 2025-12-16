"use strict";
/**
 * LSP Types
 * Core type definitions for the LSP client package
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DiagnosticSeverity = void 0;
/**
 * LSP Diagnostic severity levels
 */
var DiagnosticSeverity;
(function (DiagnosticSeverity) {
    DiagnosticSeverity[DiagnosticSeverity["Error"] = 1] = "Error";
    DiagnosticSeverity[DiagnosticSeverity["Warning"] = 2] = "Warning";
    DiagnosticSeverity[DiagnosticSeverity["Information"] = 3] = "Information";
    DiagnosticSeverity[DiagnosticSeverity["Hint"] = 4] = "Hint";
})(DiagnosticSeverity || (exports.DiagnosticSeverity = DiagnosticSeverity = {}));
//# sourceMappingURL=types.js.map