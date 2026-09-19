// controllers/stockTransferController.js
const StockTransferModel = require('../models/stockTransferModel');
const UserModel = require('../models/userModel');
const PoActivityLogModel = require('../models/poActivityLogModel');

const sendServerError = (res, error) => {
  console.error('❌ stockTransferController error:', error);
  return res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
  });
};

const getFreshUser = async (req) => {
  if (!req.user?.id) return null;
  try {
    return await UserModel.getUserById(req.user.id);
  } catch {
    return null;
  }
};

const isSuperAdmin = (user) => user?.user_role === 'Super Admin';
const isAdmin = (user) => user?.user_role === 'Admin';
const isApprover = (user) =>
  isAdmin(user) && user?.emp_position === 'Department Head';

const stockTransferController = {
  /* ============================================================
     CREATE
     ============================================================ */

  createSTS: async (req, res) => {
    try {
      const {
        from_warehouse_id,
        to_warehouse_id,
        transfer_date,
        po_no = null,
        remarks = null,
        lines = [],
      } = req.body;

      const me = await getFreshUser(req);
      if (!me) {
        return res.status(401).json({ success: false, message: 'User not found.' });
      }

      if (!from_warehouse_id || !to_warehouse_id) {
        return res.status(400).json({
          success: false,
          message: 'Both source and destination warehouses are required.',
        });
      }
      if (!transfer_date || isNaN(Date.parse(transfer_date))) {
        return res.status(400).json({
          success: false,
          message: 'A valid transfer date is required.',
        });
      }
      if (Number(from_warehouse_id) === Number(to_warehouse_id)) {
        return res.status(400).json({
          success: false,
          message: 'Source and destination warehouses must be different.',
        });
      }

      const globalUser = isSuperAdmin(me) || isAdmin(me);
      if (!globalUser && Number(from_warehouse_id) !== Number(me.warehouse_assigned)) {
        return res.status(403).json({
          success: false,
          message: 'You can only submit transfer slips FROM your assigned warehouse.',
        });
      }

      if (!Array.isArray(lines) || lines.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'At least one item line is required.',
        });
      }

      const cleanLines = [];
      const errors = [];

      lines.forEach((l, idx) => {
        const row = idx + 1;
        const item_code = String(l.item_code || '').trim();
        const qty = Number(l.qty);

        if (!item_code) {
          return errors.push({ row, message: 'Missing item code.' });
        }
        if (!Number.isFinite(qty) || qty <= 0) {
          return errors.push({ row, message: `Item "${item_code}" has invalid qty.` });
        }

        cleanLines.push({
          item_code,
          item_name: l.item_name || null,
          uom: l.uom || null,
          qty,
          unit_price: l.unit_price == null || l.unit_price === '' ? null : Number(l.unit_price),
          currency: l.currency || null,
          remarks: l.remarks || null,
        });
      });

      if (cleanLines.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No valid item lines to submit.',
          errors,
        });
      }

      let created;
      try {
        created = await StockTransferModel.createSTS({
          from_warehouse_id: Number(from_warehouse_id),
          to_warehouse_id: Number(to_warehouse_id),
          transfer_date,
          po_no,
          remarks,
          submitted_by: me.username,
          lines: cleanLines,
        });
      } catch (err) {
        if (err && err.code === 'PO_HAS_ACTIVE_STS') {
          return res.status(409).json({
            success: false,
            code: 'PO_HAS_ACTIVE_STS',
            message: err.message,
            blocked_items: err.blockedItems || [],
          });
        }
        throw err;
      }

      const {
        sts_id,
        sts_no,
        skippedItems = [],
        createdLineCount = cleanLines.length,
      } = created;

      // ---- Activity log ----
      if (po_no) {
        const totalQty = cleanLines
          .filter((l) => !skippedItems.includes(l.item_code))
          .reduce((s, l) => s + (Number(l.qty) || 0), 0);

        await PoActivityLogModel.log({
          po_no,
          event_type: 'TransferSubmitted',
          event_summary:
            `${sts_no} submitted · ${createdLineCount} line${createdLineCount === 1 ? '' : 's'} · ` +
            `${totalQty} unit${totalQty === 1 ? '' : 's'} · ` +
            `WH ${from_warehouse_id} → WH ${to_warehouse_id}` +
            (skippedItems.length > 0 ? ` · ${skippedItems.length} skipped` : ''),
          event_detail: remarks ? `Remarks: ${remarks}` : null,
          ref_sts_id: sts_id,
          actor: me.username,
        });
      }

      const message =
        skippedItems.length > 0
          ? `Stock Transfer Slip ${sts_no} submitted. ${skippedItems.length} item(s) were skipped because they already have a pending transfer.`
          : `Stock Transfer Slip ${sts_no} submitted for approval.`;

      return res.status(201).json({
        success: true,
        message,
        data: {
          sts_id,
          sts_no,
          skipped_items: skippedItems,
        },
        warnings: errors.length > 0 ? errors : undefined,
      });
    } catch (error) {
      return sendServerError(res, error);
    }
  },

  /* ============================================================
     READ
     ============================================================ */

  listSTSs: async (req, res) => {
    try {
      const me = await getFreshUser(req);
      if (!me) {
        return res.status(401).json({ success: false, message: 'User not found.' });
      }

      const filters = {
        status:            req.query.status,
        from_warehouse_id: req.query.from_warehouse_id,
        to_warehouse_id:   req.query.to_warehouse_id,
        search:            req.query.search,
        start_date:        req.query.start_date,
        end_date:          req.query.end_date,
        submitted_by:      req.query.submitted_by,
        approved_by:       req.query.approved_by,
        limit:             req.query.limit,
      };

      const scope = req.query.scope;

      if (scope === 'mine') {
        filters.submitted_by = me.username;
      } else if (scope === 'pending') {
        if (!isApprover(me) && !isSuperAdmin(me)) {
          return res.status(403).json({
            success: false,
            message: 'You do not have permission to view the pending queue.',
          });
        }
        filters.status = 'Pending';
      } else if (scope === 'all') {
        if (!isSuperAdmin(me) && !isAdmin(me)) {
          return res.status(403).json({
            success: false,
            message: 'You do not have permission to view all slips.',
          });
        }
      } else {
        if (!isApprover(me) && !isSuperAdmin(me)) {
          filters.submitted_by = me.username;
        }
      }

      const rows = await StockTransferModel.listSTSs(filters);

      return res.status(200).json({
        success: true,
        data: rows,
        total: rows.length,
      });
    } catch (error) {
      return sendServerError(res, error);
    }
  },

  listIncomingSTSs: async (req, res) => {
    try {
      const me = await getFreshUser(req);
      if (!me) {
        return res.status(401).json({ success: false, message: 'User not found.' });
      }

      let warehouseId = me.warehouse_assigned;
      if ((isSuperAdmin(me) || isAdmin(me)) && req.query.to_warehouse_id) {
        warehouseId = Number(req.query.to_warehouse_id);
      }

      if (!warehouseId) {
        return res.status(400).json({
          success: false,
          message: 'You are not assigned to any warehouse.',
        });
      }

      const rows = await StockTransferModel.listIncoming({
        to_warehouse_id: warehouseId,
        status: req.query.status,
        search: req.query.search,
        limit: req.query.limit,
      });

      return res.status(200).json({
        success: true,
        data: rows,
        total: rows.length,
      });
    } catch (error) {
      return sendServerError(res, error);
    }
  },

  getIncomingSummary: async (req, res) => {
    try {
      const me = await getFreshUser(req);
      if (!me) {
        return res.status(401).json({ success: false, message: 'User not found.' });
      }

      let warehouseId = me.warehouse_assigned;
      if ((isSuperAdmin(me) || isAdmin(me)) && req.query.to_warehouse_id) {
        warehouseId = Number(req.query.to_warehouse_id);
      }

      const counts = await StockTransferModel.getIncomingCounts({
        to_warehouse_id: warehouseId,
      });

      return res.status(200).json({ success: true, data: counts });
    } catch (error) {
      return sendServerError(res, error);
    }
  },

  getSummary: async (req, res) => {
    try {
      const me = await getFreshUser(req);
      if (!me) {
        return res.status(401).json({ success: false, message: 'User not found.' });
      }

      const summary = await StockTransferModel.getSummaryCounts({});

      const mine = await StockTransferModel.getSummaryCounts({
        submitted_by: me.username,
      });

      const pendingForMe = isApprover(me) || isSuperAdmin(me)
        ? (await StockTransferModel.getSummaryCounts({})).pending
        : 0;

      return res.status(200).json({
        success: true,
        data: {
          global:  summary,
          mine:    mine,
          pendingForMe,
        },
      });
    } catch (error) {
      return sendServerError(res, error);
    }
  },

  getSTSDetail: async (req, res) => {
    try {
      const { id } = req.params;
      const detail = await StockTransferModel.getSTSDetail(id);

      if (!detail) {
        return res.status(404).json({
          success: false,
          message: 'Stock Transfer Slip not found.',
        });
      }

      return res.status(200).json({ success: true, data: detail });
    } catch (error) {
      return sendServerError(res, error);
    }
  },

  getTransferredQty: async (req, res) => {
    try {
      const { po_no } = req.query;
      if (!po_no) {
        return res.status(400).json({
          success: false,
          message: 'po_no query parameter is required.',
        });
      }

      const map = await StockTransferModel.getTransferredQtyForPO(po_no);

      return res.status(200).json({
        success: true,
        data: map,
      });
    } catch (error) {
      return sendServerError(res, error);
    }
  },

  /* ============================================================
     STATUS TRANSITIONS
     ============================================================ */

  approveSTS: async (req, res) => {
    try {
      const { id } = req.params;
      const me = await getFreshUser(req);

      if (!me) {
        return res.status(401).json({ success: false, message: 'User not found.' });
      }

      if (!isApprover(me) && !isSuperAdmin(me)) {
        return res.status(403).json({
          success: false,
          message: 'Only Department Heads can approve Stock Transfer Slips.',
        });
      }

      const affected = await StockTransferModel.approveSTS(id, me.username);

      if (affected === 0) {
        return res.status(400).json({
          success: false,
          message: 'Cannot approve: the slip is not in Pending status (or does not exist).',
        });
      }

      const detail = await StockTransferModel.getSTSById(id);
      if (detail?.po_no) {
        await PoActivityLogModel.log({
          po_no: detail.po_no,
          event_type: 'TransferApproved',
          event_summary: `${detail.sts_no} approved`,
          ref_sts_id: id,
          actor: me.username,
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Stock Transfer Slip approved.',
      });
    } catch (error) {
      return sendServerError(res, error);
    }
  },

  rejectSTS: async (req, res) => {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      const me = await getFreshUser(req);

      if (!me) {
        return res.status(401).json({ success: false, message: 'User not found.' });
      }

      if (!isApprover(me) && !isSuperAdmin(me)) {
        return res.status(403).json({
          success: false,
          message: 'Only Department Heads can reject Stock Transfer Slips.',
        });
      }

      if (!reason || !String(reason).trim()) {
        return res.status(400).json({
          success: false,
          message: 'A rejection reason is required.',
        });
      }

      const affected = await StockTransferModel.rejectSTS(id, me.username, String(reason).trim());

      if (affected === 0) {
        return res.status(400).json({
          success: false,
          message: 'Cannot reject: the slip is not in Pending status (or does not exist).',
        });
      }

      const detail = await StockTransferModel.getSTSById(id);
      if (detail?.po_no) {
        await PoActivityLogModel.log({
          po_no: detail.po_no,
          event_type: 'TransferRejected',
          event_summary: `${detail.sts_no} rejected — ${String(reason).trim()}`,
          ref_sts_id: id,
          actor: me.username,
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Stock Transfer Slip rejected.',
      });
    } catch (error) {
      return sendServerError(res, error);
    }
  },

  cancelSTS: async (req, res) => {
    try {
      const { id } = req.params;
      const me = await getFreshUser(req);

      if (!me) {
        return res.status(401).json({ success: false, message: 'User not found.' });
      }

      const affected = await StockTransferModel.cancelSTS(id, me.username);

      if (affected === 0) {
        return res.status(400).json({
          success: false,
          message: 'Cannot cancel: either you are not the submitter, or the slip is not Pending.',
        });
      }

      const detail = await StockTransferModel.getSTSById(id);
      if (detail?.po_no) {
        await PoActivityLogModel.log({
          po_no: detail.po_no,
          event_type: 'TransferCancelled',
          event_summary: `${detail.sts_no} cancelled by submitter`,
          ref_sts_id: id,
          actor: me.username,
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Stock Transfer Slip cancelled.',
      });
    } catch (error) {
      return sendServerError(res, error);
    }
  },

  completeSTS: async (req, res) => {
    try {
      const { id } = req.params;
      const me = await getFreshUser(req);

      if (!me) {
        return res.status(401).json({ success: false, message: 'User not found.' });
      }

      const affected = await StockTransferModel.completeSTS(id, me.username);

      if (affected === 0) {
        return res.status(400).json({
          success: false,
          message: 'Cannot complete: the slip is not in Approved status (or does not exist).',
        });
      }

      const detail = await StockTransferModel.getSTSById(id);
      if (detail?.po_no) {
        await PoActivityLogModel.log({
          po_no: detail.po_no,
          event_type: 'TransferCompleted',
          event_summary: `${detail.sts_no} marked as completed`,
          ref_sts_id: id,
          actor: me.username,
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Stock Transfer Slip marked as Completed.',
      });
    } catch (error) {
      return sendServerError(res, error);
    }
  },

  receiveSTS: async (req, res) => {
    try {
      const { id } = req.params;
      const { remarks } = req.body || {};
      const me = await getFreshUser(req);

      if (!me) {
        return res.status(401).json({ success: false, message: 'User not found.' });
      }

      const detail = await StockTransferModel.getSTSById(id);
      if (!detail) {
        return res.status(404).json({
          success: false,
          message: 'Stock Transfer Slip not found.',
        });
      }

      const globalUser = isSuperAdmin(me);
      if (!globalUser && Number(detail.to_warehouse_id) !== Number(me.warehouse_assigned)) {
        return res.status(403).json({
          success: false,
          message: 'You can only receive transfers addressed to your assigned warehouse.',
        });
      }

      const affected = await StockTransferModel.receiveSTS(
        id,
        me.username,
        remarks ? String(remarks).trim() : null
      );

      if (affected === 0) {
        return res.status(400).json({
          success: false,
          message: 'Cannot receive: the slip is not in Approved status (or does not exist).',
        });
      }

      if (detail.po_no) {
        await PoActivityLogModel.log({
          po_no: detail.po_no,
          event_type: 'TransferReceived',
          event_summary: `${detail.sts_no} received by ${me.username}`,
          event_detail: remarks ? `Remarks: ${String(remarks).trim()}` : null,
          ref_sts_id: id,
          actor: me.username,
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Stock Transfer Slip marked as Received.',
      });
    } catch (error) {
      return sendServerError(res, error);
    }
  },
};

module.exports = stockTransferController;