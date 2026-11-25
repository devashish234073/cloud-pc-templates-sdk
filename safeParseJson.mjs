import { jsonrepair } from "jsonrepair";

function extractBalancedJson(text) {
    const start = text.indexOf('{');
    if (start === -1) return null;

    let depth = 0, inString = false, escaped = false;

    for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') inString = true;
        else if (ch === '{') depth++;
        else if (ch === '}') { depth--; if (depth === 0) return text.slice(start, i + 1); }
    }
    return null;
}

export function safeParseJson(text) {
    if (typeof text !== "string") throw new Error("Expected string response from model, got: " + typeof text);

    let cleaned = text.trim()
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/, "")
        .replace(/```\s*$/, "")
        .trim();

    let candidate = cleaned;

    // Trim surrounding prose unless the response already starts with { and ends with }.
    if (!(candidate.startsWith("{") && candidate.endsWith("}"))) {
        const firstBrace = candidate.indexOf("{");
        const lastBrace = candidate.lastIndexOf("}");

        if (firstBrace !== -1 && lastBrace > firstBrace) {
            candidate = candidate.slice(firstBrace, lastBrace + 1);
        }
    }

    try { return JSON.parse(candidate); } catch (e) {}

    const extracted = extractBalancedJson(candidate);
    if (extracted) { try { return JSON.parse(extracted); } catch (e) {} }

    try { return JSON.parse(jsonrepair(extracted || candidate)); } catch (e) {
        throw new Error("Failed to parse structured JSON from model response: " + text);
    }
}
