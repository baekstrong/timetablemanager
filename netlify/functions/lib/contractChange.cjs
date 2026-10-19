// appendCells + updateCells는 동일 spreadsheets.batchUpdate에서 원자적으로 반영된다.
// 응답 유실 재요청은 계약변경 ID로 확인해 중복 결제를 만들지 않는다.
module.exports = async function saveContractChange(sheets, spreadsheetId, input) {
  const { name, targetSheet, id, row, retired } = input || {};
  const fail = message => { const error = new Error(message); error.status = 409; throw error; };
  if (typeof name !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(id || '') ||
      !Array.isArray(row) || row.length !== 18 || row[1] !== name || row[5] !== '계약변경' ||
      !/^[2-4]$/.test(String(row[2])) || !/^\d{6}$/.test(row[6]) || !/^\d{6}$/.test(row[7]) || row[7] < row[6] ||
      !Number.isFinite(Number(row[8])) || Number(row[8]) < 0 || !['O', 'X'].includes(row[10]) ||
      !Array.isArray(retired) || !retired.length || retired.length > 100) fail('계약변경 입력값을 확인해주세요.');
  const info = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties' });
  const props = info.data.sheets.map(s => s.properties).filter(s => /^등록생 목록\(/.test(s.title));
  const target = props.find(s => s.title === targetSheet);
  if (!target) fail('대상 등록 시트를 찾지 못했습니다.');
  const quote = title => `'${title.replaceAll("'", "''")}'`;
  const result = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: props.map(s => `${quote(s.title)}!A:R`) });
  if (result.data.valueRanges?.length !== props.length) fail('전체 시트 확인에 실패했습니다.');
  const tables = new Map(props.map((p, i) => [p.title, result.data.valueRanges[i].values || []]));
  const normalized = r => Array.from({ length: 18 }, (_, i) => String(r?.[i] ?? ''));
  const marker = `[계약변경연결:${id}]`;
  const duplicate = [...tables.values()].flat().find(r => r[1] === name && r[5] === '계약변경' && String(r[4] || '').includes(encodeURIComponent(`"id":"${id}"`)));
  if (duplicate) {
    if (JSON.stringify(normalized(duplicate).slice(1)) !== JSON.stringify(normalized(row).slice(1))) fail('같은 변경 ID의 저장 내용이 다릅니다. 시트를 확인해주세요.');
    return { success: true, alreadySaved: true };
  }
  const requests = [];
  const seen = new Set();
  for (const item of retired) {
    const prop = props.find(p => p.title === item.sheetName);
    const key = `${item.sheetName}:${item.rowIndex}`;
    if (!prop || !Number.isInteger(item.rowIndex) || item.rowIndex < 2 || seen.has(key)) fail('이전 등록 위치를 확인해주세요.');
    seen.add(key);
    const current = tables.get(item.sheetName)[item.rowIndex];
    if (!current || current[1] !== name || !current[3] || !['신규', '재등록', '계약변경'].includes(current[5]) ||
        JSON.stringify(normalized(current)) !== JSON.stringify(normalized(item.expected))) fail('이전 등록이 변경됐습니다. 최신 상태를 다시 확인해주세요.');
    if (typeof item.notes !== 'string' || !item.notes.includes(marker) || !item.notes.includes(`[이전시간표:${current[3]}]`)) fail('이전 시간표 보존 기록이 없습니다.');
    requests.push({ updateCells: {
      range: { sheetId: prop.sheetId, startRowIndex: item.rowIndex, endRowIndex: item.rowIndex + 1, startColumnIndex: 3, endColumnIndex: 5 },
      rows: [{ values: [{ userEnteredValue: { stringValue: '' } }, { userEnteredValue: { stringValue: item.notes } }] }], fields: 'userEnteredValue',
    } });
  }
  // 현재 행 번호의 최댓값 + 1. 다른 수강생 데이터·시트 수식·서식은 덮어쓰지 않는다.
  const targetRows = tables.get(targetSheet);
  const number = Math.max(0, ...targetRows.slice(2).map(r => Number(r[0]) || 0)) + 1;
  // 새 행도 기존 표의 글꼴·테두리·결제방식 드롭다운을 이어받는다. 값/메모는 복사하지 않는다.
  let exemplar = targetRows.findLastIndex((r, i) => i >= 2 && r[5] === '계약변경');
  if (exemplar < 2) exemplar = retired.find(item => item.sheetName === targetSheet)?.rowIndex;
  if (!Number.isInteger(exemplar)) fail('새 행의 서식 원본을 찾지 못했습니다.');
  const styleResponse = await sheets.spreadsheets.get({ spreadsheetId, ranges: [`${quote(targetSheet)}!A${exemplar + 1}:R${exemplar + 1}`],
    includeGridData: true, fields: 'sheets(data(rowData(values(userEnteredFormat,dataValidation))))' });
  const template = styleResponse.data.sheets?.[0]?.data?.[0]?.rowData?.[0]?.values;
  if (!Array.isArray(template)) fail('새 행의 서식을 확인하지 못했습니다.');
  const newRow = [...row]; newRow[0] = number;
  requests.push({ appendCells: { sheetId: target.sheetId,
    rows: [{ values: newRow.map((value, index) => ({ userEnteredFormat: template[index]?.userEnteredFormat || {},
      ...(template[index]?.dataValidation ? { dataValidation: template[index].dataValidation } : {}), userEnteredValue: [0, 2, 6, 7, 8, 9].includes(index) && value !== '' && Number.isFinite(Number(value))
      ? { numberValue: Number(value) } : { stringValue: String(value ?? '') } })) }], fields: 'userEnteredValue,userEnteredFormat,dataValidation' } });
  await sheets.spreadsheets.batchUpdate({ spreadsheetId, resource: { requests } });
  return { success: true };
};
