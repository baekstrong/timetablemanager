import './PageLoading.css';

export default function PageLoading({ message = '화면을 불러오는 중…' }) {
    return (
        <div className="page-loading" role="status">
            <span className="page-loading__spinner" aria-hidden="true" />
            <p>{message}</p>
        </div>
    );
}
