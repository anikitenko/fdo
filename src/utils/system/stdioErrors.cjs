const guardedStreams = new WeakSet();

// GUI processes can outlive the terminal/IDE that launched them. Losing that
// logging pipe is not an application failure. Keep other stream errors fatal.
function installStdioErrorHandlers(streams = [process.stdout, process.stderr]) {
    for (const stream of streams) {
        if (!stream || guardedStreams.has(stream)) continue;
        stream.on("error", error => {
            if (error?.code !== "EPIPE") throw error;
        });
        guardedStreams.add(stream);
    }
}

module.exports = {installStdioErrorHandlers};
