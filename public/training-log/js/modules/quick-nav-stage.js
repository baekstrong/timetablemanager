// 코치 훈련일지 상단 퀵내비 — 같은 이름을 반복해서 눌렀을 때의 이동 순환.
// DOM·Firebase 의존이 없어 브라우저와 Vitest 양쪽에서 import 한다.

// 1클릭 코치 전용 메모 → 2클릭 훈련일지 기록 → 3클릭 재등록(메인 앱으로 이탈).
//
// 3단계는 '마지막' 수업인 수강생에게만 붙인다. 모두에게 붙이면 아무나 세 번 누른 순간
// 훈련일지 밖으로 튕겨나가는데, 돌아오려면 페이지를 통째로 다시 로드해야 한다.
export function nextStage(currentStage, isSameStudent, isLastClass) {
    if (!isSameStudent) return 'memo';
    const stages = isLastClass ? ['memo', 'records', 'renewal'] : ['memo', 'records'];
    // 없는 단계(null, 또는 태그가 사라져 사라진 'renewal')는 -1 → 첫 단계로 되돌아간다.
    return stages[(stages.indexOf(currentStage) + 1) % stages.length];
}

// 숨은 3단계를 알리는 유일한 힌트. 기록 단계에 와 있는 '마지막' 수강생에게만 보인다.
// ponytail: 자식 span이 아니라 이름과 같은 텍스트 노드에 붙인다 — 구버전 사파리에서
// 퀵내비 칸 안의 자식 요소가 눌려 사라지는 문제(labelFor 주석 참고).
export function stageHint(stage, isLastClass) {
    return stage === 'records' && isLastClass ? ' · 한 번 더 = 재등록' : '';
}
