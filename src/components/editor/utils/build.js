import virtualFS from "./VirtualFS";

const build = async () => {
    virtualFS.build.setInProgress()
    virtualFS.build.addProgress(10)
    virtualFS.build.addMessage("Initializing compiler...", false, "build")
    try {
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
            window.electron.notifications.add("Build failed", result.error, "danger")
            return {success: false, error: result.error};
        } else {
            virtualFS.build.addProgress(90)
            virtualFS.build.addMessage("Build complete, preparing runtime bundle...", false, "build")

            const bundle = result.files?.outputFiles?.[0]?.text;
            if (typeof bundle !== "string" || !bundle.trim()) throw new Error("Compiler returned no runtime bundle.");
            // Runtime output belongs to the build artifact, never to Monaco source models.
            virtualFS.build.setContent(bundle)

            virtualFS.build.addProgress(100)
            virtualFS.build.addMessage("Compilation successful!", false, "build")
            window.electron.notifications.add("Build success", "", "success")
            return {success: true};
        }
    } catch (error) {
        virtualFS.build.addMessage("Compilation failed: " + error.message,  true, "build")
        console.error("Compilation failed:", error);
        return {success: false, error: error.message};
    } finally {
        setTimeout(() => virtualFS.build.stopProgress(), 500);
    }
}

export default build;
