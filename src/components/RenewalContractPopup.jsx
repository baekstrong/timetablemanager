import ReviewModal from '../features/today/ReviewModal';
import './RenewalContractPopup.css';

const formatDate = (yymmdd) => {
    const value = String(yymmdd || '');
    if (!/^\d{6}$/.test(value)) return value;
    return `20${value.slice(0, 2)}.${Number(value.slice(2, 4))}.${Number(value.slice(4))}`;
};

// 코치가 재등록 계약서를 보내면 어느 화면에서든 뜨는 팝업. 동의는 계약서 화면에서 한다.
export default function RenewalContractPopup({ contract, onOpen, onLater }) {
    const rd = contract?.registrationData || {};
    const start = formatDate(rd.시작날짜);
    const end = formatDate(rd.종료날짜);
    const plan = [rd.주횟수 && `주 ${rd.주횟수}회`, `${rd.등록개월수 || '1'}개월`].filter(Boolean).join(' · ');
    return <ReviewModal title="재등록 계약서가 도착했어요" onClose={onLater}>
        <div className="renewal-contract-popup">
            <p>코치가 재등록 계약서를 보냈습니다.<br />내용을 확인하고 동의해 주세요.</p>
            {(plan || start) && <dl>
                {plan && <div><dt>수강</dt><dd>{plan}</dd></div>}
                {start && <div><dt>기간</dt><dd>{start}{end ? ` ~ ${end}` : ''}</dd></div>}
            </dl>}
            <div className="renewal-contract-popup-actions">
                <button type="button" onClick={onLater}>나중에</button>
                <button type="button" className="primary" onClick={onOpen}>계약서 확인하기</button>
            </div>
        </div>
    </ReviewModal>;
}
