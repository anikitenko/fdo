import {exportDestination} from '../../utils/persistence/observabilityConfig';

async function verifyExportResponse(response) {
    if (!response.ok) {
        const error = new Error(`Langfuse returned HTTP ${response.status}`);
        error.permanent = [400, 401, 403, 404, 422].includes(response.status);
        throw error;
    }
    const result = await response.json().catch(() => ({}));
    if (Number(result.partialSuccess?.rejectedSpans || 0) > 0) throw new Error('Langfuse rejected part of this trace');
}

export function createLangfuseExporter({request, config, decrypt, report = () => {}, fetchImpl = (input, init) => fetch(input, init), now = Date.now}) {
    let running, controller, stopped = false;
    async function drain() {
        if (stopped) return;
        const current = config({decrypt: false});
        if (!current.enabled || !current.host || !current.publicKey || (!current.hasSecretKey && !current.secretKey)) return;
        const destination = exportDestination(current);
        const records = await request('due', {destination, now: now()});
        let sent = false;
        for (const record of records) {
            if (stopped) break;
            // A settings change cannot redirect an existing trace to another project.
            const active = config();
            if (!active.enabled || exportDestination(active) !== destination) break;
            const attempts = record.attempts + 1;
            try {
                controller = new AbortController();
                const timeout = setTimeout(() => controller?.abort(), 15000);
                let response;
                try {
                    response = await fetchImpl(`${active.host}/api/public/otel/v1/traces`, {method: 'POST', redirect: 'error',
                        headers: {'content-type': 'application/json', 'x-langfuse-ingestion-version': '4',
                            authorization: `Basic ${Buffer.from(`${active.publicKey}:${active.secretKey}`).toString('base64')}`},
                        body: JSON.stringify(decrypt(record.payload).otel), signal: controller.signal});
                } finally {clearTimeout(timeout);}
                await verifyExportResponse(response);
                await request('export-result', {id: record.id, destination, state: 'sent', attempts});
                sent = true;
            } catch (error) {
                if (stopped) break; // Leave unacknowledged work pending for the next launch.
                await request('export-result', {id: record.id, destination, attempts,
                    state: error.permanent || attempts >= 8 ? 'failed' : 'pending',
                    nextAttemptAt: now() + Math.min(3600000, 15000 * 2 ** (attempts - 1)),
                    // Never persist response bodies, URLs, credentials or raw network errors.
                    error: error.permanent ? error.message : 'Export could not be completed. It will be retried.'});
                if (error.permanent || attempts >= 8) report({source: 'observability', groupKey: `langfuse-export:${destination}`, title: 'Langfuse exports need attention', type: 'danger',
                    message: 'An encrypted trace is waiting on this device. Check the server URL and project keys in Observability settings, then retry pending exports.',
                    details: error.permanent ? error.message : 'The automatic retry limit was reached.', actions: [{kind: 'view-settings', tab: 'observability'}]});
            } finally {controller = undefined;}
        }
        if (sent && (await request('export-status', {destination}))?.remaining === 0) report({source: 'observability', groupKey: `langfuse-export:${destination}`, status: 'resolved', type: 'success',
            title: 'Langfuse export queue recovered', message: 'All retained traces for this project have been exported successfully.', actions: [{kind: 'view-settings', tab: 'observability'}]});
    }
    return {
        run() {if (running) return running; running = drain().finally(() => {running = undefined;}); return running;},
        async stop() {stopped = true; controller?.abort(); await running?.catch(() => {});},
    };
}
