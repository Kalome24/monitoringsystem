// src/components/underground/UndergroundInventory.jsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FiSearch,
  FiRefreshCw,
  FiLoader,
  FiInbox,
  FiAlertTriangle,
  FiMapPin,
  FiChevronLeft,
  FiChevronRight,
  FiChevronsLeft,
  FiChevronsRight,
  FiBox,
} from 'react-icons/fi';
import { undergroundApi, uomConversionApi, itemMasterApi } from '../../services/api';
import { useToast } from '../shared/ToastProvider';
import useRefreshOnFocus, { UG_DATA_CHANGED } from '../../hooks/useRefreshOnFocus';

/* ============================================================
   Formatters — 4-DECIMAL STRICT for money
   ============================================================ */
const intFmt = new Intl.NumberFormat('en-PH');
const curFmt = new Intl.NumberFormat('en-PH', {
  style: 'currency', currency: 'PHP',
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});
const fmtInt = (n) => intFmt.format(Number(n) || 0);
const fmtCur = (n) => curFmt.format(Number(n) || 0);

const DEBOUNCE_MS = 300;
const PAGE_SIZE = 100;

const UndergroundInventory = ({
  currentShift,
  loading,
  onOpenSeedImport,
  onOpenIssue,
}) => {
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [fetching, setFetching] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [scopedBodegas, setScopedBodegas] = useState(null);
  const [uomMap, setUomMap] = useState({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const convRes = await uomConversionApi.getAll({ limit: 5000 });
        if (cancelled || !convRes.ok || !convRes.data?.data) return;

        const activeRules = convRes.data.data.filter(r => r.Status === 'Active');
        if (activeRules.length === 0) return;

        const masterRes = await itemMasterApi.getAllItemMasters({ limit: 5000 });
        if (cancelled) return;

        const masterData = masterRes.ok && masterRes.data?.data ? masterRes.data.data : [];
        const masterMap = new Map(masterData.map(i => [i.Item_Code, i]));

        const map = {};
        activeRules.forEach(rule => {
          const boxItem = masterMap.get(rule.box_item_code);
          const pieceItem = masterMap.get(rule.piece_item_code);
          const ruleData = {
            box_code: rule.box_item_code,
            piece_code: rule.piece_item_code,
            pieces_per_box: Number(rule.pieces_per_box),
            box_name: boxItem?.Item_Description || 'Box Item',
            piece_name: pieceItem?.Item_Description || 'Piece Item',
            box_price: Number(boxItem?.List_Price_Per_Unit) || 0,
          };
          map[rule.piece_item_code] = ruleData;
          map[rule.box_item_code] = ruleData;
        });

        setUomMap(map);
      } catch (err) {
        console.warn('Could not load UOM mapping:', err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debounced]);

  const load = useCallback(
    async ({ silent = false } = {}) => {
      if (!currentShift?.shift_id) {
        setRows([]); setTotal(0); setTotalPages(1); setScopedBodegas(null); return;
      }
      if (silent) setRefreshing(true); else setFetching(true);
      setError(null);
      try {
        const res = await undergroundApi.currentInventory({ search: debounced || undefined, page, limit: PAGE_SIZE });
        if (res.ok) {
          setRows(Array.isArray(res.data) ? res.data : []);
          setTotal(Number(res.total) || 0);
          setTotalPages(Math.max(Number(res.totalPages) || 1, 1));
          setScopedBodegas(Array.isArray(res.scoped_bodegas) ? res.scoped_bodegas : null);
        } else {
          setError(res?.data?.message || 'Failed to load inventory.');
          setRows([]); setTotal(0); setTotalPages(1);
        }
      } catch (err) {
        console.error('Inventory load error:', err);
        setError(err?.message || 'Failed to load inventory.');
        setRows([]); setTotal(0); setTotalPages(1);
      } finally {
        setFetching(false); setRefreshing(false);
      }
    }, [currentShift?.shift_id, debounced, page]
  );

  useEffect(() => { load(); }, [load]);

  useRefreshOnFocus(() => load({ silent: true }), { events: [UG_DATA_CHANGED] });

  const pageTotals = useMemo(() => {
    return rows.reduce((acc, r) => ({
      qty: acc.qty + Number(r.qty_on_hand || 0),
      value: acc.value + Number(r.total_value || 0),
    }), { qty: 0, value: 0 });
  }, [rows]);

  const groupedRows = useMemo(() => {
    const groups = {};
    rows.forEach((r) => {
      const loc = r.locator_code || 'Unknown';
      if (!groups[loc]) groups[loc] = [];
      groups[loc].push(r);
    });
    return groups;
  }, [rows]);

  const goToPage = (target) => {
    const next = Math.max(1, Math.min(totalPages, target));
    if (next !== page) setPage(next);
  };

  const renderQtyBreakdown = (qty, itemCode) => {
    const totalQty = Number(qty) || 0;
    const rule = uomMap[itemCode];

    if (!rule || totalQty <= 0) {
      return <span className="uginv-qty-total">{fmtInt(totalQty)}</span>;
    }

    const isBoxItem = rule.box_code === itemCode;
    const isPieceItem = rule.piece_code === itemCode;
    let boxes = 0, loose = 0, totalPieces = totalQty;

    if (isBoxItem) {
      boxes = totalQty; loose = 0; totalPieces = totalQty * rule.pieces_per_box;
    } else if (isPieceItem) {
      boxes = Math.floor(totalQty / rule.pieces_per_box);
      loose = totalQty % rule.pieces_per_box;
      totalPieces = totalQty;
    }

    return (
      <div className="uginv-qty-breakdown">
        {isBoxItem ? (
          <>
            <span className="uginv-qty-total">{fmtInt(boxes)} <span style={{fontSize:10,color:'#64748b'}}>Boxes</span></span>
            <span className="uginv-qty-detail">{fmtInt(totalPieces)} Pcs</span>
          </>
        ) : (
          <>
            <span className="uginv-qty-total">{fmtInt(totalPieces)} <span style={{fontSize:10,color:'#64748b'}}>Pcs</span></span>
            {boxes > 0 && (
              <span className="uginv-qty-detail">
                <FiBox /> {boxes} Box{boxes !== 1 ? 'es' : ''}{loose > 0 ? ` + ${loose} Pcs` : ''}
              </span>
            )}
          </>
        )}
      </div>
    );
  };

  if (!loading && !currentShift) {
    return (
      <div className="ug-section">
        <header className="ug-header">
          <div className="ug-header-left">
            <div className="ug-header-icon"><FiInbox /></div>
            <div className="ug-header-info">
              <h2 className="ug-header-title">Underground Inventory</h2>
              <div className="ug-header-sub">No open shift</div>
            </div>
          </div>
          <div className="ug-header-actions">
            <button type="button" className="ug-btn ug-btn--primary" onClick={onOpenSeedImport}>
              <FiInbox /> <span>Import Surface Export</span>
            </button>
          </div>
        </header>
        <div className="ug-card">
          <div className="ug-empty">
            <FiInbox />
            <div className="ug-empty-title">Inventory not available</div>
            <div className="ug-empty-sub">Start a shift by importing a surface export.</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ug-section">

      <header className="ug-header">
        <div className="ug-header-left">
          <div className="ug-header-icon"><FiInbox /></div>
          <div className="ug-header-info">
            <h2 className="ug-header-title">Underground Inventory</h2>
            <div className="ug-header-sub">
              Shift #{currentShift.shift_id} · {currentShift.warehouse_code} · {fmtInt(total)} line{total === 1 ? '' : 's'}
            </div>
          </div>
        </div>
        <div className="ug-header-actions">
          {currentShift?.status === 'Open' && (
            <button type="button" className="ug-btn ug-btn--primary ug-btn--sm" onClick={onOpenIssue}>
              <FiInbox /> <span>Issue</span>
            </button>
          )}
          <button type="button" className="ug-btn ug-btn--secondary ug-btn--sm" onClick={() => load({ silent: true })} disabled={refreshing || fetching}>
            <FiRefreshCw className={refreshing ? 'ug-spin' : ''} />
            <span>{refreshing ? 'Refreshing…' : 'Refresh'}</span>
          </button>
        </div>
      </header>

      {scopedBodegas && scopedBodegas.length > 0 && (
        <div className="uginv-scoped">
          <FiMapPin />
          <span>Showing <strong>{scopedBodegas.length}</strong> assigned bodega{scopedBodegas.length === 1 ? '' : 's'}:</span>
          <div className="uginv-scoped-chips">
            {scopedBodegas.map((code) => <span key={code} className="uginv-scoped-chip">{code}</span>)}
          </div>
        </div>
      )}

      <div className="uginv-toolbar">
        <div className="uginv-search">
          <FiSearch />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by item code, item name, or locator…" />
        </div>
        <span className="ug-modal-hint" style={{ marginLeft: 'auto' }}>
          This page: <strong>{fmtInt(pageTotals.qty)}</strong> qty · <strong>{fmtCur(pageTotals.value)}</strong>
        </span>
      </div>

      {error && (
        <div className="ug-error" role="alert">
          <FiAlertTriangle /> <span>{error}</span>
          <button type="button" onClick={() => load()}>Try again</button>
        </div>
      )}

      {fetching && <div className="ug-loading"><FiLoader className="ug-spin" /><span>Loading inventory…</span></div>}

      {!fetching && !error && rows.length === 0 && (
        <div className="ug-card">
          <div className="ug-empty">
            <FiInbox />
            <div className="ug-empty-title">{debounced ? 'No items match your search' : 'Inventory is empty'}</div>
            <div className="ug-empty-sub">{debounced ? 'Try a different search term.' : 'The seed export did not contain any item lines.'}</div>
          </div>
        </div>
      )}

      {!fetching && !error && rows.length > 0 && (
        <>
          <div className="uginv-table-wrap">
            <table className="uginv-table">
              <thead>
                <tr>
                  <th scope="col" style={{ width: '30%' }}>Item</th>
                  <th scope="col" className="uginv-num">Beginning</th>
                  <th scope="col" className="uginv-num">Issued</th>
                  <th scope="col" className="uginv-num">Damaged</th>
                  <th scope="col" className="uginv-num">Transferred</th>
                  <th scope="col" className="uginv-center" style={{ width: '15%', textAlign: 'center' }}>On Hand</th>
                  <th scope="col" className="uginv-num">Unit Cost</th>
                  <th scope="col" className="uginv-num">Total Value</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(groupedRows).map(([locator, items]) => (
                  <React.Fragment key={locator}>
                    <tr className="uginv-bodega-header">
                      <td colSpan={8}>
                        <FiMapPin /> BODEGA: {locator}
                      </td>
                    </tr>
                    {items.map((r) => {
                      const onHand = Number(r.qty_on_hand) || 0;
                      const rule = uomMap[r.item_code];
                      const isBoxItem = rule && rule.box_code === r.item_code;
                      let piecePrice = 0, boxPrice = 0;
                      if (isBoxItem) {
                        boxPrice = Number(r.unit_cost) || 0;
                        piecePrice = boxPrice / rule.pieces_per_box;
                      } else {
                        piecePrice = Number(r.unit_cost) || 0;
                        boxPrice = rule ? (rule.box_price || (piecePrice * rule.pieces_per_box)) : piecePrice;
                      }

                      const issued = Number(r.issued_qty) || 0;
                      const damaged = Number(r.damaged_qty) || 0;
                      const transOut = Number(r.transfer_out_qty) || 0;
                      const transIn = Number(r.transfer_in_qty) || 0;
                      const netTrans = transIn - transOut;

                      return (
                        <tr key={`${r.shift_id}-${r.locator_code}-${r.item_code}`}>
                          <td>
                            <div className="uginv-code">
                              {isBoxItem ? rule.piece_code : r.item_code}
                              <span className="uginv-tag--piece">PIECE</span>
                            </div>
                            {r.item_name && <div className="uginv-name" title={r.item_name}>{isBoxItem ? rule.piece_name : r.item_name}</div>}
                          </td>
                          <td className="uginv-num" style={{ color: '#64748b' }}>{fmtInt(r.beginning_qty)}</td>
                          
                          <td className={`uginv-num ${issued > 0 ? 'uginv-color-issued' : ''}`}>
                            {issued > 0 ? `-${fmtInt(issued)}` : '—'}
                          </td>
                          <td className={`uginv-num ${damaged > 0 ? 'uginv-color-damaged' : ''}`}>
                            {damaged > 0 ? `-${fmtInt(damaged)}` : '—'}
                          </td>
                          <td className={`uginv-num ${netTrans !== 0 ? 'uginv-color-transferred' : ''}`}>
                            {netTrans === 0 ? '—' : (netTrans > 0 ? `+${fmtInt(netTrans)}` : fmtInt(netTrans))}
                          </td>
                          
                          <td style={{ textAlign: 'center' }}>
                            <span className="uginv-onhand-pill">{renderQtyBreakdown(onHand, r.item_code)}</span>
                          </td>
                          
                          <td className="uginv-num">
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                              <span style={{ fontWeight: 700 }}>{fmtCur(piecePrice)} <span style={{fontSize:10,color:'#64748b'}}>/ Pc</span></span>
                              {rule && <span style={{ fontSize: 11, color: '#64748b' }}>{fmtCur(boxPrice)} / Box</span>}
                            </div>
                          </td>
                          
                          <td className="uginv-num uginv-num--cur">{fmtCur(r.total_value)}</td>
                        </tr>
                      );
                    })}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>

          <div className="uginv-cardlist">
            {Object.entries(groupedRows).map(([locator, items]) => (
              <div key={locator} style={{ marginBottom: 24 }}>
                <div className="uginv-bodega-group-header" style={{ marginBottom: 12 }}>
                  <FiMapPin /> BODEGA: {locator}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {items.map((r) => {
                    const onHand = Number(r.qty_on_hand) || 0;
                    const rule = uomMap[r.item_code];
                    const isBoxItem = rule && rule.box_code === r.item_code;
                    let piecePrice = 0, boxPrice = 0;
                    if (isBoxItem) {
                      boxPrice = Number(r.unit_cost) || 0;
                      piecePrice = boxPrice / rule.pieces_per_box;
                    } else {
                      piecePrice = Number(r.unit_cost) || 0;
                      boxPrice = rule ? (rule.box_price || (piecePrice * rule.pieces_per_box)) : piecePrice;
                    }

                    const issued = Number(r.issued_qty) || 0;
                    const damaged = Number(r.damaged_qty) || 0;
                    const transOut = Number(r.transfer_out_qty) || 0;
                    const transIn = Number(r.transfer_in_qty) || 0;
                    const netTrans = transIn - transOut;

                    return (
                      <article key={`m-${r.shift_id}-${r.locator_code}-${r.item_code}`} className="uginv-card">
                        <header className="uginv-card-head">
                          <div className="uginv-card-head-info">
                            <div className="uginv-code">
                              {isBoxItem ? rule.piece_code : r.item_code}
                              <span className="uginv-tag--piece">PIECE</span>
                            </div>
                            <div className="uginv-name">{isBoxItem ? rule.piece_name : (r.item_name || '—')}</div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>On Hand</div>
                            <div className="uginv-onhand-pill" style={{ marginTop: 4 }}>
                              {renderQtyBreakdown(onHand, r.item_code)}
                            </div>
                          </div>
                        </header>

                        <div className="uginv-card-moves">
                          <div className="uginv-move-item">
                            <span className="uginv-move-label">Beginning</span>
                            <span className="uginv-move-val" style={{ color: '#64748b' }}>{fmtInt(r.beginning_qty)}</span>
                          </div>
                          <div className="uginv-move-item">
                            <span className="uginv-move-label">Issued</span>
                            <span className={`uginv-move-val ${issued > 0 ? 'uginv-color-issued' : ''}`} style={{ color: issued > 0 ? '' : '#cbd5e1' }}>
                              {issued > 0 ? `-${fmtInt(issued)}` : '—'}
                            </span>
                          </div>
                          <div className="uginv-move-item">
                            <span className="uginv-move-label">Damaged</span>
                            <span className={`uginv-move-val ${damaged > 0 ? 'uginv-color-damaged' : ''}`} style={{ color: damaged > 0 ? '' : '#cbd5e1' }}>
                              {damaged > 0 ? `-${fmtInt(damaged)}` : '—'}
                            </span>
                          </div>
                          <div className="uginv-move-item">
                            <span className="uginv-move-label">Transferred</span>
                            <span className={`uginv-move-val ${netTrans !== 0 ? 'uginv-color-transferred' : ''}`} style={{ color: netTrans !== 0 ? '' : '#cbd5e1' }}>
                              {netTrans === 0 ? '—' : (netTrans > 0 ? `+${fmtInt(netTrans)}` : fmtInt(netTrans))}
                            </span>
                          </div>
                        </div>

                        <dl className="uginv-card-grid" style={{ marginTop: 12 }}>
                          <div>
                            <dt>Unit Cost</dt>
                            <dd>{fmtCur(piecePrice)} <span style={{fontSize:10,color:'#64748b'}}>/ Pc</span></dd>
                          </div>
                          <div>
                            <dt>Total Value</dt>
                            <dd className="uginv-num--cur">{fmtCur(r.total_value)}</dd>
                          </div>
                        </dl>
                      </article>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <nav className="ughist-pagination" aria-label="Pagination">
              <div className="ughist-pagination-info">
                Showing <strong>{(page - 1) * PAGE_SIZE + 1}</strong>–<strong>{Math.min(page * PAGE_SIZE, total)}</strong> of <strong>{fmtInt(total)}</strong> lines
              </div>
              <div className="ughist-pagination-controls">
                <button type="button" className="ughist-page-btn" onClick={() => goToPage(1)} disabled={page <= 1}><FiChevronsLeft /></button>
                <button type="button" className="ughist-page-btn" onClick={() => goToPage(page - 1)} disabled={page <= 1}><FiChevronLeft /></button>
                <span className="ughist-page-btn is-active">{page}</span>
                <button type="button" className="ughist-page-btn" onClick={() => goToPage(page + 1)} disabled={page >= totalPages}><FiChevronRight /></button>
                <button type="button" className="ughist-page-btn" onClick={() => goToPage(totalPages)} disabled={page >= totalPages}><FiChevronsRight /></button>
              </div>
            </nav>
          )}
        </>
      )}
    </div>
  );
};

export default UndergroundInventory;