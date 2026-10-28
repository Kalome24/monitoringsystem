// controllers/stockTransferController.js
//
// Reservation timing — Design 1 (reserve at approve, deduct at ship):
//   Submit    →  400 on `Insufficient available stock` (soft check)
//   Approve   →  400 on `Insufficient available stock` (hard check + reserve)
//   Ship      →  400 on `Insufficient stock`           (physical deduction fails)
//   Receive   →  unchanged
//   Reject    →  unchanged (only Pending)
//   Cancel    →  unchanged (only Pending)
//
// Department-Head quantity adjustment (Session 8, Option A):
//   approveSTS accepts body:
//     { approved_lines: [{ sts_line_id, approved_qty, qty_change_reason? }] }
//   Lines with approved_qty === 0 are dropped from reservation and shipping.
//   If ALL lines are zeroed, the STS is auto-rejected and the endpoint
//   returns 200 with { all_zeroed: true }.
//
// Session 13 (I2) — Email notification for Department Heads:
//   createTransferRequest now dispatches a "New Transfer Request" email
//   to every active Department Head after the STS row is committed.
//
// Session 13 (I3) — Emails for the rest of the STS lifecycle:
//   • rejectSTS   → requester       (red theme)
//   • approveSTS  → requester + source-warehouse handlers (green theme)
//   • shipSTS     → requester       (indigo theme)
//   • receiveSTS  → all DHs + specific issuer (teal theme)
//
// SESSION 17 — Optional Backup Approvers:
//   Users with can_approve_sts = 1 can now view the queue and approve/reject.
//   Activity logs now capture the exact emp_position (e.g. "Inventory Controller Manager").
//
// RED-FLAG FIX (this version) — listReceivedForStore:
//   The model returns { rows, total, page, limit } but the controller
//   was assigning the whole object to `data` and setting `total` to
//   `rows.length` (which is undefined on an object). The response was:
//     { data: { rows: [...], total, page, limit }, total: undefined }
//   instead of:
//     { data: [...], total, page, limit, totalPages }
//   Any UI that read `total` for pagination was getting undefined, and
//   any code that called `data.map(...)` was crashing on `.map is not
//   a function`. Fixed to unwrap the model result and return the
//   standard pagination contract.

const StockTransferModel  = require('../models/stockTransferModel');
const UserModel           = require('../models/userModel');
const PoActivityLogModel  = require('../models/poActivityLogModel');
const StockTransferActivityLogModel = require('../models/stockTransferActivityLogModel');
const emailService        = require('../services/emailService');

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
  try { return await UserModel.getUserById(req.user.id); } catch { return null; }
};

const isSuperAdmin = (user) => user?.user_role === 'Super Admin';
const isAdmin      = (user) => user?.user_role === 'Admin';

// Updated logic to allow Inventory Controller Managers with can_approve_sts = 1
const isApprover   = (user) => {
  if (!isAdmin(user)) return false;
  return user?.emp_position === 'Department Head' || user?.can_approve_sts === 1 || user?.can_approve_sts === true;
};

// Helper to get the exact role label for Activity Feeds
const getActorRole = (user) => {
  if (!user) return null;
  return user.emp_position || user.user_role || 'System';
};

// STS label for log summaries — shows "STS No. ?" when the slip
// hasn't been approved yet (no STS No. assigned). This is display-only;
// the internal numeric sts_id is never leaked to the end user.
const refOf = (detail) => detail?.sts_no || 'STS No. ?';

/* ------------------------------------------------------------
   logTransferEventPerItem — writes PO-level events for the
   underlying PO when a transfer touches it.
   ------------------------------------------------------------ */
const logTransferEventPerItem = async (stsId, eventType, actor, buildSummary, actorRole = null) => {
  try {
    const detail = await StockTransferModel.getSTSDetail(stsId);
    if (!detail?.po_no) return;
    if (!Array.isArray(detail.lines) || detail.lines.length === 0) return;

    const warehouseCode = detail.from_warehouse_code || detail.to_warehouse_code || null;
    if (!warehouseCode) {
      console.warn('⚠️ logTransferEventPerItem: no warehouse_code on STS detail — skipping PO log.');
      return;
    }

    for (const line of detail.lines) {
      await PoActivityLogModel.log({
        po_no: detail.po_no,
        item_code: line.item_code,
        event_type: eventType,
        event_summary: buildSummary(detail, line),
        ref_sts_id: stsId,
        actor,
        warehouse_code: warehouseCode,
      });
    }
  } catch (err) {
    console.warn('⚠️ logTransferEventPerItem failed:', err.message);
  }
};

/* ------------------------------------------------------------
   Build the item payload used by the email templates from
   an STS detail object (header + lines).
   ------------------------------------------------------------ */
const buildEmailItems = (detail) => {
  if (!Array.isArray(detail?.lines)) return [];
  return detail.lines.map((l) => ({
    itemCode:    l.item_code,
    itemName:    l.item_name || null,
    uom:         l.uom || null,
    qty:         Number(l.approved_qty ?? l.requested_qty ?? l.qty) || 0,
    locatorCode: l.locator_code || null,
  }));
};

