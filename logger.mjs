export class Logger {
    className;
    debugMode = true;
    constructor(className) {
        this.className = className;
    }
    log(message) {
        console.log(`[${this.className}] ${new Date()} [INFO] ${message}`);
    }
    warn(message) {
        console.warn(`[${this.className}] ${new Date()} [WARN] ${message}`);
    }
    debug(message) {
        if (this.debugMode) {
            console.log(`[${this.className}] ${new Date()} [DEBUG] ${message}`);
        }
    }
    warn(message) {
        console.error(`[${this.className}] ${new Date()} [ERROR] ${message}`);
    }
}