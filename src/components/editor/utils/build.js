import virtualFS from "./VirtualFS";
import {createVirtualFile} from "./createVirtualFile";

const build = async () => {
    virtualFS.build.setInProgress()
    virtualFS.build.addProgress(10)
    virtualFS.build.addMessage("Initializing compiler...")
    try {
        virtualFS.build.addProgress(20)
        virtualFS.build.addMessage("Compiler initialized...")

        const latestContent = virtualFS.getLatestContent()

        virtualFS.build.addProgress(30)
        virtualFS.build.addMessage("Building plugin...")

        const result = await window.electron.plugin.build({latestContent})
        if (!result.success) {
            console.error("Build failed: " + result.error)
            virtualFS.build.addMessage("Build failed: " + result.error, true)
            setTimeout(() => virtualFS.build.stopProgress(), 500)
            window.electron.notifications.add("Build failed", result.error, "danger")
        } else {
            virtualFS.build.addProgress(90)
            virtualFS.build.addMessage("Build complete, writing output...")

            createVirtualFile(virtualFS.build.getEntrypoint(), result.files.outputFiles[0].text, undefined, false, true)

            virtualFS.build.setContent(result.files.outputFiles[0].text)

            virtualFS.build.addProgress(100)
            virtualFS.build.addMessage("Compilation successful!")
            window.electron.notifications.add("Build success", "", "success")
        }
    } catch (error) {
        virtualFS.build.addMessage("Compilation failed: " + error.message,  true)
        console.error("Compilation failed:", error);
    } finally {
        setTimeout(() => virtualFS.build.stopProgress(), 500);
    }
}

export default build;