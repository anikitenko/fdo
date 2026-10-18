// Bounded single-consumer queue. Terminal delivery never depends on a consumer.
function createQueue({limit = 2048, latest = false} = {}) {
    const values = []; let waiting, ended = false, error, reading = false;
    const wake = () => {if (waiting) {const next = waiting; waiting = null; next();}};
    return {
        push(value) {
            if (ended) return false;
            if (values.length >= limit) {
                if (!latest) return false;
                values[values.length - 1] = value;
            } else values.push(value);
            wake(); return true;
        },
        end(reason) {ended = true; error = reason; if (reason) values.length = 0; wake();},
        async next() {
            if (reading) throw Object.assign(new Error('Concurrent reads are unsupported.'), {code:'INVALID_REQUEST'});
            reading = true;
            try {
                while (!values.length && !ended) await new Promise(resolve => {waiting = resolve;});
                if (error) throw error;
                return values.length ? {done:false,value:values.shift()} : {done:true};
            } finally {reading = false;}
        },
        return() {values.length = 0; ended = true; wake(); return Promise.resolve({done:true});},
        [Symbol.asyncIterator]() {return this;},
    };
}
module.exports = {createQueue};
