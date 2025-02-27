export const getFullPathOfFileFolder = (path, type, same = false) => {
    if (type === "folder") {
        if (path.endsWith("/")) {
            if (same) {
                path = path.trimEnd("/")
                return path.split("/").slice(0, -1).join("/") + "/"
            }
            return path + "/"
        }
        if (same) {
            return path.split("/").slice(0, -1).join("/") + "/"
        }
        return path + "/"
    } else {
        return path.split("/").slice(0, -1).join("/") + "/"
    }
}