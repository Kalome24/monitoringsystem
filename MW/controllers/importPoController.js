// controllers/importPoController.js
const ImportPoModel = require('../models/importPoModel');
const PoActivityLogModel = require('../models/poActivityLogModel');

const importPurchaseOrders = async (req, res) => {
  try {
    const { source_file = null, rows = [] } = req.body;

    const warehouseId =
      req.body?.warehouse_id != null && req.body.warehouse_id !== ''
        ? Number(req.body.warehouse_id)
        : null;

    const user = req.user || {};

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ success: false, message: 'No rows provided.' });
    }

    const errors = [];

    const clean = [];
    rows.forEach((r, i) => {
      const excelRow = i + 2;
      const po_no     = String(r.po_no || '').trim();
      const item_code = String(r.item_code || '').trim();
      const qty       = Number(r.qty);

      if (!po_no)                              return errors.push({ row: excelRow, message: 'Missing PO NO.' });
      if (!item_code)                          return errors.push({ row: excelRow, message: 'Missing ITEM CODE' });
      if (!Number.isFinite(qty) || qty <= 0)   return errors.push({ row: excelRow, message: 'QTY. must be greater than 0' });
      if (!r.po_date || isNaN(Date.parse(r.po_date)))
                                               return errors.push({ row: excelRow, message: 'Invalid PO DATE' });

      clean.push({
        excelRow,
        po_date:     r.po_date,
        pr_no:       String(r.pr_no || '').trim(),
        po_no,
        vendor_name: String(r.vendor_name || '').trim(),
        item_code,
        qty,
        unit_price:  Number(r.unit_price) || 0,
        currency:    String(r.currency || 'PHP').toUpperCase().slice(0, 3),
        buyer:       String(r.buyer || '').trim(),
      });
    });

    if (clean.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid rows to import.',
        summary: { po_count: 0, lines_in: rows.length, inserted: 0, skipped: 0, errors: errors.length },
        errors,
      });
    }

    const fileCounts = new Map();
    for (const c of clean) {
      const key = `${c.po_no}|||${c.item_code}`;
      fileCounts.set(key, (fileCounts.get(key) || 0) + 1);
    }
    const fileDups = [];
    for (const [key, count] of fileCounts.entries()) {
      if (count > 1) {
        const [po_no, item_code] = key.split('|||');
        fileDups.push({ po_no, item_code, count });
      }
    }
    if (fileDups.length > 0) {
      return res.status(409).json({
        success: false,
        code: 'DUPLICATE_LINES_IN_FILE',
        message: `${fileDups.length} line${fileDups.length === 1 ? '' : 's'} appear more than once in the file.`,
        duplicates: fileDups,
      });
    }

    const codes = clean.map(c => c.item_code);
    const masterMap = await ImportPoModel.lookupItemMasters(codes);

    const invalidCodes = [
      ...new Set(
        clean
          .map(c => c.item_code)
          .filter(code => !masterMap.has(code))
      ),
    ];

    if (invalidCodes.length > 0) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_ITEM_CODES',
        message: 'Invalid item code. Please check your item codes.',
        invalid_item_codes: invalidCodes,
      });
    }

    const prepared = clean.map(c => ({ ...c, ...masterMap.get(c.item_code) }));

    const existingKeys = await ImportPoModel.findExistingKeys(prepared.map(p => p.po_no));

    const dbCollisions = prepared.filter(p =>
      existingKeys.has(`${p.po_no}|||${p.item_code}`)
    );

    if (dbCollisions.length > 0) {
      return res.status(409).json({
        success: false,
        code: 'DUPLICATE_LINES',
        message: `${dbCollisions.length} line${dbCollisions.length === 1 ? '' : 's'} already exist in the system.`,
        duplicates: dbCollisions.map((c) => ({
          po_no:      c.po_no,
          item_code:  c.item_code,
          excel_row:  c.excelRow,
        })),
      });
    }

    let inserted = 0;
    const importTs = new Date();

    for (const p of prepared) {
      const data = {
        po_date:         p.po_date,
        pr_no:           p.pr_no,
        po_no:           p.po_no,
        vendor_name:     p.vendor_name,
        item_code:       p.item_code,
        qty:             p.qty,
        unit_price:      p.unit_price,
        currency:        p.currency,
        buyer:           p.buyer,
        uom:             p.uom,
        uom_description: p.uom_description,
        item_name:       p.item_name,
        barcode:         p.barcode,
        gl_class_code:   p.gl_class_code,
        gl_description:  p.gl_description,
        purchase_class:  p.purchase_class,
        category:        p.category,
        warehouse_id:    warehouseId,
        source_file,
        imported_by:     user.username || 'System',
        imported_at:     importTs,
      };

      try {
        await ImportPoModel.insertLine(data);
        inserted++;
      } catch (err) {
        const isDup = err.number === 2627 || err.number === 2601;
        if (isDup) {
          return res.status(409).json({
            success: false,
            code: 'DUPLICATE_LINES',
            message: `A line already exists: PO ${p.po_no} / Item ${p.item_code}`,
            duplicates: [{
              po_no:     p.po_no,
              item_code: p.item_code,
              excel_row: p.excelRow,
            }],
          });
        }

        const isFk =
          err.number === 547 ||
          (typeof err.message === 'string' && err.message.includes('FOREIGN KEY'));

        if (isFk) {
          return res.status(400).json({
            success: false,
            code: 'INVALID_ITEM_CODES',
            message: 'Invalid item code. Please check your item codes.',
            invalid_item_codes: [p.item_code],
          });
        }

        errors.push({
          row: p.excelRow,
          message: err.message,
          po_no: p.po_no,
          item_code: p.item_code,
        });
      }
    }

    const distinctPOsArr = [...new Set(prepared.map(p => p.po_no))];
    for (const poNo of distinctPOsArr) {
      const poLines = prepared.filter(x => x.po_no === poNo);
      const totalQty = poLines.reduce((s, x) => s + (Number(x.qty) || 0), 0);
      await PoActivityLogModel.log({
        po_no: poNo,
        event_type: 'Imported',
        event_summary:
          `Imported ${poLines.length} line${poLines.length === 1 ? '' : 's'} · ` +
          `total qty ${totalQty}`,
        event_detail: source_file ? `Source file: ${source_file}` : null,
        actor: user.username || 'System',
      });
    }

    return res.status(200).json({
      success: true,
      message: `Import complete.`,
      summary: {
        po_count:  distinctPOsArr.length,
        lines_in:  rows.length,
        inserted,
        skipped:   0,
        errors:    errors.length,
      },
      errors,
    });
  } catch (error) {
    console.error('Error importing POs:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
    });
  }
};

