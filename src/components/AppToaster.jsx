import {OverlayToaster, Position} from "@blueprintjs/core";
import {createRoot} from "react-dom/client";

const AppToasterProps = {
    position: Position.TOP_RIGHT
}

export const AppToaster = await OverlayToaster.createAsync(
    {
        ...AppToasterProps
    }, {
        // Use createRoot() instead of ReactDOM.render(). This can be deleted after
        // a future Blueprint version uses createRoot() for Toasters by default.
        domRenderer: (toaster, containerElement) =>
            createRoot(containerElement).render(toaster),
    });
