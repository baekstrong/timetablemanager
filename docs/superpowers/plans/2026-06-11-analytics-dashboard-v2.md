# 매출 대시보드 개선(v2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 매출·통계 대시보드를 (1) 위=월별 현황 / 아래=6개월 추세로 재배치하고, (2) 월 선택기로 선택한 달 현황을 보며, (3) 환불(현황 KPI + 6개월 추세)을 추가한다.

**Architecture:** `analyticsService.js`의 `buildDashboard`를 두 함수로 분리한다 — `getTrends(6)`(고정 추세: 매출·환불·이탈)와 `getMonthSnapshot(년,월,등록목록)`(선택 달 현황). 시트 '엑셀 시트 집계' 블록(`T2:AF3`)을 한 번 읽어 매출·환불·결제방식 금액을 동시 취득하는 순수 파서 `parseAggregateBlock`를 추가한다. 컴포넌트는 두 결과를 조합하고, 월 선택 시 현황만 재조회한다.

**Tech Stack:** React 19, Recharts, Google Sheets, Firebase, Vitest.

**핵심 데이터 사실:**
- 집계 블록 행2=라벨, 행3=값, 모두 **만원 단위**, 환불은 음수·소수.
- 라벨 위치: 계좌(T) 카드(U) 네이버(V) 탈잉(W) 제로페이(X) 어플(Y) … 총 매출(AD) 환불(AE) 최종 매출(환불 포함)(AF). `T2:AF3` 읽기로 전부 커버.
- 결제방식 라벨 집합: `계좌/카드/네이버/탈잉/제로페이/어플`.
- `MANWON = 10000`. 금액은 `parseFloat(... .replace(/[^0-9.-]/g,''))` 후 `Math.round(×10000)`.
- 기존 순수 함수 재사용: `computeRevenueTrend`, `computeSheetChurnByMonth`, `mergeChurn`, `countNewVsRenewal`, `tallyGenders`, `tallyOccupations`, `tallyReferralSources`, `recentMonths`, `getMonthlyRevenue`(폴백 보유), `getAllStudents`, `getTerminations`, `getNewStudentRegistrations`. 모두 `analyticsService.js`에 import/정의되어 있음.
- 모듈 스코프 `ymKey(year,month)`='YYYY-MM' 존재(재사용).

---

## File Structure

| 파일 | 변경 |
|---|---|
| `src/services/analyticsService.js` | `parseAggregateBlock`(순수), `getAggregate`/`getTrends`/`getMonthSnapshot`(IO) 추가. Task 4에서 미사용 `buildDashboard` 제거. |
| `src/services/analyticsService.test.js` | `parseAggregateBlock` 단위 테스트 추가. |
| `src/components/AnalyticsDashboard.jsx` | 2섹션 레이아웃 + 월 선택기 + 환불 KPI/차트 + 결제방식 금액으로 전면 교체. |
| `src/components/AnalyticsDashboard.css` | 섹션 헤더·월 선택기 스타일 추가. |

각 태스크는 빌드를 깨지 않는다(`buildDashboard`는 Task 3에서 컴포넌트가 새 함수로 전환된 뒤, Task 4에서 제거).

---

## Task 1: parseAggregateBlock (순수 함수)

**Files:**
- Modify: `src/services/analyticsService.js`
- Test: `src/services/analyticsService.test.js`

- [ ] **Step 1: 실패하는 테스트 추가** (`analyticsService.test.js`에 append)

```js
import { parseAggregateBlock } from './analyticsService';

describe('parseAggregateBlock', () => {
  const labels = ['계좌','카드','네이버','탈잉','제로페이','어플','총합','단말기와 차액','<-네이버+탈잉+제로+어플','기타(HR)','총 매출','환불',' 최종 매출\n(환불 포함)'];

  it('만원→원 환산, 0 방식 제외, 최종매출 추출 (6월: 환불 없음)', () => {
    const values = ['39','190','0','0','62','0','291','291','62','0','291','0','291'];
    expect(parseAggregateBlock(labels, values)).toEqual({
      payments: { 계좌: 390000, 카드: 1900000, 제로페이: 620000 },
      refund: 0,
      finalRevenue: 2910000,
    });
  });

  it('환불은 절대값, 소수 최종매출 처리 (5월: 환불 -53.025)', () => {
    const values = ['39','39','0','0','0','0','78','78','0','0','871','-53.025','817.975'];
    expect(parseAggregateBlock(labels, values)).toEqual({
      payments: { 계좌: 390000, 카드: 390000 },
      refund: 530250,
      finalRevenue: 8179750,
    });
  });

  it('빈 입력은 안전하게 0/빈 객체', () => {
    expect(parseAggregateBlock([], [])).toEqual({ payments: {}, refund: 0, finalRevenue: 0 });
    expect(parseAggregateBlock(undefined, undefined)).toEqual({ payments: {}, refund: 0, finalRevenue: 0 });
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm run test -- analyticsService`
Expected: FAIL — "parseAggregateBlock is not a function".

