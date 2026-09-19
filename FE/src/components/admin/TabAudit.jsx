// src/components/admin/TabAudit.jsx
import React, { useEffect, useState } from 'react';
import { getUser } from '../../secure/auth';

const TabAudit = () => {
  const [auditLogs, setAuditLogs] = useState([]);
  const currentUser = getUser();

  useEffect(() => {
    const mockLogs = [
      { id: 1, user: currentUser?.username || 'System', action: 'Logged in', timestamp: new Date().toISOString() },
      { id: 2, user: currentUser?.username || 'System', action: 'Viewed dashboard', timestamp: new Date().toISOString() },
    ];
    setAuditLogs(mockLogs);
  }, []);

  return (
    <div className="audit-section">
      <div className="section-header">
        <h3>Audit Logs</h3>
        <span className="log-count">Total: {auditLogs.length} entries</span>
      </div>
      <div className="table-wrapper">
        <table className="data-table">
          <thead>
            <tr><th>ID</th><th>User</th><th>Action</th><th>Timestamp</th></tr>
          </thead>
          <tbody>
            {auditLogs.length > 0 ? auditLogs.map(log => (
              <tr key={log.id}>
                <td>{log.id}</td>
                <td><strong>{log.user}</strong></td>
                <td>{log.action}</td>
                <td>{log.timestamp}</td>
              </tr>
            )) : <tr><td colSpan="4" style={{ textAlign: 'center' }}>No audit logs found</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default TabAudit;