import { Logger } from "./logger.mjs";
let registry = [
    { "id": "huggingface", "port": 3003 },
    { "id": "ollamacloud", "port": 3004 },
    { "id": "ollamalocal", "port": 3005 },
    { "id": "deepseek", "port": 3006 },
    { "id": "sarvam", "port": 3007 }
];

let registryMap = Object.fromEntries(registry.map(item => [item.id, item]));
const LOGIN_RATE_LIMIT_MS = 2 * 60 * 1000;

export class LoginMode {
    host;
    id;
    logger = new Logger("LoginMode");
    availableModels;
    lastSuccessfulLoginAt = null;
    constructor(host, id) {
        if (!registryMap[id]) {
            throw new Error("Invalid login mode id: " + id + ". Available modes: " + Object.keys(registryMap).join(", "));
        }
        this.host = host;
        this.id = id;
    }
    getDetails() {
        return registryMap[this.id];
    }

    async listModels() {
        await this.login();// Ensure models are loaded
        return { ...this.availableModels };
    }

    async containsModel(modelName) {
        await this.listModels(); // Ensure models are loaded
        return this.availableModels && this.availableModels[modelName] !== undefined;
    }

    async getFirstModel() {
        await this.listModels(); // Ensure models are loaded
        if (!this.availableModels) {
            return null;
        }
        let keys = Object.keys(this.availableModels);
        return keys.length > 0 ? keys[0] : null;
    }

    async infer(modelName, messages, onToken = null) {
        await this.login(); // Ensure models are loaded
        let inferenceUrl = this.host + ":" + this.getDetails().port + "/v1/chat/completions";
        let payload = JSON.stringify({
            model: modelName,
            messages,
            temperature: 0.5,
            top_p: 0.7,
            stream: true
        });

        const response = await fetch(inferenceUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: payload
        });

        if (response.status !== 200) {
            return false;
        }

        let fullText = "";
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop();

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith("data:")) continue;

                const jsonStr = trimmed.slice(5).trim();
                if (jsonStr === "[DONE]") continue;

                try {
                    const parsed = JSON.parse(jsonStr);
                    const delta = parsed.choices?.[0]?.delta?.content;
                    if (delta) {
                        fullText += delta;
                        if (onToken) onToken(delta);
                    }
                } catch (e) {
                    this.logger.error("Failed to parse SSE chunk: " + jsonStr);
                }
            }
        }

        return fullText;
    }

    async login() {
        if (this.lastSuccessfulLoginAt && (Date.now() - this.lastSuccessfulLoginAt) < LOGIN_RATE_LIMIT_MS) {
            this.logger.debug("Skipping login for mode " + this.id + " — rate limited, last successful login was recent");
            return true;
        }

        let healthUrl = this.host + ":" + this.getDetails().port + "/v1/models";

        const response = await fetch(healthUrl);

        if (response.status !== 200) {
            return false;
        }

        const data = await response.json();

        if (data.data.length) {
            this.logger.debug("Login successful for mode " + this.id);
            this.availableModels = Object.fromEntries(data.data
                .filter(item => item.object == 'model')
                .filter(item => item.id.indexOf('embed') === -1) //to remove embedding models like nomic-embed-text
                .map(item => [item.id, item]));
            this.lastSuccessfulLoginAt = Date.now();
            return true;
        }
        this.logger.error("Login failed for mode " + this.id);
        return false;
    }
}