const checkDuplicatePOs = async (req, res) => {
  try {
    const { po_nos = [], item_codes = [] } = req.body;

    if (!Array.isArray(po_nos) || po_nos.length === 0) {
      return res.status(400).json({ success: false, message: 'No PO numbers provided.' });
    }

    const existing = await ImportPoModel.findExistingPOs(po_nos);

    let invalid_item_codes = [];
    if (Array.isArray(item_codes) && item_codes.length > 0) {
      const masterMap = await ImportPoModel.lookupItemMasters(item_codes);
      invalid_item_codes = [
        ...new Set(
          item_codes
            .map(c => String(c).trim())
            .filter(Boolean)
            .filter(code => !masterMap.has(code))
        ),
      ];
    }

    return res.status(200).json({
      success: true,
      existing,
      invalid_item_codes,
    });
  } catch (error) {
    console.error('Error checking preflight:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
    });
  }
};

const listPurchaseOrders = async (req, res) => {
  try {
    const warehouseId =
      req.query.warehouse_id != null && req.query.warehouse_id !== ''
        ? req.query.warehouse_id
        : null;

    const viewerWarehouseId =
      req.warehouseId ?? req.user?.warehouse_assigned ?? null;

    const page  = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 50));

    const { rows, total } = await ImportPoModel.listPOs({
      warehouse_id:        warehouseId,
      viewer_warehouse_id: viewerWarehouseId,
      status:              req.query.status,
      search:              req.query.search,
      start_date:          req.query.start_date,
      end_date:            req.query.end_date,
      page,
      limit,
    });

    return res.status(200).json({
      success: true,
      data: rows,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (error) {
    console.error('Error listing POs:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
    });
  }
};