- [ ] **Step 3: 구현** (`analyticsService.js`에 추가 — 기존 `const MANWON = 10000;` 아래/근처에 두되, MANWON가 이미 선언돼 있으면 재사용하고 중복 선언 금지)

```js
// ─── 집계 블록 파서 (행2=라벨, 행3=값, 만원 단위) ───
const PAYMENT_LABELS = ['계좌', '카드', '네이버', '탈잉', '제로페이', '어플'];
const toWon = (raw) => {
  const n = parseFloat(String(raw ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? Math.round(n * MANWON) : 0;
};

export function parseAggregateBlock(labelRow, valueRow) {
  const labels = labelRow || [];
  const values = valueRow || [];
  const payments = {};
  let refund = 0;
  let finalRevenue = 0;
  labels.forEach((rawLabel, i) => {
    const label = String(rawLabel ?? '').trim();
    const won = toWon(values[i]);
    if (PAYMENT_LABELS.includes(label)) {
      if (won > 0) payments[label] = won;
    } else if (label === '환불') {
      refund = Math.abs(won);
    } else if (label.includes('최종 매출')) {
      finalRevenue = won;
    }
  });
  return { payments, refund, finalRevenue };
}
```
Note: `MANWON` is already declared at module scope (used by `getMonthlyRevenue`). Reuse it; do NOT redeclare. Place `PAYMENT_LABELS`/`toWon`/`parseAggregateBlock` after the existing `MANWON` declaration.

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm run test -- analyticsService`
Expected: PASS (기존 + 3 new).

- [ ] **Step 5: 커밋**

```bash
git add src/services/analyticsService.js src/services/analyticsService.test.js
git commit -m "feat(analytics): 집계 블록 파서 parseAggregateBlock 추가"
```

---

## Task 2: getAggregate / getTrends / getMonthSnapshot (IO)

**Files:**
- Modify: `src/services/analyticsService.js`

기존 `buildDashboard`는 이 태스크에서 그대로 둔다(빌드 그린 유지). 새 함수만 추가한다.

- [ ] **Step 1: 구현 추가** (`analyticsService.js` — `getMonthlyRevenue` 정의 아래, `buildDashboard` 위 근처)

```js
// 집계 블록(T2:AF3) 1회 읽기 → { payments(원), refund(원,양수), finalRevenue(원) }
export async function getAggregate(year, month) {
  const sheet = getSheetNameByYearMonth(year, month);
  try {
    const rows = await readSheetData(`${sheet}!T2:AF3`);
    return parseAggregateBlock(rows?.[0], rows?.[1]);
  } catch {
    return { payments: {}, refund: 0, finalRevenue: 0 };
  }
}

// 매출: 집계 최종매출 우선, 0/실패면 getMonthlyRevenue 폴백(컬럼 I 합산)
async function resolveRevenue(year, month, agg) {
  if (agg && agg.finalRevenue > 0) return agg.finalRevenue;
  return getMonthlyRevenue(year, month);
}

// 최근 N개월(고정) 추세: 매출·환불·이탈
export async function getTrends(monthsCount = 6, baseDate = new Date()) {
  const months = recentMonths(monthsCount, baseDate);
  const perMonth = await Promise.all(months.map(async ({ year, month }) => {
    const agg = await getAggregate(year, month);
    return {
      year, month,
      students: await getAllStudents(year, month).catch(() => []),
      revenue: await resolveRevenue(year, month, agg),
      refund: agg.refund,
    };
  }));
  const terminations = await getTerminations().catch(() => []);

  const revenueTrend = computeRevenueTrend(
    perMonth.map(m => ({ year: m.year, month: m.month, revenue: m.revenue }))
  );
  const refundTrend = perMonth.map(m => ({ year: m.year, month: m.month, refund: m.refund }));
  const sheetChurn = computeSheetChurnByMonth(
    perMonth.map(m => ({ year: m.year, month: m.month, students: m.students }))
  );
  const churnByMonth = mergeChurn(sheetChurn, terminations, months);

  return { months, revenueTrend, refundTrend, churnByMonth };
}

