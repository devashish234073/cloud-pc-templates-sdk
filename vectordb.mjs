import { Logger } from "./logger.mjs";

export class VectorDB {
    logger = new Logger("VectorDB");
    host;
    PORT = 4302;
    constructor(host = "http://localhost") {
        this.host = host;
    }
    formatSuggestionEntry(item, attribute = null) {
        if (!item || !item.metadata || typeof item.metadata !== "object") {
            return null;
        }

        const metadata = item.metadata;
        const allowedKeys = ["agentId", "endpointMethod", "endpointPath"];
        const metadataSummary = allowedKeys.reduce((acc, key) => {
            if (Object.prototype.hasOwnProperty.call(metadata, key)) {
                acc[key] = metadata[key];
            }
            return acc;
        }, {});

        const metadataLine = `Metadata: ${JSON.stringify(metadataSummary)}`;

        if (!attribute) {
            return metadataLine;
        }

        const normalizedAttribute = String(attribute);
        if (!Object.prototype.hasOwnProperty.call(metadata, normalizedAttribute)) {
            return metadataLine;
        }

        const attributeValue = metadata[normalizedAttribute];
        const formattedValue = typeof attributeValue === "string"
            ? attributeValue
            : JSON.stringify(attributeValue, null, 2);

        return `${metadataLine}\n${normalizedAttribute}: ${formattedValue}`;
    }

    async getSuggestion(prompt, attribute = null) {
        let response = await this.getSuggestionRaw(prompt);

        if (!response) {
            return null;
        }
        if (!response.results || !Array.isArray(response.results)) {
            this.logger.error("Invalid response from vector DB: ", response);
            return null;
        }

        const rankedResults = [...response.results].sort((left, right) => {
            const leftScore = Number.isFinite(left?.score) ? left.score : 0;
            const rightScore = Number.isFinite(right?.score) ? right.score : 0;
            return rightScore - leftScore;
        });

        return rankedResults
            .map((item) => this.formatSuggestionEntry(item, attribute))
            .filter(Boolean);
    }
    async getSuggestionRaw(prompt) {
        let vectorSuggestionUrl = this.host + ":" + this.PORT + "/query";
        let payload = JSON.stringify({ prompt, topK: 3 });
        try {
            const response = await fetch(vectorSuggestionUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: payload
            });

            if (response.status !== 200) {
                return null;
            }
            return response.json();
        } catch (error) {
            this.logger.error("Error fetching suggestion from vector DB: ", error);
            return null;
        }
    }
}

/*async function test() {
    let vectorDb = new VectorDB();
    let response = await vectorDb.getSuggestion("Create a java maven project..");
    console.log("VectorDB response: ", response);
    let responseText = await vectorDb.getSuggestion("Create a java maven project..","text");
    console.log("VectorDB response text: ", responseText);
}
test();*/