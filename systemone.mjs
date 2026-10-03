import { LoginMode } from "./loginMode.mjs";
import { Logger } from "./logger.mjs";

// Order is the preference order: first installed model wins.
const SYSTEM_ONE_MODELS = ["nimble", "tev1", "tev1:1.4b", "tev1:0.8b"];
const FAILURE_THRESHOLD = 3;
const COOLDOWN_MS = 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15 * 1000;

export class SystemOne {
    logger = new Logger("SystemOne");
    host;
    loginMode;
    failureCount = 0;
    cooldownUntil = 0;
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

    async getPreferredAvailableModel() {
        const availableModels = await this.getAvailableSystemOneModels();
        return SYSTEM_ONE_MODELS.find((modelName) => availableModels.includes(modelName)) ?? null;
    }

    async checkSystemOneModelAvailability() {
        const availableSystemOneModels = await this.getAvailableSystemOneModels();
        const hasSupportedModel = availableSystemOneModels.length > 0;

        if (!hasSupportedModel) {
            this.logger.warn("no system one model found, downloading one of: " + SYSTEM_ONE_MODELS.join(", "));
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

    isAvailable() {
        if (!this.cooldownUntil) {
            return true;
        }
        if (Date.now() < this.cooldownUntil) {
            return false;
        }
        this.logger.log("SystemOne cooldown over, re-enabling");
        this.cooldownUntil = 0;
        this.failureCount = 0;
        return true;
    }

    recordSuccess() {
        if (this.cooldownUntil) {
            return; // late result from a call that started before the breaker tripped
        }
        this.failureCount = 0;
    }

    recordFailure(error) {
        if (this.cooldownUntil) {
            return; // already tripped; don't extend the cooldown
        }
        this.failureCount += 1;
        this.logger.warn("SystemOne failure " + this.failureCount + "/" + FAILURE_THRESHOLD + ": " + (error?.message ?? error));
        if (this.failureCount >= FAILURE_THRESHOLD) {
            this.cooldownUntil = Date.now() + COOLDOWN_MS;
            this.logger.warn("SystemOne disabled for " + (COOLDOWN_MS / 60000) + " minutes");
        }
    }

    async withTimeout(promise) {
        let timer;
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error("SystemOne request timed out after " + REQUEST_TIMEOUT_MS + "ms")), REQUEST_TIMEOUT_MS);
        });
        return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
    }

    // Never throws. Returns `answers` on success, null if unavailable/failed (caller falls back).
    // All questions must be type "choice".
    async inferUsingTopPrioritySystemOneModel(state, questions) {
        if (!this.isAvailable()) {
            return null;
        }

        const modelName = await this.getPreferredAvailableModel();
        if (!modelName) {
            this.logger.debug("No SystemOne model installed, skipping");
            return null; // config issue, not a breaker failure
        }

        try {
            const response = await this.withTimeout(this.infer(modelName, state, questions));
            const answers = response?.answers;
            if (typeof response?.error === "string" || !answers || typeof answers !== "object") {
                throw new Error("Unexpected SystemOne response: " + String(JSON.stringify(response)).slice(0, 200));
            }
            for (const [name, question] of Object.entries(questions)) {
                const answer = answers[name];
                if (answer?.type !== "choice" || !Object.hasOwn(question.criteria, answer.choice)) {
                    throw new Error("Invalid SystemOne answer for question '" + name + "'");
                }
            }
            this.recordSuccess();
            return answers;
        } catch (error) {
            this.recordFailure(error);
            return null;
        }
    }
}