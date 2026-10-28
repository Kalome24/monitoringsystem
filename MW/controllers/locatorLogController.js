// controllers/locatorLogController.js
const LocatorLogModel = require('../models/locatorLogModel');

const ADMIN_ROLES = ['Super Admin', 'Admin'];

const isAdmin = (user) => {
  const role = String(user?.role || user?.user_role || '').trim();
  return ADMIN_ROLES.includes(role);
};

const toIntOrUndef = (v) => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
};

const locatorLogController = {
  /* ============================================================
     POST /api/locator-logs
     Server owns: export_uid, performed_by_*, performed_at.
     Client sends: direction, action_type, format, warehouse,
                   totals, filename, hash, lines[].
     ============================================================ */
  create: async (req, res) => {
    try {
      const body = req.body || {};

      const required = [
        'direction', 'action_type',
        'source_warehouse_code',
        'locator_count', 'item_row_count',
        'total_qty', 'total_value',
      ];
      for (const key of required) {
        if (body[key] === undefined || body[key] === null) {
          return res.status(400).json({
            success: false,
            message: `Missing required field: ${key}`,
          });
        }
      }

      if (!['Export', 'Import'].includes(body.direction)) {
        return res.status(400).json({
          success: false,
          message: "direction must be 'Export' or 'Import'.",
        });
      }
      if (body.export_format && !['Excel', 'PDF'].includes(body.export_format)) {
        return res.status(400).json({
          success: false,
          message: "export_format must be 'Excel' or 'PDF'.",
        });
      }

      const performer = {
        performed_by_id:       req.user?.id || null,
        performed_by_username: req.user?.username || 'system',
        performed_by_role:     req.user?.role || null,
        performed_by_position: req.user?.emp_position || null,
      };

      const header = { ...body, ...performer };
      const lines  = Array.isArray(body.lines) ? body.lines : [];

      const { export_id, export_uid } =
        await LocatorLogModel.createLog(header, lines);

      return res.status(201).json({
        success: true,
        message: 'Locator log recorded.',
        data: {
          export_id,
          export_uid,
          lines_logged: lines.length,
        },
      });
    } catch (err) {
      console.error('❌ Error in locatorLogController.create:', err);
      return res.status(500).json({
        success: false,
        message: 'Failed to record locator log.',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined,
      });
    }
  },

  /* ============================================================
     GET /api/locator-logs
     ============================================================ */
  list: async (req, res) => {
    try {
      const {
        page, limit,
        direction, action_type, export_format,
        warehouse_code, performed_by,
        search, start_date, end_date,
        scope,
      } = req.query;

      const admin = isAdmin(req.user);
      const effectiveScope = admin ? (scope === 'mine' ? 'mine' : 'all') : 'mine';

      const filters = {
        page:  toIntOrUndef(page),
        limit: toIntOrUndef(limit) || 50,
        direction,
        action_type,
        export_format,
        warehouse_code,
        performed_by:
          effectiveScope === 'mine'
            ? (req.user?.username || '__no_user__')
            : performed_by,
        search,
        start_date,
        end_date,
      };

      const result = await LocatorLogModel.listLogs(filters);

      return res.status(200).json({
        success: true,
        data: result.rows,
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
        scope: effectiveScope,
      });
    } catch (err) {
      console.error('❌ Error in locatorLogController.list:', err);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch locator log.',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined,
      });
    }
  },

  /* ============================================================
     GET /api/locator-logs/:id
     ============================================================ */
  getOne: async (req, res) => {
    try {
      const id = toIntOrUndef(req.params.id);
      if (!id) {
        return res.status(400).json({ success: false, message: 'Invalid log ID.' });
      }

      const header = await LocatorLogModel.getLogById(id);
      if (!header) {
        return res.status(404).json({ success: false, message: 'Locator log not found.' });
      }

      if (!isAdmin(req.user) && header.performed_by_username !== req.user?.username) {
        return res.status(403).json({
          success: false,
          message: 'You do not have access to this log.',
        });
      }

      return res.status(200).json({ success: true, data: header });
    } catch (err) {
      console.error('❌ Error in locatorLogController.getOne:', err);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch locator log.',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined,
      });
    }
  },

  /* ============================================================
     GET /api/locator-logs/:id/lines
     ============================================================ */
  getLines: async (req, res) => {
    try {
      const id = toIntOrUndef(req.params.id);
      if (!id) {
        return res.status(400).json({ success: false, message: 'Invalid log ID.' });
      }

      const header = await LocatorLogModel.getLogById(id);
      if (!header) {
        return res.status(404).json({ success: false, message: 'Locator log not found.' });
      }
      if (!isAdmin(req.user) && header.performed_by_username !== req.user?.username) {
        return res.status(403).json({
          success: false,
          message: 'You do not have access to this log.',
        });
      }

      const { page, limit } = req.query;
      const result = await LocatorLogModel.getLogLines(id, {
        page:  toIntOrUndef(page),
        limit: toIntOrUndef(limit) || 50,
      });

      return res.status(200).json({
        success: true,
        data: result.rows,
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
      });
    } catch (err) {
      console.error('❌ Error in locatorLogController.getLines:', err);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch locator log lines.',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined,
      });
    }
  },
};

module.exports = locatorLogController;