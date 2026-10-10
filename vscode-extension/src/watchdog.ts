// Runs llama-server and stops it when the extension's process goes away, on Windows (Linux and macOS
// use a shell watchdog, see engine.ts). Started by the engine with an IPC channel: the channel closes
// when the extension's process ends for any reason, including a crash, and when the engine asks this
// watchdog to stop (by disconnecting). Either way the server is stopped too.
//
// Usage: node watchdog.js <server> [args...]
import { spawn } from "child_process";

const [file, ...args] = process.argv.slice(2);
const server = spawn(file, args, { stdio: "inherit" });

function stopServer(): void {
    if (server.exitCode === null && server.signalCode === null) {
        server.kill();
    }
}

process.on("disconnect", stopServer);
process.on("SIGTERM", stopServer);
server.on("exit", (code) => process.exit(code ?? 1));
server.on("error", (error) => {
    console.error(`couldn't start ${file}: ${error.message}`);
    process.exit(1);
});
