-- ============================================================================
-- Session 16 — Cross-DB Sync Peer Registry
-- ----------------------------------------------------------------------------
-- Tracks every standalone underground server that heartbeats to this surface.
-- On underground servers, this table is created but never written to.
--
-- Safe to re-run: every DDL is guarded by IF NOT EXISTS.
-- ============================================================================

IF OBJECT_ID('dbo.sync_peers', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.sync_peers (
        server_id           NVARCHAR(50)   NOT NULL PRIMARY KEY,
        display_name        NVARCHAR(100)  NULL,
        warehouse_code      NVARCHAR(40)   NOT NULL,
        device_hostname     NVARCHAR(100)  NULL,
        version             NVARCHAR(20)   NULL,

        last_heartbeat_at   DATETIME2(7)   NOT NULL,
        last_synced_at      DATETIME2(7)   NULL,
        first_seen_at       DATETIME2(7)   NOT NULL CONSTRAINT DF_sync_peers_first_seen DEFAULT (SYSUTCDATETIME()),

        pending_count       INT            NOT NULL CONSTRAINT DF_sync_peers_pending DEFAULT (0),
        has_open_shift      BIT            NOT NULL CONSTRAINT DF_sync_peers_open_shift DEFAULT (0),
        active_shift_id     INT            NULL,
        active_warehouse_id INT            NULL,

        last_ip_address     NVARCHAR(45)   NULL,
        last_user_agent     NVARCHAR(200)  NULL,

        notes               NVARCHAR(500)  NULL
    );

    PRINT '✅ Created dbo.sync_peers';
END
ELSE
BEGIN
    PRINT 'ℹ️  dbo.sync_peers already exists — skipping create.';
END;
GO

-- Fast "who is online" query
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
     WHERE object_id = OBJECT_ID('dbo.sync_peers')
       AND name = 'IX_sync_peers_heartbeat'
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_sync_peers_heartbeat
        ON dbo.sync_peers (last_heartbeat_at DESC);
    PRINT '✅ Created IX_sync_peers_heartbeat';
END;
GO

-- Fast per-warehouse listing (UG handler sees only UG peers)
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
     WHERE object_id = OBJECT_ID('dbo.sync_peers')
       AND name = 'IX_sync_peers_wh_heartbeat'
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_sync_peers_wh_heartbeat
        ON dbo.sync_peers (warehouse_code, last_heartbeat_at DESC);
    PRINT '✅ Created IX_sync_peers_wh_heartbeat';
END;
GO

PRINT '── Sync peers migration complete ──';
GO