// controllers/importPoController.js
const ImportPoModel           = require('../models/importPoModel');
const PoActivityLogModel      = require('../models/poActivityLogModel');
const LockedItemsModel        = require('../models/lockedItemsModel');
const WarehouseInventoryModel = require('../models/warehouseInventoryModel');
const UserModel               = require('../models/userModel');
const emailService            = require('../services/emailService');
const { sql, pool, poolConnect, query } = require('../db');

/* ============================================================
   MULTI-CURRENCY HELPERS
   ============================================================ */
const MAX_FOREX_DECIMALS = 3;

const isPhpCurrency = (raw) => {
  const c = String(raw == null ? '' : raw).trim().toUpperCase();
  return c === '' || c === 'PHP';
};

const countDecimals = (raw) => {
  if (raw === null || raw === undefined) return 0;
  const s = String(raw).replace(/[₱$€£¥,\s]/g, '');
  if (s === '') return 0;
  if (/[eE]/.test(s)) return -1;
  const n = Number(s);
  if (!Number.isFinite(n)) return -1;
  const dot = s.indexOf('.');
  if (dot === -1) return 0;
  const decimals = s.slice(dot + 1).replace(/0+$/, '');
  return decimals.length;
};

const computeFuncAmount = (unitPrice, deliveredQty, forex) => {
  const up = Number(unitPrice);
  const q  = Number(deliveredQty);
  const fx = Number(forex);
  if (!Number.isFinite(up) || !Number.isFinite(q) || !Number.isFinite(fx)) return null;
  return Number((up * q * fx).toFixed(3));
};

/* ============================================================
   DELIVERY STATUS
   ============================================================ */
const normalizeDeliveryStatus = (raw) => {
  const s = String(raw == null ? '' : raw).trim().toLowerCase();
  if (!s) return null;

  if (
    s === 'complete' ||
    s === 'completed' ||
    s === 'full' ||
    s === 'full received' ||
    s === 'fully received'
  ) {
    return 'Complete';
  }
  if (
    s === 'partial' ||
    s === 'partial received' ||
    s === 'partial_received' ||
    s === 'partialreceived' ||
    s === 'partially received' ||
    s === 'incomplete'
  ) {
    return 'Partial Received';
  }
  return null;
};

/* ============================================================
   INVENTORY LOCATOR UPSERT (AUDIT-SAFE)
   ============================================================ */
const upsertInventoryLocator = async (transaction, { warehouse_code, item_code, locator_code, qty, unit_cost = 0 }) => {
  const getReq = new sql.Request(transaction);
  getReq.input('wh',  sql.NVarChar(20),  warehouse_code);
  getReq.input('item', sql.NVarChar(50), item_code);
  getReq.input('loc', sql.NVarChar(50),  locator_code);

  const getRes = await getReq.query(`
    SELECT qty, avg_unit_cost, total_value
      FROM inventory_locator
     WHERE warehouse_code = @wh
       AND item_code      = @item
       AND locator_code   = @loc
  `);

  const curQty = Number(getRes.recordset[0]?.qty)          || 0;
  const curTotalValue = Number(getRes.recordset[0]?.total_value) || 0;
  
  const incQty = Number(qty) || 0;
  const incAvg = Number(unit_cost) || 0;
  const incTotalValue = incQty * incAvg;
  
  const newQty = curQty + incQty;
  const newTotalValue = curTotalValue + incTotalValue;
  const newAvg = newQty > 0 ? newTotalValue / newQty : 0;

  if (getRes.recordset[0]) {
    const updReq = new sql.Request(transaction);
    updReq.input('wh',  sql.NVarChar(20),  warehouse_code);
    updReq.input('item', sql.NVarChar(50), item_code);
    updReq.input('loc', sql.NVarChar(50),  locator_code);
    updReq.input('q',   sql.Decimal(18,4), newQty);
    updReq.input('a',   sql.Decimal(18,6), newAvg);
    updReq.input('v',   sql.Decimal(18,4), newTotalValue);
    await updReq.query(`
      UPDATE inventory_locator
         SET qty           = @q,
             avg_unit_cost = @a,
             total_value   = @v,
             updated_at    = GETDATE()
       WHERE warehouse_code = @wh
         AND item_code      = @item
         AND locator_code   = @loc
    `);
  } else {
    const insReq = new sql.Request(transaction);
    insReq.input('wh',  sql.NVarChar(20),  warehouse_code);
    insReq.input('item', sql.NVarChar(50), item_code);
    insReq.input('loc', sql.NVarChar(50),  locator_code);
    insReq.input('q',   sql.Decimal(18,4), newQty);
    insReq.input('a',   sql.Decimal(18,6), newAvg);
    insReq.input('v',   sql.Decimal(18,4), newTotalValue);
    await insReq.query(`
      INSERT INTO inventory_locator
        (warehouse_code, item_code, locator_code, qty,
         avg_unit_cost, total_value, created_at, updated_at)
      VALUES
        (@wh, @item, @loc, @q, @a, @v, GETDATE(), GETDATE())
    `);
  }
};

/* ============================================================
   IMPORT PURCHASE ORDERS
   ============================================================ */