/**
 * NEW: Handler view — one row per item for the caller's warehouse.
 */
const listHandlerItems = async (req, res) => {
  try {
    const viewerWarehouseId =
      req.warehouseId ?? req.user?.warehouse_assigned ?? null;

    const warehouseId =
      req.query.warehouse_id != null && req.query.warehouse_id !== ''
        ? Number(req.query.warehouse_id)
        : viewerWarehouseId;

    if (!warehouseId) {
      return res.status(400).json({
        success: false,
        message: 'A warehouse is required.',
      });
    }

    const rows = await ImportPoModel.listHandlerItems({
      warehouse_id: warehouseId,
      status:       req.query.status,
      search:       req.query.search,
      start_date:   req.query.start_date,
      end_date:     req.query.end_date,
      limit:        req.query.limit,
    });

    return res.status(200).json({
      success: true,
      data: rows,
      total: rows.length,
    });
  } catch (error) {
    console.error('Error listing handler items:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
    });
  }
};

const getPurchaseOrderDetail = async (req, res) => {
  try {
    const { po_no } = req.params;

    const warehouseId =
      req.query.warehouse_id != null && req.query.warehouse_id !== ''
        ? req.query.warehouse_id
        : null;

    const rows = await ImportPoModel.getPODetail(po_no, warehouseId);

    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Purchase Order not found.' });
    }

    return res.status(200).json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching PO detail:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
    });
  }
};

const getPOActivity = async (req, res) => {
  try {
    const { po_no } = req.params;
    if (!po_no) {
      return res.status(400).json({ success: false, message: 'po_no is required.' });
    }

    const rows = await PoActivityLogModel.listByPO(po_no);

    return res.status(200).json({
      success: true,
      data: rows,
      total: rows.length,
    });
  } catch (error) {
    console.error('Error fetching PO activity:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
    });
  }
};

const receivePurchaseOrder = async (req, res) => {
  try {
    const { po_no } = req.params;
    const { items = [] } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'No items to receive.' });
    }

    const receivingWarehouseId =
      req.warehouseId ?? req.user?.warehouse_assigned ?? null;

    const ALLOWED_CURRENCIES = ['PHP', 'USD', 'AUD', 'JPY'];

    for (const it of items) {
      const id = Number(it.id);
      if (!Number.isFinite(id)) continue;

      const currency = it.currency && ALLOWED_CURRENCIES.includes(String(it.currency).toUpperCase())
        ? String(it.currency).toUpperCase()
        : null;

      await ImportPoModel.receiveLine({
        id,
        incoming_good: Number(it.received_qty) || 0,
        incoming_dmg:  Number(it.damaged_qty)  || 0,
        damage_reason: it.damage_reason || null,
        unit_price:    it.unit_price,
        currency,
        receiving_warehouse_id: receivingWarehouseId,
      });
    }

    await ImportPoModel.recomputePOStatus(po_no);

    const totalGood = items.reduce((s, it) => s + (Number(it.received_qty) || 0), 0);
    const totalDmg  = items.reduce((s, it) => s + (Number(it.damaged_qty)  || 0), 0);
    await PoActivityLogModel.log({
      po_no,
      event_type: 'Received',
      event_summary:
        `Received ${items.length} line${items.length === 1 ? '' : 's'} · ` +
        `${totalGood} good · ${totalDmg} damaged`,
      actor: req.user?.username || 'System',
    });

    return res.status(200).json({ success: true, message: 'Receipt saved.' });
  } catch (error) {
    console.error('Error receiving PO:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
    });
  }
};

