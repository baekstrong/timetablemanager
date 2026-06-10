const ImpersonationBanner = ({ studentName, onExit }) => {
    return (
        <div
            style={{
                position: 'sticky',
                top: 0,
                zIndex: 1000,
                background: 'var(--error)',
                color: '#fff',
                padding: '10px 14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '12px',
                boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
                fontSize: '0.95rem'
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                <span style={{ fontSize: '1.1rem' }}>🔍</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <strong style={{ fontSize: '1.05rem' }}>{studentName}</strong>
                    <span style={{ marginLeft: '6px', opacity: 0.9 }}>님으로 빙의 중</span>
                </span>
            </div>
            <button
                onClick={onExit}
                style={{
                    background: '#fff',
                    color: '#b91c1c',
                    border: 'none',
                    padding: '6px 12px',
                    borderRadius: '6px',
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap'
                }}
            >
                코치로 돌아가기
            </button>
        </div>
    );
};

export default ImpersonationBanner;
