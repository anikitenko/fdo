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

        let pluginEntrypoint;
        let pluginMetadata = null

        virtualFS.build.addProgress(30)
        virtualFS.build.addMessage("Building plugin...")

        const result = await window.electron.plugin.build({latestContent})
        if (!result.success) {
            console.error("Build failed: " + result.error)
            virtualFS.build.addMessage("Build failed: " + result.error, true)
            setTimeout(() => virtualFS.build.stopProgress(), 500)
            window.electron.notifications.add("Build failed", result.error, "danger")
        }
        virtualFS.build.addProgress(90)
        virtualFS.build.addMessage("Build complete, writing output...")

        const metadataMatch = result.files.outputFiles[0].text.match(/_metadata\s*=\s*({[\s\S]*?});/);
        if (metadataMatch) {
            try {
                const rawExtracted = metadataMatch[1].replace(/(\w+):/g, '"$1":');
                const rawExtractedMatch = rawExtracted.match(/{\s*"name":\s*".*?",\s*"version":\s*".*?",\s*"author":\s*".*?",\s*"description":\s*".*?",\s*"icon":\s*".*?"\s*}/s);
                if (rawExtractedMatch) {
                    pluginMetadata = JSON.parse(rawExtractedMatch[0])
                } else {
                    console.error("Failed to parse metadata: no match found");
                    virtualFS.build.addMessage("Failed to parse metadata: no match found", true)
                    setTimeout(() => virtualFS.build.stopProgress(), 500)
                }
            } catch (err) {
                console.error("Failed to parse metadata:", err);
                virtualFS.build.addMessage("Failed to parse metadata: " + err.toString(),  true)
                setTimeout(() => virtualFS.build.stopProgress(), 500)
            }
        }

        const srcJson = JSON.parse(latestContent["/package.json"])
        pluginEntrypoint = srcJson.module || srcJson.main || "dist/index.mjs"
        createVirtualFile(pluginEntrypoint, result.files.outputFiles[0].text, undefined, false, true)

        virtualFS.build.setEntrypoint(pluginEntrypoint)
        virtualFS.build.setMetadata(pluginMetadata)
        virtualFS.build.setContent(result.files.outputFiles[0].text)

        virtualFS.build.addProgress(100)
        virtualFS.build.addMessage("Compilation successful!")
        window.electron.notifications.add("Build success", "", "success")
    } catch (error) {
        virtualFS.build.addMessage("Compilation failed: " + error.message,  true)
        console.error("Compilation failed:", error);
    } finally {
        setTimeout(() => virtualFS.build.stopProgress(), 500);
    }
}

export default build;