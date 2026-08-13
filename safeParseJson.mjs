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
        .replace(/```\s*$/, "");

    try { return JSON.parse(cleaned); } catch (e) {}

    const extracted = extractBalancedJson(cleaned);
    if (extracted) { try { return JSON.parse(extracted); } catch (e) {} }

    try { return JSON.parse(jsonrepair(extracted || cleaned)); } catch (e) {
        throw new Error("Failed to parse structured JSON from model response: " + text);
    }
}
