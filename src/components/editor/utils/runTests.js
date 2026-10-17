import {publishNotification, failureNotification} from '../../../utils/desktop/notificationContent';
import virtualFS from "./VirtualFS";
import {workspaceNotificationName} from "./workspaceNotificationName";

const runTests = async () => {
    virtualFS.build.setInProgress();
    virtualFS.build.addProgress(10);
    virtualFS.build.addMessage("Preparing plugin test workspace...", false, "test");

    let pluginName = virtualFS.pluginName || "Untitled plugin";
    try {
        pluginName = await workspaceNotificationName(virtualFS);
        const latestContent = virtualFS.getLatestContent();

        virtualFS.build.addProgress(30);
        virtualFS.build.addMessage("Running plugin tests with bundled Node test runner...", false, "test");

        const result = await window.electron.plugin.runTests({latestContent});
        if (!result.success) {
            if (result.output) {
                virtualFS.build.addMessage(result.output, true, "test");
            }
            virtualFS.build.addMessage(result.error || "Plugin tests failed.", true, "test");
            publishNotification(failureNotification({title: `${pluginName}: tests failed`, message: "The test run did not pass. Review the failed assertions in the editor’s test output before deploying.", error: result.output || result.error, source: "builds"}));
            return result;
        }

        if (result.output) {
            virtualFS.build.addMessage(result.output, false, "test");
        }
        virtualFS.build.addProgress(100);
        virtualFS.build.addMessage(result.skipped ? "No plugin tests found. Build can continue, but there is nothing to verify yet." : "Plugin tests passed.", false, "test");
        publishNotification({title: `${pluginName}: ${result.skipped ? "no tests found" : "tests passed"}`,
            message: result.skipped ? "No automated checks ran. Add node:test files to this plugin before relying on pre-deployment verification." : "The plugin’s test suite completed successfully. Review the test output for individual results.",
            type: result.skipped ? "warning" : "success", source: "builds"});
        return result;
    } catch (error) {
        virtualFS.build.addMessage(`Plugin tests failed: ${error.message}`, true, "test");
        publishNotification(failureNotification({title: `${pluginName}: tests could not run`, message: "The test runner could not complete. Review the editor’s test output and try again.", error, source: "builds"}));
        return {success: false, error: error.message, output: ""};
    } finally {
        virtualFS.build.stopProgress();
    }
};

export default runTests;
