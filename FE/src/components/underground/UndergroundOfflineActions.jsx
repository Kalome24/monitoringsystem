// src/components/underground/UndergroundOfflineActions.jsx
import React, { useState } from 'react';
import {
  FiAlertTriangle,
  FiTruck,
  FiArrowRight,
} from 'react-icons/fi';
import { undergroundCss } from './undergroundStyles';
import OfflineDamageModal from './OfflineDamageModal';
import OfflineTransferModal from './OfflineTransferModal';

const UndergroundOfflineActions = ({ shift, onRefresh }) => {
  const [damageOpen, setDamageOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);

  const isOpen = shift?.status === 'Open';

  return (
    <div className="ug-section">
      <style>{undergroundCss}</style>
      <style>{actionCss}</style>

      <header className="ug-header">
        <div className="ug-header-left">
          <div className="ug-header-icon" style={{ background: 'linear-gradient(135deg, #64748b 0%, #334155 100%)' }}>
            <FiArrowRight />
          </div>
          <div className="ug-header-info">
            <h2 className="ug-header-title">Operations</h2>
            <div className="ug-header-sub">
              Record manual damage or transfer stock between bodegas.
            </div>
          </div>
        </div>
      </header>

      {!isOpen && (
        <div className="ugmodal-warn">
          <FiAlertTriangle />
          <div>
            You must have an <strong>Open Shift</strong> to log damages or transfer stocks. 
            Please import a surface export to start a shift.
          </div>
        </div>
      )}

      <div className="uga-grid">
        {/* DAMAGE CARD */}
        <div className="uga-card uga-card--damage">
          <div className="uga-icon-wrap uga-icon-wrap--damage">
            <FiAlertTriangle />
          </div>
          <div className="uga-content">
            <h3 className="uga-title">Log Damaged Item</h3>
            <p className="uga-desc">
              Deduct broken, expired, or unusable items from a specific locator and record the reason.
            </p>
            <button
              type="button"
              className="ug-btn ug-btn--danger uga-btn"
              onClick={() => setDamageOpen(true)}
              disabled={!isOpen}
            >
              Open Damage Form
            </button>
          </div>
        </div>

        {/* TRANSFER CARD */}
        <div className="uga-card uga-card--transfer">
          <div className="uga-icon-wrap uga-icon-wrap--transfer">
            <FiTruck />
          </div>
          <div className="uga-content">
            <h3 className="uga-title">Transfer Stocks</h3>
            <p className="uga-desc">
              Move items from one locator (bodega) to another within the underground warehouse.
            </p>
            <button
              type="button"
              className="ug-btn ug-btn--primary uga-btn"
              onClick={() => setTransferOpen(true)}
              disabled={!isOpen}
            >
              Open Transfer Form
            </button>
          </div>
        </div>
      </div>

      {/* MODALS */}
      {damageOpen && (
        <OfflineDamageModal
          onClose={() => setDamageOpen(false)}
          onSuccess={() => {
            setDamageOpen(false);
            onRefresh?.();
          }}
        />
      )}

      {transferOpen && (
        <OfflineTransferModal
          onClose={() => setTransferOpen(false)}
          onSuccess={() => {
            setTransferOpen(false);
            onRefresh?.();
          }}
        />
      )}
    </div>
  );
};

const actionCss = `
.uga-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 20px;
  margin-top: 10px;
}

.uga-card {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 16px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 16px;
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.04);
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.uga-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.08);
}

.uga-card--damage {
  border-top: 4px solid #dc2626;
}
.uga-card--transfer {
  border-top: 4px solid #0ea5e9;
}

.uga-icon-wrap {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  flex-shrink: 0;
}
.uga-icon-wrap svg { width: 24px; height: 24px; stroke-width: 2.2; }

.uga-icon-wrap--damage {
  background: linear-gradient(135deg, #f97316 0%, #dc2626 100%);
  box-shadow: 0 4px 12px rgba(220, 38, 38, 0.24);
}
.uga-icon-wrap--transfer {
  background: linear-gradient(135deg, #0ea5e9 0%, #0369a1 100%);
  box-shadow: 0 4px 12px rgba(14, 165, 233, 0.24);
}

.uga-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
}

.uga-title {
  margin: 0;
  font-size: 18px;
  font-weight: 800;
  color: #0f172a;
}

.uga-desc {
  margin: 0;
  font-size: 13.5px;
  color: #64748b;
  line-height: 1.5;
  flex: 1;
}

.uga-btn {
  width: 100%;
  margin-top: 8px;
}

/* Responsive */
@media (max-width: 768px) {
  .uga-grid {
    grid-template-columns: 1fr;
  }
}
`;

export default UndergroundOfflineActions;