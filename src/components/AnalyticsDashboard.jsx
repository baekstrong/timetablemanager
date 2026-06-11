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
