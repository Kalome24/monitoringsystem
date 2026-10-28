-- ============================================================================
-- Session 16b — Peer command channel
-- ----------------------------------------------------------------------------
-- Adds two things to support surface-initiated pull over WAN:
--
--   1. sync_peers.last_port — the port the peer listens on. Needed to build
--      the peer's address when pulling on LAN.
--
--   2. peer_commands — a command queue. Surface enqueues commands for a peer,
--      the peer picks them up on its next heartbeat and reports results.
--
-- Safe to re-run: every DDL is guarded by IF NOT EXISTS.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Add last_port column to sync_peers (idempotent)
-- ---------------------------------------------------------------------------
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
     WHERE object_id = OBJECT_ID('dbo.sync_peers')
       AND name = 'last_port'
)
BEGIN
    ALTER TABLE dbo.sync_peers
        ADD last_port INT NULL;
    PRINT '✅ Added dbo.sync_peers.last_port';
END
ELSE
BEGIN
    PRINT 'ℹ️  dbo.sync_peers.last_port already exists.';
END;
GO

-- ---------------------------------------------------------------------------
-- 2. peer_commands table
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.peer_commands', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.peer_commands (
        command_id      BIGINT         IDENTITY(1,1) PRIMARY KEY,
        server_id       NVARCHAR(50)   NOT NULL,
        kind            NVARCHAR(40)   NOT NULL,   -- 'pull_shift' | 'mark_reconciled' | 'noop'
        payload_json    NVARCHAR(MAX)  NULL,       -- free-form JSON the peer decodes
        status          NVARCHAR(20)   NOT NULL CONSTRAINT DF_peer_commands_status DEFAULT ('pending'),
                                                    -- 'pending' | 'in_flight' | 'done' | 'failed' | 'expired'
        created_at      DATETIME2(7)   NOT NULL CONSTRAINT DF_peer_commands_created DEFAULT (SYSUTCDATETIME()),
        dispatched_at   DATETIME2(7)   NULL,       -- when the surface first sent it in a heartbeat response
        fulfilled_at    DATETIME2(7)   NULL,
        attempts        INT            NOT NULL CONSTRAINT DF_peer_commands_attempts DEFAULT (0),
        result_code     NVARCHAR(40)   NULL,
        result_message  NVARCHAR(500)  NULL,
        result_json     NVARCHAR(MAX)  NULL
    );

    CREATE NONCLUSTERED INDEX IX_peer_commands_peer_status
        ON dbo.peer_commands (server_id, status, created_at);

    PRINT '✅ Created dbo.peer_commands';
END
ELSE
BEGIN
    PRINT 'ℹ️  dbo.peer_commands already exists.';
END;
GO

PRINT '── Session 16b migration complete ──';
GO