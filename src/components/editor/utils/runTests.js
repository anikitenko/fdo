import virtualFS from "./VirtualFS";

const runTests = async () => {
    virtualFS.build.setInProgress();
    virtualFS.build.addProgress(10);
    virtualFS.build.addMessage("Preparing plugin test workspace...", false, "test");

    try {
        const latestContent = virtualFS.getLatestContent();

        virtualFS.build.addProgress(30);
        virtualFS.build.addMessage("Running plugin tests with bundled Node test runner...", false, "test");

        const result = await window.electron.plugin.runTests({latestContent});
        if (!result.success) {
            if (result.output) {
                virtualFS.build.addMessage(result.output, true, "test");
            }
            virtualFS.build.addMessage(result.error || "Plugin tests failed.", true, "test");
            window.electron.notifications.add("Tests failed", result.error || "Plugin tests failed.", "danger");
            return result;
        }

        if (result.output) {
            virtualFS.build.addMessage(result.output, false, "test");
        }
        virtualFS.build.addProgress(100);
        virtualFS.build.addMessage(result.skipped ? "No plugin tests found. Build can continue, but there is nothing to verify yet." : "Plugin tests passed.", false, "test");
        window.electron.notifications.add(
            result.skipped ? "No tests found" : "Tests passed",
            result.skipped ? "Add node:test files to enable pre-build verification." : "",
            result.skipped ? "warning" : "success"
        );
        return result;
    } catch (error) {
        virtualFS.build.addMessage(`Plugin tests failed: ${error.message}`, true, "test");
        window.electron.notifications.add("Tests failed", error.message, "danger");
        return {success: false, error: error.message, output: ""};
    } finally {
        setTimeout(() => virtualFS.build.stopProgress(), 500);
    }
};

export default runTests;
