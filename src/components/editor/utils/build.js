import {publishNotification, failureNotification} from '../../../utils/desktop/notificationContent';
import virtualFS from "./VirtualFS";
import {workspaceNotificationName} from "./workspaceNotificationName";

function runtimeBundle(result) {
    const bundle = result.files?.outputFiles?.[0]?.text;
    if (typeof bundle !== "string" || !bundle.trim()) throw new Error("Compiler returned no runtime bundle.");
    return bundle;
}

const build = async () => {
    virtualFS.build.setInProgress()
    virtualFS.build.addProgress(10)
    virtualFS.build.addMessage("Initializing compiler...", false, "build")
    let pluginName = virtualFS.pluginName || "Untitled plugin";
    try {
        pluginName = await workspaceNotificationName(virtualFS);
        virtualFS.build.addProgress(20)
        virtualFS.build.addMessage("Compiler initialized...", false, "build")

        const latestContent = virtualFS.getLatestContent()

        virtualFS.build.addProgress(30)
        virtualFS.build.addMessage("Building plugin...", false, "build")

            const result = await window.electron.plugin.build({latestContent})
        if (!result.success) {
            console.error("Build failed: " + result.error)
            virtualFS.build.addMessage("Build failed: " + result.error, true, "build")
            setTimeout(() => virtualFS.build.stopProgress(), 500)
            publishNotification(failureNotification({title: `${pluginName}: build failed`, message: "The plugin was not compiled. Review the compiler output in the editor, correct the errors, then build again.", error: result.error, source: "builds"}))
            return {success: false, error: result.error};
        } else {
            virtualFS.build.addProgress(90)
            virtualFS.build.addMessage("Build complete, preparing runtime bundle...", false, "build")

            const bundle = runtimeBundle(result);
            // Runtime output belongs to the build artifact, never to Monaco source models.
            virtualFS.build.setContent(bundle)
            if (result.compatibility) virtualFS.build.addMessage(`Supported FDO: ${result.compatibility.supportedFdo}`, false, 'build');

            virtualFS.build.addProgress(100)
            virtualFS.build.addMessage("Compilation successful!", false, "build")
            publishNotification({title: `${pluginName}: build completed`, message: "The compiled bundle is available in the editor. Deploy it to apply these changes to the installed plugin.", type: "success", source: "builds"})
            return {success: true};
        }
    } catch (error) {
        virtualFS.build.addMessage("Compilation failed: " + error.message,  true, "build")
        console.error("Compilation failed:", error);
        publishNotification(failureNotification({title: `${pluginName}: build failed`, message: "The plugin was not compiled. Review the compiler output in the editor, then try again.", error, source: "builds"}));
        return {success: false, error: error.message};
    } finally {
        setTimeout(() => virtualFS.build.stopProgress(), 500);
    }
}

export default build;
