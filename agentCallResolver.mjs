import { Logger } from "./logger.mjs";

export class AgentCallResolver {
    sdk;
    logger;
    loginMode;
    constructor(sdk, loginMode) {
        this.logger = new Logger("AgentCallResolver");
        this.sdk = sdk;
        this.loginMode = loginMode;
    }

    async askForStructuredCall(prompt, apiContext) {
        const systemPrompt =
            "You are an API call resolver for an internal agent SDK.\n" +
            "Given API documentation/context and a user request, determine the exact HTTP call needed.\n" +
            "Respond with ONLY raw JSON, no markdown fences, no commentary.\n" +
            "If the call can be determined, respond with exactly this shape:\n" +
            '{"httpMethod": "GET|POST|PUT|DELETE|PATCH", "path": "/path/with?query=params", "body": <object or null>}\n' +
            "If the provided context does NOT contain enough information to determine the correct call, respond with exactly:\n" +
            '{"warning": "short explanation of what information is missing"}';

        const messages = [
            { role: "system", content: systemPrompt },
            { role: "user", content: "API context:\n" + apiContext + "\n\nUser request:\n" + prompt }
        ];

        const response = await this.loginMode.infer(this.sdk.getSelectedModel(), messages, null);
        return this.safeParseJson(response);
    }

    safeParseJson(text) {
        if (typeof text !== "string") {
            throw new Error("Expected string response from model, got: " + typeof text);
        }
        let cleaned = text.trim()
            .replace(/^```json\s*/i, "")
            .replace(/^```\s*/, "")
            .replace(/```\s*$/, "");

        try {
            return JSON.parse(cleaned);
        } catch (e) {
            const match = cleaned.match(/\{[\s\S]*\}/);
            if (match) {
                try {
                    return JSON.parse(match[0]);
                } catch (e2) {
                    // fall through to throw below
                }
            }
            throw new Error("Failed to parse structured JSON from model response: " + text);
        }
    }

    async resolveAgentCall(agent, prompt) {
        // Attempt 1: narrow vectorDB context
        const vectorContext = await this.sdk.getVectorDbApiDocSuggestion(prompt, agent.getId());
        const firstAttempt = await this.askForStructuredCall(prompt, vectorContext);

        if (!firstAttempt.warning) {
            return firstAttempt;
        }

        this.logger.warn(
            "VectorDB context insufficient for agent " + agent.getId() +
            " (\"" + firstAttempt.warning + "\"), retrying with full API doc."
        );

        // Attempt 2: fall back to the agent's complete API doc
        const fullApiDoc = await agent.getApiDoc();
        const secondAttempt = await this.askForStructuredCall(prompt, fullApiDoc);

        if (secondAttempt.warning) {
            throw new Error(
                "Unable to resolve API call for agent " + agent.getId() +
                " even with full API doc: " + secondAttempt.warning
            );
        }

        return secondAttempt;
    }

    async buildAgentError(prompt, structured, callError) {
        const rawError = callError && callError.message ? callError.message : String(callError);

        const systemPrompt =
            "You are an error formatter for an agent orchestrator.\n" +
            "Given the original request, the API call that was attempted, and the raw error returned,\n" +
            "respond with ONLY raw JSON, no markdown fences, no commentary, in exactly this shape:\n" +
            '{"errorMessage": "concise human-readable error summary", "retryable": true|false}';

        const messages = [
            { role: "system", content: systemPrompt },
            {
                role: "user",
                content:
                    "Original request:\n" + prompt +
                    "\n\nAttempted call:\n" + JSON.stringify(structured) +
                    "\n\nRaw error:\n" + rawError
            }
        ];

        try {
            const response = await this.loginMode.infer(this.sdk.getSelectedModel(), messages, null);
            const parsed = this.safeParseJson(response);
            if (parsed && typeof parsed.errorMessage === "string" && typeof parsed.retryable === "boolean") {
                return parsed;
            }
        } catch (e) {
            this.logger.log("Failed to format agent error via LLM: " + e);
        }
        return { errorMessage: rawError, retryable: false };
    }
}