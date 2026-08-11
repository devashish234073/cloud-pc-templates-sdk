## cloud-pc-templates-sdk to interact with the running login modes, vectordb and agents

<img width="1565" height="557" alt="image" src="https://github.com/user-attachments/assets/2f864b40-89ff-41ef-8e20-70f376102830" />

Steps:
1. Launch a login mode:
```
npx cloud-pc-templates ai login loginMode ollamalocal
```
2. Create a new project and install the dependency
```
mkdir new-app
cd new-app
npm init -y
npm install cloud-pc-templates-sdk
```
3. Then implement the code in index.js
```javascript
let { Sdk }  = require("cloud-pc-templates-sdk");
async function main() {
    let sdk = new Sdk("ollamalocal");
    let response = await sdk.chat("Hello");
    console.log(response);
}
main();
```
  or for streaming
```javascript
let { Sdk }  = require("cloud-pc-templates-sdk");
async function main() {
    let sdk = new Sdk("ollamalocal");
    await sdk.chat("Hello",null,(token) => {
        process.stdout.write(token);
    });
}
main();
```
### The second argument for sdk.chat() is model id passing that null takes the first model from the list of model returned by the login mode.


## For vector db use below steps 

1. Start vector db
```
npx cloud-pc-templates@latest ai agents startVectorDb
```
2. Create new app add dependency 
```
mkdir new-app
cd new-app
npm init -y
npm install cloud-pc-templates-sdk
```
3. create index.js with below content
```javascript
let { Sdk }  = require("cloud-pc-templates-sdk");
async function main() {
    let sdk = new Sdk("ollamalocal");
    let response1 = await sdk.getVectorDbApiDocSuggestion("Create a java application");
    console.log("vector db suggestion",response1);
    let response2 = await sdk.getVectorDbApiDocSuggestion("Create a java application","text");
    console.log("vector db suggestion text",response2);
}
main();
```

## For agents use the following
1. Start all agents 
```
npx cloud-pc-templates ai agents startAllOn linux
```
  or for windows
```
npx cloud-pc-templates@latest ai agents startAllOn docker
```
2. Create new app add dependency 
```
mkdir new-app
cd new-app
npm init -y
npm install cloud-pc-templates-sdk
```
3. create agents.js with below content and run
```javascript
let { Sdk }  = require("cloud-pc-templates-sdk");
async function main() {
    let sdk = new Sdk("ollamalocal");
    let health = await sdk.getAllAgents().healthcheck();
    console.log("Agents Health", health);
    let agent = sdk.getAgentById('web-explorer');
    let apiDoc = await agent.getApiDoc();
    console.log("Agent API Doc", apiDoc);
    let agentApiHitInsights = await agent.getApiHitInsights();
    console.log("Agent API Insights", agentApiHitInsights);
}
main();
```
output:
<img width="915" height="443" alt="image" src="https://github.com/user-attachments/assets/1261bb62-6b2a-4ed5-a3d5-b1566ef0b2d7" />

