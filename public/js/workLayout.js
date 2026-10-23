// Version 2 layouts remain compatible: pairing is an optional item flag.
export function groupWorkRows(items = []) {
  const rows=[];
  for(const item of items.filter(item=>item.type==='image')) {
    const previous=rows[rows.length-1];
    if(item.pairWithPrevious && previous?.length===1)previous.push(item);
    else rows.push([item]);
  }
  return rows;
}
export function workRowMetrics(row) {
  const widths=row.map(item=>Math.max(20,Math.min(80,Number(item.width)||45)));
  const width=row.length===2?Math.min(100,widths[0]+widths[1]+3):widths[0];
  return {width,offset:Math.max(0,Math.min(100-width,Number(row[0].offset)||0)),
    gap:Math.max(10,Math.min(120,Number(row[row.length-1].gap)||40)),widths};
}
