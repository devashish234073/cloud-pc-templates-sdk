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
