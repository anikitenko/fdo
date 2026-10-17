import {OverlayToaster, Position} from "@blueprintjs/core";
import * as styles from './css/AppToaster.module.css';

const AppToasterProps = {
    position: Position.TOP_RIGHT,
    className: styles.toaster,
    maxToasts: 3,
}

export const AppToaster = await OverlayToaster.create(
    {
        ...AppToasterProps
    });