// 선택한 달 현황. registrations는 호출측에서 1회 로드해 전달.
export async function getMonthSnapshot(year, month, registrations = []) {
  const agg = await getAggregate(year, month);
  const revenue = await resolveRevenue(year, month, agg);

  // 전월 대비
  const prevDate = new Date(year, month - 2, 1);
  const py = prevDate.getFullYear();
  const pm = prevDate.getMonth() + 1;
  const prevAgg = await getAggregate(py, pm);
  const prevRevenue = await resolveRevenue(py, pm, prevAgg);
  const trend = computeRevenueTrend([{ revenue: prevRevenue }, { revenue }]);
  const prevDelta = { delta: trend[1].delta, deltaPct: trend[1].deltaPct };

  const students = await getAllStudents(year, month).catch(() => []);
  const inMonth = (registrations || []).filter(r => {
    const ms = r.createdAt?.toMillis?.();
    if (!ms) return false;
    const d = new Date(ms);
    return d.getFullYear() === year && (d.getMonth() + 1) === month;
  });

  return {
    year, month,
    revenue,
    refund: agg.refund,
    prevDelta,
    payments: agg.payments,
    totalStudents: students.filter(s => (s['이름'] || '').trim()).length,
    newVsRenewal: countNewVsRenewal(students),
    genders: tallyGenders(students),
    occupations: tallyOccupations(students),
    referrals: tallyReferralSources(inMonth),
  };
}
```

- [ ] **Step 2: 테스트 + 빌드 확인** (IO라 단위 테스트 없음 — 임포트 해석/회귀만 확인)

Run: `npm run test -- analyticsService` → 기존 통과 유지.
Run: `npm run build` → 성공(임포트 해석 확인).

- [ ] **Step 3: 커밋**

```bash
git add src/services/analyticsService.js
git commit -m "feat(analytics): getTrends/getMonthSnapshot/getAggregate 추가 (현황·추세 분리)"
```

---

## Task 3: AnalyticsDashboard 재구성 (레이아웃 2섹션 + 월 선택 + 환불 + 결제방식 금액)

**Files:**
- Modify: `src/components/AnalyticsDashboard.jsx` (전면 교체)
- Modify: `src/components/AnalyticsDashboard.css` (스타일 추가)

- [ ] **Step 1: 컴포넌트 전면 교체** — `src/components/AnalyticsDashboard.jsx` 전체를 아래로 교체:

```jsx
import { useState, useEffect, useCallback } from 'react';
import {
  BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { getTrends, getMonthSnapshot } from '../services/analyticsService';
import { getNewStudentRegistrations } from '../services/firebaseService';
import './AnalyticsDashboard.css';

// 코발트 + 중립 팔레트 (상태색 토큰 오용 금지)
const PALETTE = ['#329BE7', '#47C8FF', '#327AB8', '#A7A7AA', '#242428', '#7FB8E0'];
const won = (n) => `${Math.round(n || 0).toLocaleString('ko-KR')}원`;
const ymKey = (y, m) => `${y}-${String(m).padStart(2, '0')}`;

const AnalyticsDashboard = ({ onBack }) => {
  const [trends, setTrends] = useState(null);
  const [registrations, setRegistrations] = useState([]);
  const [snapshot, setSnapshot] = useState(null);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [snapLoading, setSnapLoading] = useState(false);
  const [error, setError] = useState(null);

  const loadSnapshot = useCallback(async (sel, regs) => {
    setSnapLoading(true);
    try {
      setSnapshot(await getMonthSnapshot(sel.year, sel.month, regs));
    } catch (e) {
      console.error(e);
    } finally {
      setSnapLoading(false);
    }
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [t, regs] = await Promise.all([
        getTrends(6),
        getNewStudentRegistrations().catch(() => []),
      ]);
      setTrends(t);
      setRegistrations(regs);
      const latest = t.months[t.months.length - 1];
      setSelected(latest);
      await loadSnapshot(latest, regs);
    } catch (e) {
      console.error(e);
      setError('통계를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [loadSnapshot]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const onSelectMonth = (e) => {
    const [y, m] = e.target.value.split('-').map(Number);
    const sel = { year: y, month: m };
    setSelected(sel);
    loadSnapshot(sel, registrations);
  };

  const toPie = (obj) => Object.entries(obj || {}).map(([name, value]) => ({ name, value }));

  return (
    <div className="analytics-page">
      <header className="analytics-header">
        <button className="analytics-back" onClick={onBack}>← 수강생 관리</button>
        <h1>매출·통계</h1>
        <button className="analytics-refresh" onClick={loadAll} disabled={loading}>새로고침</button>
      </header>

      {loading && <div className="analytics-state">불러오는 중…</div>}
      {error && <div className="analytics-state error">{error}</div>}

      {trends && !loading && (
        <>
          {/* ── 월별 현황 ── */}
          <div className="section-head">
            <h2 className="section-title">월별 현황</h2>
            <select
              className="analytics-month-select"
              value={selected ? ymKey(selected.year, selected.month) : ''}
              onChange={onSelectMonth}
            >
              {[...trends.months].reverse().map(m => (
                <option key={ymKey(m.year, m.month)} value={ymKey(m.year, m.month)}>
                  {m.year}년 {m.month}월
                </option>
              ))}
            </select>
          </div>

          {snapLoading && <div className="analytics-state">불러오는 중…</div>}
          {snapshot && !snapLoading && (
            <>
              <section className="kpi-row">
                <KpiCard label="매출" value={won(snapshot.revenue)} />
                <KpiCard label="전월 대비" value={fmtDelta(snapshot.prevDelta)} />
                <KpiCard label="환불" value={won(snapshot.refund)} />
                <KpiCard label="총 수강생" value={`${snapshot.totalStudents}명`} />
                <KpiCard
                  label="신규/재등록/이탈"
                  value={`${snapshot.newVsRenewal.신규}/${snapshot.newVsRenewal.재등록}/${trends.churnByMonth[ymKey(snapshot.year, snapshot.month)] ?? 0}`}
                />
              </section>

              <div className="pie-grid">
                <PieCard title="결제방식 (금액)" data={toPie(snapshot.payments)} money />
                <PieCard title="남녀 비율" data={toPie(snapshot.genders)} />
                <PieCard title="유입 경로" data={toPie(snapshot.referrals)} />
                <PieCard title="직업 비율" data={toPie(snapshot.occupations)} />
              </div>
            </>
          )}

          {/* ── 6개월 추세 ── */}
          <h2 className="section-title trend-title">6개월 추세</h2>

          <ChartCard title="매출 추세">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={trends.revenueTrend.map(m => ({ name: `${m.month}월`, 매출: m.revenue }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EFEFF0" />
                <XAxis dataKey="name" /><YAxis tickFormatter={(v) => `${Math.round(v / 10000)}만`} />
                <Tooltip formatter={(v) => won(v)} />
                <Bar dataKey="매출" fill="#329BE7" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="환불 추세">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={trends.refundTrend.map(m => ({ name: `${m.month}월`, 환불: m.refund }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EFEFF0" />
                <XAxis dataKey="name" /><YAxis tickFormatter={(v) => `${Math.round(v / 10000)}만`} />
                <Tooltip formatter={(v) => won(v)} />
                <Bar dataKey="환불" fill="#A7A7AA" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="이탈 추세">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={trends.months.map(m => ({
                name: `${m.month}월`,
                이탈: trends.churnByMonth[ymKey(m.year, m.month)] || 0,
              }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EFEFF0" />
                <XAxis dataKey="name" /><YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="이탈" fill="#A7A7AA" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </>
      )}
    </div>
  );
};

const fmtDelta = (d) => {
  if (!d || d.delta == null) return '—';
  const sign = d.delta > 0 ? '▲' : d.delta < 0 ? '▼' : '';
  const pct = d.deltaPct == null ? '' : ` (${d.deltaPct}%)`;
  return `${sign} ${Math.abs(d.delta).toLocaleString('ko-KR')}원${pct}`;
};

const KpiCard = ({ label, value }) => (
  <div className="kpi-card"><div className="kpi-label">{label}</div><div className="kpi-value">{value}</div></div>
);

const ChartCard = ({ title, children }) => (
  <section className="chart-card"><h2>{title}</h2>{children}</section>
);

const PieCard = ({ title, data, money }) => (
  <section className="chart-card">
    <h2>{title}</h2>
    {data.length === 0 ? <div className="analytics-state">데이터 없음</div> : (
      <ResponsiveContainer width="100%" height={240}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} innerRadius={45} label={!money}>
            {data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
          </Pie>
          <Tooltip formatter={money ? (v) => won(v) : undefined} /><Legend />
        </PieChart>
      </ResponsiveContainer>
    )}
  </section>
);

export default AnalyticsDashboard;
```

- [ ] **Step 2: CSS 추가** — `src/components/AnalyticsDashboard.css` 끝에 append:

```css
.section-head { display: flex; align-items: center; justify-content: space-between; margin: 8px 0 12px; }
.section-title { font-size: 16px; font-weight: 700; }
.trend-title { margin: 24px 0 12px; padding-top: 16px; border-top: 1px solid var(--hairline); }
.analytics-month-select {
  border: 1px solid var(--hairline);
  border-radius: var(--r-chip);
  padding: 6px 10px;
  background: var(--canvas);
  color: var(--text);
  font-size: 14px;
  font-family: var(--font);
  cursor: pointer;
}
```

- [ ] **Step 3: 빌드 + 린트 확인**

Run: `npm run build` → 성공.
Run: `npm run lint 2>&1 | grep AnalyticsDashboard` → 새 에러 없음.

- [ ] **Step 4: 커밋**

```bash
git add src/components/AnalyticsDashboard.jsx src/components/AnalyticsDashboard.css
git commit -m "feat(analytics): 월별 현황/6개월 추세 분리 + 월 선택기 + 환불 + 결제방식 금액"
```

---

## Task 4: 정리(미사용 buildDashboard 제거) + 검증 + 푸시

**Files:**
- Modify: `src/services/analyticsService.js`

- [ ] **Step 1: 미사용 `buildDashboard` 제거**

`src/components/AnalyticsDashboard.jsx`가 더 이상 `buildDashboard`를 import하지 않음을 확인:
Run: `grep -rn "buildDashboard" src/`
Expected: `analyticsService.js`의 정의 1곳만 남음(컴포넌트/테스트에서 참조 없음).

확인되면 `analyticsService.js`에서 `export async function buildDashboard(...) { ... }` 함수 블록 전체(시작 `export async function buildDashboard`부터 매칭되는 닫는 `}`까지)를 삭제한다. 이 함수가 쓰던 헬퍼(`recentMonths`, `mergeChurn`, `computeRevenueTrend`, `computeSheetChurnByMonth`, tally 함수들, `getAggregate`, `resolveRevenue`)는 `getTrends`/`getMonthSnapshot`이 계속 사용하므로 **남겨둔다**.

주의: `tallyPaymentMethods`는 이제 차트에서 안 쓰지만, 테스트가 있고 재사용 가능한 유틸이므로 **삭제하지 않고 유지**한다(YAGNI 위반 아님 — 이미 존재·테스트됨).

- [ ] **Step 2: 전체 검증**

Run: `npm run test 2>&1 | tail -6` → 전체 PASS.
Run: `npm run lint 2>&1 | tail -3` → 새 에러 없음(기존 ~186 사전 에러 제외).
Run: `npm run build 2>&1 | tail -3` → 성공.

- [ ] **Step 3: 커밋 + 푸시**

```bash
git add src/services/analyticsService.js
git commit -m "refactor(analytics): 미사용 buildDashboard 제거"
git push -u origin feat/analytics-dashboard-v2
```
주의: `.env`·`functions/package-lock.json` 등 로컬 변경은 스테이징하지 말 것(명시 경로만 add).

---

## Self-Review (작성자 점검)

- **스펙 커버리지:** 레이아웃 재배치(T3) / 월 선택기·현황만 갱신(T2 getMonthSnapshot + T3 selector) / 환불 KPI+추세(T1 파서, T2 refund, T3 KPI·차트) / 결제방식 금액(T1 파서, T3 money 플래그) / 데이터 분리(T2) / 정리(T4). 모두 매핑됨.
- **타입 일관성:** `getTrends` 반환 `{months, revenueTrend, refundTrend, churnByMonth}` ↔ 컴포넌트 소비 일치. `getMonthSnapshot` 반환 `{year,month,revenue,refund,prevDelta,payments,totalStudents,newVsRenewal,genders,occupations,referrals}` ↔ 컴포넌트 소비 일치. `prevDelta`는 `{delta,deltaPct}` → `fmtDelta(d)` 시그니처 일치(기존 `fmtDelta(m)`는 `m.delta` 접근 → 동일 형태). `ymKey`는 컴포넌트에 로컬 정의(서비스의 모듈 스코프 `ymKey`와 별개, 동일 포맷).
- **빌드 그린 유지:** T1·T2는 추가만, T3에서 컴포넌트가 새 함수로 전환, T4에서 미사용 제거 — 각 커밋 빌드 그린.
- **금액 단위:** 파서·resolveRevenue 모두 만원→원 환산(×10000) 일관. 폴백(getMonthlyRevenue)도 원 단위 반환.
- **알려진 한계:** 월 선택 범위는 최근 6개월(추세와 동일). 더 과거는 후속(YAGNI).
