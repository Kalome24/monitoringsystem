// src/components/underground/UndergroundActivityHistory.jsx
import React, { useState } from 'react';
import {
  FiClock,
  FiFileText,
  FiAlertOctagon,
  FiTruck,
} from 'react-icons/fi';
import { undergroundCss } from './undergroundStyles';
import UndergroundHistory from './UndergroundHistory';
import IssueFormHistory from './IssueFormHistory';
import OfflineDamageHistory from './OfflineDamageHistory';
import OfflineTransferHistory from './OfflineTransferHistory';

const UndergroundActivityHistory = () => {
  const [activeTab, setActiveTab] = useState('shift');

  return (
    <div className="ug-section">
      <style>{undergroundCss}</style>
      <style>{subTabsCss}</style>

      {/* Sub-Tabs Top Bar */}
      <div className="ug-subtabs" role="tablist" aria-label="Activity History Views">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'shift'}
          className={`ug-subtab ${activeTab === 'shift' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('shift')}
        >
          <FiClock className="ug-subtab-icon" />
          <span>Shift History</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'forms'}
          className={`ug-subtab ${activeTab === 'forms' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('forms')}
        >
          <FiFileText className="ug-subtab-icon" />
          <span>Issue Forms</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'damage'}
          className={`ug-subtab ${activeTab === 'damage' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('damage')}
        >
          <FiAlertOctagon className="ug-subtab-icon" />
          <span>Damage</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'transfer'}
          className={`ug-subtab ${activeTab === 'transfer' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('transfer')}
        >
          <FiTruck className="ug-subtab-icon" />
          <span>Transfers</span>
        </button>
      </div>

      {/* Render Selected History */}
      <div className="ug-history-container">
        {activeTab === 'shift' && <UndergroundHistory />}
        {activeTab === 'forms' && <IssueFormHistory />}
        {activeTab === 'damage' && <OfflineDamageHistory />}
        {activeTab === 'transfer' && <OfflineTransferHistory />}
      </div>
    </div>
  );
};

const subTabsCss = `
.ug-history-container {
  margin-top: 16px;
  width: 100%;
  min-width: 0;
}

/* Override max-width for the main sub-tabs in this context to fill the screen better */
.ug-subtabs {
  max-width: 800px;
  margin-bottom: 8px;
}

@media (max-width: 480px) {
  .ug-subtab span {
    font-size: 11px;
  }
  .ug-subtab {
    padding: 6px 4px;
    gap: 4px;
  }
  .ug-subtab-icon {
    width: 12px;
    height: 12px;
  }
}
`;

export default UndergroundActivityHistory;