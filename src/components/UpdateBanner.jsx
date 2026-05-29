// 새 버전이 배포됐을 때 상단에 띄우는 새로고침 안내 배너.
// 사용자가 직접 버튼을 눌러 새로고침하므로 입력 중이던 내용이 날아갈 위험이 없다.

const UpdateBanner = () => {
  const handleReload = () => {
    // 명시적 reload는 최상위 문서를 재검증(If-None-Match)하므로 새 index.html → 새 번들을 받는다.
    window.location.reload();
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
        padding: '10px 16px',
        background: '#2563eb',
        color: '#fff',
        fontSize: '14px',
        fontWeight: 600,
        boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
      }}
      role="status"
    >
      <span>🔄 새 버전이 있습니다.</span>
      <button
        onClick={handleReload}
        style={{
          padding: '6px 14px',
          background: '#fff',
          color: '#2563eb',
          border: 'none',
          borderRadius: '6px',
          fontSize: '14px',
          fontWeight: 700,
          cursor: 'pointer',
        }}
      >
        새로고침
      </button>
    </div>
  );
};

export default UpdateBanner;
