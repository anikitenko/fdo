import {operationError} from '../../../utils/desktop/notificationContent';
import {Button, Card, Switch} from '@blueprintjs/core';
import {useEffect, useState} from 'react';
import * as styles from '../../css/SettingsDialog.module.css';
import {AppToaster} from '../../AppToaster';

export const GeneralPanel = () => {
    const [installation, setInstallation] = useState({success: false});
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        let current = true;
        window.electron.system.isFdoInPath().then(result => {if (current) setInstallation(result);}).catch(() => {});
        return () => {current = false;};
    }, []);
    const update = async remove => {
        if (busy) return;
        setBusy(true);
        const showFailure = error => AppToaster.show({message: operationError(`Could not ${remove ? 'remove' : 'install or repair'} the fdo terminal command`, error, 'Check shell integration permissions and try again.'), intent: 'danger'});
        try {
            const result = await (remove ? window.electron.system.removeFdoFromPath() : window.electron.system.addFdoInPath());
            if (!result.success) {
                if (result.error !== 'skip') showFailure(new Error(result.error));
                return;
            }
            setInstallation({success: !remove, path: result.path});
            AppToaster.show({message: result.warning || (remove ? 'The fdo terminal command was removed.' : `The fdo command is ready at ${result.path}. Open a new terminal; add its directory to PATH if needed.`), intent: result.warning ? 'warning' : 'success'});
        } catch (error) {
            showFailure(error);
        } finally {setBusy(false);}
    };
    return <Card className={styles['card-panel']}>
        <Switch size="medium" style={{marginTop: '15px'}} labelElement={<strong>Enable 'fdo' terminal command</strong>}
            innerLabelChecked="installed" innerLabel="not installed" checked={installation.success} disabled={busy}
            onChange={() => update(installation.success)}/>
        {installation.path && <p>{installation.path}</p>}
        {installation.success && <Button disabled={busy} loading={busy} onClick={() => update(false)}>Repair command</Button>}
    </Card>;
};