const importPurchaseOrders = async (req, res) => {
  try {
    const { source_file = null, rows = [] } = req.body;
    const user = req.user || {};

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ success: false, message: 'No rows provided.' });
    }

    const errors = [];
    const clean = [];

    rows.forEach((r, i) => {
      const excelRow       = i + 2;
      const raw_po_no      = String(r.po_no || '').trim();
      const pr_no          = String(r.pr_no || '').trim();
      const item_code      = String(r.item_code || '').trim();
      const qty            = Number(r.qty);
      const warehouse_code = String(r.warehouse_code || '').trim().toUpperCase();

      const hasPo = Boolean(raw_po_no);
      const po_no = hasPo ? raw_po_no : pr_no;

      if (!po_no) {
        return errors.push({
          row: excelRow,
          message: 'Missing PO NO. and PR NO. — at least one is required.',
        });
      }

      if (!item_code)                         return errors.push({ row: excelRow, message: 'Missing ITEM CODE.' });
      if (!Number.isFinite(qty) || qty <= 0)  return errors.push({ row: excelRow, message: 'QTY. must be greater than 0.' });
      if (!r.po_date || isNaN(Date.parse(r.po_date)))
                                              return errors.push({ row: excelRow, message: 'Invalid PO DATE.' });
      if (!warehouse_code)                    return errors.push({ row: excelRow, message: 'Missing WAREHOUSE CODE.' });

      const rawDelivered = r.delivered_qty;
      const deliveredBlank = rawDelivered == null || rawDelivered === '';
      const delivered_qty  = deliveredBlank ? qty : Number(rawDelivered);
      if (!Number.isFinite(delivered_qty) || delivered_qty < 0) {
        return errors.push({ row: excelRow, message: 'DELIVERED QTY must be a non-negative number.' });
      }

      const delivery_status = normalizeDeliveryStatus(r.delivery_status ?? r.status);
      if (!delivery_status) {
        return errors.push({
          row: excelRow,
          message:
            'STATUS is required and must be either "Complete" or "Partial Received".',
        });
      }

      const currencyRaw = String(r.currency || '').trim().toUpperCase();
      const currency    = (currencyRaw || 'PHP').slice(0, 3);

      let forex = 1;
      if (!isPhpCurrency(currency)) {
        const rawForex = r.forex;
        const decs = countDecimals(rawForex);
        if (decs === -1) {
          return errors.push({
            row: excelRow,
            message: `FOREX value "${rawForex}" is not a valid number.`,
          });
        }
        if (decs > MAX_FOREX_DECIMALS) {
          return errors.push({
            row: excelRow,
            message: `FOREX has ${decs} decimal places — only up to ${MAX_FOREX_DECIMALS} are allowed.`,
          });
        }
        const fx = Number(String(rawForex).replace(/[₱$€£¥,\s]/g, ''));
        if (!Number.isFinite(fx) || fx <= 0) {
          return errors.push({
            row: excelRow,
            message: `FOREX is required and must be greater than 0 when CURR is "${currency}".`,
          });
        }
        forex = fx;
      }

      const unit_price  = Number(r.unit_price) || 0;
      const func_amount = computeFuncAmount(unit_price, delivered_qty, forex);
      if (func_amount == null) {
        return errors.push({ row: excelRow, message: 'Could not compute FUNC AMOUNT — check UNIT PRICE / DELIVERED QTY / FOREX.' });
      }

      clean.push({
        excelRow,
        po_date:         r.po_date,
        pr_no,
        po_no,
        has_po:          hasPo ? 1 : 0,
        vendor_name:     String(r.vendor_name || '').trim(),
        item_code,
        qty,
        delivered_qty,
        unit_price,
        currency,
        forex,
        func_amount,
        delivery_status,
        buyer:           String(r.buyer || '').trim(),
        warehouse_code,
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

    const byPo = new Map();
    for (const c of clean) {
      if (!byPo.has(c.po_no)) byPo.set(c.po_no, []);
      byPo.get(c.po_no).push(c);
    }

    const violations = [];
    for (const [po_no, poRows] of byPo.entries()) {
      const groups = new Map();
      for (const r of poRows) {
        if (!groups.has(r.warehouse_code)) groups.set(r.warehouse_code, []);
        groups.get(r.warehouse_code).push(r.excelRow);
      }
      if (groups.size > 1) {
        violations.push({
          po_no,
          warehouses: [...groups.entries()].map(([warehouse_code, rowNumbers]) => ({
            warehouse_code, rows: rowNumbers,
          })),
        });
      }
    }

    if (violations.length > 0) {
      return res.status(409).json({
        success: false,
        code: 'MIXED_WAREHOUSE_CODES_PER_PO',
        message:
          'One or more PO numbers use multiple warehouse codes. ' +
          'A single PO must be for one warehouse; different POs may use different warehouses.',
        violations,
      });
    }

    const allDistinctCodes = [...new Set(clean.map((c) => c.warehouse_code))];
    const whMap = await ImportPoModel.lookupWarehouseIdsByCodes(allDistinctCodes);

    const missingCodes = allDistinctCodes.filter((code) => !whMap.has(code));
    if (missingCodes.length > 0) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_WAREHOUSE_CODE',
        message: `Warehouse code(s) not found: ${missingCodes.join(', ')}`,
        invalid_warehouse_codes: missingCodes,
      });
    }

    const inactiveCodes = allDistinctCodes.filter((code) => whMap.get(code)?.status !== 'Active');
    if (inactiveCodes.length > 0) {
      return res.status(400).json({
        success: false,
        code: 'INACTIVE_WAREHOUSE_CODE',
        message: `Warehouse code(s) are deactivated: ${inactiveCodes.join(', ')}`,
        inactive_warehouse_codes: inactiveCodes,
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

    const invalidCodes = [...new Set(clean.map(c => c.item_code).filter(code => !masterMap.has(code)))];
    if (invalidCodes.length > 0) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_ITEM_CODES',
        message: 'Invalid item code(s). Please check your item codes.',
        invalid_item_codes: invalidCodes,
      });
    }

    const lockedMap = await LockedItemsModel.bulkLookup(codes);

    const allWarehouseCodes = new Set(allDistinctCodes);
    for (const [, info] of lockedMap.entries()) allWarehouseCodes.add(info.warehouse_code);
    const allWhMap = await ImportPoModel.lookupWarehouseIdsByCodes([...allWarehouseCodes]);

    const prepared = clean.map((c) => {
      const master = masterMap.get(c.item_code) || {};
      const locked = lockedMap.get(c.item_code);
      const finalWarehouseCode = locked ? locked.warehouse_code : c.warehouse_code;
      const finalLocatorCode   = locked ? (locked.locator_code || null) : null;
      const wh = allWhMap.get(finalWarehouseCode);

      return {
        ...c, ...master,
        resolved_warehouse_code: finalWarehouseCode,
        resolved_warehouse_id:   wh?.warehouse_id || null,
        resolved_locator_code:   finalLocatorCode,
        is_locked:               !!locked,
      };
    });

    const existingKeys = await ImportPoModel.findExistingKeys(prepared.map(p => p.po_no));
    const dbCollisions = prepared.filter(p => existingKeys.has(`${p.po_no}|||${p.item_code}`));
    if (dbCollisions.length > 0) {
      return res.status(409).json({
        success: false,
        code: 'DUPLICATE_LINES',
        message: `${dbCollisions.length} line${dbCollisions.length === 1 ? '' : 's'} already exist in the system.`,
        duplicates: dbCollisions.map(c => ({ po_no: c.po_no, item_code: c.item_code, excel_row: c.excelRow })),
      });
    }

    let inserted = 0, locked_count = 0, unlocked_count = 0, auto_stored_count = 0;
    const importTs = new Date();
    const actor    = user.username || 'System';

    await poolConnect;

    for (const p of prepared) {
      const functionalUnitCost = Number(p.unit_price || 0) * Number(p.forex || 1);

      const baseData = {
        po_date:         p.po_date,
        pr_no:           p.pr_no,
        po_no:           p.po_no,
        has_po:          p.has_po,
        vendor_name:     p.vendor_name,
        item_code:       p.item_code,
        qty:             p.qty,
        received_qty:    p.delivered_qty,
        damaged_qty:     0,
        released_qty:    0,
        unit_price:      p.unit_price,
        currency:        p.currency,
        forex:           p.forex,
        func_amount:     p.func_amount,
        delivery_status: p.delivery_status,
        buyer:           p.buyer,
        uom:             p.uom,
        uom_description: p.uom_description,
        item_name:       p.item_name,
        barcode:         p.barcode,
        gl_class_code:   p.gl_class_code,
        gl_description:  p.gl_description,
        purchase_class:  p.purchase_class,
        category:        p.category,
        warehouse_id:    p.resolved_warehouse_id,
        warehouse_code:  p.resolved_warehouse_code,
        locator_code:    p.resolved_locator_code,
        forwarded_by:    actor,
        forwarded_at:    importTs,
        source_file,
        imported_by:     actor,
        imported_at:     importTs,
      };

      try {
        if (p.is_locked && p.resolved_locator_code) {
          // --- UOM CONVERSION LOGIC ---
          const uomRule = await ImportPoModel.getUomConversion(p.item_code);
          let actualItemCode = p.item_code;
          let totalPieces = Number(p.delivered_qty);
          let qtyBoxes = null;
          let qtyLoose = null;
          let piecesPerBox = null;

          if (uomRule) {
            if (uomRule.box_item_code === p.item_code) {
              piecesPerBox = Number(uomRule.pieces_per_box);
              actualItemCode = uomRule.piece_item_code;
              qtyBoxes = Number(p.delivered_qty);
              qtyLoose = 0;
              totalPieces = qtyBoxes * piecesPerBox;
            } else if (uomRule.piece_item_code === p.item_code) {
              piecesPerBox = Number(uomRule.pieces_per_box);
              totalPieces = Number(p.delivered_qty);
            }
          }

          // Get piece master details if actualItemCode is different
          let pieceMaster = p;
          if (actualItemCode !== p.item_code) {
            const pm = await ImportPoModel.lookupItemMasters([actualItemCode]);
            if (pm.has(actualItemCode)) {
              pieceMaster = pm.get(actualItemCode);
            }
          }

          const tx = new sql.Transaction(pool);
          await tx.begin();
          try {
            await ImportPoModel.insertLine({
              ...baseData,
              status:     'Stored',
              stored_qty: totalPieces,
              qty_boxes:  qtyBoxes,
              qty_loose_pieces: qtyLoose,
              pieces_per_box_snapshot: piecesPerBox,
            }, tx);

            await PoActivityLogModel.createEventInTx(tx, {
              po_no:          p.po_no,
              item_code:      p.item_code, // Log Box code
              event_type:     'IMPORT_PO_LINE',
              warehouse_code: p.resolved_warehouse_code,
              warehouse_id:   p.resolved_warehouse_id,
              qty_change:     totalPieces,
              prev_qty:       0,
              new_qty:        totalPieces,
              event_summary:
                `Imported · ${p.item_code} · delivered ${p.delivered_qty} (${totalPieces} Pcs) → ` +
                `${p.resolved_warehouse_code} · ${p.delivery_status}`,
              event_detail:   source_file ? `Source file: ${source_file}` : null,
              actor,
            });

            await WarehouseInventoryModel.applyMovement(tx, {
              warehouse_id:   p.resolved_warehouse_id,
              item_code:      actualItemCode, // PIECE CODE
              item_name:      pieceMaster?.item_name || p.item_name || null,
              uom:            pieceMaster?.uom || 'PC',
              movement_type:  'Store',
              qty_change:     totalPieces,
              unit_cost:      functionalUnitCost,
              reference_type: 'PO',
              reference_no:   p.po_no,
              actor,
              remarks:        `Auto-stored (locked) from PO ${p.po_no} → ${p.resolved_locator_code}`,
            });

            await upsertInventoryLocator(tx, {
              warehouse_code: p.resolved_warehouse_code,
              item_code:      actualItemCode, // PIECE CODE
              locator_code:   p.resolved_locator_code,
              qty:            totalPieces,
              unit_cost:      functionalUnitCost,
            });

            await PoActivityLogModel.createEventInTx(tx, {
              po_no:          p.po_no,
              item_code:      p.item_code, // Log Box code
              event_type:     'STORE_PO_LINE',
              warehouse_code: p.resolved_warehouse_code,
              warehouse_id:   p.resolved_warehouse_id,
              locator_code:   p.resolved_locator_code,
              qty_change:     totalPieces,
              prev_qty:       0,
              new_qty:        totalPieces,
              event_summary:
                `Auto-stored (locked) · ${p.item_code} · ${totalPieces} pcs → ` +
                `${p.resolved_warehouse_code} / ${p.resolved_locator_code}`,
              actor,
            });

            await tx.commit();
          } catch (txErr) {
            try { await tx.rollback(); } catch { /* ignore */ }
            throw txErr;
          }

          inserted++; locked_count++; auto_stored_count++;
        } else {
          await ImportPoModel.insertLine({
            ...baseData,
            status:     'With Handler',
            stored_qty: 0,
          });

          await PoActivityLogModel.createEvent({
            po_no:          p.po_no,
            item_code:      p.item_code,
            event_type:     'IMPORT_PO_LINE',
            warehouse_code: p.resolved_warehouse_code,
            warehouse_id:   p.resolved_warehouse_id,
            qty_change:     p.delivered_qty,
            prev_qty:       0,
            new_qty:        p.delivered_qty,
            event_summary:
              `${p.has_po === 1 ? 'Imported' : 'Imported (PR-based)'} · ${p.item_code} · ` +
              `delivered ${p.delivered_qty} of ${p.qty} → ${p.resolved_warehouse_code} · ${p.delivery_status}`,
            event_detail: source_file ? `Source file: ${source_file}` : null,
            actor,
          });

          await PoActivityLogModel.createEvent({
            po_no:          p.po_no,
            item_code:      p.item_code,
            event_type:     'Forwarded',
            warehouse_code: p.resolved_warehouse_code,
            warehouse_id:   p.resolved_warehouse_id,
            qty_change:     0,
            event_summary:
              `Forwarded to Handler · ${p.item_code} · ${p.delivered_qty} of ${p.qty} at ` +
              `${p.resolved_warehouse_code}`,
            actor,
          });

          inserted++; unlocked_count++;
        }
      } catch (err) {
        const isDup = err.number === 2627 || err.number === 2601;
        if (isDup) {
          errors.push({ row: p.excelRow, message: 'Duplicate line.', po_no: p.po_no, item_code: p.item_code });
          continue;
        }
        const isFk = err.number === 547 || (typeof err.message === 'string' && err.message.includes('FOREIGN KEY'));
        if (isFk) {
          errors.push({ row: p.excelRow, message: 'Invalid warehouse or locator reference.', po_no: p.po_no, item_code: p.item_code });
          continue;
        }
        errors.push({ row: p.excelRow, message: err.message, po_no: p.po_no, item_code: p.item_code });
      }
    }

    const distinctPOsArr = [...new Set(prepared.map(p => p.po_no))];
    const distinctWarehousesArr = [...new Set(prepared.map((p) => p.resolved_warehouse_code))];
    const withPoCount    = prepared.filter((p) => p.has_po === 1).length;
    const withoutPoCount = prepared.filter((p) => p.has_po === 0).length;

    if (inserted > 0) {
      (async () => {
        try {
          const adminList = await UserModel.getAdminsAndSuperAdmins();
          if (!Array.isArray(adminList) || adminList.length === 0) {
            console.warn('📧 Admin import notification skipped — no active Admin/Super Admin with email.');
            return;
          }
          await emailService.notifyAdminsOfPOImport({
            recipients:       adminList,
            importedBy:       actor,
            importedAt:       importTs,
            sourceFile:       source_file,
            poCount:          distinctPOsArr.length,
            lineCount:        inserted,
            withPoCount,
            withoutPoCount,
            warehouseCodes:   distinctWarehousesArr,
            lockedCount:      locked_count,
            unlockedCount:    unlocked_count,
            autoStoredCount:  auto_stored_count,
          });
        } catch (err) {
          console.error('📧 Admin import notification failed (non-fatal):', err.message || err);
        }
      })();
    }

    return res.status(200).json({
      success: true,
      message: 'Import complete.',
      summary: {
        po_count:            distinctPOsArr.length,
        lines_in:            rows.length,
        inserted,
        locked_count,
        unlocked_count,
        auto_stored_count,
        skipped:             0,
        errors:              errors.length,
        distinct_warehouses: distinctWarehousesArr,
        with_po_lines:       withPoCount,
        without_po_lines:    withoutPoCount,
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
      invalid_item_codes = [...new Set(
        item_codes.map(c => String(c).trim()).filter(Boolean).filter(code => !masterMap.has(code))
      )];
    }

    return res.status(200).json({ success: true, existing, invalid_item_codes });
  } catch (error) {
    console.error('Error checking preflight:', error);
    return res.status(500).json({
      success: false, message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
    });
  }
};

const listPurchaseOrders = async (req, res) => {
  try {
    const warehouseId = req.query.warehouse_id != null && req.query.warehouse_id !== '' ? req.query.warehouse_id : null;
    const viewerWarehouseId = req.warehouseId ?? req.user?.warehouse_assigned ?? null;
    const page  = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 50));

    const { rows, total } = await ImportPoModel.listPOs({
      warehouse_id:        warehouseId,
      viewer_warehouse_id: viewerWarehouseId,
      status:              req.query.status,
      search:              req.query.search,
      delivery_status:     req.query.delivery_status,
      has_po:              req.query.has_po,
      start_date:          req.query.start_date,
      end_date:            req.query.end_date,
      page, limit,
    });

    return res.status(200).json({
      success: true, data: rows, total, page, limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (error) {
    console.error('Error listing POs:', error);
    return res.status(500).json({
      success: false, message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
    });
  }
};

const listReceivedPOLines = async (req, res) => {
  try {
    const {
      warehouse_id, item_code, search, status, delivery_status, has_po,
      start_date, end_date,
    } = req.query;

    const page  = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(10000, Math.max(1, parseInt(req.query.limit, 10) || 50));

    const filters = {
      warehouse_id, item_code, search, status, delivery_status, has_po,
      start_date, end_date,
      received_only: true,
    };

    const [{ rows, total }, totals, warehouses] = await Promise.all([
      ImportPoModel.listReceivedPOLines({ ...filters, page, limit }),
      ImportPoModel.getReceivedTotals(filters),
      ImportPoModel.listWarehousesWithReceivedPOs(filters),
    ]);

    return res.status(200).json({
      success: true,
      data: rows,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      totals,
      warehouses,
    });
  } catch (error) {
    console.error('Error listing received PO lines:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
    });
  }
};

const getReceivedPOTrend = async (req, res) => {
  try {
    const {
      warehouse_id, item_code, search, status, delivery_status, has_po,
      start_date, end_date, days,
    } = req.query;

    const rows = await ImportPoModel.getReceivedPOTrend({
      warehouse_id, item_code, search, status, delivery_status, has_po,
      start_date, end_date, days,
      received_only: true,
    });

    return res.status(200).json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching received PO trend:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
    });
  }
};