const forwardPurchaseOrder = async (req, res) => {
  try {
    const { po_no } = req.params;
    const user = req.user || {};

    const targetWarehouseId =
      req.warehouseId ??
      (req.body?.warehouse_id != null && req.body.warehouse_id !== ''
        ? Number(req.body.warehouse_id)
        : null);

    if (!targetWarehouseId) {
      return res.status(400).json({
        success: false,
        message:
          'A warehouse must be specified. Admins must pass warehouse_id in the request body; other roles need an assigned warehouse.',
      });
    }

    const allRows = await ImportPoModel.getPODetail(po_no);
    if (!allRows.length) {
      return res.status(404).json({ success: false, message: 'Purchase Order not found.' });
    }

    const forwardable = await ImportPoModel.countForwardableLines(po_no, targetWarehouseId);

    if (forwardable === 0) {
      const mine = allRows.filter(
        (r) => Number(r.warehouse_id) === Number(targetWarehouseId)
      );

      if (mine.length === 0) {
        return res.status(403).json({
          success: false,
          message:
            'Your warehouse has not received any lines of this PO. Only the warehouse that received the items can send them to the handler.',
        });
      }

      const alreadyForwarded = mine.every((r) =>
        ['With Handler', 'Partial With Handler', 'Pending Transfer', 'Transferred', 'Stored'].includes(r.status)
      );
      if (alreadyForwarded) {
        return res.status(400).json({
          success: false,
          message: 'Your warehouse has already sent this PO to the handler.',
        });
      }

      return res.status(400).json({
        success: false,
        message: 'Nothing to forward yet. Receive items for this PO first.',
      });
    }

    const affected = await ImportPoModel.forwardPOToHandler(
      po_no,
      user.username || 'System',
      targetWarehouseId
    );

    if (affected === 0) {
      return res.status(400).json({
        success: false,
        message: 'Nothing was forwarded. The lines may have already been sent.',
      });
    }

    const refreshed = await ImportPoModel.getPODetail(po_no, targetWarehouseId);
    const newStatus = refreshed[0]?.status || 'With Handler';

    await PoActivityLogModel.log({
      po_no,
      event_type: 'Forwarded',
      event_summary:
        `Sent to Stock Handler (${affected} line${affected === 1 ? '' : 's'}) · ` +
        `warehouse ${targetWarehouseId} · resulting status: ${newStatus}`,
      actor: user.username || 'System',
    });

    return res.status(200).json({
      success: true,
      message:
        newStatus === 'Partial With Handler'
          ? `PO "${po_no}" sent to Stock Handler (partial — ${affected} line${affected === 1 ? '' : 's'}).`
          : `PO "${po_no}" sent to Stock Handler (${affected} line${affected === 1 ? '' : 's'}).`,
      affected,
      status: newStatus,
    });
  } catch (error) {
    console.error('Error forwarding PO:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
    });
  }
};

const deletePurchaseOrder = async (req, res) => {
  try {
    const { po_no } = req.params;
    const deleted = await ImportPoModel.deletePOIfPending(po_no);

    if (deleted === 0) {
      return res.status(404).json({ success: false, message: 'Purchase Order not found.' });
    }

    return res.status(200).json({
      success: true,
      message: `Purchase Order "${po_no}" deleted (${deleted} line(s)).`,
    });
  } catch (error) {
    if (error.code === 'PO_HAS_RECEIPTS') {
      return res.status(409).json({ success: false, message: error.message });
    }
    console.error('Error deleting PO:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
    });
  }
};

module.exports = {
  importPurchaseOrders,
  checkDuplicatePOs,
  listPurchaseOrders,
  listHandlerItems,        // ← NEW
  getPurchaseOrderDetail,
  getPOActivity,
  receivePurchaseOrder,
  forwardPurchaseOrder,
  deletePurchaseOrder,
};