import {OverlayToaster, Position} from "@blueprintjs/core";
import { createRoot } from "react-dom/client";

const toasterProps = {
    position: Position.TOP_RIGHT,
}

export const AppToaster = OverlayToaster.createAsync(toasterProps, {
    // Use createRoot() instead of ReactDOM.render(). This can be deleted after
    // a future Blueprint version uses createRoot() for Toasters by default.
    domRenderer: (toaster, containerElement) => createRoot(containerElement).render(toaster),
});
