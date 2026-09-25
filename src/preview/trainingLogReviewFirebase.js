// This adapter never imports Firebase. It implements only the compat calls used
// by the real training-log UI, backed by an isolated in-memory document map.
export class ReviewTimestamp {
    constructor(milliseconds) { this.milliseconds = milliseconds; }
    toDate() { return new Date(this.milliseconds); }
    toMillis() { return this.milliseconds; }
    get seconds() { return Math.floor(this.milliseconds / 1000); }
    get nanoseconds() { return (this.milliseconds % 1000) * 1e6; }
    static fromDate(date) { return new ReviewTimestamp(date.getTime()); }
    static now() { return new ReviewTimestamp(Date.now()); }
}

const clone = value => {
    if (value instanceof ReviewTimestamp) return new ReviewTimestamp(value.toMillis());
    if (value instanceof Date) return new Date(value);
    if (Array.isArray(value)) return value.map(clone);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
    return value;
};
const field = (object, name) => name.split('.').reduce((item, key) => item?.[key], object);
const comparable = value => value?.toMillis ? value.toMillis() : value;
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function createMemoryFirestore(initialDocuments = {}, onChange = () => {}) {
    const documents = new Map(Object.entries(initialDocuments).map(([path, data]) => [path, clone(data)]));
    const subscriptions = new Set();
    const operations = [];
    let sequence = 0;
    let scheduled = false;
    const log = (type, path) => { operations.push({ type, path }); onChange({ type, path }); };
    const notify = () => {
        if (scheduled) return;
        scheduled = true;
        queueMicrotask(() => {
            scheduled = false;
            for (const subscription of [...subscriptions]) {
                try { subscription.next(subscription.read()); } catch (error) { subscription.error?.(error); }
            }
        });
    };
    const resolveValue = (value, previous) => {
        if (value?.__reviewOperation === 'timestamp') return ReviewTimestamp.now();
        if (value?.__reviewOperation === 'increment') return (Number(previous) || 0) + value.amount;
        if (value?.__reviewOperation === 'arrayUnion') return [...(previous || []), ...value.items.filter(item => !(previous || []).some(old => equal(old, item)))];
        if (value?.__reviewOperation === 'arrayRemove') return (previous || []).filter(old => !value.items.some(item => equal(old, item)));
        return clone(value);
    };
    const patch = (previous, data) => {
        const result = clone(previous || {});
        Object.entries(data).forEach(([name, value]) => {
            const path = name.split('.');
            let target = result;
            path.slice(0, -1).forEach(key => { target[key] ||= {}; target = target[key]; });
            const key = path.at(-1);
            if (value?.__reviewOperation === 'delete') delete target[key];
            else target[key] = resolveValue(value, target[key]);
        });
        return result;
    };
    const documentSnapshot = path => ({
        id: path.split('/').at(-1),
        exists: documents.has(path),
        ref: documentReference(path),
        metadata: { fromCache: true, hasPendingWrites: false },
        data: () => clone(documents.get(path)),
        get: name => clone(field(documents.get(path), name)),
    });
    const listen = (read, next, error) => {
        const subscription = { read, next, error };
        subscriptions.add(subscription);
        queueMicrotask(() => {
            if (!subscriptions.has(subscription)) return;
            try { next(read()); } catch (caught) { error?.(caught); }
        });
        return () => subscriptions.delete(subscription);
    };
    function documentReference(path) {
        return {
            id: path.split('/').at(-1), path,
            collection: name => queryReference(`${path}/${name}`),
            get: async () => { log('get', path); return documentSnapshot(path); },
            set: async (data, options = {}) => {
                documents.set(path, patch(options.merge ? documents.get(path) : {}, data));
                log('set', path); notify();
            },
            update: async data => {
                if (!documents.has(path)) throw new Error(`검토 문서가 없습니다: ${path}`);
                documents.set(path, patch(documents.get(path), data));
                log('update', path); notify();
            },
            delete: async () => { documents.delete(path); log('delete', path); notify(); },
            onSnapshot: (next, error) => { log('listen', path); return listen(() => documentSnapshot(path), next, error); },
        };
    }
    function queryReference(path, filters = [], ordering = [], maximum = Infinity) {
        const read = () => {
            let rows = [...documents.entries()].filter(([documentPath]) => documentPath.startsWith(`${path}/`) && documentPath.slice(path.length + 1).indexOf('/') < 0);
            for (const [name, operator, expected] of filters) {
                rows = rows.filter(([, data]) => {
                    const actual = comparable(field(data, name));
                    const wanted = comparable(expected);
                    switch (operator) {
                        case '==': return equal(actual, wanted);
                        case '!=': return actual !== undefined && !equal(actual, wanted);
                        case '>': return actual > wanted;
                        case '>=': return actual >= wanted;
                        case '<': return actual < wanted;
                        case '<=': return actual <= wanted;
                        case 'in': return expected.some(item => equal(actual, item));
                        case 'array-contains': return actual?.some(item => equal(item, expected));
                        default: throw new Error(`리뷰 어댑터에서 지원하지 않는 연산: ${operator}`);
                    }
                });
            }
            if (ordering.length) {
                rows = rows.filter(([, data]) => ordering.every(([name]) => field(data, name) !== undefined));
                rows.sort((a, b) => {
                    for (const [name, direction] of ordering) {
                        const left = comparable(field(a[1], name));
                        const right = comparable(field(b[1], name));
                        if (left === right) continue;
                        return (left < right ? -1 : 1) * (direction === 'desc' ? -1 : 1);
                    }
                    return a[0].localeCompare(b[0]);
                });
            }
            const docs = rows.slice(0, maximum).map(([documentPath]) => documentSnapshot(documentPath));
            return { docs, size: docs.length, empty: docs.length === 0, metadata: { fromCache: true, hasPendingWrites: false }, forEach: callback => docs.forEach(callback) };
        };
        return {
            path,
            where: (name, operator, expected) => queryReference(path, [...filters, [name, operator, expected]], ordering, maximum),
            orderBy: (name, direction = 'asc') => queryReference(path, filters, [...ordering, [name, direction]], maximum),
            limit: count => queryReference(path, filters, ordering, count),
            doc: id => documentReference(`${path}/${id || `review-${++sequence}`}`),
            add: async data => { const reference = documentReference(`${path}/review-${++sequence}`); await reference.set(data); return reference; },
            get: async () => { log('query', path); return read(); },
            onSnapshot: (next, error) => { log('listen', path); return listen(read, next, error); },
        };
    }
    const db = {
        collection: name => queryReference(name),
        doc: path => documentReference(path),
        // Resolve without opening IndexedDB. Writes still finish in this memory map.
        enablePersistence: async () => {},
        runTransaction: async callback => {
            // Match the compat get/set contract without sending anything outside
            // this map. Failed callbacks commit nothing; overlapping reads retry.
            for (let attempt = 0; attempt < 5; attempt++) {
                const reads = new Map();
                const pending = [];
                const transaction = {
                    get: async ref => {
                        if (pending.length) throw new Error('트랜잭션은 쓰기 전에 문서를 읽어야 합니다.');
                        const data = clone(documents.get(ref.path));
                        reads.set(ref.path, data);
                        log('get', ref.path);
                        return { ...documentSnapshot(ref.path),
                            data: () => clone(data), get: name => clone(field(data, name)) };
                    },
                    set: (ref, data, options = {}) => {
                        pending.push({ type: 'set', path: ref.path, data: clone(data), merge: options.merge });
                        return transaction;
                    },
                    update: (ref, data) => {
                        pending.push({ type: 'update', path: ref.path, data: clone(data), merge: true });
                        return transaction;
                    },
                    delete: ref => { pending.push({ type: 'delete', path: ref.path }); return transaction; },
                };
                const result = await callback(transaction);
                if ([...reads].some(([path, data]) => !equal(documents.get(path), data))) continue;
                const staged = new Map(documents);
                for (const operation of pending) {
                    if (operation.type === 'delete') staged.delete(operation.path);
                    else {
                        if (operation.type === 'update' && !staged.has(operation.path)) throw new Error(`검토 문서가 없습니다: ${operation.path}`);
                        staged.set(operation.path, patch(operation.merge ? staged.get(operation.path) : {}, operation.data));
                    }
                }
                for (const { path } of pending) {
                    if (staged.has(path)) documents.set(path, staged.get(path));
                    else documents.delete(path);
                }
                pending.forEach(({ type, path }) => log(type, path));
                if (pending.length) notify();
                return result;
            }
            throw new Error('검토 트랜잭션의 동시 변경을 처리하지 못했습니다. 다시 시도해 주세요.');
        },
        batch: () => {
            const pending = [];
            const batch = {
                set: (ref, data, options) => { pending.push(() => ref.set(data, options)); return batch; },
                update: (ref, data) => { pending.push(() => ref.update(data)); return batch; },
                delete: ref => { pending.push(() => ref.delete()); return batch; },
                commit: async () => { for (const operation of pending) await operation(); },
            };
            return batch;
        },
    };
    const firestore = () => db;
    firestore.Timestamp = ReviewTimestamp;
    firestore.FieldValue = {
        serverTimestamp: () => ({ __reviewOperation: 'timestamp' }),
        delete: () => ({ __reviewOperation: 'delete' }),
        increment: amount => ({ __reviewOperation: 'increment', amount }),
        arrayUnion: (...items) => ({ __reviewOperation: 'arrayUnion', items }),
        arrayRemove: (...items) => ({ __reviewOperation: 'arrayRemove', items }),
    };
    const firebase = {
        initializeApp: () => ({ name: 'training-log-local-review' }),
        firestore,
        auth: () => ({
            currentUser: null,
            onAuthStateChanged: callback => { queueMicrotask(() => callback(null)); return () => {}; },
            signOut: async () => {},
            signInWithCustomToken: async () => { throw new Error('로컬 검토에서는 로그인을 실행하지 않습니다.'); },
        }),
    };
    return { firebase, db, operations, dump: () => Object.fromEntries([...documents].map(([path, data]) => [path, clone(data)])) };
}
