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
            "You are given the original user request and the history of steps already taken " +
            "(agent called, task given to it, and the agent's response).\n" +
            "Decide the single next step required.\n" +
            "Respond with ONLY raw JSON, no markdown fences, no commentary, in exactly ONE of these shapes:\n" +
            '1. Call an agent next: {"whatIsBeingDone": "short present-tense description of this step", "agentId": "<id>", "taskPrompt": "<specific instruction for that agent>"}\n' +
            '2. Request fully satisfied: {"whatIsBeingDone": "[DONE:<final response summarizing what was done/found, for the user]"}\n' +
            '3. Cannot proceed / fatal error: {"whatIsBeingDone": "[ERROR:<explanation for the user>]"}\n' +
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
                const msg = "[ERROR:" + (e?.message ?? String(e)) + "]";
                if (onStream) onStream(msg);
                return msg;
            }

            if (!decision || typeof decision.whatIsBeingDone !== "string") {
                const msg = "[ERROR:Orchestrator returned an invalid decision]";
                if (onStream) onStream(msg);
                return msg;
            }

            if (onStream) onStream(decision.whatIsBeingDone);

            if (decision.whatIsBeingDone.startsWith("[DONE:") || decision.whatIsBeingDone.startsWith("[ERROR:")) {
                return decision.whatIsBeingDone;
            }

            if (!decision.agentId || !decision.taskPrompt) {
                const msg = "[ERROR:Orchestrator step missing agentId or taskPrompt]";
                if (onStream) onStream(msg);
                return msg;
            }

            try {
                const agentResult = await this.sdk.callAgent(decision.agentId, decision.taskPrompt);
                history.push({ agentId: decision.agentId, taskPrompt: decision.taskPrompt, result: agentResult });
            } catch (e) {
                const msg = "[ERROR:Agent " + decision.agentId + " failed: " + (e?.message ?? String(e)) + "]";
                if (onStream) onStream(msg);
                return msg;
            }
        }

        const msg = "[ERROR:Orchestration exceeded maximum steps (" + MAX_STEPS + ") without completing]";
        if (onStream) onStream(msg);
        return msg;
    }
}