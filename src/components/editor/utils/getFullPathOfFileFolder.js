export const getFullPathOfFileFolder = (path, type) => {
    if (type === "folder") {
        if (path.endsWith("/")) {
            return path
        }
        return path + "/"
    } else {
        return path.split("/").slice(0, -1).join("/") + "/"
    }
}