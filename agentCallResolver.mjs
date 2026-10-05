import { Logger } from "./logger.mjs";
import { safeParseJson } from "./safeParseJson.mjs";

export class AgentCallResolver {
    sdk;
    logger;
    loginMode;
    constructor(sdk, loginMode) {
        this.logger = new Logger("AgentCallResolver");
        this.sdk = sdk;
        this.loginMode = loginMode;
    }

    async askForStructuredCall(prompt, apiContext, history = []) {
        //commented systemone call as it can only return choices and can't return dynamica values like path.
        /*const viaSystemOne = await this.askForStructuredCallUsingSystemOne(prompt, apiContext);
        if (viaSystemOne) {
            return viaSystemOne;
        }*/
        return await this.askForStructuredCallUsingLlm(prompt, apiContext, history);
    }

    async askForStructuredCallUsingSystemOne(prompt, apiContext) {
        const state = "API context:\n" + apiContext + "\n\nUser request:\n" + prompt;
        const questions = {
            resolvable: {
                type: "choice",
                instructions: "Does the API context contain enough information to determine the exact HTTP call for the user request?",
                criteria: {
                    yes: "The call can be fully determined from the context",
                    no: "Required information is missing"
                }
            },
            httpMethod: {
                type: "choice",
                instructions: "Which HTTP method does the user request need?",
                criteria: {
                    GET: "Read data",
                    POST: "Create data or trigger an action",
                    PUT: "Replace data",
                    PATCH: "Partially update data",
                    DELETE: "Remove data"
                }
            }
        };

        const answers = await this.sdk.getSystemOne().inferUsingTopPrioritySystemOneModel(state, questions);
        if (!answers) return null;
        return { resolvable: answers.resolvable.choice, httpMethod: answers.httpMethod.choice };
    }

    async askForStructuredCallUsingLlm(prompt, apiContext, history = []) {
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
            ...(history.length > 0 ? history.slice(-1) : []),
            { role: "user", content: "API context:\n" + apiContext + "\n\nUser request:\n" + prompt }
        ];

        const response = await this.loginMode.infer(this.sdk.getSelectedModel(), messages, null);
        return safeParseJson(response);
    }

    isResolvedCall(x) {
        return x && typeof x === "object" && typeof x.httpMethod === "string" && typeof x.path === "string";
    }

    // Returns a non-empty string, or null if the vector DB is down/empty.
    async getVectorContext(agent, prompt) {
        try {
            const context = await this.sdk.getVectorDbApiDocSuggestion(prompt, "text");
            if (context.length > 0 && typeof context[0] === "string" && context[0].trim().length > 0) {
                this.logger.debug(`Vector DB returned context for agent ${agent.getId()}: ${context[0].substring(0, 200)}...`);
                return context[0];
            }
            this.logger.warn(`Vector DB returned no context for agent ${agent.getId()}`);
        } catch (e) {
            this.logger.warn(`Vector DB lookup failed for agent ${agent.getId()}: ${e}`);
        }
        return null;
    }

    async resolveAgentCall(agent, prompt, history = []) {
        // Attempt 1: narrow vectorDB context (skipped if vector DB is unavailable)
        const vectorContext = await this.getVectorContext(agent, prompt);
        if (vectorContext) {
            const firstAttempt = await this.askForStructuredCall(prompt, vectorContext, history);
            if (this.isResolvedCall(firstAttempt)) {
                this.logger.info(`Agent ${agent.getId()} resolved call using vector DB context: ${JSON.stringify(firstAttempt)}`);
                return firstAttempt;
            }
            const reason = (firstAttempt && firstAttempt.warning) || "resolver returned an unusable response";
            this.logger.warn(`Attempt 1 unusable for agent ${agent.getId()} ("${reason}"), retrying with full API doc.`);
        } else {
            this.logger.warn(`Skipping vector context for agent ${agent.getId()}, using full API doc directly.`);
        }

        // Attempt 2: full API doc
        const fullApiDoc = await agent.getApiDoc();
        const secondAttempt = await this.askForStructuredCall(prompt, fullApiDoc, history);

        if (this.isResolvedCall(secondAttempt)) {
            return secondAttempt;
        }

        const secondReason = (secondAttempt && secondAttempt.warning) || "resolver returned an unusable response";
        throw new Error(`Unable to resolve API call for agent ${agent.getId()} even with full api doc: ${secondReason}`);
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
            const parsed = safeParseJson(response);
            if (parsed && typeof parsed.errorMessage === "string" && typeof parsed.retryable === "boolean") {
                return parsed;
            }
        } catch (e) {
            this.logger.log("Failed to format agent error via LLM: " + e);
        }
        return { errorMessage: rawError, retryable: false };
    }

    async summarizeAgentResponse(prompt, structured, agentResponse) {
        const systemPrompt =
            "You are an assistant that just performed an action on behalf of the user via an internal agent.\n" +
            "The agent call below was executed and returned a raw JSON/text result.\n" +
            "Reply to the user's original request as if you carried out the action yourself — do not mention " +
            "the agent, the API call, JSON, or any internal plumbing.\n" +
            "Do NOT omit any important information present in the agent's response — include all relevant " +
            "details, data points, values, and findings from the result.\n" +
            "Attempted call:\n" + JSON.stringify(structured) + "\n\n" +
            "Agent response:\n" + JSON.stringify(agentResponse);

        const messages = [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt }
        ];

        return await this.loginMode.infer(this.sdk.getSelectedModel(), messages, null);
    }
}