const listHandlerItems = async (req, res) => {
  try {
    const viewerWarehouseId = req.warehouseId ?? req.user?.warehouse_assigned ?? null;
    const warehouseId = req.query.warehouse_id != null && req.query.warehouse_id !== ''
      ? Number(req.query.warehouse_id)
      : viewerWarehouseId;

    if (!warehouseId) {
      return res.status(400).json({ success: false, message: 'A warehouse is required.' });
    }

    const rawPage  = parseInt(req.query.page,  10);
    const rawLimit = parseInt(req.query.limit, 10);

    const page  = Number.isFinite(rawPage)  && rawPage  > 0 ? rawPage  : 1;
    const limit = Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(5000, Math.max(1, rawLimit))
      : 500;
    const offset = (page - 1) * limit;

    const filters = {
      warehouse_id: warehouseId,
      status:       req.query.status,
      search:       req.query.search,
      has_po:       req.query.has_po,
      start_date:   req.query.start_date,
      end_date:     req.query.end_date,
    };

    const [rows, total] = await Promise.all([
      ImportPoModel.listHandlerItems({
        ...filters,
        limit,
        offset,
      }),
      ImportPoModel.countHandlerItems(filters),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / limit));

    return res.status(200).json({
      success: true,
      data: rows,
      total,
      page,
      limit,
      totalPages,
    });
  } catch (error) {
    console.error('Error listing handler items:', error);
    return res.status(500).json({
      success: false, message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
    });
  }
};

