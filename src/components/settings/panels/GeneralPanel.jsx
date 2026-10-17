import {operationError} from '../../../utils/desktop/notificationContent';
import {Card, Switch} from "@blueprintjs/core";
import {useEffect, useState} from "react";

import * as styles from "../../css/SettingsDialog.module.css";
import {AppToaster} from "../../AppToaster";

export const GeneralPanel = () => {
    const [fdoInPath, setFdoInPath] = useState(false);
    useEffect(() => {
        window.electron.system.isFdoInPath().then((result) => {
            if (result.success) {
                setFdoInPath(true)
            } else {
                setFdoInPath(false)
            }
        })
    }, []);
    return (
        <Card className={styles["card-panel"]}>
            <Switch size="medium" style={{marginTop: "15px"}}
                    labelElement={<strong>{fdoInPath ? "Remove" : "Install"} 'fdo'
                        command {fdoInPath ? "from" : "in"} PATH</strong>}
                    innerLabelChecked="installed :)" innerLabel="not installed :("
                    checked={fdoInPath}
                    onChange={() => {
                        if (fdoInPath) {
                            window.electron.system.removeFdoFromPath().then((result) => {
                                if (result.success) {
                                    setFdoInPath(false)
                                } else {
                                    if (result.error === "skip") {
                                        return
                                    }
                                    (AppToaster).show({message: operationError("Could not remove the fdo terminal command", result.error, "Check shell integration permissions and try again."), intent: "danger"});
                                }
                            })
                        } else {
                            window.electron.system.addFdoInPath().then((result) => {
                                if (result.success) {
                                    setFdoInPath(true)
                                } else {
                                    if (result.error === "skip") {
                                        return
                                    }
                                    (AppToaster).show({message: operationError("Could not install the fdo terminal command", result.error, "Check shell integration permissions and try again."), intent: "danger"});
                                }
                            })
                        }
                    }}
            />
        </Card>
    )
}