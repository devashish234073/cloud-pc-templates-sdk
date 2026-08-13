import { Logger } from "./logger.mjs";

export class VectorDB {
    logger = new Logger("VectorDB");
    host;
    PORT = 4302;
    constructor(host = "http://localhost") {
        this.host = host;
    }
    async getSuggestion(prompt, attribute = null) {
        let response = await this.getSuggestionRaw(prompt);

        if (!response) {
            return null;
        }
        if (!response.results || !Array.isArray(response.results)) {
            this.logger.error("Invalid response from vector DB: ", response);
            return null;
        } else {
            let suggestions = [];
            response.results.forEach((item, index) => {
                if (!attribute || !item.metadata.hasOwnProperty(attribute)) {
                    suggestions.push(item.metadata);
                } else {
                    suggestions.push(item.metadata[attribute]);
                }
            });
            return suggestions;
        }
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