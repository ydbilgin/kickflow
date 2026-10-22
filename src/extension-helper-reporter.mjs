export function originOnly(value) {
    try {
        const u = new URL(value);
        return ['http:', 'https:'].includes(u.protocol) ? u.origin : '';
    }
    catch {
        return '';
    }
}
export function createReporter(options) {
    if (!/^[a-p]{32}$/.test(options.helperId))
        throw new Error('Invalid helper extension ID');
    const runtime = options.runtime ?? globalThis.chrome?.runtime;
    const env = options.environment ?? globalThis;
    const log = options.console ?? globalThis.console;
    const catalogue = { ...options.diagnostics, unclassified: 'Unclassified extension diagnostic' };
    const now = options.now ?? Date.now;
    let windowStart = now(), sent = 0, stopped = false, installed = false;
    const originalWarn = log.warn, originalError = log.error;
    function classify(values) {
        // Never inspect objects, getters, rejection reasons, Error.message or stack.
        for (const [code, literal] of Object.entries(catalogue)) {
            if (literal && values.some(v => typeof v === 'string' && v.includes(literal)))
                return code;
        }
        return 'unclassified';
    }
    async function report(code = 'unclassified', level = 'error') {
        if (stopped || !runtime)
            return false;
        if (now() - windowStart >= 600_000) {
            windowStart = now();
            sent = 0;
        }
        if (sent >= 60)
            return false;
        sent++;
        const safeCode = Object.hasOwn(catalogue, code) && /^[a-z0-9-]{1,64}$/.test(code) ? code : 'unclassified';
        let origin = '';
        try {
            origin = originOnly(options.origin?.() ?? globalThis.location?.href ?? '');
        }
        catch { /* no page data */ }
        const payload = { type: 'ext-helper.report.v1', code: safeCode, level: level === 'warn' ? 'warn' : 'error', origin };
        return new Promise(resolve => {
            const timer = setTimeout(() => resolve(false), options.timeoutMs ?? 3000);
            try {
                runtime.sendMessage(options.helperId, payload, reply => {
                    clearTimeout(timer);
                    const failed = Boolean(runtime.lastError); // Consume Chrome callback error, never log it recursively.
                    resolve(!failed && reply?.ok === true);
                });
            }
            catch {
                clearTimeout(timer);
                resolve(false);
            }
        });
    }
    const warn = (...args) => {
        Reflect.apply(originalWarn, log, args);
        void report(classify(args), 'warn');
    };
    const error = (...args) => {
        Reflect.apply(originalError, log, args);
        void report(classify(args), 'error');
    };
    const uncaught = () => { void report('unclassified'); };
    return {
        report,
        install() {
            if (installed || stopped)
                return;
            installed = true;
            log.warn = warn;
            log.error = error;
            env.addEventListener('error', uncaught);
            env.addEventListener('unhandledrejection', uncaught);
        },
        stop() {
            stopped = true;
            if (!installed)
                return;
            if (log.warn === warn)
                log.warn = originalWarn;
            if (log.error === error)
                log.error = originalError;
            env.removeEventListener('error', uncaught);
            env.removeEventListener('unhandledrejection', uncaught);
        }
    };
}