const getPurchaseOrderDetail = async (req, res) => {
  try {
    const { po_no } = req.params;
    const warehouseId = req.query.warehouse_id != null && req.query.warehouse_id !== '' ? req.query.warehouse_id : null;
    const rows = await ImportPoModel.getPODetail(po_no, warehouseId);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Purchase Order not found.' });
    return res.status(200).json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching PO detail:', error);
    return res.status(500).json({
      success: false, message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
    });
  }
};

const getPOActivity = async (req, res) => {
  try {
    const { po_no } = req.params;
    if (!po_no) return res.status(400).json({ success: false, message: 'po_no is required.' });

    const itemCode = req.query.item_code && String(req.query.item_code).trim()
      ? String(req.query.item_code).trim()
      : null;

    const warehouseCode = req.query.warehouse_code && String(req.query.warehouse_code).trim()
      ? String(req.query.warehouse_code).trim()
      : null;

    const rows = warehouseCode
      ? await PoActivityLogModel.listForPo({
          po_no,
          warehouse_code: warehouseCode,
          item_code:      itemCode,
        })
      : await PoActivityLogModel.listByPO(po_no, itemCode);

    return res.status(200).json({ success: true, data: rows, total: rows.length });
  } catch (error) {
    console.error('Error fetching PO activity:', error);
    return res.status(500).json({
      success: false, message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
    });
  }
};

