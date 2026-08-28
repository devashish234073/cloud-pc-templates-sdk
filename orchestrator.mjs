import { Logger } from "./logger.mjs";
import { safeParseJson } from "./safeParseJson.mjs";

const MAX_STEPS = 20;

export class Orchestrator {
    logger = new Logger("Orchestrator");
    sdk;
    loginMode;

    constructor(sdk, loginMode) {
        this.sdk = sdk;
        this.loginMode = loginMode;
    }

    buildAgentsCatalog() {
        return this.sdk.getAllAgents().list();
    }

    buildSystemPrompt(agentsCatalog, vectorContext) {
        return "You are an orchestrator deciding the next step to fulfill a user's request using a set of agents.\n" +
            "Available agents:\n" + JSON.stringify(agentsCatalog) + "\n\n" +
            "Relevant context:\n" + vectorContext + "\n\n" +
            "You are given the original user request and the history of steps already taken.\n" +
            "Each history entry has: agentId, taskPrompt, and either result (success) or error (failure).\n\n" +
            "CRITICAL — task granularity:\n" +
            "Each taskPrompt you issue must describe exactly ONE atomic action for the chosen agent — the smallest " +
            "unit of work that agent can perform in a single call. Do not bundle multiple distinct actions into one " +
            "taskPrompt, even if they are related or would logically happen together. If you are unsure whether an " +
            "action is atomic, assume it is not and split it further. If the overall request requires several " +
            "actions from one or more agents, plan to reach [DONE:...] only after issuing one step per action, " +
            "using the result of each prior step to inform the next.\n\n" +
            "Reacting to a failed step:\n" +
            "If the most recent history entry has an 'error' field, do not repeat the identical taskPrompt. " +
            "Instead, based on the error message: split the action into smaller pieces if it was too broad for a " +
            "single call, rephrase it if the agent may have misunderstood the intent, try a different available " +
            "agent if a better fit exists, or skip to a different remaining action if this one is not achievable. " +
            "A single failed step is not by itself grounds to emit [ERROR:...] — only do so after a reasonable " +
            "adaptation attempt still cannot make progress, or the request requires a capability no available " +
            "agent has.\n\n" +
            "Deciding when you're done:\n" +
            "Emit [DONE:...] only when every part of the original request has been addressed — re-check the " +
            "original request against the full step history before concluding, not just the outcome of the most " +
            "recent step.\n\n" +
            "Staying in scope:\n" +
            "Only take actions that directly progress the original request. Do not perform cleanup, deletion, " +
            "verification, or maintenance actions unless the user explicitly asked for them.\n\n" +
            "Decide the single next step required.\n" +
            "Respond with ONLY raw JSON, no markdown fences, no commentary, in exactly ONE of these shapes:\n" +
            '1. Call an agent next: {"whatIsBeingDone": "short present-tense description of this step", "agentId": "<id>", "taskPrompt": "<ONE atomic instruction for that agent>"}\n' +
            '2. Request fully satisfied: {"whatIsBeingDone": "[DONE:<final response summarizing everything that was done, for the user]"}\n' +
            '3. Cannot proceed / fatal error: {"whatIsBeingDone": "[ERROR:<explanation for the user, after adaptation attempts failed>]"}\n' +
            "Never fabricate an agent response. Never return more than one shape.";
    }

    async decideNextStep(originalPrompt, sdkHistory, history, agentsCatalog, vectorContext) {
        const messages = [
            { role: "system", content: this.buildSystemPrompt(agentsCatalog, vectorContext) },
            ...sdkHistory,
            {
                role: "user",
                content: "Original request:\n" + originalPrompt +
                    "\n\nSteps so far:\n" + (history.length ? JSON.stringify(history) : "(none yet)")
            }
        ];
        this.logger.debug("Orchestrator messages: ", messages);
        const response = await this.loginMode.infer(this.sdk.getSelectedModel(), messages, null);
        return safeParseJson(response);
    }

    async orchestrate(originalPrompt, sdkHistory, onStream = null) {
        const history = [];
        let consecutiveFailures = 0;
        const MAX_CONSECUTIVE_FAILURES = 3;

        const vectorSuggestions = await this.sdk.getVectorDbApiDocSuggestion(originalPrompt, "text");
        const vectorContext = Array.isArray(vectorSuggestions) && vectorSuggestions.length
            ? vectorSuggestions.join("\n---\n")
            : "(no relevant context found)";

        const agentsCatalog = this.buildAgentsCatalog();

        for (let step = 0; step < MAX_STEPS; step++) {
            let decision;
            try {
                decision = await this.decideNextStep(originalPrompt, sdkHistory, history, agentsCatalog, vectorContext);
            } catch (e) {
                const msg = this.buildErrorMarker(e?.message ?? String(e), history);
                if (onStream) onStream(msg, history);
                return {msg,history};
            }

            if (!decision || typeof decision.whatIsBeingDone !== "string") {
                const msg = this.buildErrorMarker("Orchestrator returned an invalid decision", history);
                if (onStream) onStream(msg, history);
                return {msg,history};
            }

            if (onStream) onStream(decision.whatIsBeingDone, history);

            if (decision.whatIsBeingDone.startsWith("[DONE:") || decision.whatIsBeingDone.startsWith("[ERROR:")) {
                return {msg: decision.whatIsBeingDone, history};
            }

            if (!decision.agentId || !decision.taskPrompt) {
                const msg = this.buildErrorMarker("Orchestrator step missing agentId or taskPrompt", history);
                if (onStream) onStream(msg, history);
                return {msg,history};
            }

            try {
                const agentResult = await this.sdk.callAgent(decision.agentId, decision.taskPrompt);
                history.push({ agentId: decision.agentId, taskPrompt: decision.taskPrompt, result: agentResult });
                consecutiveFailures = 0;
            } catch (e) {
                const errorMessage = e?.message ?? String(e);
                history.push({ agentId: decision.agentId, taskPrompt: decision.taskPrompt, error: errorMessage });
                consecutiveFailures++;

                if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                    const msg = this.buildErrorMarker(
                        "Agent " + decision.agentId + " failed " + consecutiveFailures + " times in a row: " + errorMessage,
                        history
                    );
                    if (onStream) onStream(msg, history);
                    return {msg,history};
                }
            }
        }

        const msg = this.buildErrorMarker(
            "Orchestration exceeded maximum steps (" + MAX_STEPS + ") without completing",
            history
        );
        if (onStream) onStream(msg, history);
        return {msg,history};
    }

    buildErrorMarker(reason, history) {
        const completedSteps = history
            .filter(h => h.result !== undefined)
            .map(h => ({ agentId: h.agentId, taskPrompt: h.taskPrompt }));

        const summary = completedSteps.length
            ? reason + " | Completed before failure: " + JSON.stringify(completedSteps)
            : reason + " | No steps completed before failure.";

        return "[ERROR:" + summary + "]";
    }
}