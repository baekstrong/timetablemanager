import { useState } from 'react';
import { shouldShowInCoachStudentList } from '../../utils/studentList';
import { getStudentField } from '../../services/googleSheetsService';

/**
 * 자율운동(3교시) 출석 관리 모달 — 코치 신규 전용 뷰에서 자율운동 셀 클릭 시.
 * 횟수 차감/종료일 영향 없음, 일시정지자도 추가 가능.
 */
export default function FreeWorkoutModal({ dateLabel, attendees, students, onAdd, onRemove, onClose, processing }) {
    const [search, setSearch] = useState('');
    const attendeeNames = new Set((attendees || []).map(a => a.studentName));
    const q = search.trim();
    const candidates = [...new Set(
        (students || [])
            .filter(shouldShowInCoachStudentList)
            .map(s => (s['이름'] || getStudentField(s, '이름') || '').trim())
            .filter(Boolean)
    )].filter(n => !attendeeNames.has(n) && (!q || n.includes(q))).slice(0, 30);

    return (
        <div onClick={onClose} style={{
            position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
            <div onClick={e => e.stopPropagation()} style={{
                background: '#fff', borderRadius: '16px', padding: '20px', width: '90%', maxWidth: '340px',
                boxShadow: '0 8px 30px rgba(0,0,0,0.18)',
            }}>
                <h3 style={{ fontSize: '17px', fontWeight: 700, marginBottom: '4px' }}>자율운동 출석</h3>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '14px' }}>{dateLabel}</p>

                {/* 현재 출석자 */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px', minHeight: '24px' }}>
                    {(attendees || []).length === 0
                        ? <span style={{ fontSize: '13px', color: '#A7A7AA' }}>아직 추가된 인원이 없습니다.</span>
                        : attendees.map(a => (
                            <span key={a.id} style={{
                                display: 'inline-flex', alignItems: 'center', gap: '4px',
                                background: '#329BE71A', border: '1px solid #329BE74D', color: '#327AB8',
                                borderRadius: '8px', padding: '2px 4px 2px 8px', fontSize: '13px', fontWeight: 600,
                            }}>
                                {a.studentName}
                                <button onClick={() => onRemove(a)} disabled={processing} title="삭제" style={{
                                    border: 'none', background: 'none', cursor: 'pointer', color: '#E94E58',
                                    fontSize: '15px', lineHeight: 1, padding: '0 2px',
                                }}>×</button>
                            </span>
                        ))}
                </div>

                {/* 검색 + 추가 */}
                <input
                    type="text" placeholder="수강생 이름 검색..." value={search}
                    onChange={e => setSearch(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.9rem', boxSizing: 'border-box' }}
                />
                <div style={{ maxHeight: '160px', overflowY: 'auto', border: '1px solid #EFEFF0', borderRadius: '6px', marginTop: '8px' }}>
                    {candidates.length === 0
                        ? <div style={{ padding: '8px 12px', color: '#9ca3af', fontSize: '0.85rem' }}>{q ? '검색 결과 없음' : '추가할 수강생을 검색하세요'}</div>
                        : candidates.map(name => (
                            <div key={name} onClick={() => !processing && onAdd(name)} style={{
                                padding: '7px 12px', cursor: processing ? 'default' : 'pointer',
                                fontSize: '0.9rem', borderBottom: '1px solid #EFEFF0',
                            }}>+ {name}</div>
                        ))}
                </div>

                <button onClick={onClose} style={{
                    marginTop: '14px', width: '100%', background: '#6b7280', color: '#fff',
                    padding: '10px', border: 'none', borderRadius: '8px', fontWeight: 700, cursor: 'pointer',
                }}>닫기</button>
            </div>
        </div>
    );
}
