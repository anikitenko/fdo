import {NotificationCenter} from './NotificationCenter';
import {failureNotification} from './notificationContent';

export function createIncidentReporter({recoveredTitle, recoveredMessage, ...context}) {
    let failed = false;
    const publish = notification => {
        try {Promise.resolve(NotificationCenter.addNotification(notification)).catch(() => {});}
        catch { /* Reporting must never replace the original operation result. */ }
    };
    return {
        fail(error) {failed = true; publish(failureNotification({...context, error}));},
        recover() {
            if (!failed) return;
            failed = false;
            publish({...context, title: recoveredTitle, message: recoveredMessage, type: 'success', status: 'resolved'});
        },
    };
}
