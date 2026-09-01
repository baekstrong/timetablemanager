// 코치 직접 등록 모달(StudentRegistrationModal)의 "중단 순서" 회귀 테스트.
//
// 예전엔 시트에 행을 쓰고 로그인 계정까지 만든 **뒤에** 입학반 정원을 검사해서,
// 만석이면 빈 행 + 계정이 남았다. 그 상태로 다시 등록하면 이름 충돌 검사에 걸려
// 코치가 갇혔다(안내는 "다른 입학반을 선택하세요"인데 선택해도 안 됨).
//
// 컴포넌트 전체를 띄우지 않고, handleSubmit의 **검사-먼저 계약**만 재현해 고정한다:
//   중단 조건(이름 충돌 / 입학반 없음 / 만석)은 전부 첫 쓰기 이전에 판정돼야 한다.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

// 위 축소판은 "이래야 한다"는 계약을 읽기 쉽게 고정할 뿐, 실제 컴포넌트가 바뀌어도
// 모른다(이 저장소엔 jsdom·testing-library가 없어 컴포넌트를 띄울 수 없다).
// 그래서 원본 파일에서 **중단 검사가 첫 쓰기보다 먼저 나오는지**를 직접 확인한다.
describe('StudentRegistrationModal 원본 — 검사가 쓰기보다 앞에 있는가', () => {
    const src = readFileSync(new URL('./StudentRegistrationModal.jsx', import.meta.url), 'utf8');

    it('입학반 만석 검사가 writeSheetData보다 먼저 나온다', () => {
        const check = src.indexOf('만석입니다');
        const write = src.indexOf('await writeSheetData(');
        expect(check).toBeGreaterThan(-1);
        expect(write).toBeGreaterThan(-1);
        expect(check).toBeLessThan(write);
    });

    it('입학반 존재 검사도 writeSheetData보다 먼저 나온다', () => {
        expect(src.indexOf('더 이상 존재하지 않습니다')).toBeLessThan(src.indexOf('await writeSheetData('));
    });

    it('이름 충돌 검사도 writeSheetData보다 먼저 나온다', () => {
        expect(src.indexOf('이미 동일한 이름의 계정이')).toBeLessThan(src.indexOf('await writeSheetData('));
    });
});

/**
 * handleSubmit의 앞부분과 같은 순서·조건으로 동작하는 축소판.
 * 실제 코드가 검사를 쓰기 뒤로 옮기면 이 계약이 깨진다.
 */
async function submit({ isNew, entranceId }, io) {
    const needsEntranceCheck = isNew && Boolean(entranceId);

    const [dupExists, , list] = await Promise.all([
        isNew ? io.checkName() : Promise.resolve(false),
        io.readSheet(),
        needsEntranceCheck ? io.loadEntrances() : Promise.resolve(null),
    ]);

    if (dupExists) return { ok: false, reason: 'name-taken' };

    let linked = null;
    if (needsEntranceCheck && list) {
        const ec = list.find(c => c.id === entranceId);
        if (!ec) return { ok: false, reason: 'entrance-missing' };
        if ((ec.currentCount || 0) >= (ec.maxCapacity || 0)) return { ok: false, reason: 'entrance-full' };
        linked = ec;
    }

    // 여기서부터 되돌릴 수 없는 부수효과
    await io.writeSheet();
    if (isNew) await io.createAccount();
    return { ok: true, linked };
}

const makeIO = ({ nameTaken = false, entrances = [] } = {}) => {
    const log = [];
    return {
        log,
        checkName: async () => { log.push('checkName'); return nameTaken; },
        readSheet: async () => { log.push('readSheet'); },
        loadEntrances: async () => { log.push('loadEntrances'); return entrances; },
        writeSheet: async () => { log.push('writeSheet'); },
        createAccount: async () => { log.push('createAccount'); },
    };
};

const FULL = [{ id: 'ec1', currentCount: 6, maxCapacity: 6 }];
const OPEN = [{ id: 'ec1', currentCount: 2, maxCapacity: 6 }];

describe('등록 모달 — 중단은 시트 쓰기 전에만', () => {
    it('입학반이 만석이면 시트도 안 쓰고 계정도 안 만든다', async () => {
        const io = makeIO({ entrances: FULL });
        const r = await submit({ isNew: true, entranceId: 'ec1' }, io);

        expect(r).toMatchObject({ ok: false, reason: 'entrance-full' });
        expect(io.log).not.toContain('writeSheet');
        expect(io.log).not.toContain('createAccount');
    });

    it('입학반이 사라져도 마찬가지', async () => {
        const io = makeIO({ entrances: [] });
        const r = await submit({ isNew: true, entranceId: 'ec1' }, io);

        expect(r).toMatchObject({ ok: false, reason: 'entrance-missing' });
        expect(io.log).not.toContain('writeSheet');
        expect(io.log).not.toContain('createAccount');
    });

    it('이름이 이미 있으면 시트도 안 쓴다', async () => {
        const io = makeIO({ nameTaken: true, entrances: OPEN });
        const r = await submit({ isNew: true, entranceId: 'ec1' }, io);

        expect(r).toMatchObject({ ok: false, reason: 'name-taken' });
        expect(io.log).not.toContain('writeSheet');
    });

    it('만석으로 막힌 뒤 다른 입학반으로 다시 내면 통과한다 (재시도가 막히지 않는다)', async () => {
        const io1 = makeIO({ entrances: FULL });
        await submit({ isNew: true, entranceId: 'ec1' }, io1);

        // 첫 시도가 계정을 안 만들었으므로 두 번째 시도의 이름 검사가 여전히 통과한다
        const io2 = makeIO({ entrances: OPEN });
        const r = await submit({ isNew: true, entranceId: 'ec1' }, io2);

        expect(r.ok).toBe(true);
        expect(io2.log).toContain('writeSheet');
        expect(io2.log).toContain('createAccount');
    });

    it('정상 등록이면 검사 3개가 모두 쓰기보다 먼저 끝나 있다', async () => {
        const io = makeIO({ entrances: OPEN });
        const r = await submit({ isNew: true, entranceId: 'ec1' }, io);

        expect(r.ok).toBe(true);
        const w = io.log.indexOf('writeSheet');
        ['checkName', 'readSheet', 'loadEntrances'].forEach(step => {
            expect(io.log.indexOf(step)).toBeGreaterThanOrEqual(0);
            expect(io.log.indexOf(step)).toBeLessThan(w);
        });
    });

    it('재등록(신규 아님)은 이름 검사도 입학반 검사도 하지 않는다', async () => {
        const io = makeIO({ nameTaken: true, entrances: FULL });
        const r = await submit({ isNew: false, entranceId: 'ec1' }, io);

        expect(r.ok).toBe(true);
        expect(io.log).not.toContain('checkName');
        expect(io.log).not.toContain('loadEntrances');
        expect(io.log).not.toContain('createAccount');
    });
});
