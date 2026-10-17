const {parentPort, workerData} = require('node:worker_threads');
const {openObservabilityDatabase} = require('./observabilityDatabase.cjs');
try {
    const database = openObservabilityDatabase(workerData.filename);
    parentPort.on('message', ({id, operation, value}) => {
        try {
            if (operation === 'close') {database.close(); parentPort.postMessage({id, result: true}); parentPort.close(); return;}
            parentPort.postMessage({id, result: database.execute(operation, value)});
        } catch (error) {parentPort.postMessage({id, error: error.message});}
    });
} catch (error) {parentPort.postMessage({fatal: true, error: error.message}); parentPort.close();}
