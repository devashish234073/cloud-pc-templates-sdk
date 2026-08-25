import { LoginMode } from "./loginMode.mjs";
import { Logger } from "./logger.mjs";
import { VectorDB } from "./vectordb.mjs";
import { Agents } from "./agents.mjs";
import { AgentCallResolver } from "./agentCallResolver.mjs";

export class Sdk {
    logger = new Logger("Sdk");
    loginMode;
    agentCallResolver;
    messageHistory = [];
    messageHistoryMetaData = [];
    selectedModel = null;
    vectorDb;
    agents;
    constructor(loginModeId, systemPrompt = null, host = "http://localhost") {
        this.loginMode = new LoginMode(host, loginModeId);
        this.vectorDb = new VectorDB(host);
        this.agents = new Agents(host);
        if(systemPrompt) {
            this.pushMessageHistory({ role: "system", content: systemPrompt });
        }
        this.agentCallResolver = new AgentCallResolver(this, this.loginMode);
    }

    getSelectedModel() {
        return this.selectedModel;
    }

    setSelectedModel(modelName) {
        this.selectedModel = modelName;
    }

    async getVectorDbApiDocSuggestion(prompt, attribute = null) {
        return await this.vectorDb.getSuggestion(prompt, attribute);
    }

    getAgentById(agentId) {
        return this.agents.getAgentById(agentId);
    }

    getAllAgents() {
        return this.agents;
    }

    async listModels() {
        const models = await this.loginMode.listModels();
        for (let k in models) {
            this.logger.log("Available model: " + k);
        }
        return models;
    }

    async selectModel(modelName) {
        if (await this.loginMode.containsModel(modelName)) {
            this.selectedModel = modelName;
            this.logger.log("Selected model: " + modelName);
        } else {
            throw new Error("Model " + modelName + " is not available for login mode " + this.loginMode.id);
        }
    }

    async callAgent(agentId, prompt) {
        const agent = this.getAgentById(agentId);
        if (!agent) {
            throw new Error("Agent not found");
        }
        
        if (!this.selectedModel) {
            this.selectedModel = await this.loginMode.getFirstModel();
            if (!this.selectedModel) {
                throw new Error("No model selected and no available models for login mode " + this.loginMode.id);
            }
        }

        const structured = await this.agentCallResolver.resolveAgentCall(agent, prompt);

        try {
            const agentResponse = await agent.call(structured.httpMethod, structured.path, structured.body ?? null);
            return await this.agentCallResolver.summarizeAgentResponse(prompt, structured, agentResponse);
        } catch (callError) {
            return await this.agentCallResolver.buildAgentError(prompt, structured, callError);
        }
    }

    async chat(message, selectedModel = null, onStream = null) {
        try {
            this.pushMessageHistory({ role: "user", content: message });

            if (selectedModel) {
                this.selectModel(selectedModel);
            }
            if (!this.selectedModel) {
                this.selectedModel = await this.loginMode.getFirstModel();
                if (!this.selectedModel) {
                    throw new Error("No model selected and no available models for login mode " + this.loginMode.id);
                }
            }
            let response = await this.loginMode.infer(this.selectedModel, this.messageHistory, onStream);
            this.pushMessageHistory({ role: "assistant", content: response });
            return response;
        } catch (e) {
            this.logger.log(e);
            this.pushMessageHistory({ role: "assistant", content: String(e) });
            return String(e);
        }
    }

    pushMessageHistory(message) {
        this.messageHistory.push(message);
        this.messageHistoryMetaData.push({ 
            timestamp: new Date(),
            modelUsed: this.selectedModel,
         });
    }

    getChatHistory() {
        return [...this.messageHistory];
    }

    getChatHistoryWithMetadata() {
        return this.messageHistory.map((msg, index) => ({
            ...msg,
            metadata: this.messageHistoryMetaData[index]
        }));
    }

    setMessageHistory(historyWithMetadata) {
        if (!Array.isArray(historyWithMetadata)) {
            throw new Error("Message history must be an array");
        }

        const messageHistory = [];
        const messageHistoryMetaData = [];

        historyWithMetadata.forEach((entry, index) => {
            if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
                throw new Error("Message history entry at index " + index + " must be an object");
            }

            if (!Object.prototype.hasOwnProperty.call(entry, "metadata")) {
                throw new Error("Message history entry at index " + index + " must include metadata");
            }

            const { metadata, ...message } = entry;

            if (!message.role || typeof message.role !== "string") {
                throw new Error("Message history entry at index " + index + " must include a string role");
            }

            if (!Object.prototype.hasOwnProperty.call(message, "content")) {
                throw new Error("Message history entry at index " + index + " must include content");
            }

            if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
                throw new Error("Message history metadata at index " + index + " must be an object");
            }

            messageHistory.push({ ...message });
            messageHistoryMetaData.push({ ...metadata });
        });

        this.messageHistory = messageHistory;
        this.messageHistoryMetaData = messageHistoryMetaData;
    }

    clearChatHistory() {
        this.messageHistory = [];
        this.messageHistoryMetaData = [];
    }
}

/*let sdk = new Sdk("ollamacloud");
sdk.setSelectedModel("gpt-oss:120b");
sdk.listModels();
let response1 = await sdk.chat("Who are you?",null, (token) => {
    process.stdout.write(token);
});
let response2 = await sdk.chat("Hello");

console.log("\n---");
console.log(sdk.getChatHistory());
let agentResponse = await sdk.callAgent(
    'playwright connector',
    'Go to https://cloud-pc-templates.com/ and tell me what all you see'
);
console.log(agentResponse);*/
