// controllers/offlineConfigController.js
'use strict';

const OfflineConfigModel = require('../models/offlineConfigModel');
const surfaceSyncClient  = require('../services/surfaceSyncClient');

const NUMERIC_CATEGORIES = ['ACTIVITY_CC', 'LEVEL', 'LHD_NO'];
const isNumericCategory = (category) => NUMERIC_CATEGORIES.includes(category);

// ADDED: Helper to identify master data categories and their prefixed IDs
const isMasterDataCategory = (category, id = '') => {
    const cat = String(category || '').toUpperCase();
    const strId = String(id || '');
    return ['ACTIVITY_CC', 'LHD_NO'].includes(cat) || strId.startsWith('cc_') || strId.startsWith('eq_');
};

/* ============================================================
   PERMISSION HELPERS
   ============================================================ */
const isConfigManager = (user) => {
    if (!user) return false;
    const role = String(user.user_role || user.role || '').trim();
    const pos  = String(user.emp_position || '').trim();

    if (['Super Admin', 'Admin', 'Department Head', 'Inventory Controller Manager'].includes(role)) return true;
    if (['Department Head', 'Inventory Controller Manager'].includes(pos)) return true;
    if (pos === 'Surface Handler') return true;

    return false;
};

const canReceiveSync = (user) => {
    if (isConfigManager(user)) return true;
    if (!user) return false;
    const pos = String(user.emp_position || '').trim();
    return pos === 'Underground Handler';
};

const isAdminRole = (user) => {
    const role = String(user?.user_role || user?.role || '').trim();
    return ['Super Admin', 'Admin'].includes(role);
};

const toInt = (v) => {
    if (v === undefined || v === null || v === '') return null;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
};

/* ============================================================
   ERROR TRANSLATION
   ============================================================ */
const translateImportError = (err) => {
    const raw   = String(err?.originalMessage || err?.message || '').trim();
    const code  = err?.number || err?.originalError?.number || null;
    const step  = err?.step || null;

    const stepContext = step ? ` (during: ${step})` : '';

    if (code === 2627 || code === 2601 || /duplicate key|violation of UNIQUE/i.test(raw)) {
        return {
            title: 'Duplicate value in the file',
            message: raw,
            hint: `The file contains a Barcode, Item Code, or Locator Code that conflicts with an existing record on this device${stepContext}. Ask the surface admin to review the item master for duplicates, then re-export.`,
            step, code,
        };
    }
    if (code === 547 || /REFERENCE constraint|FOREIGN KEY/i.test(raw)) {
        return {
            title: 'Related record not found',
            message: raw,
            hint: `A referenced record does not exist on this device${stepContext}. Ask the surface admin to confirm the warehouse assignments.`,
            step, code,
        };
    }
    if (/CREATE TYPE|type .* does not exist|table type|operand type clash/i.test(raw)) {
        return {
            title: 'Database schema missing a required type',
            message: raw,
            hint: `This device's database is missing a user-defined table type used by the sync${stepContext}. A migration is required on the underground device.`,
            step, code,
        };
    }
    if (/Invalid column name|Invalid object name/i.test(raw)) {
        return {
            title: 'Database schema mismatch',
            message: raw,
            hint: `This device's database is out of date and missing a column or table that the sync expects${stepContext}. A database migration is required on the underground device.`,
            step, code,
        };
    }
    if (code === 8152 || /String or binary data would be truncated/i.test(raw)) {
        return {
            title: 'Value too long for a database column',
            message: raw,
            hint: `A description or name in the file is longer than the target column allows${stepContext}. Ask the surface admin to shorten the offending value and re-export.`,
            step, code,
        };
    }
    if (code === 515 || /Cannot insert the value NULL/i.test(raw)) {
        return {
            title: 'Missing required value',
            message: raw,
            hint: `A row in the file is missing a required field${stepContext}. Ask the surface admin to check the item master or locator list for blank required values.`,
            step, code,
        };
    }
    return {
        title: 'Import failed',
        message: raw || 'The server rejected the file.',
        hint: step
            ? `Failed while ${step}. Please review the file or contact your administrator with this error.`
            : null,
        step, code,
    };
};

/* ============================================================
   CONTROLLER
   ============================================================ */
