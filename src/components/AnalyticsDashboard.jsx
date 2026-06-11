import { useState, useEffect } from 'react';
import {
  BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { buildDashboard } from '../services/analyticsService';
import './AnalyticsDashboard.css';

// 코발트 + 중립 팔레트 (상태색 토큰 오용 금지)
const PALETTE = ['#329BE7', '#47C8FF', '#327AB8', '#A7A7AA', '#242428', '#7FB8E0'];
const won = (n) => `${(n || 0).toLocaleString('ko-KR')}원`;

const AnalyticsDashboard = ({ onBack }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await buildDashboard(6));
    } catch (e) {
      console.error(e);
      setError('통계를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const toPie = (obj) => Object.entries(obj || {}).map(([name, v]) => ({
    name, value: typeof v === 'object' ? v.count : v,
  }));

  return (
    <div className="analytics-page">
      <header className="analytics-header">
        <button className="analytics-back" onClick={onBack}>← 수강생 관리</button>
        <h1>매출·통계</h1>
        <button className="analytics-refresh" onClick={load} disabled={loading}>새로고침</button>
      </header>

      {loading && <div className="analytics-state">불러오는 중…</div>}
      {error && <div className="analytics-state error">{error}</div>}

      {data && !loading && (
        <>
          <section className="kpi-row">
            <KpiCard label="이번 달 매출" value={won(data.revenueTrend.at(-1)?.revenue)} />
            <KpiCard label="전월 대비" value={fmtDelta(data.revenueTrend.at(-1))} />
            <KpiCard label="총 수강생" value={`${data.totalStudents}명`} />
            <KpiCard label="신규/재등록/이탈"
              value={`${data.newVsRenewal.신규}/${data.newVsRenewal.재등록}/${data.churnLatest}`} />
          </section>

          <ChartCard title="매출 추세 (최근 6개월)">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={data.revenueTrend.map(m => ({ name: `${m.month}월`, 매출: m.revenue }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EFEFF0" />
                <XAxis dataKey="name" /><YAxis tickFormatter={(v) => `${v / 10000}만`} />
                <Tooltip formatter={(v) => won(v)} />
                <Bar dataKey="매출" fill="#329BE7" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="이탈 추세 (최근 6개월)">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={data.months.map(m => ({
                name: `${m.month}월`,
                이탈: data.churnByMonth[`${m.year}-${String(m.month).padStart(2, '0')}`] || 0,
              }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EFEFF0" />
                <XAxis dataKey="name" /><YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="이탈" fill="#A7A7AA" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <div className="pie-grid">
            <PieCard title="결제방식" data={toPie(data.payments)} />
            <PieCard title="남녀 비율" data={toPie(data.genders)} />
            <PieCard title="유입 경로" data={toPie(data.referrals)} />
            <PieCard title="직업 비율" data={toPie(data.occupations)} />
          </div>
        </>
      )}
    </div>
  );
};

const fmtDelta = (m) => {
  if (!m || m.delta == null) return '—';
  const sign = m.delta > 0 ? '▲' : m.delta < 0 ? '▼' : '';
  const pct = m.deltaPct == null ? '' : ` (${m.deltaPct}%)`;
  return `${sign} ${Math.abs(m.delta).toLocaleString('ko-KR')}원${pct}`;
};

const KpiCard = ({ label, value }) => (
  <div className="kpi-card"><div className="kpi-label">{label}</div><div className="kpi-value">{value}</div></div>
);

const ChartCard = ({ title, children }) => (
  <section className="chart-card"><h2>{title}</h2>{children}</section>
);

const PieCard = ({ title, data }) => (
  <section className="chart-card">
    <h2>{title}</h2>
    {data.length === 0 ? <div className="analytics-state">데이터 없음</div> : (
      <ResponsiveContainer width="100%" height={240}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} innerRadius={45} label>
            {data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
          </Pie>
          <Tooltip /><Legend />
        </PieChart>
      </ResponsiveContainer>
    )}
  </section>
);

export default AnalyticsDashboard;
