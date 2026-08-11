import { LoginMode } from "./loginMode.mjs";
import { Logger } from "./logger.mjs";
import { VectorDB } from "./vectordb.mjs";
import { Agents } from "./agents.mjs";

export class Sdk {
    logger = new Logger("Sdk");
    loginMode;
    messageHistory = [];
    selectedModel = null;
    vectorDb;
    agents;
    constructor(loginModeId, host = "http://localhost") {
        this.loginMode = new LoginMode(host, loginModeId);
        this.vectorDb = new VectorDB(host);
        this.agents = new Agents(host);
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

    async chat(message, selectedModel = null, onStream = null) {
        try {
            this.messageHistory.push({ role: "user", content: message });

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
            this.messageHistory.push({ role: "assistant", content: response });
            return response;
        } catch (e) {
            this.logger.log(e);
            this.messageHistory.push({ role: "assistant", content: String(e) });
            return String(e);
        }
    }

    getChatHistory() {
        return [...this.messageHistory];
    }
}

/*let sdk = new Sdk("ollamalocal");
sdk.listModels();
let response1 = await sdk.chat("Who are you?",null, (token) => {
    process.stdout.write(token);
});
let response2 = await sdk.chat("Hello");

console.log("\n---");
console.log(sdk.getChatHistory());*/