const offlineConfigController = {
    /* ------------------------------------------------------------
       DROPDOWN CRUD
       ------------------------------------------------------------ */
    getAll: async (req, res) => {
        try {
            // DEPARTMENT and ADH_DH have been retired from the UI
            // (they are now manual text inputs on the issue form).
            // Default to ACTIVITY_CC — the first tab in the trimmed UI.
            const category = req.query.category || 'ACTIVITY_CC';
            const page     = parseInt(req.query.page, 10) || 1;
            const limit    = parseInt(req.query.limit, 10) || 20;
            const search   = req.query.search || '';

            let configResult;
            let signatures = [];

            if (category === 'LOCATORS') {
                configResult = await OfflineConfigModel.getPaginatedLocators({ page, limit, search });
            } else {
                configResult = await OfflineConfigModel.getPaginatedConfigItems({ category, page, limit, search });
                signatures = await OfflineConfigModel.getAuthorizedSignatures();
            }

            return res.status(200).json({ 
                success: true, 
                data: configResult.data, 
                signatures,
                total: configResult.total,
                page: configResult.page,
                limit: configResult.limit,
                totalPages: configResult.totalPages
            });
        } catch (err) {
            console.error('❌ offlineConfig.getAll:', err);
            return res.status(500).json({ success: false, message: 'Failed to fetch configurations.' });
        }
    },

    createItem: async (req, res) => {
        try {
            if (!isConfigManager(req.user)) return res.status(403).json({ success: false, message: 'Access denied.' });
            const { category, item_value, description, sort_order } = req.body;

            // ADDED: Block non-admins from modifying master data via this endpoint
            if (isMasterDataCategory(category)) {
                if (!isAdminRole(req.user)) {
                    return res.status(403).json({ success: false, message: 'Only Admins can modify Cost Center or LHD No. records. Please use the dedicated tabs.' });
                }
            }

            if (!category || !item_value) {
                return res.status(400).json({ success: false, message: 'Category and value required.' });
            }
            if (isNumericCategory(category) && isNaN(Number(item_value))) {
                return res.status(400).json({ success: false, message: 'This field only accepts numbers.' });
            }

            const result = await OfflineConfigModel.createConfigItem({
                category, item_value, description, sort_order: sort_order || 0, created_by: req.user.username
            });
            return res.status(201).json({ success: true, data: result });
        } catch (err) {
            console.error('❌ offlineConfig.createItem:', err);
            if (err.number === 2627 || err.number === 2601) {
                return res.status(409).json({ success: false, message: 'Item already exists.' });
            }
            return res.status(500).json({ success: false, message: err.message || 'Failed to create.' });
        }
    },

    updateItem: async (req, res) => {
        try {
            if (!isConfigManager(req.user)) return res.status(403).json({ success: false, message: 'Access denied.' });
            const { item_value, description, sort_order, is_active, category } = req.body;

            // ADDED: Block non-admins from modifying master data via this endpoint
            if (isMasterDataCategory(category, req.params.id)) {
                if (!isAdminRole(req.user)) {
                    return res.status(403).json({ success: false, message: 'Only Admins can modify Cost Center or LHD No. records. Please use the dedicated tabs.' });
                }
            }

            if (category && isNumericCategory(category) && isNaN(Number(item_value))) {
                return res.status(400).json({ success: false, message: 'This field only accepts numbers.' });
            }

            const result = await OfflineConfigModel.updateConfigItem(req.params.id, {
                item_value, description, sort_order, is_active, updated_by: req.user.username, category
            });
            if (!result) return res.status(404).json({ success: false, message: 'Not found.' });
            return res.status(200).json({ success: true, data: result });
        } catch (err) {
            console.error('❌ offlineConfig.updateItem:', err);
            return res.status(500).json({ success: false, message: 'Failed to update.' });
        }
    },

    deleteItem: async (req, res) => {
        try {
            if (!isConfigManager(req.user)) return res.status(403).json({ success: false, message: 'Access denied.' });

            // ADDED: Block non-admins from modifying master data via this endpoint
            if (isMasterDataCategory(null, req.params.id)) {
                if (!isAdminRole(req.user)) {
                    return res.status(403).json({ success: false, message: 'Only Admins can delete Cost Center or LHD No. records. Please use the dedicated tabs.' });
                }
            }

            await OfflineConfigModel.deleteConfigItem(req.params.id);
            return res.status(200).json({ success: true, message: 'Deleted.' });
        } catch (err) {
            console.error('❌ offlineConfig.deleteItem:', err);
            return res.status(500).json({ success: false, message: 'Failed to delete.' });
        }
    },

    /* ------------------------------------------------------------
       SIGNATURE CRUD (Merged from SignatureConfigController)
       ------------------------------------------------------------ */
    listSignatures: async (req, res) => {
        try {
            const rows = await OfflineConfigModel.listSignatures({
                role_slot: req.query.role_slot,
                is_active:
                    req.query.is_active === 'true'  ? true  :
                    req.query.is_active === 'false' ? false : undefined,
                include_inactive: isAdminRole(req.user) && req.query.include_inactive === 'true',
            });
            return res.status(200).json({ success: true, data: rows, total: rows.length });
        } catch (err) {
            console.error('❌ offlineConfig.listSignatures:', err);
            return res.status(500).json({ success: false, message: 'Failed to fetch signature config.' });
        }
    },

    getSignature: async (req, res) => {
        try {
            const id = toInt(req.params.id);
            if (!id) return res.status(400).json({ success: false, message: 'Invalid id.' });
            const row = await OfflineConfigModel.getSignatureById(id);
            if (!row) return res.status(404).json({ success: false, message: 'Not found.' });
            return res.status(200).json({ success: true, data: row });
        } catch (err) {
            console.error('❌ offlineConfig.getSignature:', err);
            return res.status(500).json({ success: false, message: 'Failed to fetch.' });
        }
    },

    createSignature: async (req, res) => {
        try {
            if (!isAdminRole(req.user)) return res.status(403).json({ success: false, message: 'Admin only.' });
            const body = req.body || {};
            const result = await OfflineConfigModel.createSignature({
                full_name:      body.full_name,
                position_title: body.position_title,
                role_slot:      body.role_slot,
                is_active:      body.is_active !== false,
                remarks:        body.remarks,
                created_by:     req.user?.username || 'system',
            });
            return res.status(201).json({ success: true, message: 'Signature config created.', data: result });
        } catch (err) {
            console.error('❌ offlineConfig.createSignature:', err);
            const status = /required|Invalid/i.test(err.message) ? 400 : 500;
            return res.status(status).json({ success: false, message: err.message || 'Failed to create.' });
        }
    },

    updateSignature: async (req, res) => {
        try {
            if (!isAdminRole(req.user)) return res.status(403).json({ success: false, message: 'Admin only.' });
            const id = toInt(req.params.id);
            if (!id) return res.status(400).json({ success: false, message: 'Invalid id.' });
            const body = req.body || {};
            const result = await OfflineConfigModel.updateSignature(id, {
                full_name:      body.full_name,
                position_title: body.position_title,
                role_slot:      body.role_slot,
                is_active:      body.is_active,
                remarks:        body.remarks,
                updated_by:     req.user?.username || 'system',
            });
            return res.status(200).json({ success: true, message: 'Updated.', data: result });
        } catch (err) {
            console.error('❌ offlineConfig.updateSignature:', err);
            const status = /required|Invalid|not found/i.test(err.message) ? 400 : 500;
            return res.status(status).json({ success: false, message: err.message || 'Failed to update.' });
        }
    },

    deleteSignature: async (req, res) => {
        try {
            if (!isAdminRole(req.user)) return res.status(403).json({ success: false, message: 'Admin only.' });
            const id = toInt(req.params.id);
            if (!id) return res.status(400).json({ success: false, message: 'Invalid id.' });
            const result = await OfflineConfigModel.removeSignature(id);
            return res.status(200).json({ success: true, message: 'Removed.', data: result });
        } catch (err) {
            console.error('❌ offlineConfig.deleteSignature:', err);
            const status = /not found/i.test(err.message) ? 404 : 500;
            return res.status(status).json({ success: false, message: err.message || 'Failed to remove.' });
        }
    },

    /* ------------------------------------------------------------
       SYNC / EXPORT / IMPORT
       ------------------------------------------------------------ */
    exportSync: async (req, res) => {
        try {
            if (!isConfigManager(req.user)) return res.status(403).json({ success: false, message: 'Access denied.' });
            const { payload, fileName, fileHash, itemCount } = await OfflineConfigModel.generateSyncPayload();

            await OfflineConfigModel.logSync({
                direction: 'Export',
                username: req.user.username,
                userId: req.user.id,
                fileName,
                fileHash,
                itemCount,
                notes: 'Manual sync export generated.'
            });

            return res.status(200).json({ success: true, data: payload, meta: { fileName, fileHash } });
        } catch (err) {
            console.error('❌ offlineConfig.exportSync:', err);
            return res.status(500).json({ success: false, message: 'Failed to generate export.' });
        }
    },

    peerExport: async (req, res) => {
        try {
            const { payload, fileName, fileHash, itemCount } = await OfflineConfigModel.generateSyncPayload();
            const source = String(req.syncSource || 'peer').slice(0, 80);

            await OfflineConfigModel.logSync({
                direction: 'Export',
                username:  `peer:${source}`,
                userId:    null,
                fileName,
                fileHash,
                itemCount,
                notes:     `Peer export served to ${source}`,
            });

            return res.status(200).json({ success: true, data: payload, meta: { fileName, fileHash } });
        } catch (err) {
            console.error('❌ offlineConfig.peerExport:', err);
            return res.status(500).json({ success: false, message: 'Failed to generate peer export.' });
        }
    },

    pullFromSurface: async (req, res) => {
        try {
            if (!canReceiveSync(req.user)) {
                return res.status(403).json({ success: false, message: 'Access denied.' });
            }

            if (!surfaceSyncClient.isRemoteSyncEnabled()) {
                return res.status(400).json({ success: false, message: 'Online Sync is not configured on this device.' });
            }

            let fetched;
            try {
                fetched = await surfaceSyncClient.fetchConfigFromSurface();
            } catch (netErr) {
                return res.status(502).json({ success: false, message: 'Could not reach the surface server.', error: netErr.message });
            }

            if (!fetched.ok) {
                return res.status(502).json({ success: false, message: fetched.message || 'The surface server rejected the pull.' });
            }

            const payload = fetched.payload;
            const meta    = fetched.meta || {};

            if (!payload || !Array.isArray(payload.configs)) {
                return res.status(502).json({ success: false, message: 'Surface returned an unexpected response.' });
            }

            const fileName = meta.fileName || `online-sync-${Date.now()}.json`;
            const fileHash = meta.fileHash || null;

            await OfflineConfigModel.applySyncPayload(payload, req.user.username, req.user.id, fileName, fileHash);

            return res.status(200).json({
                success: true,
                message: 'Configuration pulled from surface and applied.',
                data: {
                    configs:         Array.isArray(payload.configs)          ? payload.configs.length          : 0,
                    signatures:      Array.isArray(payload.signatures)       ? payload.signatures.length       : 0,
                    items:           Array.isArray(payload.item_master)      ? payload.item_master.length      : 0,
                    locators:        Array.isArray(payload.locators)         ? payload.locators.length         : 0,
                    equipment:       Array.isArray(payload.equipment_master) ? payload.equipment_master.length : 0,
                    uom_conversions: Array.isArray(payload.uom_conversions)  ? payload.uom_conversions.length  : 0,  // ← Phase 5
                    fileName, fileHash,
                },
            });
        } catch (err) {
            console.error('❌ offlineConfig.pullFromSurface:', err);
            const info = translateImportError(err);
            return res.status(500).json({ success: false, message: info.title, error: info.message, hint: info.hint });
        }
    },

    importSync: async (req, res) => {
        try {
            if (!canReceiveSync(req.user)) {
                return res.status(403).json({ success: false, message: 'Access denied.' });
            }
            const { payload, fileName, fileHash } = req.body || {};

            if (!payload || typeof payload !== 'object' || !Array.isArray(payload.configs)) {
                return res.status(400).json({ success: false, message: 'Invalid sync file format.' });
            }

            await OfflineConfigModel.applySyncPayload(payload, req.user.username, req.user.id, fileName, fileHash);
            return res.status(200).json({ success: true, message: 'Import applied successfully.' });
        } catch (err) {
            console.error('❌ offlineConfig.importSync:', err);
            const info = translateImportError(err);
            return res.status(500).json({ success: false, message: info.title, error: info.message, hint: info.hint });
        }
    },

    getHistory: async (req, res) => {
        try {
            if (!canReceiveSync(req.user)) return res.status(403).json({ success: false, message: 'Access denied.' });
            const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
            const rows  = await OfflineConfigModel.getSyncHistory(limit);
            return res.status(200).json({ success: true, data: rows, limit });
        } catch (err) {
            console.error('❌ offlineConfig.getHistory:', err);
            return res.status(500).json({ success: false, message: 'Failed to fetch history.' });
        }
    },

    syncStatus: async (req, res) => {
        try {
            if (!canReceiveSync(req.user)) return res.status(403).json({ success: false, message: 'Access denied.' });
            const enabled = surfaceSyncClient.isRemoteSyncEnabled();

            return res.status(200).json({
                success: true,
                data: {
                    enabled,
                    surfaceBaseUrl: enabled ? String(process.env.SURFACE_BASE_URL || '').replace(/\/+$/, '') : null,
                    serverId:       String(process.env.IMS_SERVER_ID       || '').trim() || null,
                    warehouseCode:  String(process.env.IMS_WAREHOUSE_CODE  || '').trim() || null,
                },
            });
        } catch (err) {
            console.error('❌ offlineConfig.syncStatus:', err);
            return res.status(500).json({ success: false, message: 'Failed to fetch status.' });
        }
    },
};

module.exports = offlineConfigController;