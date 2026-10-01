import { LoginMode } from "./loginMode.mjs";
import { Logger } from "./logger.mjs";

const SYSTEM_ONE_MODELS = ["nimble", "tev1", "tev1:0.8b", "tev1:1.4b"];

export class SystemOne {
    logger = new Logger("SystemOne");
    host;
    loginMode;
    constructor(host = "http://localhost") {
        this.host = host;
        this.loginMode = new LoginMode(host, "ollamalocal");
        this.checkSystemOneModelAvailability();
    }

    async getAvailableSystemOneModels() {
        const availableModels = await this.loginMode.listModels();
        const availableModelNames = Object.keys(availableModels ?? {}).map((name) => name.toLowerCase());
        return availableModelNames.filter((modelName) => SYSTEM_ONE_MODELS.includes(modelName));
    }

    async checkSystemOneModelAvailability() {
        const availableSystemOneModels = await this.getAvailableSystemOneModels();
        const hasSupportedModel = availableSystemOneModels.length > 0;

        if (!hasSupportedModel) {
            this.logger.warn("no system one mdoel found");
        }

        return hasSupportedModel;
    }

    async infer(modelName, state, questions) {
        const hasSupportedModel = await this.checkSystemOneModelAvailability();
        if (!hasSupportedModel) {
            throw new Error("No supported SystemOne model found. Available models must include one of: " + SYSTEM_ONE_MODELS.join(", "));
        }
        if(!SYSTEM_ONE_MODELS.includes(modelName.toLowerCase())) {
            throw new Error("Invalid SystemOne model name: " + modelName + ". Available models must include one of: " + SYSTEM_ONE_MODELS.join(", "));
        }
        let payload = JSON.stringify(
            {
                "model": modelName,
                "state": state,
                "questions": questions
            }
        );
        return await this.loginMode.infer(modelName, payload, null, "/v1/systemone");
    }
}