const stockTransferController = {
  /* ============================================================
     DIRECT TRANSFER (existing flow)
     ============================================================ */
  createSTS: async (req, res) => {
    try {
      const {
        from_warehouse_id, to_warehouse_id, transfer_date,
        po_no = null, remarks = null, lines = [],
      } = req.body;

      const me = await getFreshUser(req);
      if (!me) return res.status(401).json({ success: false, message: 'User not found.' });

      if (!from_warehouse_id || !to_warehouse_id) {
        return res.status(400).json({
          success: false, message: 'Both source and destination warehouses are required.',
        });
      }
      if (!transfer_date || isNaN(Date.parse(transfer_date))) {
        return res.status(400).json({ success: false, message: 'A valid transfer date is required.' });
      }
      if (Number(from_warehouse_id) === Number(to_warehouse_id)) {
        return res.status(400).json({
          success: false, message: 'Source and destination warehouses must be different.',
        });
      }

      const globalUser = isSuperAdmin(me) || isAdmin(me);
      if (!globalUser && Number(from_warehouse_id) !== Number(me.warehouse_assigned)) {
        return res.status(403).json({
          success: false, message: 'You can only submit transfer slips FROM your assigned warehouse.',
        });
      }

      if (!Array.isArray(lines) || lines.length === 0) {
        return res.status(400).json({ success: false, message: 'At least one item line is required.' });
      }

      const cleanLines = [];
      const errors = [];

      lines.forEach((l, idx) => {
        const row = idx + 1;
        const item_code = String(l.item_code || '').trim();
        const qty = Number(l.qty);

        if (!item_code) return errors.push({ row, message: 'Missing item code.' });
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
          success: false, message: 'No valid item lines to submit.', errors,
        });
      }

      let created;
      try {
        created = await StockTransferModel.createSTS({
          from_warehouse_id: Number(from_warehouse_id),
          to_warehouse_id:   Number(to_warehouse_id),
          transfer_date,
          po_no,
          remarks,
          submitted_by: me.username,
          lines: cleanLines,
        });
      } catch (err) {
        if (err && err.code === 'PO_HAS_ACTIVE_STS') {
          return res.status(409).json({
            success: false, code: 'PO_HAS_ACTIVE_STS',
            message: err.message, blocked_items: err.blockedItems || [],
          });
        }
        if (err && /Insufficient available stock/.test(err.message)) {
          return res.status(400).json({ success: false, message: err.message });
        }
        throw err;
      }

      const {
        sts_id,
        sts_no,
        draft_no,
        skippedItems = [],
        createdLineCount = cleanLines.length,
        reopened = false,
      } = created;

      if (po_no) {
        const eventType = reopened ? 'TransferResubmitted' : 'TransferSubmitted';
        const verb      = reopened ? 'resubmitted' : 'submitted';
        await logTransferEventPerItem(sts_id, eventType, me.username, (detail, line) =>
          `${refOf(detail)} ${verb} · ${line.item_code} · ${line.qty} unit${line.qty === 1 ? '' : 's'} · ` +
          `WH ${detail.from_warehouse_code || detail.from_warehouse_id} → WH ${detail.to_warehouse_code || detail.to_warehouse_id}`,
          getActorRole(me)
        );
      }

      const message = (() => {
        const base = reopened
          ? 'Transfer resubmitted for Department Head approval. An STS number will be assigned on approval.'
          : 'Transfer submitted for Department Head approval. An STS number will be assigned on approval.';
        return skippedItems.length > 0
          ? `${base} ${skippedItems.length} item(s) were skipped (already on a pending transfer).`
          : base;
      })();

      return res.status(reopened ? 200 : 201).json({
        success: true, message,
        data: { sts_id, sts_no: sts_no || null, draft_no, reopened, skipped_items: skippedItems },
        warnings: errors.length > 0 ? errors : undefined,
      });
    } catch (error) {
      return sendServerError(res, error);
    }
  },

  /* ============================================================
     TRANSFER REQUEST (new flow)
     ============================================================ */
  createTransferRequest: async (req, res) => {
    try {
      const {
        from_warehouse_code,
        to_warehouse_code,
        item_code,
        item_name = null,
        uom = null,
        qty,
        target_locator_code,
        remarks = null,
      } = req.body || {};

      const me = await getFreshUser(req);
      if (!me) return res.status(401).json({ success: false, message: 'User not found.' });

      const globalUser = isSuperAdmin(me) || isAdmin(me);

      const meWh = await (async () => {
        if (!me.warehouse_assigned) return null;
        const whReq = require('../db').pool.request();
        whReq.input('id', require('../db').sql.Int, Number(me.warehouse_assigned));
        const r = await whReq.query(
          `SELECT warehouse_code FROM warehouse_table WHERE warehouse_id = @id`
        );
        return r.recordset[0]?.warehouse_code || null;
      })();

      if (!globalUser) {
        if (!meWh) {
          return res.status(403).json({
            success: false,
            message: 'You are not assigned to any warehouse.',
          });
        }
        if (!to_warehouse_code || String(to_warehouse_code).trim() !== meWh) {
          return res.status(403).json({
            success: false,
            message: `You can only request transfers INTO your assigned warehouse (${meWh}).`,
          });
        }
      }

      if (!from_warehouse_code || !String(from_warehouse_code).trim()) {
        return res.status(400).json({ success: false, message: 'Source warehouse is required.' });
      }
      if (!to_warehouse_code || !String(to_warehouse_code).trim()) {
        return res.status(400).json({ success: false, message: 'Destination warehouse is required.' });
      }
      if (String(from_warehouse_code).trim() === String(to_warehouse_code).trim()) {
        return res.status(400).json({
          success: false,
          message: 'Source and destination warehouses must be different.',
        });
      }
      if (!item_code || !String(item_code).trim()) {
        return res.status(400).json({ success: false, message: 'Item code is required.' });
      }
      if (!target_locator_code || !String(target_locator_code).trim()) {
        return res.status(400).json({ success: false, message: 'Target locator is required.' });
      }
      const q = Number(qty);
      if (!Number.isInteger(q) || q <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Quantity must be a positive integer.',
        });
      }

      let created;
      try {
        created = await StockTransferModel.createTransferRequest({
          from_warehouse_code: String(from_warehouse_code).trim(),
          to_warehouse_code:   String(to_warehouse_code).trim(),
          item_code:           String(item_code).trim(),
          item_name,
          uom,
          qty:                 q,
          target_locator_code: String(target_locator_code).trim(),
          remarks,
          submitted_by:        me.username,
          actor_role:          getActorRole(me),
        });
      } catch (err) {
        if (
          err &&
          /not found|not active|must be different|Insufficient|Cannot request|positive integer|is a DAMAGE/.test(
            err.message
          )
        ) {
          return res.status(400).json({ success: false, message: err.message });
        }
        throw err;
      }

      // Session 13 (I2) — Fire-and-forget email to every active DH or Backup Approver.
      (async () => {
        try {
          const dhList = await UserModel.getDepartmentHeads();
          if (!Array.isArray(dhList) || dhList.length === 0) {
            console.warn(
              '📧 DH notification skipped — no active Department Head users with an email address.'
            );
            return;
          }

          await emailService.notifyDepartmentHeadsOfNewRequest({
            stsId:             created.sts_id,
            draftNo:           'STS No. ?',
            submitter:         me.username,
            submitterEmail:    me.email || null,
            fromWarehouseCode: created.from_warehouse_code,
            toWarehouseCode:   created.to_warehouse_code,
            itemCode:          created.item_code,
            itemName:          item_name || null,
            uom:               uom || null,
            qty:               created.qty,
            targetLocatorCode: created.target_locator_code,
            remarks:           remarks || null,
            submittedAt:       new Date(),
            recipients:        dhList,
          });
        } catch (err) {
          console.error('📧 DH notification failed (non-fatal):', err.message || err);
        }
      })();

      return res.status(201).json({
        success: true,
        message: 'Transfer request submitted for Department Head approval. An STS number will be assigned on approval.',
        data: created,
      });
    } catch (error) {
      return sendServerError(res, error);
    }
  },

  /* ============================================================
     LIST STSs (paginated)
     ============================================================ */
  listSTSs: async (req, res) => {
    try {
      const me = await getFreshUser(req);
      if (!me) return res.status(401).json({ success: false, message: 'User not found.' });

      const filters = {
        status:            req.query.status,
        origin:            req.query.origin,
        from_warehouse_id: req.query.from_warehouse_id,
        to_warehouse_id:   req.query.to_warehouse_id,
        warehouse_code:    req.query.warehouse_code,
        warehouse_side:    req.query.warehouse_side,
        search:            req.query.search,
        start_date:        req.query.start_date,
        end_date:          req.query.end_date,
        submitted_by:      req.query.submitted_by,
        approved_by:       req.query.approved_by,
        page:              req.query.page,
        limit:             req.query.limit,
      };

      const scope = req.query.scope;
      if (scope === 'mine') {
        filters.submitted_by = me.username;
      } else if (scope === 'pending') {
        if (!isApprover(me) && !isSuperAdmin(me)) {
          return res.status(403).json({ success: false, message: 'You do not have permission to view the pending queue.' });
        }
        filters.status = 'Pending';
      } else if (scope === 'all') {
        if (!isSuperAdmin(me) && !isAdmin(me)) {
          return res.status(403).json({ success: false, message: 'You do not have permission to view all slips.' });
        }
      } else {
        if (!isApprover(me) && !isSuperAdmin(me)) filters.submitted_by = me.username;
      }

      const result = await StockTransferModel.listSTSs(filters);

      const total      = Number(result.total) || 0;
      const page       = Number(result.page)  || 1;
      const limit      = Number(result.limit) || 500;
      const totalPages = Math.max(Math.ceil(total / limit), 1);

      return res.status(200).json({
        success: true,
        data: result.rows || [],
        total,
        page,
        limit,
        totalPages,
      });
    } catch (error) {
      return sendServerError(res, error);
    }
  },

  /* ============================================================
     APPROVAL QUEUE — paginated
     ============================================================ */
  listApprovalQueue: async (req, res) => {
    try {
      const me = await getFreshUser(req);
      if (!me) return res.status(401).json({ success: false, message: 'User not found.' });

      if (!isApprover(me) && !isSuperAdmin(me)) {
        return res.status(403).json({
          success: false,
          message: 'Only Department Heads or authorized backup approvers can view the approval queue.',
        });
      }

      const result = await StockTransferModel.listApprovalQueue({
        search: req.query.search,
        page:   req.query.page,
        limit:  req.query.limit,
      });

      const rows       = result?.rows || [];
      const total      = Number(result?.total) || 0;
      const page       = Number(result?.page)  || 1;
      const limit      = Number(result?.limit) || 50;
      const totalPages = Math.max(Math.ceil(total / limit), 1);

      return res.status(200).json({
        success: true,
        data: rows,
        total,
        page,
        limit,
        totalPages,
      });
    } catch (error) {
      return sendServerError(res, error);
    }
  },

  /* ============================================================
     FOR SHIPPING QUEUE
     ============================================================ */
  listForShipping: async (req, res) => {
    try {
      const me = await getFreshUser(req);
      if (!me) return res.status(401).json({ success: false, message: 'User not found.' });

      const globalUser = isSuperAdmin(me) || isAdmin(me);

      let fromWarehouseCode;
      if (globalUser) {
        fromWarehouseCode = req.query.from_warehouse_code || null;
      } else {
        if (!me.warehouse_assigned) {
          return res.status(403).json({
            success: false,
            message: 'You are not assigned to any warehouse.',
          });
        }
        const whReq = require('../db').pool.request();
        whReq.input('id', require('../db').sql.Int, Number(me.warehouse_assigned));
        const r = await whReq.query(
          `SELECT warehouse_code FROM warehouse_table WHERE warehouse_id = @id`
        );
        fromWarehouseCode = r.recordset[0]?.warehouse_code || null;
        if (!fromWarehouseCode) {
          return res.status(403).json({
            success: false,
            message: 'Your assigned warehouse could not be resolved.',
          });
        }
      }

      const commonFilters = {
        search:     req.query.search,
        start_date: req.query.start_date,
        end_date:   req.query.end_date,
        page:       req.query.page,
        limit:      req.query.limit,
      };

      if (!fromWarehouseCode) {
        const result = await StockTransferModel.listSTSs({
          status: 'For Shipping',
          ...commonFilters,
        });

        const rows       = result?.rows || [];
        const total      = Number(result?.total) || rows.length;
        const page       = Number(result?.page)  || 1;
        const limit      = Number(result?.limit) || 50;
        const totalPages = Math.max(Math.ceil(total / limit), 1);

        return res.status(200).json({
          success: true,
          data: rows,
          total,
          page,
          limit,
          totalPages,
        });
      }

      const result = await StockTransferModel.listForShipping({
        from_warehouse_code: fromWarehouseCode,
        ...commonFilters,
      });

      const rows       = result.rows || [];
      const total      = Number(result.total) || 0;
      const page       = Number(result.page)  || 1;
      const limit      = Number(result.limit) || 50;
      const totalPages = Math.max(Math.ceil(total / limit), 1);

      return res.status(200).json({
        success: true,
        data: rows,
        total,
        page,
        limit,
        totalPages,
      });
    } catch (error) {
      return sendServerError(res, error);
    }
  },

  /* ============================================================
     ELIGIBLE SOURCE LOCATORS
     ============================================================ */
  getEligibleSourceLocators: async (req, res) => {
    try {
      const { id } = req.params;
      const me = await getFreshUser(req);
      if (!me) return res.status(401).json({ success: false, message: 'User not found.' });

      const detail = await StockTransferModel.getSTSById(id);
      if (!detail) {
        return res.status(404).json({ success: false, message: 'Stock Transfer Slip not found.' });
      }

      const globalUser = isSuperAdmin(me) || isAdmin(me);
      if (!globalUser && Number(detail.from_warehouse_id) !== Number(me.warehouse_assigned)) {
        return res.status(403).json({
          success: false,
          message: 'You can only view eligible locators for transfers originating from your assigned warehouse.',
        });
      }

      const rows = await StockTransferModel.listEligibleSourceLocators(id);
      return res.status(200).json({ success: true, data: rows, total: rows.length });
    } catch (error) {
      return sendServerError(res, error);
    }
  },

  /* ============================================================
     MY REQUESTS
     ============================================================ */
  listMyRequests: async (req, res) => {
    try {
      const me = await getFreshUser(req);
      if (!me) return res.status(401).json({ success: false, message: 'User not found.' });

      const result = await StockTransferModel.listMyRequests({
        submitted_by: me.username,
        status:       req.query.status,
        search:       req.query.search,
        start_date:   req.query.start_date,
        end_date:     req.query.end_date,
        page:         req.query.page,
        limit:        req.query.limit,
      });

      const rows       = result.rows || [];
      const total      = Number(result.total) || 0;
      const page       = Number(result.page)  || 1;
      const limit      = Number(result.limit) || 50;
      const totalPages = Math.max(Math.ceil(total / limit), 1);

      return res.status(200).json({
        success: true,
        data: rows,
        total,
        page,
        limit,
        totalPages,
      });
    } catch (error) {
      return sendServerError(res, error);
    }
  },

  /* ============================================================
     INCOMING QUEUE
     ============================================================ */
  listIncomingSTSs: async (req, res) => {
    try {
      const me = await getFreshUser(req);
      if (!me) return res.status(401).json({ success: false, message: 'User not found.' });

      let warehouseId = me.warehouse_assigned;
      if ((isSuperAdmin(me) || isAdmin(me)) && req.query.to_warehouse_id) {
        warehouseId = Number(req.query.to_warehouse_id);
      }
      if (!warehouseId) {
        return res.status(400).json({ success: false, message: 'You are not assigned to any warehouse.' });
      }

      const result = await StockTransferModel.listIncoming({
        to_warehouse_id: warehouseId,
        status: req.query.status,
        search: req.query.search,
        page:   req.query.page,
        limit:  req.query.limit,
      });

      const rows       = result?.rows || [];
      const total      = Number(result?.total) || 0;
      const page       = Number(result?.page)  || 1;
      const limit      = Number(result?.limit) || 50;
      const totalPages = Math.max(Math.ceil(total / limit), 1);

      return res.status(200).json({
        success: true,
        data: rows,
        total,
        page,
        limit,
        totalPages,
      });
    } catch (error) {
      return sendServerError(res, error);
    }
  },

  getIncomingSummary: async (req, res) => {
    try {
      const me = await getFreshUser(req);
      if (!me) return res.status(401).json({ success: false, message: 'User not found.' });

      let warehouseId = me.warehouse_assigned;
      if ((isSuperAdmin(me) || isAdmin(me)) && req.query.to_warehouse_id) {
        warehouseId = Number(req.query.to_warehouse_id);
      }

      const counts = await StockTransferModel.getIncomingCounts({ to_warehouse_id: warehouseId });
      return res.status(200).json({ success: true, data: counts });
    } catch (error) {
      return sendServerError(res, error);
    }
  },

  /* ============================================================
     SUMMARY — dashboard counters
     ============================================================ */
  getSummary: async (req, res) => {
    try {
      const me = await getFreshUser(req);
      if (!me) return res.status(401).json({ success: false, message: 'User not found.' });

      const summary = await StockTransferModel.getSummaryCounts({});
      const mine    = await StockTransferModel.getSummaryCounts({ submitted_by: me.username });
      const pendingForMe = isApprover(me) || isSuperAdmin(me)
        ? (await StockTransferModel.getSummaryCounts({})).pending
        : 0;

      const handlerActions = await StockTransferModel.getHandlerActionCounts({
        warehouse_id: me.warehouse_assigned,
        submitted_by: me.username,
      });

      return res.status(200).json({
        success: true,
        data: {
          global: {
            ...summary,
            forShipping: Number(summary.for_shipping) || 0,
          },
          mine: {
            ...mine,
            forShipping: Number(mine.for_shipping) || 0,
          },
          pendingForMe,
          handlerActions: {
            forShipping: Number(handlerActions.for_shipping)     || 0,
            inTransit:   Number(handlerActions.in_transit_to_me) || 0,
            rejections:  Number(handlerActions.rejections)       || 0,
            total:       Number(handlerActions.total)            || 0,
          },
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
      if (!detail) return res.status(404).json({ success: false, message: 'Stock Transfer Slip not found.' });
      return res.status(200).json({ success: true, data: detail });
    } catch (error) {
      return sendServerError(res, error);
    }
  },

  /* ============================================================
     STS ACTIVITY
     GET /api/stock-transfer/:id/activity
     ============================================================ */
  getSTSActivity: async (req, res) => {
    try {
      const { id } = req.params;
      const me = await getFreshUser(req);
      if (!me) return res.status(401).json({ success: false, message: 'User not found.' });

      const stsId = Number(id);
      if (!Number.isFinite(stsId) || stsId <= 0) {
        return res.status(400).json({ success: false, message: 'Invalid STS id.' });
      }

      const detail = await StockTransferModel.getSTSById(stsId);
      if (!detail) {
        return res.status(404).json({ success: false, message: 'Stock Transfer Slip not found.' });
      }

      const globalUser = isSuperAdmin(me) || isAdmin(me);
      if (!globalUser) {
        const isFrom = Number(detail.from_warehouse_id) === Number(me.warehouse_assigned);
        const isTo   = Number(detail.to_warehouse_id)   === Number(me.warehouse_assigned);
        const isSubmitter = detail.submitted_by && me.username &&
                            detail.submitted_by === me.username;
        if (!isFrom && !isTo && !isSubmitter) {
          return res.status(403).json({
            success: false,
            message: 'You do not have access to this slip\'s activity.',
          });
        }
      }

      const rows = await StockTransferActivityLogModel.listForSts({ sts_id: stsId });
      return res.status(200).json({ success: true, data: rows, total: rows.length });
    } catch (error) {
      return sendServerError(res, error);
    }
  },

  /* ============================================================
     WAREHOUSE ACTIVITY FEED
     GET /api/stock-transfer/activity-feed
     ============================================================ */
  getWarehouseActivityFeed: async (req, res) => {
    try {
      const warehouseCode = req.query.warehouse_code && String(req.query.warehouse_code).trim()
        ? String(req.query.warehouse_code).trim()
        : null;

      if (!warehouseCode) {
        return res.status(400).json({
          success: false,
          message: 'warehouse_code is required for the activity feed.',
        });
      }

      const result = await StockTransferActivityLogModel.listForWarehouse({
        warehouse_code: warehouseCode,
        side:       req.query.side || 'both',
        stage:      req.query.stage || null,
        q:          req.query.q     || null,
        start_date: req.query.start_date || null,
        end_date:   req.query.end_date   || null,
        page:       req.query.page,
        limit:      req.query.limit || 200,
      });

      return res.status(200).json({
        success: true,
        warehouse_code: warehouseCode,
        data:       result.rows,
        total:      result.total,
        page:       result.page,
        limit:      result.limit,
        totalPages: result.totalPages,
      });
    } catch (err) {
      console.error('❌ getWarehouseActivityFeed (STS):', err);
      const status = /warehouse_code is required/i.test(err.message) ? 400 : 500;
      return res.status(status).json({
        success: false,
        message: err.message || 'Failed to load STS activity feed.',
      });
    }
  },

  getTransferredQty: async (req, res) => {
    try {
      const { po_no } = req.query;
      if (!po_no) return res.status(400).json({ success: false, message: 'po_no query parameter is required.' });
      const map = await StockTransferModel.getTransferredQtyForPO(po_no);
      return res.status(200).json({ success: true, data: map });
    } catch (error) {
      return sendServerError(res, error);
    }
  },

  /* ============================================================
     APPROVE — accepts per-line approved_qty from the DH.
     ============================================================ */
  approveSTS: async (req, res) => {
    try {
      const { id } = req.params;
      const me = await getFreshUser(req);
      if (!me) return res.status(401).json({ success: false, message: 'User not found.' });

      if (!isApprover(me) && !isSuperAdmin(me)) {
        return res.status(403).json({ success: false, message: 'Only Department Heads or authorized backup approvers can approve transfers.' });
      }

      const approvedLines = Array.isArray(req.body?.approved_lines)
        ? req.body.approved_lines
        : [];

      let affected;
      try {
        affected = await StockTransferModel.approveSTS(id, me.username, {
          approved_lines: approvedLines,
          actor_role:     getActorRole(me),
        });
      } catch (err) {
        if (err && /Insufficient available stock/.test(err.message)) {
          return res.status(400).json({ success: false, message: err.message });
        }
        if (err && err.code === 'ALL_LINES_ZEROED') {
          return res.status(200).json({
            success: true,
            message: err.message,
            data: { sts_id: Number(id), all_zeroed: true, status: 'Rejected' },
          });
        }
        throw err;
      }

      if (affected === 0) {
        return res.status(400).json({
          success: false,
          message: 'Cannot approve: the slip is not in Pending status (or does not exist).',
        });
      }

      const detail = await StockTransferModel.getSTSDetail(id);
      const assignedNo = detail?.sts_no || null;

      await logTransferEventPerItem(id, 'TransferApproved', me.username, (d, line) =>
        `${refOf(d)} approved · ${line.item_code} · ` +
        `req ${line.requested_qty ?? line.qty}, approved ${line.approved_qty ?? line.qty}`,
        getActorRole(me)
      );

      // Session 13 (I3) — fire-and-forget approval email to requester
      // + all Stock Handlers in the source warehouse.
      (async () => {
        try {
          if (!detail) return;

          const recipients = [];

          // 1. The requester (submitted_by)
          if (detail.submitted_by) {
            const requesterUser = await UserModel.getUserByUsername(detail.submitted_by);
            if (requesterUser && requesterUser.email && requesterUser.status === 'Active') {
              recipients.push(requesterUser);
            }
          }

          // 2. All active handlers in the source warehouse
          if (detail.from_warehouse_id) {
            const handlers = await UserModel.getHandlersByWarehouseId(detail.from_warehouse_id);
            for (const h of handlers) {
              // avoid dup if requester is also a handler in that wh
              if (!recipients.some((r) => r.id === h.id)) recipients.push(h);
            }
          }

          if (recipients.length === 0) {
            console.warn('📧 Approval notification skipped — no eligible recipients.');
            return;
          }

          await emailService.notifyOfSTSApproval({
            recipients,
            stsId:             Number(id),
            stsNo:             detail.sts_no || null,
            requester:         detail.submitted_by || '—',
            approvedBy:        me.username,
            approvedAt:        new Date(),
            items:             buildEmailItems(detail),
            fromWarehouseCode: detail.from_warehouse_code || '—',
            toWarehouseCode:   detail.to_warehouse_code   || '—',
          });
        } catch (err) {
          console.error('📧 Approval notification failed (non-fatal):', err.message || err);
        }
      })();

      return res.status(200).json({
        success: true,
        message: assignedNo
          ? `Transfer ${assignedNo} approved and is now For Shipping.`
          : 'Transfer approved and is now For Shipping.',
        data: { sts_id: Number(id), sts_no: assignedNo },
      });
    } catch (error) {
      return sendServerError(res, error);
    }
  },

  /* ============================================================
     SHIP
     ============================================================ */
  shipSTS: async (req, res) => {
    try {
      const { id } = req.params;
      const { remarks, source_locator_code } = req.body || {};
      const me = await getFreshUser(req);
      if (!me) return res.status(401).json({ success: false, message: 'User not found.' });

      const detail = await StockTransferModel.getSTSById(id);
      if (!detail) return res.status(404).json({ success: false, message: 'Stock Transfer Slip not found.' });

      const globalUser = isSuperAdmin(me) || isAdmin(me);
      if (!globalUser && Number(detail.from_warehouse_id) !== Number(me.warehouse_assigned)) {
        return res.status(403).json({
          success: false,
          message: 'You can only ship transfers originating from your assigned warehouse.',
        });
      }

      let affected;
      try {
        affected = await StockTransferModel.shipSTS(
          id,
          me.username,
          remarks ? String(remarks).trim() : null,
          source_locator_code ? String(source_locator_code).trim() : null,
          getActorRole(me)
        );
      } catch (err) {
        if (
          err &&
          /Source locator|DAMAGE locator|Source warehouse could not be resolved|Insufficient stock/.test(
            err.message
          )
        ) {
          return res.status(400).json({ success: false, message: err.message });
        }
        throw err;
      }

      if (affected === 0) {
        return res.status(400).json({
          success: false,
          message: 'Cannot ship: the slip is not in For Shipping status.',
        });
      }

      await logTransferEventPerItem(id, 'TransferInTransit', me.username, (d, line) =>
        `${refOf(d)} shipped · ${line.item_code} · ` +
        `WH ${d.from_warehouse_code || d.from_warehouse_id} → WH ${d.to_warehouse_code || d.to_warehouse_id}`,
        getActorRole(me)
      );

      // Session 13 (I3) — fire-and-forget to the requester.
      (async () => {
        try {
          const fullDetail = await StockTransferModel.getSTSDetail(id);
          if (!fullDetail) return;

          const requesterUser = fullDetail.submitted_by
            ? await UserModel.getUserByUsername(fullDetail.submitted_by)
            : null;
          if (!requesterUser || !requesterUser.email || requesterUser.status !== 'Active') {
            console.warn('📧 Transfer notification skipped — requester has no email.');
            return;
          }

          await emailService.notifyRequesterOfSTSTransfer({
            recipients:        [requesterUser],
            stsId:             Number(id),
            stsNo:             fullDetail.sts_no || null,
            requester:         fullDetail.submitted_by || '—',
            shippedBy:         me.username,
            shippedAt:         new Date(),
            sourceLocatorCode: fullDetail.source_locator_code || null,
            items:             buildEmailItems(fullDetail),
            fromWarehouseCode: fullDetail.from_warehouse_code || '—',
            toWarehouseCode:   fullDetail.to_warehouse_code   || '—',
          });
        } catch (err) {
          console.error('📧 Transfer notification failed (non-fatal):', err.message || err);
        }
      })();

      return res.status(200).json({
        success: true,
        message: 'Transfer marked as In-Transit.',
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
      if (!me) return res.status(401).json({ success: false, message: 'User not found.' });

      if (!isApprover(me) && !isSuperAdmin(me)) {
        return res.status(403).json({ success: false, message: 'Only Department Heads or authorized backup approvers can reject transfers.' });
      }
      if (!reason || !String(reason).trim()) {
        return res.status(400).json({ success: false, message: 'A rejection reason is required.' });
      }

      const trimmedReason = String(reason).trim();

      // Fetch full detail BEFORE mutating so we have the requester + items.
      const detailBefore = await StockTransferModel.getSTSDetail(id);
      if (!detailBefore) {
        return res.status(404).json({ success: false, message: 'Stock Transfer Slip not found.' });
      }

      const affected = await StockTransferModel.rejectSTS(id, me.username, trimmedReason, getActorRole(me));
      if (affected === 0) {
        return res.status(400).json({ success: false, message: 'Cannot reject: the slip is not in Pending status (or does not exist).' });
      }

      await logTransferEventPerItem(id, 'TransferRejected', me.username, (d, line) =>
        `${refOf(d)} rejected · ${line.item_code} — ${trimmedReason}`,
        getActorRole(me)
      );

      // Session 13 (I3) — fire-and-forget rejection email to the requester.
      (async () => {
        try {
          const requesterUser = detailBefore.submitted_by
            ? await UserModel.getUserByUsername(detailBefore.submitted_by)
            : null;
          if (!requesterUser || !requesterUser.email || requesterUser.status !== 'Active') {
            console.warn('📧 Rejection notification skipped — requester has no email.');
            return;
          }

          await emailService.notifyRequesterOfSTSRejection({
            recipients:        [requesterUser],
            stsId:             Number(id),
            stsNo:             detailBefore.sts_no || null,
            requester:         detailBefore.submitted_by || '—',
            rejectedBy:        me.username,
            rejectedAt:        new Date(),
            rejectionReason:   trimmedReason,
            items:             buildEmailItems(detailBefore),
            fromWarehouseCode: detailBefore.from_warehouse_code || '—',
            toWarehouseCode:   detailBefore.to_warehouse_code   || '—',
          });
        } catch (err) {
          console.error('📧 Rejection notification failed (non-fatal):', err.message || err);
        }
      })();

      return res.status(200).json({ success: true, message: 'Transfer rejected.' });
    } catch (error) {
      return sendServerError(res, error);
    }
  },

  acknowledgeRejection: async (req, res) => {
    try {
      const { id } = req.params;
      const me = await getFreshUser(req);
      if (!me) return res.status(401).json({ success: false, message: 'User not found.' });

      const affected = await StockTransferModel.acknowledgeRejection(id, me.username);

      return res.status(200).json({
        success: true,
        message: affected > 0
          ? 'Rejection acknowledged.'
          : 'Nothing to acknowledge (already acknowledged or not applicable).',
        data: { acknowledged: affected > 0 },
      });
    } catch (error) {
      return sendServerError(res, error);
    }
  },

  cancelSTS: async (req, res) => {
    try {
      const { id } = req.params;
      const me = await getFreshUser(req);
      if (!me) return res.status(401).json({ success: false, message: 'User not found.' });

      const affected = await StockTransferModel.cancelSTS(id, me.username, getActorRole(me));
      if (affected === 0) {
        return res.status(400).json({
          success: false,
          message: 'Cannot cancel: either you are not the submitter, or the slip is not Pending.',
        });
      }

      await logTransferEventPerItem(id, 'TransferCancelled', me.username, (detail, line) =>
        `${refOf(detail)} cancelled · ${line.item_code}`,
        getActorRole(me)
      );

      return res.status(200).json({ success: true, message: 'Transfer cancelled.' });
    } catch (error) {
      return sendServerError(res, error);
    }
  },

  /* ============================================================
     RECEIVE
     ============================================================ */
  receiveSTS: async (req, res) => {
    try {
      const { id } = req.params;
      const { remarks, lines = [] } = req.body || {};
      const me = await getFreshUser(req);
      if (!me) return res.status(401).json({ success: false, message: 'User not found.' });

      const detail = await StockTransferModel.getSTSById(id);
      if (!detail) return res.status(404).json({ success: false, message: 'Stock Transfer Slip not found.' });

      const globalUser = isSuperAdmin(me);
      if (!globalUser && Number(detail.to_warehouse_id) !== Number(me.warehouse_assigned)) {
        return res.status(403).json({
          success: false,
          message: 'You can only receive transfers addressed to your assigned warehouse.',
        });
      }

      if (!Array.isArray(lines) || lines.length === 0) {
        return res.status(400).json({ success: false, message: 'Per-line received/damaged quantities are required.' });
      }

      const affected = await StockTransferModel.receiveSTSWithLines(
        id, me.username, remarks ? String(remarks).trim() : null, lines, getActorRole(me)
      );

      if (affected === 0) {
        return res.status(400).json({
          success: false,
          message: 'Cannot receive: the slip is not in In-Transit status.',
        });
      }

      await logTransferEventPerItem(id, 'TransferReceived', me.username, (d, line) => {
        const totalReceived = Number(line.received_qty) || 0;
        const dmg           = Number(line.damaged_qty)  || 0;
        const good          = totalReceived - dmg;
        return `${refOf(d)} received · ${line.item_code} · ${good} good · ${dmg} damaged`;
      }, getActorRole(me));

      // Session 13 (I3) — fire-and-forget receipt email to all DHs
      // + the specific issuer (shipped_by).
      (async () => {
        try {
          const fullDetail = await StockTransferModel.getSTSDetail(id);
          if (!fullDetail) return;

          const recipients = [];

          // 1. All active Department Heads
          const dhList = await UserModel.getDepartmentHeads();
          for (const dh of dhList) {
            if (!recipients.some((r) => r.id === dh.id)) recipients.push(dh);
          }

          // 2. The specific issuer (the user who shipped it)
          if (fullDetail.shipped_by) {
            const issuer = await UserModel.getUserByUsername(fullDetail.shipped_by);
            if (issuer && issuer.email && issuer.status === 'Active') {
              if (!recipients.some((r) => r.id === issuer.id)) recipients.push(issuer);
            }
          }

          if (recipients.length === 0) {
            console.warn('📧 Receipt notification skipped — no eligible recipients.');
            return;
          }

          await emailService.notifyOfSTSReceipt({
            recipients,
            stsId:             Number(id),
            stsNo:             fullDetail.sts_no || null,
            requester:         fullDetail.submitted_by || '—',
            receivedBy:        me.username,
            receivedAt:        new Date(),
            receiveRemarks:    remarks ? String(remarks).trim() : null,
            items:             buildEmailItems(fullDetail),
            fromWarehouseCode: fullDetail.from_warehouse_code || '—',
            toWarehouseCode:   fullDetail.to_warehouse_code   || '—',
          });
        } catch (err) {
          console.error('📧 Receipt notification failed (non-fatal):', err.message || err);
        }
      })();

      const msg = detail.request_origin === 'Requested'
        ? 'Requested transfer received. Good units were stored into the designated locator.'
        : 'Stock Transfer Slip received.';

      return res.status(200).json({ success: true, message: msg });
    } catch (error) {
      if (error && /cannot exceed|required when damaged|not found on STS|target locator|In-Transit status/.test(error.message)) {
        return res.status(400).json({ success: false, message: error.message });
      }
      return sendServerError(res, error);
    }
  },

  completeSTS: async (req, res) => {
    try {
      const { id } = req.params;
      const me = await getFreshUser(req);
      if (!me) return res.status(401).json({ success: false, message: 'User not found.' });

      const affected = await StockTransferModel.completeSTS(id, me.username, getActorRole(me));
      if (affected === 0) {
        return res.status(400).json({
          success: false,
          message: 'Cannot complete: the slip is not in In-Transit/Received status.',
        });
      }

      await logTransferEventPerItem(id, 'TransferCompleted', me.username, (detail, line) =>
        `${refOf(detail)} completed · ${line.item_code}`,
        getActorRole(me)
      );

      return res.status(200).json({ success: true, message: 'Transfer marked as Completed.' });
    } catch (error) {
      return sendServerError(res, error);
    }
  },

  /* ============================================================
     STORED-TRANSFER ENDPOINTS

     RED-FLAG FIX — listReceivedForStore:
       Before: the model returns { rows, total, page, limit } but
               the controller did `const rows = await ...` (assigning
               the wrapper object to `rows`), then returned
               `{ data: rows, total: rows.length }`.
               That meant:
                 • data  was the wrapper object, not the array
                 • total was `undefined` (objects have no .length)
                 • the real `total` from the model was thrown away
                 • any caller doing `data.map(...)` threw a TypeError
               The response was therefore unusable for pagination
               AND broke the array contract for the UI.

       After:  we destructure the model result properly, pass
               `page` + `limit` through (defaults preserved), and
               return the standard pagination contract
               { data, total, page, limit, totalPages }.
     ============================================================ */
  listReceivedForStore: async (req, res) => {
    try {
      const me = await getFreshUser(req);
      if (!me) return res.status(401).json({ success: false, message: 'User not found.' });

      let warehouseId = me.warehouse_assigned;
      if ((isSuperAdmin(me) || isAdmin(me)) && req.query.warehouse_id) {
        warehouseId = Number(req.query.warehouse_id);
      }
      if (!warehouseId) {
        return res.status(400).json({
          success: false,
          message: 'You are not assigned to any warehouse.',
        });
      }

      const page  = Math.max(1, parseInt(req.query.page,  10) || 1);
      const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 50));

      const result = await StockTransferModel.listReceivedForStore({
        to_warehouse_id: warehouseId,
        search:          req.query.search,
        page,
        limit,
      });

      const rows       = result?.rows  || [];
      const total      = Number(result?.total) || 0;
      const safePage   = Number(result?.page)  || page;
      const safeLimit  = Number(result?.limit) || limit;
      const totalPages = Math.max(1, Math.ceil(total / safeLimit));

      return res.status(200).json({
        success: true,
        data: rows,
        total,
        page: safePage,
        limit: safeLimit,
        totalPages,
      });
    } catch (error) {
      return sendServerError(res, error);
    }
  },

  storeTransferLine: async (req, res) => {
    try {
      const { sts_line_id } = req.params;
      const { qty_to_store, locator_code, remarks } = req.body || {};
      const me = await getFreshUser(req);
      if (!me) return res.status(401).json({ success: false, message: 'User not found.' });

      if (!sts_line_id) {
        return res.status(400).json({ success: false, message: 'sts_line_id is required.' });
      }
      if (!locator_code || !String(locator_code).trim()) {
        return res.status(400).json({ success: false, message: 'locator_code is required.' });
      }

      const peek = await StockTransferModel.getLineForAuthorization(sts_line_id);
      if (!peek) {
        return res.status(404).json({ success: false, message: 'STS line not found.' });
      }

      const globalUser = isSuperAdmin(me);
      if (!globalUser && Number(peek.to_warehouse_id) !== Number(me.warehouse_assigned)) {
        return res.status(403).json({
          success: false,
          message: 'You can only store transfers received at your assigned warehouse.',
        });
      }

      const result = await StockTransferModel.storeTransferLine(sts_line_id, {
        qty_to_store,
        locator_code,
        remarks,
        actor: me.username,
        actor_role: getActorRole(me),
      });

      return res.status(200).json({
        success: true,
        message: `Stored ${result.qty_stored} of ${result.item_code} into locator ${result.locator_code}.`,
        data: result,
      });
    } catch (error) {
      if (error && /must be greater|Cannot store|required|not found|Nothing left|Locator/.test(error.message)) {
        return res.status(400).json({ success: false, message: error.message });
      }
      return sendServerError(res, error);
    }
  },
};

module.exports = stockTransferController;