// src/components/locator/LocatorGrid.jsx
import React from 'react';

const formatMoney = (n, cur = 'PHP') => {
  const v = Number(n) || 0;
  return `${cur} ${v.toLocaleString(undefined, {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  })}`;
};

const buildPageList = (current, total) => {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const pages = [];
  pages.push(1);
  if (current > 3) pages.push('…');

  const start = Math.max(2, current - 1);
  const end   = Math.min(total - 1, current + 1);
  for (let i = start; i <= end; i++) pages.push(i);

  if (current < total - 2) pages.push('…');
  pages.push(total);
  return pages;
};

const LocatorGrid = ({
  locators,
  loading,
  onOpen,
  page,
  totalPages,
  total,
  limit,
  onPageChange,
}) => {
  if (loading) {
    return <div className="loading-spinner" style={{ margin: '20px auto' }} />;
  }

  if (!locators.length) {
    return (
      <div className="no-items-message">
        <p>No locators match the current filter in this warehouse.</p>
      </div>
    );
  }

  const start = total === 0 ? 0 : (page - 1) * limit + 1;
  const end   = Math.min(page * limit, total);
  const pageList = buildPageList(page, totalPages);

  return (
    <>
      <div className="locator-grid">
        {locators.map((l) => {
          const totalQty   = Number(l.total_qty)    || 0;
          const totalValue = Number(l.total_value)  || 0;
          const isActive   = (l.status || 'Active') === 'Active';

          // -------- item_codes handling --------
          const rawCodes  = String(l.item_codes ?? '').trim();
          const hasItems  = rawCodes.length > 0 && rawCodes !== '—';

          const derivedCount = rawCodes
            ? rawCodes.split(',').map((s) => s.trim()).filter(Boolean).length
            : 0;
          const itemCount = Number(l.item_count) || derivedCount;

          return (
            <div
              key={`${l.warehouse_code}::${l.locator_code}`}
              className="locator-card"
              role="button"
              tabIndex={0}
              onClick={() => onOpen(l)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onOpen(l);
                }
              }}
            >
              <div className="locator-card-glow" aria-hidden="true" />

              <div className="locator-card-head">
                <div className="locator-card-code">{l.locator_code}</div>
                <span className={`locator-status ${isActive ? 'active' : 'inactive'}`}>
                  {l.status || 'Active'}
                </span>
              </div>

              <div className="locator-card-name" title={l.locator_name || l.description}>
                {l.locator_name || l.description || '—'}
              </div>

              <div className="locator-card-stats">
                <div className="locator-stat">
                  <div className="locator-stat-label">Total Qty</div>
                  <div className="locator-stat-value">{totalQty}</div>
                </div>
                <div className="locator-stat">
                  <div className="locator-stat-label">Total Value</div>
                  <div className="locator-stat-value small" title={formatMoney(totalValue)}>
                    {formatMoney(totalValue)}
                  </div>
                </div>
              </div>

              {/* -------- Item codes block (hidden when empty) -------- */}
              {hasItems && (
                <div className="locator-card-items" title={rawCodes}>
                  <span className="locator-card-items-label">Items:</span>
                  <span className="locator-card-items-codes">{rawCodes}</span>
                </div>
              )}

              <div className="locator-card-hint">
                {itemCount} item{itemCount === 1 ? '' : 's'} · Click for details →
              </div>
            </div>
          );
        })}
      </div>

      {totalPages > 1 && (
        <div className="locator-pagination">
          <div className="locator-pagination-info">
            Showing <strong>{start}</strong>–<strong>{end}</strong> of{' '}
            <strong>{total.toLocaleString()}</strong> locator(s)
          </div>

          <div className="locator-pagination-controls">
            <button
              type="button"
              className="locator-page-btn"
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1}
              title="Previous page"
            >
              ‹ Prev
            </button>

            {pageList.map((p, i) =>
              p === '…' ? (
                <span key={`e${i}`} className="locator-page-ellipsis">…</span>
              ) : (
                <button
                  type="button"
                  key={p}
                  className={`locator-page-btn ${p === page ? 'active' : ''}`}
                  onClick={() => onPageChange(p)}
                >
                  {p}
                </button>
              )
            )}

            <button
              type="button"
              className="locator-page-btn"
              onClick={() => onPageChange(page + 1)}
              disabled={page >= totalPages}
              title="Next page"
            >
              Next ›
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default LocatorGrid;