import {createIncidentReporter} from '../../src/utils/desktop/backgroundNotifications';
import {NotificationCenter} from '../../src/utils/desktop/NotificationCenter';
jest.mock('../../src/utils/desktop/NotificationCenter', () => ({NotificationCenter: {addNotification: jest.fn(async () => true)}}));
test('reports grouped failures and one recovery, with no routine success notices', () => {
    const reporter = createIncidentReporter({source: 'ai', groupKey: 'history', title: 'History unavailable', message: 'Check storage and retry.', recoveredTitle: 'History recovered', recoveredMessage: 'Saving is available again.'});
    reporter.recover(); expect(NotificationCenter.addNotification).not.toHaveBeenCalled();
    reporter.fail(new Error('Disk full')); reporter.fail(new Error('Disk full'));
    expect(NotificationCenter.addNotification).toHaveBeenCalledWith(expect.objectContaining({groupKey: 'history', source: 'ai', type: 'danger', details: expect.stringContaining('Disk full')}));
    reporter.recover(); reporter.recover();
    expect(NotificationCenter.addNotification.mock.calls.filter(([notice]) => notice.status === 'resolved')).toHaveLength(1);
});
