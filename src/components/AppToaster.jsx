import {OverlayToaster, Position} from "@blueprintjs/core";

const AppToasterProps = {
    position: Position.TOP_RIGHT
}

export const AppToaster = await OverlayToaster.create(
    {
        ...AppToasterProps
    });
