// src/components/locator/LocatorDetailModal.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { FiMapPin, FiX, FiEdit2, FiBox, FiTag } from 'react-icons/fi';
import { 
  locatorsApi, 
  itemMasterApi, 
  uomConversionApi 
} from '../../services/api';
import ItemImageThumb from '../shared/ItemImageThumb';

// ✅ 4-DECIMAL strict precision (was 2, showed 4.9995 as ₱5.00)
const formatMoney = (n, cur = 'PHP') => {
  const v = Number(n) || 0;
  return `${cur} ${v.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  })}`;
};

const LocatorDetailModal = ({ locator, warehouseCode, onClose, canEdit, onEdit }) => {
  const [items, setItems]     = useState([]);
  const [images, setImages]   = useState({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');
  
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
    if (!locator || !warehouseCode) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await locatorsApi.getItems(warehouseCode, locator.locator_code);
        if (cancelled) return;
        const rows = res.ok && Array.isArray(res.data) ? res.data : [];
        setItems(rows);

        const codes = [...new Set(rows.map((r) => r.item_code).filter(Boolean))];
        if (codes.length > 0) {
          try {
            const imgRes = await itemMasterApi.getImagesByCodes(codes);
            if (cancelled) return;
            if (imgRes.ok && imgRes.data?.images) setImages(imgRes.data.images);
          } catch (e) {
            console.warn('Could not load locator item images:', e);
          }
        }
      } catch (e) {
        console.warn('Could not load locator items:', e);
        if (!cancelled) { setItems([]); setImages({}); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [locator, warehouseCode]);

  const totals = useMemo(() => {
    let qty = 0, value = 0;
    for (const it of items) {
      const q = Number(it.qty) || 0;
      const c = Number(it.avg_unit_cost) || 0;
      qty   += q;
      value += q * c;
    }
    return { qty, value, count: items.length };
  }, [items]);

  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter((it) =>
      (it.item_code      || '').toLowerCase().includes(q) ||
      (it.item_name      || '').toLowerCase().includes(q) ||
      (it.barcode        || '').toLowerCase().includes(q) ||
      (it.category       || '').toLowerCase().includes(q) ||
      (it.purchase_class || '').toLowerCase().includes(q)
    );
  }, [items, search]);

  if (!locator) return null;

  return (
    <div style={mStyles.overlay} className="ldm-overlay" onClick={onClose}>
      <style>{detailResponsiveCss}</style>
      <div style={mStyles.card} className="ldm-card" onClick={(e) => e.stopPropagation()}>
        <div style={mStyles.header} className="ldm-header">
          <div style={mStyles.headerLeft}>
            <div style={mStyles.headerIcon} className="ldm-header-icon"><FiMapPin size={22} /></div>
            <div style={{ minWidth: 0 }}>
              <h3 style={mStyles.title} className="ldm-title">{locator.locator_code}</h3>
              <div style={mStyles.sub} className="ldm-sub">
                {locator.locator_name || locator.description || '—'}
                {locator.purchase_class && (
                  <>
                    <span style={mStyles.dot}>·</span>
                    <span style={mStyles.chip}>{locator.purchase_class}</span>
                  </>
                )}
                {locator.category && (
                  <>
                    <span style={mStyles.dot}>·</span>
                    <span style={mStyles.chipCat}>{locator.category}</span>
                  </>
                )}
                <span style={mStyles.dot}>·</span>
                <span
                  className={`locator-status ${(locator.status || 'Active') === 'Active' ? 'active' : 'inactive'}`}
                  style={{ padding: '2px 10px', fontSize: 11 }}
                >
                  {locator.status || 'Active'}
                </span>
              </div>
            </div>
          </div>
          <button style={mStyles.close} className="ldm-close" onClick={onClose} type="button" aria-label="Close">
            <FiX size={18} />
          </button>
        </div>

        <div style={mStyles.body} className="ldm-body">
          <div style={mStyles.statStrip} className="ldm-stat-strip">
            <div style={mStyles.statBox} className="ldm-stat-box">
              <div style={mStyles.statLabel} className="ldm-stat-label">Items</div>
              <div style={mStyles.statValue} className="ldm-stat-value">{totals.count}</div>
            </div>
            <div style={mStyles.statBox} className="ldm-stat-box">
              <div style={mStyles.statLabel} className="ldm-stat-label">Total Qty</div>
              <div style={mStyles.statValue} className="ldm-stat-value">{totals.qty}</div>
            </div>
            <div style={mStyles.statBox} className="ldm-stat-box">
              <div style={mStyles.statLabel} className="ldm-stat-label">Total Value</div>
              <div style={{ ...mStyles.statValue, fontSize: 18 }} className="ldm-stat-value ldm-stat-value--lg">{formatMoney(totals.value)}</div>
            </div>
          </div>

          <div style={mStyles.searchRow} className="ldm-search-row">
            <input
              type="text"
              placeholder="Search item code, description, barcode, category…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={mStyles.searchInput}
              className="ldm-search-input"
            />
            {search && (
              <button style={mStyles.clearBtn} className="ldm-clear-btn" onClick={() => setSearch('')} type="button">
                Clear
              </button>
            )}
          </div>

          <div style={mStyles.tableWrap} className="ldm-table-wrap">
            {loading ? (
              <div className="loading-spinner" style={{ margin: '24px auto' }} />
            ) : filtered.length === 0 ? (
              <div style={mStyles.empty}>
                {items.length === 0
                  ? 'No items currently stored in this locator.'
                  : 'No items match your search.'}
              </div>
            ) : (
              <table style={mStyles.table} className="ldm-table">
                <thead>
                  <tr>
                    <th style={mStyles.th} className="ldm-th">Item Details</th>
                    <th style={{ ...mStyles.th, textAlign: 'center' }} className="ldm-th">UOM / Category</th>
                    <th style={{ ...mStyles.th, textAlign: 'center' }} className="ldm-th">Quantity</th>
                    <th style={{ ...mStyles.th, textAlign: 'right' }} className="ldm-th">Price</th>
                    <th style={{ ...mStyles.th, textAlign: 'right' }} className="ldm-th">Line Total</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((it, idx) => {
                    const qty   = Number(it.qty) || 0;
                    const rule = uomMap[it.item_code];
                    
                    const isBoxItem = rule && rule.box_code === it.item_code;
                    const isPieceItem = rule && rule.piece_code === it.item_code;

                    let boxes = 0;
                    let loose = 0;
                    let totalPieces = qty;

                    if (rule) {
                      if (isBoxItem) {
                        boxes = qty;
                        loose = 0;
                        totalPieces = qty * rule.pieces_per_box;
                      } else if (isPieceItem) {
                        boxes = Math.floor(qty / rule.pieces_per_box);
                        loose = qty % rule.pieces_per_box;
                        totalPieces = qty;
                      }
                    }

                    let piecePrice = 0;
                    let boxPrice = 0;

                    if (isBoxItem) {
                      boxPrice = Number(it.avg_unit_cost) || 0;
                      piecePrice = boxPrice / rule.pieces_per_box;
                    } else {
                      piecePrice = Number(it.avg_unit_cost) || 0;
                      boxPrice = rule ? (rule.box_price || (piecePrice * rule.pieces_per_box)) : piecePrice;
                    }

                    return (
                      <tr key={it.item_code ?? idx} style={mStyles.tr}>
                        
                        <td style={mStyles.tdItem} className="ldm-td ldm-td-item">
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, minWidth: 0 }}>
                            <ItemImageThumb src={images[it.item_code] || null} alt={it.item_code} size={44} />
                            <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', width: '100%' }}>
                              
                              {isBoxItem ? (
                                <>
                                  <div style={mStyles.primaryCode}>{it.item_code} <span style={mStyles.tagBox}>BOX</span></div>
                                  <div style={mStyles.primaryName}>{it.item_name || '—'}</div>
                                  {rule && (
                                    <div style={mStyles.secondaryWrap}>
                                      <div style={mStyles.secondaryCode}>{rule.piece_code} <span style={mStyles.tagPiece}>PIECE</span></div>
                                      <div style={mStyles.secondaryName}>{rule.piece_name}</div>
                                    </div>
                                  )}
                                </>
                              ) : (
                                <>
                                  <div style={mStyles.primaryCode}>{it.item_code} <span style={mStyles.tagPiece}>PIECE</span></div>
                                  <div style={mStyles.primaryName}>{it.item_name || '—'}</div>
                                  {rule && (
                                    <div style={mStyles.secondaryWrap}>
                                      <div style={mStyles.secondaryCode}>{rule.box_code} <span style={mStyles.tagBox}>BOX</span></div>
                                      <div style={mStyles.secondaryName}>{rule.box_name}</div>
                                    </div>
                                  )}
                                </>
                              )}

                            </div>
                          </div>
                        </td>

                        <td style={{ ...mStyles.td, textAlign: 'center' }} className="ldm-td">
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                            {it.uom ? <span style={mStyles.uomTag}>{it.uom}</span> : '—'}
                            {it.category && <span style={mStyles.catTag}>{it.category}</span>}
                            {it.barcode && <span style={mStyles.barcodeTag} title="Barcode">{it.barcode}</span>}
                          </div>
                        </td>

                        <td style={{ ...mStyles.td, textAlign: 'center', verticalAlign: 'top', paddingTop: 16 }} className="ldm-td">
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', gap: 4 }}>
                            
                            {isBoxItem ? (
                              <>
                                <span style={mStyles.primaryQty}>{boxes.toLocaleString()} <span style={mStyles.qtyUnit}>Boxes</span></span>
                                <div style={mStyles.divider} />
                                <span style={mStyles.secondaryQty}>{totalPieces.toLocaleString()} Pcs</span>
                              </>
                            ) : (
                              <>
                                <span style={mStyles.primaryQty}>{totalPieces.toLocaleString()} <span style={mStyles.qtyUnit}>Pcs</span></span>
                                {rule && (
                                  <>
                                    <div style={mStyles.divider} />
                                    <span style={mStyles.secondaryQty}>{boxes} Boxes {loose > 0 ? `+ ${loose} Pcs` : ''}</span>
                                  </>
                                )}
                              </>
                            )}

                          </div>
                        </td>

                        <td style={{ ...mStyles.td, textAlign: 'right', verticalAlign: 'top', paddingTop: 16 }} className="ldm-td">
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', height: '100%', gap: 4 }}>
                            
                            {isBoxItem ? (
                              <>
                                <span style={mStyles.primaryPrice}>{formatMoney(boxPrice)} <span style={mStyles.priceUnit}>/ Box</span></span>
                                <div style={mStyles.divider} />
                                <span style={mStyles.secondaryPrice}>{formatMoney(piecePrice)} / Pc</span>
                              </>
                            ) : (
                              <>
                                <span style={mStyles.primaryPrice}>{formatMoney(piecePrice)} <span style={mStyles.priceUnit}>/ Pc</span></span>
                                {rule && (
                                  <>
                                    <div style={mStyles.divider} />
                                    <span style={mStyles.secondaryPrice}>{formatMoney(boxPrice)} / Box</span>
                                  </>
                                )}
                              </>
                            )}

                          </div>
                        </td>

                        <td style={{ ...mStyles.td, textAlign: 'right', fontWeight: 700, color: '#008a82', verticalAlign: 'top', paddingTop: 18 }} className="ldm-td">
                          {formatMoney(qty * (Number(it.avg_unit_cost) || 0))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div style={mStyles.footer} className="ldm-footer">
          <button style={mStyles.btnGhost} className="ldm-btn-ghost" onClick={onClose} type="button">Close</button>
          {canEdit && (
            <button
              style={mStyles.btnPrimary}
              className="ldm-btn-primary"
              onClick={() => { onEdit(locator); onClose(); }}
              type="button"
            >
              <FiEdit2 size={16} style={{ marginRight: 8 }} />
              Edit Locator
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

/* ============================================================
   Responsive overrides — inline mStyles remains the base
   (desktop look is pixel-identical). Media queries use
   !important to beat inline specificity on smaller screens.
   ============================================================ */
const detailResponsiveCss = `
/* ---------- XL desktop / large monitor ---------- */
@media (min-width: 1921px) {
  .ldm-card { max-width: 1400px !important; }
  .ldm-title { font-size: 24px !important; }
  .ldm-sub { font-size: 14px !important; }
  .ldm-body { padding: 24px 28px !important; gap: 20px !important; }
  .ldm-stat-value { font-size: 26px !important; }
  .ldm-stat-value--lg { font-size: 22px !important; }
  .ldm-stat-label { font-size: 11px !important; }
  .ldm-table { min-width: 1000px !important; font-size: 14px !important; }
  .ldm-th { padding: 12px 16px !important; font-size: 11px !important; }
  .ldm-td, .ldm-td-item { padding: 12px 16px !important; }
  .ldm-td-item { min-width: 300px !important; }
  .ldm-search-input { font-size: 15px !important; padding: 12px 16px !important; }
  .ldm-btn-ghost, .ldm-btn-primary { font-size: 15px !important; padding: 12px 22px !important; }
}

/* ---------- MD tablet ---------- */
@media (max-width: 900px) {
  .ldm-card { max-width: 96vw !important; }
  .ldm-stat-strip { gap: 10px !important; }
  .ldm-table { min-width: 800px !important; }
}

/* ---------- SM large phone ---------- */
@media (max-width: 640px) {
  .ldm-overlay { padding: 8px !important; }
  .ldm-card { max-height: 96vh !important; border-radius: 12px !important; }
  .ldm-header { padding: 12px 14px !important; gap: 8px !important; }
  .ldm-header-icon { width: 38px !important; height: 38px !important; border-radius: 10px !important; }
  .ldm-header-icon svg { width: 18px !important; height: 18px !important; }
  .ldm-title { font-size: 17px !important; }
  .ldm-sub { font-size: 11.5px !important; gap: 4px !important; }
  .ldm-close { width: 32px !important; height: 32px !important; }
  .ldm-body { padding: 12px 14px !important; gap: 12px !important; }
  .ldm-stat-strip { gap: 8px !important; }
  .ldm-stat-box { padding: 8px 10px !important; }
  .ldm-stat-label { font-size: 9px !important; }
  .ldm-stat-value { font-size: 17px !important; }
  .ldm-stat-value--lg { font-size: 14px !important; }
  .ldm-search-input { font-size: 13px !important; padding: 8px 12px !important; }
  .ldm-clear-btn { padding: 8px 12px !important; font-size: 12px !important; }
  .ldm-table-wrap { max-height: 42vh !important; }
  .ldm-table { min-width: 720px !important; font-size: 12px !important; }
  .ldm-th { padding: 8px 10px !important; font-size: 9px !important; letter-spacing: 0.04em !important; }
  .ldm-td, .ldm-td-item { padding: 8px 10px !important; }
  .ldm-td-item { min-width: 200px !important; }
  .ldm-footer { padding: 10px 14px !important; gap: 8px !important; }
}

/* ---------- XS small phone ---------- */
@media (max-width: 480px) {
  .ldm-overlay { padding: 4px !important; }
  .ldm-card { max-height: 98vh !important; border-radius: 8px !important; }
  .ldm-header { padding: 10px 12px !important; gap: 6px !important; }
  .ldm-header-icon { width: 34px !important; height: 34px !important; border-radius: 9px !important; }
  .ldm-header-icon svg { width: 16px !important; height: 16px !important; }
  .ldm-title { font-size: 15px !important; }
  .ldm-sub { font-size: 10.5px !important; }
  .ldm-body { padding: 10px 12px !important; gap: 10px !important; }
  .ldm-stat-strip { gap: 6px !important; }
  .ldm-stat-box { padding: 6px 8px !important; }
  .ldm-stat-value { font-size: 14px !important; }
  .ldm-stat-value--lg { font-size: 12px !important; }
  .ldm-stat-label { font-size: 8.5px !important; letter-spacing: 0.06em !important; }
  .ldm-table-wrap { max-height: 35vh !important; }
  .ldm-table { min-width: 640px !important; }
  .ldm-th { padding: 6px 8px !important; font-size: 8.5px !important; }
  .ldm-td, .ldm-td-item { padding: 6px 8px !important; }
  .ldm-td-item { min-width: 160px !important; }
  .ldm-footer { padding: 8px 10px !important; gap: 6px !important; }
  .ldm-btn-ghost, .ldm-btn-primary { flex: 1 1 0 !important; min-height: 40px !important; padding: 10px 12px !important; }
}

/* ---------- Ultra-narrow (foldables, tiny phones) ---------- */
@media (max-width: 360px) {
  .ldm-body { padding: 8px 10px !important; gap: 8px !important; }
  .ldm-stat-strip { gap: 4px !important; }
  .ldm-stat-value { font-size: 13px !important; }
  .ldm-stat-value--lg { font-size: 11px !important; }
  .ldm-stat-label { font-size: 8px !important; }
  .ldm-table { min-width: 600px !important; }
  .ldm-footer { flex-direction: column-reverse !important; }
  .ldm-btn-ghost, .ldm-btn-primary { width: 100% !important; }
}

/* ---------- Short landscape (phones turned sideways) ---------- */
@media (max-height: 520px) and (orientation: landscape) {
  .ldm-card { max-height: 98vh !important; }
  .ldm-body { padding: 10px 14px !important; gap: 10px !important; }
  .ldm-stat-box { padding: 6px 10px !important; }
  .ldm-table-wrap { max-height: 32vh !important; }
}

/* ---------- Accessibility ---------- */
@media (prefers-reduced-motion: reduce) {
  .ldm-overlay, .ldm-card { animation: none !important; }
  .ldm-btn-ghost, .ldm-btn-primary, .ldm-close, .ldm-clear-btn, .ldm-search-input { transition: none !important; }
}
`;

/* ============================================================
   Base styles (unchanged) — inline object, primary source of
   truth on desktop. Responsive media queries above override
   via !important on smaller screens.
   ============================================================ */
const mStyles = {
  overlay: {
    position: 'fixed', inset: 0,
    background: 'rgba(15, 23, 42, 0.62)',
    backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 10000, padding: 16,
    animation: 'locFadeIn 0.18s ease',
  },
  card: {
    background: '#fff', borderRadius: 18, width: '100%', maxWidth: 1100,
    maxHeight: '92vh', display: 'flex', flexDirection: 'column',
    overflow: 'hidden',
    boxShadow: '0 24px 64px rgba(15,23,42,0.28), 0 4px 14px rgba(15,23,42,0.14)',
    fontFamily: 'inherit',
    animation: 'locSlideUp 0.22s cubic-bezier(0.34, 1.3, 0.64, 1)',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    gap: 12, padding: '18px 22px', borderBottom: '1px solid #e5e7eb',
    background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
    flexShrink: 0,
  },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 14, flex: 1, minWidth: 0 },
  headerIcon: {
    width: 46, height: 46, borderRadius: 12,
    background: 'linear-gradient(135deg, #00e0d4 0%, #008a82 100%)',
    color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
    boxShadow: '0 6px 16px rgba(0, 200, 190, 0.32)',
  },
  title: {
    margin: 0, fontSize: 22, fontWeight: 700, color: '#0f172a',
    fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace",
    letterSpacing: '-0.01em',
  },
  sub: {
    fontSize: 13, color: '#64748b', marginTop: 4,
    display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6,
  },
  dot: { color: '#cbd5e1' },
  chip: {
    display: 'inline-block', padding: '2px 10px', borderRadius: 999,
    fontSize: 11, fontWeight: 700, background: '#eef2ff', color: '#4338ca',
    border: '1px solid #c7d2fe',
  },
  chipCat: {
    display: 'inline-block', padding: '2px 10px', borderRadius: 999,
    fontSize: 11, fontWeight: 700, background: '#f0fdfa', color: '#0f766e',
    border: '1px solid #99f6e4',
  },
  close: {
    background: 'transparent', border: 'none', width: 36, height: 36,
    borderRadius: 8, cursor: 'pointer', color: '#64748b',
    flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  body: {
    flex: 1, overflowY: 'auto', padding: '20px 22px',
    display: 'flex', flexDirection: 'column', gap: 16,
  },
  statStrip: {
    display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12,
  },
  statBox: {
    padding: '12px 16px', background: '#f8fafc',
    border: '1px solid #e2e8f0', borderRadius: 10,
  },
  statLabel: {
    fontSize: 10, fontWeight: 700, color: '#64748b',
    textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4,
  },
  statValue: {
    fontSize: 22, fontWeight: 800, color: '#0f172a',
    fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace",
    letterSpacing: '-0.02em',
  },
  searchRow: { display: 'flex', gap: 8 },
  searchInput: {
    flex: 1, padding: '10px 14px', border: '1px solid #cbd5e1',
    borderRadius: 8, fontSize: 14, fontFamily: 'inherit', color: '#0f172a',
    outline: 'none',
  },
  clearBtn: {
    padding: '10px 16px', background: '#fff', border: '1px solid #cbd5e1',
    borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
    color: '#475569', fontFamily: 'inherit',
  },
  tableWrap: {
    flex: 1, overflow: 'auto', border: '1px solid #e2e8f0',
    borderRadius: 10, background: '#fff', maxHeight: '52vh',
  },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 850 },
  th: {
    padding: '10px 14px', textAlign: 'left',
    fontSize: 10, fontWeight: 700, color: '#64748b',
    textTransform: 'uppercase', letterSpacing: '0.06em',
    background: '#f8fafc', borderBottom: '1px solid #e2e8f0',
    position: 'sticky', top: 0, zIndex: 1, whiteSpace: 'nowrap',
  },
  tr: { borderBottom: '1px solid #f1f5f9' },
  td: { padding: '10px 14px', color: '#0f172a', verticalAlign: 'middle' },
  tdItem: { padding: '10px 14px', minWidth: 250, verticalAlign: 'top', paddingTop: 16 },
  
  primaryCode: {
    fontWeight: 700, fontSize: 13, color: '#0f172a',
    fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace",
    lineHeight: 1.2, display: 'flex', alignItems: 'center', gap: 6
  },
  primaryName: {
    fontSize: 11, color: '#475569', marginTop: 2, lineHeight: 1.3,
  },
  
  secondaryWrap: {
    marginTop: 6, paddingTop: 6, borderTop: '1px dashed #e2e8f0'
  },
  secondaryCode: {
    fontWeight: 600, fontSize: 12, color: '#64748b',
    fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace",
    lineHeight: 1.2, display: 'flex', alignItems: 'center', gap: 4
  },
  secondaryName: {
    fontSize: 10.5, color: '#94a3b8', marginTop: 2, lineHeight: 1.3,
  },

  tagPiece: {
    fontSize: 8, background: '#eef2ff', color: '#4338ca', border: '1px solid #c7d2fe',
    padding: '1px 4px', borderRadius: 3, letterSpacing: '0.05em', fontWeight: 700
  },
  tagBox: {
    fontSize: 8, background: '#e0f2fe', color: '#0369a1', border: '1px solid #7dd3fc',
    padding: '1px 4px', borderRadius: 3, letterSpacing: '0.05em', fontWeight: 700
  },

  primaryQty: { fontSize: 15, fontWeight: 800, color: '#0f172a', fontFamily: "'JetBrains Mono', monospace" },
  qtyUnit: { fontSize: 10, color: '#64748b', fontFamily: 'inherit' },
  secondaryQty: { fontSize: 11.5, color: '#64748b', fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" },

  primaryPrice: { fontSize: 14, fontWeight: 700, color: '#0f172a', fontFamily: "'JetBrains Mono', monospace" },
  priceUnit: { fontSize: 10, color: '#64748b', fontFamily: 'inherit', fontWeight: 500 },
  secondaryPrice: { fontSize: 11, color: '#64748b', fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" },

  divider: { width: '80%', height: 1, borderTop: '1px dashed #e2e8f0', margin: '2px 0' },

  uomTag: {
    display: 'inline-block', padding: '2px 8px',
    background: '#f1f5f9', color: '#334155', borderRadius: 6,
    fontSize: 10, fontWeight: 600,
    fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace",
  },
  barcodeTag: {
    display: 'inline-block', padding: '2px 8px',
    background: '#f5f3ff', color: '#7c3aed', border: '1px solid #ddd6fe',
    borderRadius: 999, fontSize: 9, fontWeight: 700,
    fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace",
    letterSpacing: '0.02em',
  },
  catTag: {
    display: 'inline-block', padding: '2px 8px',
    background: '#f0fdfa', color: '#0f766e', border: '1px solid #99f6e4',
    borderRadius: 999, fontSize: 10, fontWeight: 700,
  },
  emptyCell: { color: '#cbd5e1' },
  empty: {
    padding: 32, textAlign: 'center', color: '#94a3b8', fontSize: 13,
  },
  footer: {
    display: 'flex', justifyContent: 'flex-end', gap: 10,
    padding: '14px 22px', borderTop: '1px solid #e5e7eb',
    background: '#f8fafc', flexShrink: 0,
  },
  btnGhost: {
    padding: '10px 18px', background: '#fff', border: '1px solid #cbd5e1',
    borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer',
    color: '#334155', fontFamily: 'inherit',
  },
  btnPrimary: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    padding: '10px 22px',
    background: 'linear-gradient(135deg, #00e0d4 0%, #00b8b0 45%, #008a82 100%)',
    color: '#fff', border: 'none', borderRadius: 8,
    fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
    boxShadow: '0 4px 12px rgba(0, 200, 190, 0.32)',
  },
};

export default LocatorDetailModal;