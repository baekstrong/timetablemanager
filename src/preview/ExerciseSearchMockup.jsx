import { useId, useRef, useState } from 'react';

const normalize = value => value.normalize('NFKC').toLocaleLowerCase('ko').replace(/\s+/g, '');

export default function ExerciseSearchMockup({ value, names, recentNames, onChange, inputRef }) {
    const id = useId();
    const [searchText, setSearchText] = useState(null);
    const [open, setOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(-1);
    const composing = useRef(false);
    const options = useRef([]);
    const query = searchText ?? value;
    const normalized = normalize(query);
    const rank = name => normalize(name) === normalized ? 0 : normalize(name).startsWith(normalized) ? 1 : 2;
    const results = normalized
        ? names.filter(name => normalize(name).includes(normalized)).toSorted((a, b) => rank(a) - rank(b))
        : recentNames;
    const listId = `${id}-results`;
    const close = () => { setOpen(false); setSearchText(null); setActiveIndex(-1); };
    const select = name => { onChange(name); close(); };
    const handleKeyDown = event => {
        if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === 'Escape') { event.preventDefault(); close(); return; }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
            if (!results.length) return;
            const next = event.key === 'ArrowDown'
                ? Math.min(activeIndex + 1, results.length - 1)
                : activeIndex < 0 ? results.length - 1 : Math.max(activeIndex - 1, 0);
            setActiveIndex(next);
            options.current[next]?.scrollIntoView({ block: 'nearest' });
        } else if (event.key === 'Enter' && open) {
            event.preventDefault();
            const name = results[activeIndex] || results.find(item => normalize(item) === normalized) || (results.length === 1 ? results[0] : null);
            if (name) select(name);
        }
    };
    return <div className="tlm-exercise-search" onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) close();
    }}>
        <label htmlFor={id}>운동 종목</label>
        <div className="tlm-search-field">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
            <input ref={inputRef} id={id} type="text" role="combobox" aria-autocomplete="list"
                aria-expanded={open} aria-controls={open ? listId : undefined}
                aria-activedescendant={open && activeIndex >= 0 && results[activeIndex] ? `${id}-option-${activeIndex}` : undefined}
                autoComplete="off" spellCheck="false" placeholder="운동 이름을 검색하세요" value={query}
                onFocus={event => { setOpen(true); event.currentTarget.select(); }}
                onClick={() => setOpen(true)}
                onChange={event => { setSearchText(event.target.value); setOpen(true); setActiveIndex(-1); }}
                onKeyDown={handleKeyDown}
                onCompositionStart={() => { composing.current = true; }}
                onCompositionEnd={() => { composing.current = false; }} />
            <button type="button" className="tlm-search-clear" aria-label="운동 검색어 지우기" onClick={() => {
                setSearchText(''); setActiveIndex(-1); inputRef.current?.focus(); setOpen(true);
            }}>×</button>
        </div>
        {open && <div className="tlm-search-dropdown">
            <p className="tlm-search-caption" role="status">{normalized ? `검색 결과 ${results.length}개` : '최근 선택한 운동'}</p>
            <ul id={listId} role="listbox" aria-label="운동 검색 결과">
                {results.map((name, index) => <li key={name} role="presentation">
                    <button type="button" role="option" id={`${id}-option-${index}`} ref={node => { options.current[index] = node; }}
                        tabIndex={-1} aria-selected={activeIndex === index} onMouseDown={event => event.preventDefault()}
                        onClick={() => select(name)}>
                        <span>{name}</span>{name === value && <small>선택됨</small>}
                    </button>
                </li>)}
            </ul>
            {!results.length && <p className="tlm-search-empty">일치하는 운동이 없어요.<br />운동 이름의 일부로 다시 검색해주세요.</p>}
        </div>}
    </div>;
}