const getWarehouseActivityFeed = async (req, res) => {
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

    const result = await PoActivityLogModel.listForWarehouse({
      warehouse_code: warehouseCode,
      stage:      req.query.stage     || null,
      item_code:  req.query.item_code || null,
      po_no:      req.query.po_no     || null,
       q:          req.query.q         || null,
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
    console.error('❌ getWarehouseActivityFeed:', err);
    const status = /warehouse_code is required/i.test(err.message) ? 400 : 500;
    return res.status(status).json({
      success: false,
      message: err.message || 'Failed to load PO activity feed.',
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

    const receivingWarehouseId = req.warehouseId ?? req.user?.warehouse_assigned ?? null;
    const actor = req.user?.username || 'System';

    for (const it of items) {
      const id = Number(it.id);
      if (!Number.isFinite(id)) continue;

      const currencyRaw = it.currency ? String(it.currency).trim().toUpperCase() : '';
      const currency    = currencyRaw ? currencyRaw.slice(0, 3) : null;

      await ImportPoModel.receiveLine({
        id,
        incoming_good: Number(it.received_qty) || 0,
        unit_price:    it.unit_price,
        currency,
        receiving_warehouse_id: receivingWarehouseId,
      });
    }

    await ImportPoModel.recomputePOStatus(po_no);

    const allRows = await ImportPoModel.getPODetail(po_no);
    const byId = {};
    for (const r of allRows) byId[r.id] = r;

    for (const it of items) {
      const id = Number(it.id);
      if (!Number.isFinite(id)) continue;
      const line = byId[id];
      if (!line) continue;
      const good = Number(it.received_qty) || 0;

      const currentReceived = Number(line.received_qty) || 0;
      const prevQty = Math.max(0, currentReceived - good);

      await PoActivityLogModel.createEvent({
        po_no,
        item_code:      line.item_code,
        event_type:     'RECEIVE_PO_LINE',
        warehouse_code: line.warehouse_code,
        warehouse_id:   line.warehouse_id,
        qty_change:     good,
        prev_qty:       prevQty,
        new_qty:        currentReceived,
        event_summary:
          `Received · ${line.item_code} · ${good} good ` +
          `(of ${line.qty} ordered, running ${currentReceived})`,
        actor,
      });
    }

    return res.status(200).json({ success: true, message: 'Receipt saved.' });
  } catch (error) {
    console.error('Error receiving PO:', error);
    return res.status(500).json({
      success: false, message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
    });
  }
};

const forwardPurchaseOrder = async (req, res) => {
  try {
    const { po_no } = req.params;
    const user = req.user || {};
    const targetWarehouseId = req.warehouseId ??
      (req.body?.warehouse_id != null && req.body.warehouse_id !== '' ? Number(req.body.warehouse_id) : null);

    if (!targetWarehouseId) {
      return res.status(400).json({
        success: false,
        message: 'A warehouse must be specified. Admins must pass warehouse_id in the request body; other roles need an assigned warehouse.',
      });
    }

    const allRows = await ImportPoModel.getPODetail(po_no);
    if (!allRows.length) return res.status(404).json({ success: false, message: 'Purchase Order not found.' });

    const forwardable = await ImportPoModel.countForwardableLines(po_no, targetWarehouseId);

    if (forwardable === 0) {
      const mine = allRows.filter((r) => Number(r.warehouse_id) === Number(targetWarehouseId));
      if (mine.length === 0) {
        return res.status(403).json({
          success: false,
          message: 'Your warehouse has not received any lines of this PO. Only the warehouse that received the items can send them to the handler.',
        });
      }
      const alreadyForwarded = mine.every((r) =>
        ['With Handler', 'Pending Transfer', 'Transferred', 'Stored', 'Released'].includes(r.status)
      );
      if (alreadyForwarded) {
        return res.status(400).json({ success: false, message: 'Your warehouse has already sent this PO to the handler.' });
      }
      return res.status(400).json({ success: false, message: 'Nothing to forward yet. Receive items for this PO first.' });
    }

    const affected = await ImportPoModel.forwardPOToHandler(po_no, user.username || 'System', targetWarehouseId);
    if (affected === 0) {
      return res.status(400).json({ success: false, message: 'Nothing was forwarded. The lines may have already been sent.' });
    }

    const refreshed = await ImportPoModel.getPODetail(po_no, targetWarehouseId);

    for (const line of refreshed) {
      if (line.forwarded_at && Number(line.warehouse_id) === Number(targetWarehouseId)) {
        await PoActivityLogModel.createEvent({
          po_no,
          item_code:      line.item_code,
          event_type:     'Forwarded',
          warehouse_code: line.warehouse_code,
          warehouse_id:   line.warehouse_id,
          qty_change:     0,
          event_summary:
            `Forwarded to Handler · ${line.item_code} · status ${line.status} at ${line.warehouse_code}`,
          actor: user.username || 'System',
        });
      }
    }

    return res.status(200).json({
      success: true,
      message: `PO "${po_no}" sent to Stock Handler (${affected} line${affected === 1 ? '' : 's'}).`,
      affected,
      status: 'With Handler',
    });
  } catch (error) {
    console.error('Error forwarding PO:', error);
    return res.status(500).json({
      success: false, message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
    });
  }
};

const deletePurchaseOrder = async (req, res) => {
  try {
    const { po_no } = req.params;
    const deleted = await ImportPoModel.deletePOIfPending(po_no);
    if (deleted === 0) return res.status(404).json({ success: false, message: 'Purchase Order not found.' });
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
      success: false, message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
    });
  }
};

/* ============================================================
   STORE PO LINE — UPDATED FOR BOX × PIECES MATH
   ============================================================ */
const storePurchaseOrderLine = async (req, res) => {
  try {
    const { po_no } = req.params;
    const {
      item_id,
      qty_to_store,
      qty_boxes,
      qty_loose_pieces,
      damaged_qty: rawDamagedQty,
      damage_reason,
      remarks,
      locator_code,
    } = req.body || {};
    const user = req.user || {};

    if (!item_id) return res.status(400).json({ success: false, message: 'item_id is required.' });

    const line = await ImportPoModel.getLineById(item_id);
    if (!line) return res.status(404).json({ success: false, message: 'PO line not found.' });
    if (String(line.po_no) !== String(po_no)) {
      return res.status(400).json({ success: false, message: 'Line does not belong to this PO.' });
    }
    if (!line.warehouse_id) {
      return res.status(400).json({ success: false, message: 'Line has no warehouse. Cannot store.' });
    }
    if (!['With Handler', 'Pending Transfer'].includes(line.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot store: line status is "${line.status}". Expected With Handler / Pending Transfer.`,
      });
    }

    // --- BOX × PIECES MATH ---
    let q = 0;
    let boxes = 0;
    let loose = 0;
    let piecesPerBox = null;
    let actualItemCode = line.item_code;
    let actualItemName = line.item_name;
    let actualUom = line.uom;

    // Check if item has a UOM conversion rule
    const uomRule = await ImportPoModel.getUomConversion(line.item_code);
    
    if (uomRule) {
      actualItemCode = uomRule.piece_item_code;
      piecesPerBox = Number(uomRule.pieces_per_box);

      // Fetch piece item master details
      if (actualItemCode !== line.item_code) {
        const pm = await ImportPoModel.lookupItemMasters([actualItemCode]);
        if (pm.has(actualItemCode)) {
          const pData = pm.get(actualItemCode);
          actualItemName = pData.item_name || actualItemName;
          actualUom = pData.uom || actualUom;
        }
      }

      if (uomRule.box_item_code === line.item_code) {
        boxes = Number(qty_boxes) || 0;
        loose = Number(qty_loose_pieces) || 0;
        q = (boxes * piecesPerBox) + loose;
      } else {
        boxes = Number(qty_boxes) || 0;
        loose = Number(qty_loose_pieces) || 0;
        q = Number(qty_to_store) || ((boxes * piecesPerBox) + loose);
      }
    } else {
      q = Number(qty_to_store) || 0;
    }

    const damagedQty = Number(rawDamagedQty) || 0;

    if (q < 0 || damagedQty < 0) {
      return res.status(400).json({ success: false, message: 'qty_to_store and damaged_qty must be non-negative.' });
    }
    if (q + damagedQty <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Nothing to store — total pieces and damaged_qty are both zero.',
      });
    }
    if (q > 0 && (!locator_code || !String(locator_code).trim())) {
      return res.status(400).json({ success: false, message: 'locator_code is required when storing good units.' });
    }

    const received  = Number(line.received_qty) || 0;
    const stored    = Number(line.stored_qty)   || 0;
    const released  = Number(line.released_qty) || 0;
    const available = received - stored - released;

    if (available <= 0) {
      return res.status(400).json({ success: false, message: 'Nothing left to store on this line.' });
    }
    if ((q + damagedQty) > available) {
      return res.status(400).json({
        success: false,
        message: `Cannot process ${q + damagedQty}. Only ${available} available (received ${received}, stored ${stored}, released ${released}).`,
      });
    }

    let finalLocatorCode = null;
    if (q > 0) {
      const locatorRows = await query(
        `SELECT locator_code, ISNULL(locator_type, 'Regular') AS locator_type
           FROM locator_table
          WHERE warehouse_code = @param0
            AND locator_code   = @param1
            AND status         = 'Active'`,
        [line.warehouse_code, String(locator_code).trim()]
      );
      if (locatorRows.length === 0) {
        return res.status(400).json({
          success: false,
          message: `Locator "${locator_code}" not found or inactive for warehouse ${line.warehouse_code}.`,
        });
      }
      if (locatorRows[0].locator_type === 'Damage') {
        return res.status(400).json({
          success: false,
          message: `Locator "${locator_code}" is a DAMAGE locator — you cannot store good units into it.`,
        });
      }
      finalLocatorCode = locatorRows[0].locator_code;
    }

    await poolConnect;

    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    let damageResult = null;
    try {
      const functionalUnitCost = Number(line.unit_price || 0) * Number(line.forex || 1);
      const actor = user.username || 'System';

      if (q > 0) {
        await WarehouseInventoryModel.applyMovement(transaction, {
          warehouse_id:   Number(line.warehouse_id),
          item_code:      actualItemCode, // PIECE CODE
          item_name:      actualItemName,
          uom:            actualUom,
          movement_type:  'Store',
          qty_change:     q,
          unit_cost:      functionalUnitCost,
          reference_type: 'PO',
          reference_id:   line.id,
          reference_no:   line.po_no,
          actor,
          remarks:        remarks ? String(remarks).trim() : `Stored from PO ${line.po_no}`,
        });

        await upsertInventoryLocator(transaction, {
          warehouse_code: line.warehouse_code,
          item_code:      actualItemCode, // PIECE CODE
          locator_code:   finalLocatorCode,
          qty:            q,
          unit_cost:      functionalUnitCost,
        });

        const summary = uomRule 
          ? `Stored ${boxes} Boxes (${boxes * piecesPerBox} pcs) + ${loose} Loose = ${q} Total Pieces of ${line.item_code} → ${line.warehouse_code} / ${finalLocatorCode}`
          : `Stored ${q} of ${line.item_code} → ${line.warehouse_code} / ${finalLocatorCode}`;

        await PoActivityLogModel.createEventInTx(transaction, {
          po_no:          line.po_no,
          item_code:      line.item_code,
          event_type:     'STORE_PO_LINE',
          warehouse_code: line.warehouse_code,
          warehouse_id:   line.warehouse_id,
          locator_code:   finalLocatorCode,
          qty_change:     q,
          prev_qty:       stored,
          new_qty:        stored + q,
          event_summary:  summary,
          event_detail:   remarks ? `Remarks: ${String(remarks).trim()}` : null,
          actor,
        });
      }

      if (damagedQty > 0) {
        damageResult = await ImportPoModel.recordDamagedUnits(transaction, {
          source_type:    'PO',
          source_ref:     line.po_no,
          line_ref:       line.id,
          item_code:      actualItemCode, // PIECE CODE
          item_name:      actualItemName,
          uom:            actualUom,
          warehouse_id:   Number(line.warehouse_id),
          warehouse_code: line.warehouse_code,
          qty:            damagedQty,
          unit_cost:      Number(line.unit_price) || 0,
          forex:          Number(line.forex) || 1,
          currency:       line.currency || null,
          reason:         damage_reason ? String(damage_reason).trim() : null,
          actor,
        });

        await PoActivityLogModel.createEventInTx(transaction, {
          po_no:          line.po_no,
          item_code:      line.item_code,
          event_type:     'DAMAGE_PO_LINE',
          warehouse_code: line.warehouse_code,
          warehouse_id:   line.warehouse_id,
          locator_code:   damageResult?.locator_code || null,
          qty_change:     damagedQty,
          prev_qty:       0,
          new_qty:        damagedQty,
          event_summary:
            `Damaged ${damagedQty} of ${line.item_code} → ` +
            `${line.warehouse_code} / ${damageResult?.locator_code || 'DAMAGE-XX'}`,
          event_detail: damage_reason ? `Damage reason: ${String(damage_reason).trim()}` : null,
          actor,
        });
      }

      const totalProcessed = q + damagedQty;
      
      // Save the box breakdown to the DB
      await ImportPoModel.addStoredQty(transaction, { 
        id: line.id, 
        qty_to_add: totalProcessed,
        qty_boxes: boxes,
        qty_loose_pieces: loose,
        pieces_per_box_snapshot: piecesPerBox
      });
      
      await ImportPoModel.maybeMarkPOStored(transaction, line.po_no);

      await transaction.commit();
    } catch (err) {
      try { await transaction.rollback(); } catch { /* ignore */ }
      throw err;
    }

    const messageParts = [];
    if (q > 0)          messageParts.push(`${q} pieces stored → ${finalLocatorCode}`);
    if (damagedQty > 0) messageParts.push(`${damagedQty} damaged → ${damageResult?.locator_code || 'DAMAGE-XX'}`);

    return res.status(200).json({
      success: true,
      message: damagedQty > 0
        ? `Stored ${q} pieces (locator ${finalLocatorCode || '—'}) and ${damagedQty} damaged (locator ${damageResult?.locator_code}).`
        : `Stored ${q} pieces of ${line.item_code} to locator ${finalLocatorCode}.`,
      data: {
        item_id:             line.id,
        qty_stored:          q,
        qty_boxes:           boxes,
        qty_loose_pieces:    loose,
        qty_damaged:         damagedQty,
        locator_code:        finalLocatorCode,
        damage_locator_code: damageResult?.locator_code || null,
        writeoff_id:         damageResult?.writeoff_id || null,
      },
    });
  } catch (error) {
    console.error('❌ storePurchaseOrderLine:', error);
    return res.status(500).json({
      success: false, message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
    });
  }
};

const releasePurchaseOrderLine = async (req, res) => {
  try {
    const { po_no } = req.params;
    const { item_id, qty_to_release, released_to, purpose, reference, remarks } = req.body || {};
    const user = req.user || {};

    if (!item_id) {
      return res.status(400).json({ success: false, message: 'item_id is required.' });
    }
    if (!released_to || !String(released_to).trim()) {
      return res.status(400).json({ success: false, message: 'released_to is required.' });
    }

    const q = Number(qty_to_release);
    if (!Number.isFinite(q) || q <= 0) {
      return res.status(400).json({ success: false, message: 'qty_to_release must be greater than 0.' });
    }

    const line = await ImportPoModel.getLineById(item_id);
    if (!line) return res.status(404).json({ success: false, message: 'PO line not found.' });
    if (String(line.po_no) !== String(po_no)) {
      return res.status(400).json({ success: false, message: 'Line does not belong to this PO.' });
    }
    if (line.status !== 'With Handler') {
      return res.status(400).json({
        success: false,
        message: `Cannot release: line status is "${line.status}". Expected With Handler.`,
      });
    }

    const received  = Number(line.received_qty) || 0;
    const stored    = Number(line.stored_qty)   || 0;
    const released  = Number(line.released_qty) || 0;
    const available = received - stored - released;

    if (available <= 0) {
      return res.status(400).json({ success: false, message: 'Nothing left to release on this line.' });
    }
    if (q > available) {
      return res.status(400).json({
        success: false,
        message: `Cannot release ${q}. Only ${available} available (received ${received}, stored ${stored}, released ${released}).`,
      });
    }

    await poolConnect;
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      await ImportPoModel.addReleasedQty(transaction, { id: line.id, qty_to_add: q });
      await ImportPoModel.maybeMarkPOStored(transaction, line.po_no);

      const parts = [`Released ${q} of ${line.item_code} to ${released_to}`];
      if (purpose)   parts.push(`purpose: ${purpose}`);
      if (reference) parts.push(`ref: ${reference}`);

      await PoActivityLogModel.createEventInTx(transaction, {
        po_no:          line.po_no,
        item_code:      line.item_code,
        event_type:     'RELEASE_PO_LINE',
        warehouse_code: line.warehouse_code,
        warehouse_id:   line.warehouse_id,
        qty_change:     -q,
        prev_qty:       released,
        new_qty:        released + q,
        event_summary:  parts.join(' · '),
        event_detail:   remarks ? `Remarks: ${String(remarks).trim()}` : null,
        actor:          user.username || 'System',
      });

      await transaction.commit();
    } catch (err) {
      try { await transaction.rollback(); } catch { /* ignore */ }
      throw err;
    }

    return res.status(200).json({
      success: true,
      message: `Released ${q} of ${line.item_code} to ${released_to}.`,
      data: { item_id: line.id, qty_released: q, released_to },
    });
  } catch (error) {
    console.error('❌ releasePurchaseOrderLine:', error);
    return res.status(500).json({
      success: false, message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
    });
  }
};

module.exports = {
  importPurchaseOrders,
  checkDuplicatePOs,
  listPurchaseOrders,
  listReceivedPOLines,
  getReceivedPOTrend,
  listHandlerItems,
  getPurchaseOrderDetail,
  getPOActivity,
  getWarehouseActivityFeed,
  receivePurchaseOrder,
  forwardPurchaseOrder,
  deletePurchaseOrder,
  storePurchaseOrderLine,
  releasePurchaseOrderLine,
};