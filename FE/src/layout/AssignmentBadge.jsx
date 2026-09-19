// src/layout/AssignmentBadge.jsx
import React from 'react';
import { useAssignment } from '../permissions/useAssignment';

const AssignmentBadge = () => {
  const {
    isWarehouseBound,
    warehouseLabel,
  } = useAssignment();

  if (!isWarehouseBound) return null;

  return (
    <div className="assignment-badge" title="Your assigned location">
      <span className="assignment-item">
        <span className="assignment-icon">🏭</span>
        <span className="assignment-text">
          <span className="assignment-label">Warehouse</span>
          <span className="assignment-value">{warehouseLabel}</span>
        </span>
      </span>
    </div>
  );
};

export default AssignmentBadge;