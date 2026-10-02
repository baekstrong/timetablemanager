import PushSettings from './PushSettings';
import TierBadge from './TierBadge';
import { gradeProgress } from '../utils/grades';
import './StudentGrowth.css';

export default function StudentGrowthHeader({ user, tier, xp, loading = false, error = '', pushReadOnly = false, onOpen, onRetry }) {
    const progress = Number.isFinite(xp) ? gradeProgress(xp) : null;
    return <section className="student-growth" aria-label="내 성장 정보">
        <div className="student-growth-top"><span className="student-growth-name"><strong>{user?.username}님</strong><PushSettings user={user} readOnly={pushReadOnly} /></span><TierBadge tier={tier} style={{ height: '22px', fontSize: '11px', marginRight: 0 }} /></div>
        <button type="button" className="student-growth-summary" onClick={error ? onRetry : onOpen}
            disabled={loading && !progress} aria-label={error ? '성장 정보 다시 불러오기' : `${user?.username || ''}님의 성장 자세히 보기`}>
            {progress ? <>
                <span className="student-growth-level"><span>🎓 {progress.grade.label}</span><span className="student-growth-link">성장 보기 <span aria-hidden="true">›</span></span></span>
                <span className="student-growth-track" role="progressbar" aria-label="다음 학년까지 진행률"
                    aria-valuenow={Math.round(progress.pct)} aria-valuemin={0} aria-valuemax={100}>
                    <span style={{ width: `${progress.pct}%` }} />
                </span>
                <span className="student-growth-caption"><span>{progress.next ? `다음 학년까지 ${progress.remaining.toLocaleString()}kg` : '최고 학년 달성 · 졸업'}</span><span>{Math.round(progress.pct)}%</span></span>
            </> : <span className="student-growth-placeholder">{error ? '성장 정보를 불러오지 못했어요. 다시 시도 ›' : loading ? '성장 정보를 불러오는 중…' : '내 운동의 성장을 확인해보세요 ›'}</span>}
        </button>
    </section>;
}
