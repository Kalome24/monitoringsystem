// controllers/underground/undergroundController.js
'use strict';

const UndergroundModel      = require('../../models/underground/undergroundModel');
const LocatorLogModel       = require('../../models/locatorLogModel');
const UserModel             = require('../../models/userModel');
const WarehouseModel        = require('../../models/warehouseModel');
const SyncPeerModel         = require('../../models/syncPeerModel');
const surfaceSyncClient     = require('../../services/surfaceSyncClient');
const { query }             = require('../../db');

const round4 = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10000) / 10000;
};

const getFreshUser = async (req) => {
  if (!req.user?.id) return null;
  try { return await UserModel.getUserById(req.user.id); } catch { return null; }
};

const isAdminRole = (user) => {
  const role = String(user?.user_role || user?.role || '').trim();
  return role === 'Super Admin' || role === 'Admin';
};

const toInt = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};

const normCode = (v) => String(v ?? '').trim().toUpperCase();

const extractIp = (req) => {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  if (forwarded) return forwarded.slice(0, 45);
  const raw = String(req.socket?.remoteAddress || '').trim();
  return raw.replace(/^::ffff:/, '').slice(0, 45) || null;
};

const getAssignedLocators = async (user) => {
  if (!user) return null;
  try {
    return await UserModel.getAssignedLocatorsForUser(user);
  } catch {
    return null;
  }
};

const checkUndergroundGate = async (user) => {
  if (!user) return { ok: false, message: 'User not found.' };
  const pos = String(user.emp_position || '').trim();
  if (pos !== 'Underground Handler') {
    return { ok: false, message: 'Only Underground Handlers may use this feature.' };
  }
  if (!user.warehouse_assigned) {
    return { ok: false, message: 'Your account has no warehouse assignment.' };
  }
  const wh = await WarehouseModel.getWarehouseById(user.warehouse_assigned);
  if (!wh) return { ok: false, message: 'Assigned warehouse not found.' };

  const code = String(wh.warehouse_code || '').trim().toUpperCase();
  if (!UndergroundModel.isSyncWarehouse(code)) {
    // ⚡ LUMB removed from scope. Only UG.
    return { ok: false, message: 'This feature is only available at the UG warehouse.' };
  }
  return {
    ok: true,
    warehouse_id:   wh.warehouse_id,
    warehouse_code: wh.warehouse_code,
    warehouse_name: wh.warehouse_name,
  };
};

const checkReconcileGate = async (user, shift) => {
  if (!user) return { ok: false, message: 'User not found.' };
  if (isAdminRole(user)) return { ok: true };
  const pos = String(user.emp_position || '').trim();
  if (pos !== 'Surface Handler') {
    return { ok: false, message: 'Only Surface Handlers or admins may reconcile a sync.' };
  }
  if (Number(user.warehouse_assigned) !== Number(shift.warehouse_id)) {
    return { ok: false, message: 'You are not assigned to this warehouse.' };
  }
  return { ok: true };
};

const checkSurfaceViewGate = async (user, requestedWarehouseId) => {
  if (!user) return { ok: false, message: 'User not found.' };
  if (isAdminRole(user)) {
    if (!requestedWarehouseId) {
      return { ok: false, message: 'Admins must specify warehouse_id.' };
    }
    const wh = await WarehouseModel.getWarehouseById(requestedWarehouseId);
    if (!wh) return { ok: false, message: 'Warehouse not found.' };
    return {
      ok: true,
      warehouse_id:   wh.warehouse_id,
      warehouse_code: wh.warehouse_code,
      warehouse_name: wh.warehouse_name,
    };
  }
  const pos = String(user.emp_position || '').trim();
  if (pos !== 'Surface Handler') {
    return { ok: false, message: 'Only Surface Handlers or admins may view underground syncs.' };
  }
  if (!user.warehouse_assigned) {
    return { ok: false, message: 'Your account has no warehouse assignment.' };
  }
  const wh = await WarehouseModel.getWarehouseById(user.warehouse_assigned);
  if (!wh) return { ok: false, message: 'Assigned warehouse not found.' };

  const code = String(wh.warehouse_code || '').trim().toUpperCase();
  if (!UndergroundModel.isSyncWarehouse(code)) {
    // ⚡ LUMB removed from scope. Only UG.
    return { ok: false, message: 'This feature is only available at the UG warehouse.' };
  }
  return {
    ok: true,
    warehouse_id:   wh.warehouse_id,
    warehouse_code: wh.warehouse_code,
    warehouse_name: wh.warehouse_name,
  };
};

const checkSyncGate = async (user, shift) => {
  if (!user) return { ok: false, message: 'User not found.' };
  if (isAdminRole(user)) return { ok: true };

  const pos = String(user.emp_position || '').trim();
  const isUGHandler      = pos === 'Underground Handler';
  const isSurfaceHandler = pos === 'Surface Handler';

  if (!isUGHandler && !isSurfaceHandler) {
    return { ok: false, message: 'Only Underground/Surface Handlers or admins may sync.' };
  }
  if (!user.warehouse_assigned) {
    return { ok: false, message: 'Your account has no warehouse assignment.' };
  }
  if (Number(user.warehouse_assigned) !== Number(shift.warehouse_id)) {
    return { ok: false, message: 'You are not assigned to this warehouse.' };
  }
  return { ok: true };
};

const fetchReleaseLines = async (shift_id) => {
  return query(
    `SELECT locator_code, locator_name, item_code, item_name,
            barcode, uom, category, purchase_class, gl_class,
            qty, unit_cost, line_total, released_at, released_by,
            destination, remarks, line_kind
       FROM dbo.underground_shift_lines
      WHERE shift_id = @param0 AND line_kind IN ('Release', 'Damage', 'Transfer-Out', 'Transfer-In')
      ORDER BY line_id`,
    [shift_id]
  );
};

const fetchBeginningLines = async (shift_id) => {
  return query(
    `SELECT locator_code, locator_name, item_code, item_name,
            barcode, uom, category, purchase_class, gl_class,
            qty, unit_cost, line_total
       FROM dbo.underground_shift_lines
      WHERE shift_id = @param0 AND line_kind = 'Beginning'
      ORDER BY line_id`,
    [shift_id]
  );
};

const sanitiseReleaseLines = (raw) => {
  const src = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const l of src) {
    if (!l || !l.locator_code) throw new Error('Each release line requires locator_code.');
    if (!l.item_code)          throw new Error('Each release line requires item_code.');
    const q = Number(l.qty);
    if (!(q > 0))              throw new Error(`Each release line qty must be > 0 (got ${l.qty}).`);
    out.push({
      locator_code: String(l.locator_code).trim(),
      item_code:    String(l.item_code).trim(),
      item_name:    l.item_name ?? null,
      uom:          l.uom       ?? null,
      qty:          q,
      unit_cost:    Number(l.unit_cost)  || 0,
      line_total:   Number(l.line_total) || 0,
      destination:  l.destination ?? null,
      remarks:      l.remarks     ?? null,
      line_kind:    l.line_kind   ?? 'Release',
    });
  }
  return out;
};

const coerceReleaseLineNumerics = (raw) => {
  const src = Array.isArray(raw) ? raw : [];
  return src.map((l, i) => {
    if (!l) throw new Error(`Release line ${i + 1}: row is missing.`);

    const qty        = Number(l.qty);
    const unit_cost  = Number(l.unit_cost);
    const line_total = Number(l.line_total);

    if (!Number.isFinite(qty)) {
      throw new Error(`Release line ${i + 1} (${l.item_code || '?'}): qty "${l.qty}" is not a valid number.`);
    }
    if (!Number.isFinite(unit_cost)) {
      throw new Error(`Release line ${i + 1} (${l.item_code || '?'}): unit_cost "${l.unit_cost}" is not a valid number.`);
    }
    if (!Number.isFinite(line_total)) {
      throw new Error(`Release line ${i + 1} (${l.item_code || '?'}): line_total "${l.line_total}" is not a valid number.`);
    }

    return {
      ...l,
      locator_code:   String(l.locator_code ?? ''),
      locator_name:   l.locator_name   != null ? String(l.locator_name)   : null,
      item_code:      String(l.item_code ?? ''),
      item_name:      l.item_name      != null ? String(l.item_name)      : null,
      barcode:        l.barcode        != null ? String(l.barcode)        : null,
      uom:            l.uom            != null ? String(l.uom)            : null,
      category:       l.category       != null ? String(l.category)       : null,
      purchase_class: l.purchase_class != null ? String(l.purchase_class) : null,
      gl_class:       l.gl_class       != null ? String(l.gl_class)       : null,
      qty,
      unit_cost,
      line_total,
      released_at:    l.released_at  ?? null,
      released_by:    l.released_by  != null ? String(l.released_by) : null,
      destination:    l.destination  != null ? String(l.destination) : null,
      remarks:        l.remarks      != null ? String(l.remarks)     : null,
      line_kind:      l.line_kind    ?? 'Release',
    };
  });
};

const createLogSafe = async (header, items = []) => {
  try {
    return await LocatorLogModel.createLog(header, items);
  } catch (err) {
    const isBcp = /Invalid column type from bcp client/i.test(err?.message || '');
    const isMissingCol = /Invalid column name/i.test(err?.message || '');
    
    if ((isBcp || isMissingCol) && Array.isArray(items) && items.length > 0) {
      console.warn(
        `⚠️  createLogSafe: createLog with items failed (${isBcp ? 'BCP schema mismatch' : 'Missing column'}). ` +
        'Retrying with header only. Please ensure locator_export_log_items has the line_kind column.',
        err.message
      );
      return await LocatorLogModel.createLog(
        { ...header, item_row_count: 0 },
        []
      );
    }
    throw err;
  }
};

const normalizeSeedLinesWithUom = async (seedLines) => {
  if (!Array.isArray(seedLines) || seedLines.length === 0) return seedLines;

  const itemCodes = [...new Set(
    seedLines.map((l) => String(l.item_code || '').trim()).filter(Boolean)
  )];
  if (itemCodes.length === 0) return seedLines;

  const placeholders = itemCodes.map((_, i) => `@c${i}`).join(', ');
  let rules = [];
  try {
    rules = await query(
      `SELECT box_item_code, piece_item_code, pieces_per_box
         FROM dbo.uom_conversions
        WHERE box_item_code IN (${placeholders})
          AND Status = 'Active'`,
      itemCodes
    );
  } catch (err) {
    console.warn(
      '⚠️  normalizeSeedLinesWithUom: uom_conversions lookup failed —',
      err.message || err
    );
    return seedLines;
  }
  if (!rules.length) return seedLines;

  const ruleMap = new Map();
  for (const r of rules) ruleMap.set(String(r.box_item_code), r);

  const pieceCodes = [...new Set(rules.map((r) => String(r.piece_item_code)))];
  const pieceMasters = new Map();
  if (pieceCodes.length > 0) {
    const pPlaceholders = pieceCodes.map((_, i) => `@p${i}`).join(', ');
    try {
      const pRows = await query(
        `SELECT Item_Code, Item_Description, Uom_Code, Barcode,
                Category, Purchase_Class, Gl_Class
           FROM dbo.item_master
          WHERE Item_Code IN (${pPlaceholders})`,
        pieceCodes
      );
      for (const p of pRows) pieceMasters.set(String(p.Item_Code), p);
    } catch (err) {
      console.warn(
        '⚠️  normalizeSeedLinesWithUom: piece item_master lookup failed —',
        err.message || err
      );
    }
  }

  return seedLines.map((l) => {
    const code = String(l.item_code || '').trim();
    const rule = ruleMap.get(code);
    if (!rule) return l;

    const pm = pieceMasters.get(String(rule.piece_item_code));
    return {
      ...l,
      item_code:      String(rule.piece_item_code),
      item_name:      pm?.Item_Description ?? l.item_name,
      uom:            pm?.Uom_Code         ?? l.uom,
      barcode:        pm?.Barcode          ?? l.barcode,
      category:       pm?.Category         ?? l.category,
      purchase_class: pm?.Purchase_Class   ?? l.purchase_class,
      gl_class:       pm?.Gl_Class != null ? String(pm.Gl_Class) : l.gl_class,
    };
  });
};

const undergroundController = {
  // ============================================================
  // DASHBOARD & SHIFT MANAGEMENT
  // ============================================================
  dashboard: async (req, res) => {
    try {
      const me = await getFreshUser(req);
      if (!me) return res.status(401).json({ success: false, message: 'User not found.' });

      const gate = await checkUndergroundGate(me);
      if (!gate.ok) return res.status(403).json({ success: false, message: gate.message });

      const assigned_locators = await getAssignedLocators(me);

      const current = await UndergroundModel.getCurrentShift(gate.warehouse_id, me.username);
      let summary = null;
      if (current) {
        summary = await UndergroundModel.getCurrentInventorySummary(
          current.shift_id,
          { assigned_locators }
        );
      }

      const recent = await UndergroundModel.listShifts({
        warehouse_id: gate.warehouse_id,
        page: 1,
        limit: 10,
      });

      return res.status(200).json({
        success: true,
        data: {
          warehouse: {
            id:   gate.warehouse_id,
            code: gate.warehouse_code,
            name: gate.warehouse_name,
          },
          current_shift: current,
          current_summary: summary,
          recent_shifts: recent.rows,
          scoped_bodegas: Array.isArray(assigned_locators) ? assigned_locators : null,
        },
      });
    } catch (err) {
      console.error('❌ underground.dashboard:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  currentShift: async (req, res) => {
    try {
      const me = await getFreshUser(req);
      if (!me) return res.status(401).json({ success: false, message: 'User not found.' });

      const gate = await checkUndergroundGate(me);
      if (!gate.ok) return res.status(403).json({ success: false, message: gate.message });

      const assigned_locators = await getAssignedLocators(me);

      const shift = await UndergroundModel.getCurrentShift(gate.warehouse_id, me.username);
      const summary = shift
        ? await UndergroundModel.getCurrentInventorySummary(
            shift.shift_id,
            { assigned_locators }
          )
        : null;

      return res.status(200).json({
        success: true,
        data: {
          shift,
          summary,
          scoped_bodegas: Array.isArray(assigned_locators) ? assigned_locators : null,
        },
      });
    } catch (err) {
      console.error('❌ underground.currentShift:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  activeShift: async (req, res) => {
    try {
      const me = await getFreshUser(req);
      if (!me) return res.status(401).json({ success: false, message: 'User not found.' });

      const gate = await checkUndergroundGate(me);
      if (!gate.ok) return res.status(403).json({ success: false, message: gate.message });

      const result = await UndergroundModel.getActiveShift(gate.warehouse_id, me.username);
      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      console.error('❌ underground.activeShift:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  currentInventory: async (req, res) => {
    try {
      const me = await getFreshUser(req);
      if (!me) return res.status(401).json({ success: false, message: 'User not found.' });

      const gate = await checkUndergroundGate(me);
      if (!gate.ok) return res.status(403).json({ success: false, message: gate.message });

      const shift = await UndergroundModel.getCurrentShift(gate.warehouse_id, me.username);
      if (!shift) {
        return res.status(200).json({
          success: true,
          data: [],
          total: 0,
          page: 1,
          limit: 500,
          totalPages: 1,
          message: 'No open shift. Import a surface export to begin a new shift.',
          scoped_bodegas: null,
        });
      }

      const assigned_locators = await getAssignedLocators(me);

      const rawPage  = parseInt(req.query.page,  10);
      const rawLimit = parseInt(req.query.limit, 10);

      const page  = Number.isFinite(rawPage)  && rawPage  > 0 ? rawPage  : 1;
      const limit = Number.isFinite(rawLimit) && rawLimit > 0
        ? Math.min(5000, Math.max(1, rawLimit))
        : 500;
      const offset = (page - 1) * limit;

      const filters = {
        search:            req.query.search,
        locator_code:      req.query.locator_code,
        item_code:         req.query.item_code,
        assigned_locators,
      };

      const [rows, total] = await Promise.all([
        UndergroundModel.getCurrentInventory(shift.shift_id, {
          ...filters,
          limit,
          offset,
        }),
        UndergroundModel.countCurrentInventory(shift.shift_id, filters),
      ]);

      const totalPages = Math.max(1, Math.ceil(total / limit));

      return res.status(200).json({
        success: true,
        data: rows,
        total,
        page,
        limit,
        totalPages,
        shift_id: shift.shift_id,
        scoped_bodegas: Array.isArray(assigned_locators) ? assigned_locators : null,
      });
    } catch (err) {
      console.error('❌ underground.currentInventory:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  listShifts: async (req, res) => {
    try {
      const me = await getFreshUser(req);
      if (!me) return res.status(401).json({ success: false, message: 'User not found.' });

      const gate = await checkUndergroundGate(me);
      if (!gate.ok) return res.status(403).json({ success: false, message: gate.message });

      const result = await UndergroundModel.listShifts({
        warehouse_id: gate.warehouse_id,
        status:       req.query.status,
        page:         req.query.page,
        limit:        req.query.limit,
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
      console.error('❌ underground.listShifts:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  surfaceShifts: async (req, res) => {
    try {
      const me = await getFreshUser(req);
      if (!me) return res.status(401).json({ success: false, message: 'User not found.' });

      const requestedWarehouseId = toInt(req.query.warehouse_id);
      const gate = await checkSurfaceViewGate(me, requestedWarehouseId);
      if (!gate.ok) return res.status(403).json({ success: false, message: gate.message });

      const result = await UndergroundModel.listShifts({
        warehouse_id: gate.warehouse_id,
        status:       req.query.status || null,
        page:         req.query.page,
        limit:        req.query.limit || 50,
      });

      return res.status(200).json({
        success: true,
        data: result.rows,
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
        warehouse: {
          id:   gate.warehouse_id,
          code: gate.warehouse_code,
          name: gate.warehouse_name,
        },
      });
    } catch (err) {
      console.error('❌ underground.surfaceShifts:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  listPendingSyncs: async (req, res) => {
    try {
      const me = await getFreshUser(req);
      if (!me) return res.status(401).json({ success: false, message: 'User not found.' });

      const requestedWarehouseId = toInt(req.query.warehouse_id);
      const gate = await checkSurfaceViewGate(me, requestedWarehouseId);
      if (!gate.ok) return res.status(403).json({ success: false, message: gate.message });

      const rows = await UndergroundModel.listPendingSyncsForWarehouse(
        gate.warehouse_id,
        { limit: req.query.limit }
      );

      return res.status(200).json({
        success: true,
        data: rows,
        warehouse: {
          id:   gate.warehouse_id,
          code: gate.warehouse_code,
          name: gate.warehouse_name,
        },
      });
    } catch (err) {
      console.error('❌ underground.listPendingSyncs:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  getShift: async (req, res) => {
    try {
      const me = await getFreshUser(req);
      if (!me) return res.status(401).json({ success: false, message: 'User not found.' });

      const shift_id = toInt(req.params.id);
      if (!shift_id) return res.status(400).json({ success: false, message: 'Invalid shift id.' });

      const shift = await UndergroundModel.getShiftById(shift_id);
      if (!shift) return res.status(404).json({ success: false, message: 'Shift not found.' });

      if (!isAdminRole(me)) {
        if (Number(shift.warehouse_id) !== Number(me.warehouse_assigned)) {
          return res.status(403).json({ success: false, message: 'Shift belongs to another warehouse.' });
        }
      }

      return res.status(200).json({ success: true, data: shift });
    } catch (err) {
      console.error('❌ underground.getShift:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  getShiftLines: async (req, res) => {
    try {
      const me = await getFreshUser(req);
      if (!me) return res.status(401).json({ success: false, message: 'User not found.' });

      const shift_id = toInt(req.params.id);
      if (!shift_id) return res.status(400).json({ success: false, message: 'Invalid shift id.' });

      const shift = await UndergroundModel.getShiftById(shift_id);
      if (!shift) return res.status(404).json({ success: false, message: 'Shift not found.' });

      if (!isAdminRole(me)) {
        if (Number(shift.warehouse_id) !== Number(me.warehouse_assigned)) {
          return res.status(403).json({ success: false, message: 'Shift belongs to another warehouse.' });
        }
      }

      const result = await UndergroundModel.getShiftLines(shift_id, {
        kind:  req.query.kind,
        page:  req.query.page,
        limit: req.query.limit,
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
      console.error('❌ underground.getShiftLines:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  availableSeeds: async (req, res) => {
    try {
      const me = await getFreshUser(req);
      if (!me) return res.status(401).json({ success: false, message: 'User not found.' });

      const gate = await checkUndergroundGate(me);
      if (!gate.ok) return res.status(403).json({ success: false, message: gate.message });

      const days     = toInt(req.query.days) || 7;
      const limit    = toInt(req.query.limit) || 50;
      const showUsed = String(req.query.show_used || '').toLowerCase() === '1'
        || String(req.query.show_used || '').toLowerCase() === 'true';

      const rows = await UndergroundModel.listAvailableSeeds({
        warehouse_code: gate.warehouse_code,
        days,
        limit,
        show_used: showUsed,
      });

      return res.status(200).json({
        success: true,
        data: rows,
        warehouse_code: gate.warehouse_code,
        days,
        show_used: showUsed,
      });
    } catch (err) {
      console.error('❌ underground.availableSeeds:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  openShift: async (req, res) => {
    try {
      const me = await getFreshUser(req);
      if (!me) return res.status(401).json({ success: false, message: 'User not found.' });

      const gate = await checkUndergroundGate(me);
      if (!gate.ok) return res.status(403).json({ success: false, message: gate.message });

      const body = req.body || {};
      let seedLogId = toInt(body.seed_log_id);

      if (!seedLogId && body.seed_export_uid) {
        const rows = await query(
          `SELECT export_id FROM dbo.locator_export_log WHERE export_uid = @param0`,
          [String(body.seed_export_uid).trim()]
        );
        seedLogId = rows[0]?.export_id || null;
      }
      if (!seedLogId) {
        return res.status(400).json({
          success: false,
          message: 'seed_log_id or seed_export_uid is required.',
        });
      }

      const seedHeader = await LocatorLogModel.getLogById(seedLogId);
      if (!seedHeader) {
        return res.status(404).json({ success: false, message: 'Seed export not found.' });
      }
      if (seedHeader.direction !== 'Export') {
        return res.status(400).json({ success: false, message: 'Seed must be a surface export.' });
      }
      if (String(seedHeader.source_warehouse_code || '').trim().toUpperCase() !==
          String(gate.warehouse_code).trim().toUpperCase()) {
        return res.status(400).json({
          success: false,
          message: `Seed export was for warehouse ${seedHeader.source_warehouse_code}, not ${gate.warehouse_code}.`,
        });
      }

      const rawSeedLines = await query(
        `SELECT locator_code, locator_name, item_code, item_name,
                barcode, uom, category, purchase_class, gl_class,
                qty, unit_cost, line_total
           FROM dbo.locator_export_log_items
          WHERE export_id = @param0
          ORDER BY line_id`,
        [seedLogId]
      );
      if (!rawSeedLines.length) {
        return res.status(400).json({ success: false, message: 'Seed export has no item lines.' });
      }

      const seedLines = await normalizeSeedLinesWithUom(rawSeedLines);

      const { shift_id } = await UndergroundModel.openShift({
        warehouse_id:     gate.warehouse_id,
        warehouse_code:   gate.warehouse_code,
        handler_id:       me.id,
        handler_username: me.username,
        handler_position: me.emp_position,
        seed_log_id:      seedLogId,
        seed_export_uid:  seedHeader.export_uid,
        seed_file_hash:   seedHeader.file_hash,
        seed_lines:       seedLines,
      });

      const locatorSet = new Set(seedLines.map((l) => l.locator_code));
      const totalQty   = seedLines.reduce((s, l) => s + (Number(l.qty) || 0), 0);
      const totalValue = seedLines.reduce((s, l) => s + (Number(l.line_total) || 0), 0);

      const log = await createLogSafe({
        direction:             'Import',
        action_type:           'Underground Seed Import',
        export_format:         'Excel',
        source_warehouse_code: seedHeader.source_warehouse_code,
        source_warehouse_name: seedHeader.source_warehouse_name,
        target_warehouse_code: gate.warehouse_code,
        target_warehouse_name: gate.warehouse_name,
        performed_by_id:       me.id,
        performed_by_username: me.username,
        performed_by_role:     me.user_role,
        performed_by_position: me.emp_position,
        locator_count:         locatorSet.size,
        item_row_count:        seedLines.length,
        total_qty:             round4(totalQty),
        total_value:           round4(totalValue),
        filename:              seedHeader.filename || null,
        file_hash:             seedHeader.file_hash || null,
        file_size_bytes:       seedHeader.file_size_bytes || null,
        notes:                 body.notes || `Seed import for shift #${shift_id}`,
        linked_export_id:      seedLogId,
      }, []);

      return res.status(201).json({
        success: true,
        message: `Shift opened from ${seedHeader.export_uid}. Import logged as ${log.export_uid}.`,
        data: {
          shift_id,
          seed_import_uid: log.export_uid,
          seed_export_uid: seedHeader.export_uid,
          beginning_line_count: seedLines.length,
        },
      });
    } catch (err) {
      console.error('❌ underground.openShift:', err);
      const msg = String(err.message || '');
      const status = /already has an open shift|You already have an open shift/i.test(msg) ? 409 : 500;
      return res.status(status).json({
        success: false,
        message: msg || 'Failed to open shift.',
        error: process.env.NODE_ENV === 'development' ? msg : undefined,
      });
    }
  },

  releaseLines: async (req, res) => {
    try {
      const me = await getFreshUser(req);
      if (!me) return res.status(401).json({ success: false, message: 'User not found.' });

      const gate = await checkUndergroundGate(me);
      if (!gate.ok) return res.status(403).json({ success: false, message: gate.message });

      const shift_id = toInt(req.params.id);
      if (!shift_id) return res.status(400).json({ success: false, message: 'Invalid shift id.' });

      const shift = await UndergroundModel.getShiftById(shift_id);
      if (!shift) return res.status(404).json({ success: false, message: 'Shift not found.' });
      if (Number(shift.warehouse_id) !== Number(gate.warehouse_id)) {
        return res.status(403).json({ success: false, message: 'Shift belongs to another warehouse.' });
      }

      const lines = Array.isArray(req.body?.lines) ? req.body.lines : [];
      if (!lines.length) {
        return res.status(400).json({ success: false, message: 'At least one line is required.' });
      }

      const result = await UndergroundModel.releaseLines({
        shift_id,
        released_by: me.username,
        lines,
      });

      return res.status(201).json({
        success: true,
        message: `${result.inserted} line(s) released.`,
        data: result,
      });
    } catch (err) {
      console.error('❌ underground.releaseLines:', err);
      const msg = String(err.message || '');
      const status = /Insufficient|No underground stock|qty must be/i.test(msg) ? 400 : 500;
      return res.status(status).json({
        success: false,
        message: msg || 'Failed to record release.',
        error: process.env.NODE_ENV === 'development' ? msg : undefined,
      });
    }
  },

  closeShift: async (req, res) => {
    try {
      const me = await getFreshUser(req);
      if (!me) return res.status(401).json({ success: false, message: 'User not found.' });

      const gate = await checkUndergroundGate(me);
      if (!gate.ok) return res.status(403).json({ success: false, message: gate.message });

      const shift_id = toInt(req.params.id);
      if (!shift_id) return res.status(400).json({ success: false, message: 'Invalid shift id.' });

      const shift = await UndergroundModel.getShiftById(shift_id);
      if (!shift) return res.status(404).json({ success: false, message: 'Shift not found.' });
      if (Number(shift.warehouse_id) !== Number(gate.warehouse_id)) {
        return res.status(403).json({ success: false, message: 'Shift belongs to another warehouse.' });
      }
      if (shift.status !== 'Open') {
        return res.status(400).json({
          success: false,
          message: `Shift #${shift_id} is not Open (status=${shift.status}).`,
        });
      }

      const body = req.body || {};

      const rawReleaseLines = await fetchReleaseLines(shift_id);

      const releaseLines = coerceReleaseLineNumerics(rawReleaseLines);
      const locatorSet   = new Set(releaseLines.map((l) => l.locator_code));

      const totalQty   = round4(
        releaseLines.reduce((s, l) => s + Number(l.qty        || 0), 0)
      );
      const totalValue = round4(
        releaseLines.reduce((s, l) => s + Number(l.line_total || 0), 0)
      );

      const log = await createLogSafe({
        direction:             'Export',
        action_type:           'Underground Shift Close',
        export_format:         'Excel',
        source_warehouse_code: gate.warehouse_code,
        source_warehouse_name: gate.warehouse_name,
        target_warehouse_code: gate.warehouse_code,
        target_warehouse_name: gate.warehouse_name,
        performed_by_id:       me.id,
        performed_by_username: me.username,
        performed_by_role:     me.user_role,
        performed_by_position: me.emp_position,
        locator_count:         locatorSet.size,
        item_row_count:        releaseLines.length,
        total_qty:             totalQty,
        total_value:           totalValue,
        filename:              body.filename || null,
        file_hash:             body.file_hash || null,
        file_size_bytes:       body.file_size_bytes || null,
        notes:                 body.notes || `Shift #${shift_id} closed`,
        linked_export_id:      shift.seed_log_id || null,
      }, releaseLines);

      await UndergroundModel.setClosingLog({
        shift_id,
        closing_log_id:     log.export_id,
        closing_export_uid: log.export_uid,
      });

      const closed = await UndergroundModel.closeShift({
        shift_id,
        notes: body.notes || null,
      });

      try {
        require('../../services/peerHeartbeat').pulse();
      } catch { /* non-fatal */ }

      return res.status(200).json({
        success: true,
        message: `Shift #${shift_id} closed. Export logged as ${log.export_uid}.`,
        data: {
          shift_id,
          closing_export_uid: log.export_uid,
          released_qty:       closed.released_qty,
          released_value:     closed.released_value,
          release_line_count: closed.release_line_count,
          ending_qty:         closed.ending_qty,
          ending_value:       closed.ending_value,
          sync_token:         closed.sync_token || null,
        },
      });
    } catch (err) {
      console.error('❌ underground.closeShift:', err);
      const msg = String(err.message || '');
      const status = /not Open|not found/i.test(msg) ? 400 : 500;
      return res.status(status).json({
        success: false,
        message: msg || 'Failed to close shift.',
        error: process.env.NODE_ENV === 'development' ? msg : undefined,
      });
    }
  },

  syncOnline: async (req, res) => {
    try {
      const me = await getFreshUser(req);
      if (!me) return res.status(401).json({ success: false, message: 'User not found.' });

      const shift_id = toInt(req.params.id);
      if (!shift_id) return res.status(400).json({ success: false, message: 'Invalid shift id.' });

      const shift = await UndergroundModel.getShiftById(shift_id);
      if (!shift) return res.status(404).json({ success: false, message: 'Shift not found.' });

      const gate = await checkSyncGate(me, shift);
      if (!gate.ok) return res.status(403).json({ success: false, message: gate.message });

      if (shift.status === 'Reconciled') {
        return res.status(409).json({
          success: false,
          code: 'ALREADY_SYNCED',
          message: 'This shift has already been synced. No stock changes were made.',
          data: {
            shift_id:               shift.shift_id,
            reconciled_at:          shift.reconciled_at,
            reconciled_by_username: shift.reconciled_by_username,
          },
        });
      }

      if (shift.status !== 'Closed') {
        return res.status(400).json({
          success: false,
          code: 'SHIFT_NOT_CLOSED',
          message: `Shift #${shift_id} must be closed before it can be synced.`,
        });
      }

      const body = req.body || {};
      const providedToken = body.sync_token ? String(body.sync_token).trim() : null;
      if (providedToken && shift.sync_token && providedToken !== shift.sync_token) {
        return res.status(400).json({
          success: false,
          code: 'TOKEN_MISMATCH',
          message: 'The sync token does not match this shift.',
        });
      }

      if (surfaceSyncClient.isRemoteSyncEnabled()) {
        const payload = await UndergroundModel.getShiftPayloadForPush(shift_id);
        if (!payload || !payload.release_lines.length) {
          return res.status(400).json({
            success: false,
            code: 'NO_RELEASE_LINES',
            message: 'This shift has no release lines to sync.',
          });
        }

        const pushBody = {
          sync_token:       shift.sync_token,
          source_shift_id:  shift.shift_id,
          source_server:    process.env.IMS_SERVER_ID || null,
          warehouse_code:   shift.warehouse_code,
          handler_username: shift.handler_username,
          handler_position: shift.handler_position,
          closed_at:        shift.ended_at,
          totals: {
            beginning_qty:       Number(shift.beginning_qty  || 0),
            beginning_value:     Number(shift.beginning_value || 0),
            released_qty:        Number(shift.released_qty   || 0),
            released_value:      Number(shift.released_value || 0),
            ending_qty:          Number(shift.ending_qty     || 0),
            ending_value:        Number(shift.ending_value   || 0),
            release_line_count:  Number(shift.release_line_count || 0),
          },
          release_lines: payload.release_lines.map((l) => ({
            locator_code:   l.locator_code,
            locator_name:   l.locator_name,
            item_code:      l.item_code,
            item_name:      l.item_name,
            uom:            l.uom,
            barcode:        l.barcode,
            category:       l.category,
            purchase_class: l.purchase_class,
            gl_class:       l.gl_class,
            qty:            Number(l.qty),
            unit_cost:      Number(l.unit_cost  || 0),
            line_total:     Number(l.line_total || 0),
            destination:    l.destination,
            remarks:        l.remarks,
            line_kind:      l.line_kind || 'Release',
          })),
        };

        let push;
        try {
          push = await surfaceSyncClient.pushShiftPayload(pushBody);
        } catch (netErr) {
          console.error('❌ syncOnline remote push failed:', netErr.message);
          return res.status(502).json({
            success: false,
            code: netErr.code || 'SURFACE_UNREACHABLE',
            message: netErr.message || 'Could not reach the surface server.',
            data: {
              shift_id,
              sync_token: shift.sync_token,
              path: 'cross-db-online',
            },
          });
        }

        if (!push.ok && push.code === 'ALREADY_SYNCED') {
          await UndergroundModel.markShiftReconciledLocally({
            shift_id,
            sync_token: shift.sync_token,
            reconciled_by_username: me.username,
          });
          return res.status(200).json({
            success: true,
            message: 'Shift was already synced on the surface. Local state updated.',
            data: {
              shift_id,
              sync_token: shift.sync_token,
              remote_export_uid: push.data?.export_uid || null,
              already_synced: true,
              path: 'cross-db-online',
            },
          });
        }

        if (!push.ok) {
          return res.status(502).json({
            success: false,
            code: push.code || 'SURFACE_PUSH_FAILED',
            message: push.message || 'The surface server rejected the sync.',
            data: {
              shift_id,
              sync_token: shift.sync_token,
              path: 'cross-db-online',
            },
          });
        }

        await UndergroundModel.markShiftReconciledLocally({
          shift_id,
          sync_token: shift.sync_token,
          reconciled_by_username: me.username,
        });

        return res.status(200).json({
          success: true,
          message: `Synced to surface · ${push.data?.export_uid || '(unknown)'}. `
                 + `${push.data?.reconciled_lines || 0} line(s) applied.`,
          data: {
            shift_id,
            sync_token:           shift.sync_token,
            remote_export_id:     push.data?.export_id || null,
            remote_export_uid:    push.data?.export_uid || null,
            reconciled_lines:     push.data?.reconciled_lines || 0,
            path:                 'cross-db-online',
          },
        });
      }

      const rawReleaseLines = await fetchReleaseLines(shift_id);
      const releaseLines    = coerceReleaseLineNumerics(rawReleaseLines);
      const locatorSet      = new Set(releaseLines.map((l) => l.locator_code));

      const reconLog = await createLogSafe({
        direction:             'Import',
        action_type:           'Underground Reconciliation',
        export_format:         'Online',
        source_warehouse_code: shift.warehouse_code,
        source_warehouse_name: shift.warehouse_code,
        target_warehouse_code: shift.warehouse_code,
        target_warehouse_name: shift.warehouse_code,
        performed_by_id:       me.id,
        performed_by_username: me.username,
        performed_by_role:     me.user_role,
        performed_by_position: me.emp_position,
        locator_count:         locatorSet.size,
        item_row_count:        releaseLines.length,
        total_qty:             round4(shift.released_qty),
        total_value:           round4(shift.released_value),
        filename:              null,
        file_hash:             null,
        file_size_bytes:       null,
        notes:                 body.notes || `Online sync of shift #${shift_id}`,
        linked_export_id:      shift.closing_log_id || null,
        sync_token:            shift.sync_token || null,
      }, releaseLines);

      const result = await UndergroundModel.reconcileShift({
        shift_id,
        reconciled_by_username: me.username,
        reconciliation_log_id:  reconLog.export_id,
      });

      return res.status(200).json({
        success: true,
        message: `Synced · ${reconLog.export_uid}. ${result.reconciled_lines} line(s) applied.`,
        data: {
          shift_id,
          reconciliation_uid: reconLog.export_uid,
          reconciled_lines:   result.reconciled_lines,
          sync_token:         shift.sync_token || null,
          path:               'online',
        },
      });
    } catch (err) {
      console.error('❌ underground.syncOnline:', err);
      const msg = String(err.message || '');
      const status = /Insufficient|must be Closed|already Reconciled|not found/i.test(msg) ? 400 : 500;
      return res.status(status).json({
        success: false,
        message: msg || 'Failed to sync online.',
        error: process.env.NODE_ENV === 'development' ? msg : undefined,
      });
    }
  },

  receiveOnlineSync: async (req, res) => {
    try {
      const body = req.body || {};

      const syncToken = String(body.sync_token || '').trim();
      if (!syncToken) {
        return res.status(400).json({
          success: false,
          code: 'MISSING_SYNC_TOKEN',
          message: 'sync_token is required.',
        });
      }

      const warehouseCode = String(body.warehouse_code || '').trim().toUpperCase();
      if (!warehouseCode) {
        return res.status(400).json({
          success: false,
          code: 'MISSING_WAREHOUSE_CODE',
          message: 'warehouse_code is required.',
        });
      }

      const releaseLines = Array.isArray(body.release_lines) ? body.release_lines : [];
      
      const sanitised = [];
      for (const l of releaseLines) {
        if (!l || !l.locator_code) {
          return res.status(400).json({
            success: false,
            code: 'BAD_LINE',
            message: 'Each release line requires locator_code.',
          });
        }
        if (!l.item_code) {
          return res.status(400).json({
            success: false,
            code: 'BAD_LINE',
            message: 'Each release line requires item_code.',
          });
        }
        const q = Number(l.qty);
        if (!(q > 0)) {
          return res.status(400).json({
            success: false,
            code: 'BAD_LINE',
            message: `Each release line qty must be > 0 (got ${l.qty}).`,
          });
        }
        sanitised.push({
          locator_code:   String(l.locator_code).trim(),
          locator_name:   l.locator_name   ?? null,
          item_code:      String(l.item_code).trim(),
          item_name:      l.item_name      ?? null,
          uom:            l.uom            ?? null,
          barcode:        l.barcode        ?? null,
          category:       l.category       ?? null,
          purchase_class: l.purchase_class ?? null,
          gl_class:       l.gl_class       ?? null,
          qty:            q,
          unit_cost:      Number(l.unit_cost)  || 0,
          line_total:     Number(l.line_total) || 0,
          destination:    l.destination ?? null,
          remarks:        l.remarks     ?? null,
          line_kind:      l.line_kind   ?? 'Release',
        });
      }

      const result = await UndergroundModel.applyRemoteReconcile({
        sync_token:       syncToken,
        warehouse_code:   warehouseCode,
        release_lines:    sanitised,
        source_shift_id:  body.source_shift_id || null,
        source_server:    req.syncSource || body.source_server || 'underground',
        handler_username: body.handler_username || null,
        handler_position: body.handler_position || null,
        source_totals:    body.totals || {},
      });

      const sourceServerId = String(body.source_server || req.syncSource || '').trim();
      if (sourceServerId && sourceServerId !== 'underground' && sourceServerId !== 'surface') {
        SyncPeerModel.markSynced(sourceServerId).catch(() => {});
      }

      if (result.already_synced) {
        return res.status(409).json({
          success: false,
          code: 'ALREADY_SYNCED',
          message: 'This shift has already been synced to this server.',
          data: {
            export_id:  result.export_id,
            export_uid: result.export_uid,
            sync_token: syncToken,
          },
        });
      }

      return res.status(200).json({
        success: true,
        message: `Cross-DB sync applied · ${result.export_uid}. ${result.reconciled_lines} line(s).`,
        data: {
          export_id:        result.export_id,
          export_uid:       result.export_uid,
          reconciled_lines: result.reconciled_lines,
          sync_token:       syncToken,
        },
      });
    } catch (err) {
      console.error('❌ underground.receiveOnlineSync:', err);
      const msg = String(err.message || '');

      let status = 500;
      let code   = 'RECEIVE_FAILED';
      if (/Warehouse .* not found/i.test(msg)) {
        status = 404; code = 'WAREHOUSE_NOT_FOUND';
      } else if (/Warehouse .* is deactivated/i.test(msg)) {
        status = 400; code = 'WAREHOUSE_DEACTIVATED';
      } else if (/Insufficient stock/i.test(msg)) {
        status = 409; code = 'STOCK_MISMATCH';
      }

      return res.status(status).json({
        success: false,
        code,
        message: msg || 'Failed to apply cross-DB sync.',
        error: process.env.NODE_ENV === 'development' ? msg : undefined,
      });
    }
  },

  peerHeartbeat: async (req, res) => {
    try {
      const body = req.body || {};
      const serverId      = String(body.server_id || '').trim();
      const warehouseCode = String(body.warehouse_code || '').trim().toUpperCase();

      if (!serverId) {
        return res.status(400).json({
          success: false,
          code: 'MISSING_SERVER_ID',
          message: 'server_id is required.',
        });
      }
      if (!warehouseCode) {
        return res.status(400).json({
          success: false,
          code: 'MISSING_WAREHOUSE_CODE',
          message: 'warehouse_code is required.',
        });
      }

      const ip = extractIp(req);
      const ua = String(req.headers['user-agent'] || '').slice(0, 200) || null;

      await SyncPeerModel.upsertFromHeartbeat({
        server_id:           serverId,
        display_name:        body.display_name        || null,
        warehouse_code:      warehouseCode,
        device_hostname:     body.device_hostname     || null,
        version:             body.version             || null,
        pending_count:       body.pending_count       ?? 0,
        has_open_shift:      !!body.has_open_shift,
        active_shift_id:     body.active_shift_id     ?? null,
        active_warehouse_id: body.active_warehouse_id ?? null,
        last_ip_address:     ip,
        last_port:           body.listen_port         ?? null,
        last_user_agent:     ua,
      });

      const commands = await SyncPeerModel.fetchPendingForPeer(serverId);

      return res.status(200).json({
        success: true,
        message: commands.length
          ? `Acknowledged · ${commands.length} command(s) queued.`
          : 'Acknowledged.',
        data: { commands },
      });
    } catch (err) {
      console.error('❌ underground.peerHeartbeat:', err);
      return res.status(500).json({
        success: false,
        code: 'HEARTBEAT_FAILED',
        message: 'Failed to record heartbeat.',
        error: process.env.NODE_ENV === 'development' ? (err.message || String(err)) : undefined,
      });
    }
  },

  peerCommandResult: async (req, res) => {
    try {
      const body = req.body || {};
      const commandId = toInt(body.command_id);
      if (!commandId) {
        return res.status(400).json({
          success: false,
          code: 'MISSING_COMMAND_ID',
          message: 'command_id is required.',
        });
      }

      const status = String(body.status || '').trim().toLowerCase();
      if (status !== 'done' && status !== 'failed') {
        return res.status(400).json({
          success: false,
          code: 'BAD_STATUS',
          message: "status must be 'done' or 'failed'.",
        });
      }

      if (status === 'done') {
        await SyncPeerModel.markCommandDone({
          command_id:     commandId,
          result_code:    body.code    || 'OK',
          result_message: body.message || null,
          result:         body.data    || null,
        });
      } else {
        await SyncPeerModel.markCommandFailed({
          command_id:     commandId,
          result_code:    body.code    || 'FAILED',
          result_message: body.message || null,
          result:         body.data    || null,
        });
      }

      return res.status(200).json({ success: true, message: 'Result recorded.' });
    } catch (err) {
      console.error('❌ underground.peerCommandResult:', err);
      return res.status(500).json({
        success: false,
        code: 'RESULT_RECORD_FAILED',
        message: 'Failed to record command result.',
        error: process.env.NODE_ENV === 'development' ? (err.message || String(err)) : undefined,
      });
    }
  },

  listPeers: async (req, res) => {
    try {
      const me = await getFreshUser(req);
      if (!me) return res.status(401).json({ success: false, message: 'User not found.' });

      const requestedWarehouseId = toInt(req.query.warehouse_id);
      const gate = await checkSurfaceViewGate(me, requestedWarehouseId);
      if (!gate.ok) return res.status(403).json({ success: false, message: gate.message });

      const peers = await SyncPeerModel.listPeers({
        warehouse_code: gate.warehouse_code,
      });

      return res.status(200).json({
        success: true,
        data: peers,
        warehouse: {
          id:   gate.warehouse_id,
          code: gate.warehouse_code,
          name: gate.warehouse_name,
        },
      });
    } catch (err) {
      console.error('❌ underground.listPeers:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  createPeerCommand: async (req, res) => {
    try {
      const me = await getFreshUser(req);
      if (!me) return res.status(401).json({ success: false, message: 'User not found.' });

      const requestedWarehouseId = toInt(req.query.warehouse_id);
      const gate = await checkSurfaceViewGate(me, requestedWarehouseId);
      if (!gate.ok) return res.status(403).json({ success: false, message: gate.message });

      const serverId = String(req.params.server_id || '').trim();
      if (!serverId) {
        return res.status(400).json({ success: false, message: 'server_id is required.' });
      }

      const peer = await SyncPeerModel.getPeer(serverId);
      if (!peer) {
        return res.status(404).json({ success: false, message: `Peer "${serverId}" is not registered.` });
      }
      if (normCode(peer.warehouse_code) !== normCode(gate.warehouse_code)) {
        return res.status(403).json({
          success: false,
          message: `Peer "${serverId}" belongs to warehouse ${peer.warehouse_code}, not ${gate.warehouse_code}.`,
        });
      }

      const body = req.body || {};
      const kind = String(body.kind || '').trim();
      if (!kind) {
        return res.status(400).json({ success: false, message: 'kind is required.' });
      }

      const allowed = ['pull_shift', 'mark_reconciled', 'noop'];
      if (!allowed.includes(kind)) {
        return res.status(400).json({
          success: false,
          message: `kind must be one of: ${allowed.join(', ')}.`,
        });
      }

      if (kind === 'pull_shift') {
        const shift_id = toInt(body.payload?.shift_id);
        if (!shift_id) {
          return res.status(400).json({
            success: false,
            message: 'pull_shift requires payload.shift_id.',
          });
        }
      }

      const { command_id } = await SyncPeerModel.enqueueCommand({
        server_id:  serverId,
        kind,
        payload:    body.payload || null,
        created_by: me.username,
      });

      return res.status(201).json({
        success: true,
        message: `Command queued for ${serverId}. It will be picked up on the next heartbeat (≤30s).`,
        data: {
          command_id,
          server_id:  serverId,
          kind,
          status:     'pending',
        },
      });
    } catch (err) {
      console.error('❌ underground.createPeerCommand:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  listPeerCommands: async (req, res) => {
    try {
      const me = await getFreshUser(req);
      if (!me) return res.status(401).json({ success: false, message: 'User not found.' });

      const requestedWarehouseId = toInt(req.query.warehouse_id);
      const gate = await checkSurfaceViewGate(me, requestedWarehouseId);
      if (!gate.ok) return res.status(403).json({ success: false, message: gate.message });

      const serverId = String(req.params.server_id || '').trim();
      if (!serverId) {
        return res.status(400).json({ success: false, message: 'server_id is required.' });
      }

      const peer = await SyncPeerModel.getPeer(serverId);
      if (!peer) {
        return res.status(404).json({ success: false, message: `Peer "${serverId}" is not registered.` });
      }
      if (normCode(peer.warehouse_code) !== normCode(gate.warehouse_code)) {
        return res.status(403).json({
          success: false,
          message: `Peer "${serverId}" belongs to warehouse ${peer.warehouse_code}, not ${gate.warehouse_code}.`,
        });
      }

      const commands = await SyncPeerModel.listCommandsForPeer(serverId, {
        limit: toInt(req.query.limit) || 20,
      });

      return res.status(200).json({ success: true, data: commands });
    } catch (err) {
      console.error('❌ underground.listPeerCommands:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  remoteExportPending: async (req, res) => {
    try {
      const whCode = normCode(req.query.warehouse_code) || null;

      const rows = await query(
        `SELECT TOP 200
           s.shift_id,
           s.warehouse_id,
           s.warehouse_code,
           s.handler_username,
           s.status,
           s.started_at,
           s.ended_at,
           s.seed_export_uid,
           s.closing_export_uid,
           s.release_line_count,
           s.released_qty,
           s.released_value,
           s.ending_qty,
           s.ending_value,
           s.sync_token,
           s.reconciled_at
         FROM dbo.underground_shift s
         WHERE s.status = 'Closed'
           AND s.reconciled_at IS NULL
           ${whCode ? 'AND UPPER(s.warehouse_code) = @param0' : ''}
         ORDER BY s.ended_at DESC, s.shift_id DESC`,
        whCode ? [whCode] : []
      );

      let warehouseMismatch = false;
      if (whCode) {
        const ownWh = String(process.env.IMS_WAREHOUSE_CODE || '').trim().toUpperCase();
        if (ownWh && ownWh !== whCode) warehouseMismatch = true;
      }

      return res.status(200).json({
        success: true,
        data: rows,
        server_id: String(process.env.IMS_SERVER_ID || '').trim() || null,
        warehouse_code: String(process.env.IMS_WAREHOUSE_CODE || '').trim() || null,
        warehouse_mismatch: warehouseMismatch,
      });
    } catch (err) {
      console.error('❌ underground.remoteExportPending:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  remoteExportShift: async (req, res) => {
    try {
      const shift_id = toInt(req.params.id);
      if (!shift_id) {
        return res.status(400).json({ success: false, message: 'Invalid shift id.' });
      }

      const payload = await UndergroundModel.getShiftPayloadForPush(shift_id);
      if (!payload || !payload.shift) {
        return res.status(404).json({ success: false, message: `Shift ${shift_id} not found.` });
      }

      return res.status(200).json({
        success: true,
        data: {
          sync_token:       payload.shift.sync_token,
          source_shift_id:  payload.shift.shift_id,
          source_server:    String(process.env.IMS_SERVER_ID || '').trim() || null,
          warehouse_code:   payload.shift.warehouse_code,
          handler_username: payload.shift.handler_username,
          handler_position: payload.shift.handler_position,
          closed_at:        payload.shift.ended_at,
          totals: {
            beginning_qty:       Number(payload.shift.beginning_qty  || 0),
            beginning_value:     Number(payload.shift.beginning_value || 0),
            released_qty:        Number(payload.shift.released_qty   || 0),
            released_value:      Number(payload.shift.released_value || 0),
            ending_qty:          Number(payload.shift.ending_qty     || 0),
            ending_value:        Number(payload.shift.ending_value   || 0),
            release_line_count:  Number(payload.shift.release_line_count || 0),
          },
          release_lines: payload.release_lines.map((l) => ({
            locator_code:   l.locator_code,
            locator_name:   l.locator_name,
            item_code:      l.item_code,
            item_name:      l.item_name,
            uom:            l.uom,
            barcode:        l.barcode,
            category:       l.category,
            purchase_class: l.purchase_class,
            gl_class:       l.gl_class,
            qty:            Number(l.qty),
            unit_cost:      Number(l.unit_cost  || 0),
            line_total:     Number(l.line_total || 0),
            destination:    l.destination,
            remarks:        l.remarks,
            line_kind:      l.line_kind || 'Release',
          })),
        },
      });
    } catch (err) {
      console.error('❌ underground.remoteExportShift:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  remoteMarkReconciled: async (req, res) => {
    try {
      const shift_id = toInt(req.body?.shift_id);
      const sync_token = req.body?.sync_token ? String(req.body.sync_token).trim() : null;

      if (!shift_id) {
        return res.status(400).json({ success: false, message: 'shift_id is required.' });
      }

      await UndergroundModel.markShiftReconciledLocally({
        shift_id,
        sync_token,
        reconciled_by_username: 'surface-requested',
      });

      return res.status(200).json({ success: true, message: `Shift ${shift_id} marked Reconciled locally.` });
    } catch (err) {
      console.error('❌ underground.remoteMarkReconciled:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  liveDeltas: async (req, res) => {
    try {
      const me = await getFreshUser(req);
      if (!me) return res.status(401).json({ success: false, message: 'User not found.' });

      const gate = await checkUndergroundGate(me);
      if (!gate.ok) return res.status(403).json({ success: false, message: gate.message });

      const shift_id = toInt(req.params.id);
      if (!shift_id) return res.status(400).json({ success: false, message: 'Invalid shift id.' });

      const shift = await UndergroundModel.getShiftById(shift_id);
      if (!shift) return res.status(404).json({ success: false, message: 'Shift not found.' });
      if (Number(shift.warehouse_id) !== Number(gate.warehouse_id)) {
        return res.status(403).json({ success: false, message: 'Shift belongs to another warehouse.' });
      }

      const asOf = new Date().toISOString();

      if (shift.status !== 'Open' && shift.status !== 'Closed') {
        return res.status(200).json({
          success: true,
          data: {
            shift_id,
            warehouse_code: gate.warehouse_code,
            since:          shift.started_at,
            as_of:          asOf,
            status:         shift.status,
            items:          [],
            totals:         { net_qty: 0, net_value: 0, items: 0 },
            note:           'Shift is not in a live-viewable state.',
          },
        });
      }

      const items = await UndergroundModel.getSurfaceDeltasSince({
        warehouse_id: shift.warehouse_id,
        since:        shift.started_at,
        limit:        req.query.limit,
      });

      const totals = items.reduce(
        (acc, r) => ({
          net_qty:   acc.net_qty   + Number(r.delta_qty   || 0),
          net_value: acc.net_value + Number(r.delta_value || 0),
          items:     acc.items     + 1,
        }),
        { net_qty: 0, net_value: 0, items: 0 }
      );

      return res.status(200).json({
        success: true,
        data: {
          shift_id,
          warehouse_code: gate.warehouse_code,
          since:          shift.started_at,
          as_of:          asOf,
          status:         shift.status,
          items,
          totals: {
            net_qty:   round4(totals.net_qty),
            net_value: round4(totals.net_value),
            items:     totals.items,
          },
        },
      });
    } catch (err) {
      console.error('❌ underground.liveDeltas:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  reconcileShift: async (req, res) => {
    try {
      const me = await getFreshUser(req);
      if (!me) return res.status(401).json({ success: false, message: 'User not found.' });

      const shift_id = toInt(req.params.id);
      if (!shift_id) return res.status(400).json({ success: false, message: 'Invalid shift id.' });

      const shift = await UndergroundModel.getShiftById(shift_id);
      if (!shift) return res.status(404).json({ success: false, message: 'Shift not found.' });

      const gate = await checkReconcileGate(me, shift);
      if (!gate.ok) return res.status(403).json({ success: false, message: gate.message });

      const rawReleaseLines = await fetchReleaseLines(shift_id);
      const releaseLines = coerceReleaseLineNumerics(rawReleaseLines);

      const body = req.body || {};
      const locatorSet = new Set(releaseLines.map((l) => l.locator_code));

      const log = await createLogSafe({
        direction:             'Import',
        action_type:           'Underground Reconciliation',
        export_format:         'Excel',
        source_warehouse_code: shift.warehouse_code,
        source_warehouse_name: null,
        target_warehouse_code: shift.warehouse_code,
        target_warehouse_name: null,
        performed_by_id:       me.id,
        performed_by_username: me.username,
        performed_by_role:     me.user_role,
        performed_by_position: me.emp_position,
        locator_count:         locatorSet.size,
        item_row_count:        releaseLines.length,
        total_qty:             round4(shift.released_qty),
        total_value:           round4(shift.released_value),
        filename:              body.filename || null,
        file_hash:             body.file_hash || null,
        file_size_bytes:       body.file_size_bytes || null,
        notes:                 body.notes || `Reconciliation of shift #${shift_id}`,
        linked_export_id:      shift.closing_log_id || null,
      }, releaseLines);

      const result = await UndergroundModel.reconcileShift({
        shift_id,
        reconciled_by_username: me.username,
        reconciliation_log_id:  log.export_id,
      });

      return res.status(200).json({
        success: true,
        message: `Shift #${shift_id} reconciled. ${result.reconciled_lines} line(s) applied.`,
        data: {
          shift_id,
          reconciliation_uid: log.export_uid,
          reconciled_lines:   result.reconciled_lines,
        },
      });
    } catch (err) {
      console.error('❌ underground.reconcileShift:', err);
      const msg = String(err.message || '');
      const status = /Insufficient|must be Closed|already Reconciled|not found/i.test(msg) ? 400 : 500;
      return res.status(status).json({
        success: false,
        message: msg || 'Failed to reconcile shift.',
        error: process.env.NODE_ENV === 'development' ? msg : undefined,
      });
    }
  },

  getClosePayload: async (req, res) => {
    try {
      const me = await getFreshUser(req);
      if (!me) return res.status(401).json({ success: false, message: 'User not found.' });

      const gate = await checkUndergroundGate(me);
      if (!gate.ok) return res.status(403).json({ success: false, message: gate.message });

      const shift_id = toInt(req.params.id);
      if (!shift_id) return res.status(400).json({ success: false, message: 'Invalid shift id.' });

      const shift = await UndergroundModel.getShiftById(shift_id);
      if (!shift) return res.status(404).json({ success: false, message: 'Shift not found.' });
      if (Number(shift.warehouse_id) !== Number(gate.warehouse_id)) {
        return res.status(403).json({ success: false, message: 'Shift belongs to another warehouse.' });
      }
      if (shift.status !== 'Open') {
        return res.status(400).json({
          success: false,
          message: `Shift #${shift_id} is not Open (status=${shift.status}).`,
        });
      }

      const [beginningLines, rawReleaseLines] = await Promise.all([
        fetchBeginningLines(shift_id),
        fetchReleaseLines(shift_id),
      ]);

      const releaseLines = coerceReleaseLineNumerics(rawReleaseLines);

      const issuedLines = releaseLines.filter(l => l.line_kind === 'Release');
      const damagedLines = releaseLines.filter(l => l.line_kind === 'Damage');
      const transferOutLines = releaseLines.filter(l => l.line_kind === 'Transfer-Out');
      const transferInLines = releaseLines.filter(l => l.line_kind === 'Transfer-In');

      const issuedQty   = issuedLines.reduce((s, l) => s + (Number(l.qty) || 0), 0);
      const issuedValue = issuedLines.reduce((s, l) => s + (Number(l.line_total) || 0), 0);
      
      const damagedQty   = damagedLines.reduce((s, l) => s + (Number(l.qty) || 0), 0);
      const damagedValue = damagedLines.reduce((s, l) => s + (Number(l.line_total) || 0), 0);
      
      const transferOutQty   = transferOutLines.reduce((s, l) => s + (Number(l.qty) || 0), 0);
      const transferOutValue = transferOutLines.reduce((s, l) => s + (Number(l.line_total) || 0), 0);

      const transInQty   = transferInLines.reduce((s, l) => s + (Number(l.qty) || 0), 0);
      const transInValue = transferInLines.reduce((s, l) => s + (Number(l.line_total) || 0), 0);

      const totalReleasedQty = issuedQty + damagedQty + transferOutQty;
      const totalReleasedValue = issuedValue + damagedValue + transferOutValue;

      const locatorSet    = new Set(releaseLines.map((l) => l.locator_code));

      return res.status(200).json({
        success: true,
        data: {
          shift,
          warehouse: {
            id:   gate.warehouse_id,
            code: gate.warehouse_code,
            name: gate.warehouse_name,
          },
          summary: {
            beginning_line_count: beginningLines.length,
            beginning_qty:        round4(shift.beginning_qty),
            beginning_value:      round4(shift.beginning_value),
            release_line_count:   releaseLines.length,
            
            // Detailed Breakdown
            issued_qty:           round4(issuedQty),
            issued_value:         round4(issuedValue),
            damaged_qty:          round4(damagedQty),
            damaged_value:        round4(damagedValue),
            transfer_out_qty:     round4(transferOutQty),
            transfer_out_value:   round4(transferOutValue),
            trans_in_qty:         round4(transInQty),
            trans_in_value:       round4(transInValue),
            
            // Backwards-compatible totals
            released_qty:         round4(totalReleasedQty),
            released_value:       round4(totalReleasedValue),
            
            ending_qty:           round4(Number(shift.beginning_qty)   - totalReleasedQty + transInQty),
            ending_value:         round4(Number(shift.beginning_value) - totalReleasedValue + transInValue),
            locator_count:        locatorSet.size,
          },
          beginning_lines: beginningLines,
          release_lines:   releaseLines,
          generated_at:    new Date().toISOString(),
        },
      });
    } catch (err) {
      console.error('❌ underground.getClosePayload:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  openShiftFromFile: async (req, res) => {
    try {
      const me = await getFreshUser(req);
      if (!me) return res.status(401).json({ success: false, message: 'User not found.' });

      const gate = await checkUndergroundGate(me);
      if (!gate.ok) return res.status(403).json({ success: false, message: gate.message });

      const body = req.body || {};
      const fileHash = String(body.file_hash || '').trim();
      if (!fileHash || fileHash.length < 32) {
        return res.status(400).json({
          success: false,
          message: 'file_hash is required and must be a valid SHA-256 digest (hex).',
        });
      }

      const matched = await query(
        `SELECT TOP 5 *
           FROM dbo.locator_export_log
          WHERE file_hash = @param0 AND direction = 'Export'
          ORDER BY export_id DESC`,
        [fileHash]
      );

      let seedLogId     = null;
      let seedExportUid = null;
      let seedFileName  = body.filename || null;
      let seedFileSize  = body.file_size_bytes || null;
      let rawSeedLines  = null;
      let verified      = false;

      if (matched.length) {
        const logRow = matched[0];
        if (normCode(logRow.source_warehouse_code) !== normCode(gate.warehouse_code)) {
          return res.status(400).json({
            success: false,
            message: `This export was for warehouse ${logRow.source_warehouse_code}, not ${gate.warehouse_code}.`,
          });
        }

        const dbLines = await query(
          `SELECT locator_code, locator_name, item_code, item_name,
                  barcode, uom, category, purchase_class, gl_class,
                  qty, unit_cost, line_total
             FROM dbo.locator_export_log_items
            WHERE export_id = @param0
            ORDER BY line_id`,
          [logRow.export_id]
        );
        if (!dbLines.length) {
          return res.status(400).json({
            success: false,
            message: `Matched export ${logRow.export_uid} has no item lines.`,
          });
        }

        seedLogId     = logRow.export_id;
        seedExportUid = logRow.export_uid;
        seedFileName  = logRow.filename || seedFileName;
        seedFileSize  = logRow.file_size_bytes || seedFileSize;
        rawSeedLines  = dbLines;
        verified      = true;
      } else {
        const providedLines = Array.isArray(body.seed_lines) ? body.seed_lines : [];
        if (!providedLines.length) {
          return res.status(400).json({
            success: false,
            message:
              'This file does not match any export on record. ' +
              'If the export predates hash logging, please supply the parsed seed_lines from the file.',
          });
        }

        for (const l of providedLines) {
          if (!l.locator_code) throw new Error('Each seed line requires locator_code.');
          if (!l.item_code)    throw new Error('Each seed line requires item_code.');
          const q = Number(l.qty);
          if (!(q > 0))        throw new Error(`Each seed line qty must be > 0 (got ${l.qty}).`);
        }

        const locatorSet = new Set(providedLines.map((l) => String(l.locator_code)));
        const totalQty   = providedLines.reduce((s, l) => s + (Number(l.qty) || 0), 0);
        const totalValue = providedLines.reduce((s, l) => s + (Number(l.line_total) || 0), 0);

        const syntheticNotes =
          '[UNVERIFIED] Uploaded file hash did not match any existing surface export. ' +
          'Synthetic seed log created from parsed client-supplied lines.';

        const synthetic = await createLogSafe({
          direction:             'Export',
          action_type:           'Underground Seed Import',
          export_format:         'Excel',
          source_warehouse_code: gate.warehouse_code,
          source_warehouse_name: gate.warehouse_name,
          target_warehouse_code: null,
          target_warehouse_name: null,
          performed_by_id:       me.id,
          performed_by_username: me.username,
          performed_by_role:     me.user_role,
          performed_by_position: me.emp_position,
          locator_count:         locatorSet.size,
          item_row_count:        providedLines.length,
          total_qty:             round4(totalQty),
          total_value:           round4(totalValue),
          filename:              seedFileName,
          file_hash:             fileHash,
          file_size_bytes:       seedFileSize,
          notes:                 syntheticNotes,
          linked_export_id:      null,
        }, providedLines.map((l) => ({
          locator_code:   String(l.locator_code),
          locator_name:   l.locator_name   ?? null,
          item_code:      String(l.item_code),
          item_name:      l.item_name      ?? null,
          barcode:        l.barcode        ?? null,
          uom:            l.uom            ?? null,
          category:       l.category       ?? null,
          purchase_class: l.purchase_class ?? null,
          gl_class:       l.gl_class       ?? null,
          qty:            Number(l.qty),
          unit_cost:      Number(l.unit_cost)  || 0,
          line_total:     Number(l.line_total) || 0,
        })));

        seedLogId     = synthetic.export_id;
        seedExportUid = synthetic.export_uid;
        rawSeedLines  = providedLines.map((l) => ({
          locator_code:   String(l.locator_code),
          locator_name:   l.locator_name   ?? null,
          item_code:      String(l.item_code),
          item_name:      l.item_name      ?? null,
          barcode:        l.barcode        ?? null,
          uom:            l.uom            ?? null,
          category:       l.category       ?? null,
          purchase_class: l.purchase_class ?? null,
          gl_class:       l.gl_class       ?? null,
          qty:            Number(l.qty),
          unit_cost:      Number(l.unit_cost)  || 0,
          line_total:     Number(l.line_total) || 0,
        }));
        verified = false;
      }

      const seedLines = await normalizeSeedLinesWithUom(rawSeedLines);

      const { shift_id } = await UndergroundModel.openShift({
        warehouse_id:     gate.warehouse_id,
        warehouse_code:   gate.warehouse_code,
        handler_id:       me.id,
        handler_username: me.username,
        handler_position: me.emp_position,
        seed_log_id:      seedLogId,
        seed_export_uid:  seedExportUid,
        seed_file_hash:   fileHash,
        seed_lines:       seedLines,
      });

      const locatorSet = new Set(seedLines.map((l) => l.locator_code));
      const totalQty   = seedLines.reduce((s, l) => s + (Number(l.qty) || 0), 0);
      const totalValue = seedLines.reduce((s, l) => s + (Number(l.line_total) || 0), 0);

      const importNotes = body.notes
        ? (verified ? body.notes : `[UNVERIFIED] ${body.notes}`)
        : (verified
            ? `Seed import for shift #${shift_id}`
            : `[UNVERIFIED] Seed import for shift #${shift_id}`);

      const importLog = await createLogSafe({
        direction:             'Import',
        action_type:           'Underground Seed Import',
        export_format:         'Excel',
        source_warehouse_code: gate.warehouse_code,
        source_warehouse_name: gate.warehouse_name,
        target_warehouse_code: gate.warehouse_code,
        target_warehouse_name: gate.warehouse_name,
        performed_by_id:       me.id,
        performed_by_username: me.username,
        performed_by_role:     me.user_role,
        performed_by_position: me.emp_position,
        locator_count:         locatorSet.size,
        item_row_count:        seedLines.length,
        total_qty:             round4(totalQty),
        total_value:           round4(totalValue),
        filename:              seedFileName,
        file_hash:             fileHash,
        file_size_bytes:       seedFileSize,
        notes:                 importNotes,
        linked_export_id:      seedLogId,
      }, []);

      return res.status(201).json({
        success: true,
        message: verified
          ? `Shift opened from verified export ${seedExportUid}. Import logged as ${importLog.export_uid}.`
          : `Shift opened from unverified file. Synthetic seed log ${seedExportUid} created. Import logged as ${importLog.export_uid}.`,
        data: {
          shift_id,
          verified,
          seed_import_uid:       importLog.export_uid,
          seed_export_uid:       seedExportUid,
          beginning_line_count:  seedLines.length,
        },
      });
    } catch (err) {
      console.error('❌ underground.openShiftFromFile:', err);
      const msg = String(err.message || '');
      let status = 500;
      if (/already has an open shift|You already have an open shift/i.test(msg)) status = 409;
      else if (/required|qty must be|locator_code|item_code/i.test(msg)) status = 400;
      return res.status(status).json({
        success: false,
        message: msg || 'Failed to open shift from file.',
        error: process.env.NODE_ENV === 'development' ? msg : undefined,
      });
    }
  },

  reconcileFromFile: async (req, res) => {
    try {
      const me = await getFreshUser(req);
      if (!me) return res.status(401).json({ success: false, message: 'User not found.' });

      const body = req.body || {};
      const fileHash = String(body.file_hash || '').trim();
      if (!fileHash || fileHash.length < 32) {
        return res.status(400).json({
          success: false,
          message: 'file_hash is required and must be a valid SHA-256 digest (hex).',
        });
      }

      const logs = await query(
        `SELECT TOP 5 *
           FROM dbo.locator_export_log
          WHERE file_hash = @param0
            AND action_type = 'Underground Shift Close'
          ORDER BY export_id DESC`,
        [fileHash]
      );

      if (logs.length) {
        const closingLog = logs[0];

        const shifts = await query(
          `SELECT * FROM dbo.underground_shift WHERE closing_log_id = @param0`,
          [closingLog.export_id]
        );
        if (!shifts.length) {
          return res.status(400).json({
            success: false,
            message:
              `The closing file ${closingLog.export_uid} was found, but it is not ` +
              'associated with any pending record. It may have already been processed, ' +
              'or the link was broken. Please contact your administrator.',
          });
        }
        const shift = shifts[0];

        const gate = await checkReconcileGate(me, shift);
        if (!gate.ok) return res.status(403).json({ success: false, message: gate.message });

        if (shift.status === 'Reconciled') {
          return res.status(400).json({
            success: false,
            message: 'This closing file has already been reconciled.',
          });
        }
        if (shift.status !== 'Closed') {
          return res.status(400).json({
            success: false,
            message:
              'This closing file cannot be reconciled in its current state. ' +
              'Please contact your administrator.',
          });
        }

        const rawReleaseLines = await fetchReleaseLines(shift.shift_id);
        const releaseLines    = coerceReleaseLineNumerics(rawReleaseLines);
        const locatorSet      = new Set(releaseLines.map((l) => l.locator_code));

        const reconLog = await createLogSafe({
          direction:             'Import',
          action_type:           'Underground Reconciliation',
          export_format:         'Excel',
          source_warehouse_code: shift.warehouse_code,
          source_warehouse_name: null,
          target_warehouse_code: shift.warehouse_code,
          target_warehouse_name: null,
          performed_by_id:       me.id,
          performed_by_username: me.username,
          performed_by_role:     me.user_role,
          performed_by_position: me.emp_position,
          locator_count:         locatorSet.size,
          item_row_count:        releaseLines.length,
          total_qty:             round4(shift.released_qty),
          total_value:           round4(shift.released_value),
          filename:              body.filename || closingLog.filename || null,
          file_hash:             fileHash,
          file_size_bytes:       body.file_size_bytes || closingLog.file_size_bytes || null,
          notes:                 body.notes ||
            `Inventory sync from closing file ${closingLog.export_uid}`,
          linked_export_id:      closingLog.export_id,
        }, releaseLines);

        const result = await UndergroundModel.reconcileShift({
          shift_id:               shift.shift_id,
          reconciled_by_username: me.username,
          reconciliation_log_id:  reconLog.export_id,
        });

        return res.status(200).json({
          success: true,
          message:
            `Sync recorded · ${reconLog.export_uid}. ` +
            `${result.reconciled_lines} line(s) applied.`,
          data: {
            reconciliation_uid: reconLog.export_uid,
            reconciled_lines:   result.reconciled_lines,
            verified_against:   closingLog.export_uid,
            path:               'shared-db',
          },
        });
      }

      const parsedLines = Array.isArray(body.release_lines) ? body.release_lines : [];
      
      const cleanLines = sanitiseReleaseLines(parsedLines);

      const fileWhCode = normCode(body.warehouse_code) || null;
      let requestedWhId = null;
      if (fileWhCode) {
        const whRow = await query(
          `SELECT warehouse_id FROM dbo.warehouse_table WHERE warehouse_code = @param0`,
          [fileWhCode]
        );
        requestedWhId = whRow[0]?.warehouse_id || null;
      }

      const gate = await checkSurfaceViewGate(me, requestedWhId);
      if (!gate.ok) return res.status(403).json({ success: false, message: gate.message });

      if (fileWhCode && normCode(gate.warehouse_code) !== fileWhCode) {
        return res.status(400).json({
          success: false,
          message:
            `This closing file was produced for warehouse ${fileWhCode}, but you are ` +
            `assigned to ${gate.warehouse_code}. Please use a file from your own warehouse.`,
        });
      }

      const locatorSet = new Set(cleanLines.map((l) => l.locator_code));
      const totalQty   = cleanLines.reduce((s, l) => s + (Number(l.qty) || 0), 0);
      const totalValue = cleanLines.reduce((s, l) => s + (Number(l.line_total) || 0), 0);

      const reconLog = await createLogSafe({
        direction:             'Import',
        action_type:           'Underground Reconciliation',
        export_format:         'Excel',
        source_warehouse_code: gate.warehouse_code,
        source_warehouse_name: gate.warehouse_name,
        target_warehouse_code: gate.warehouse_code,
        target_warehouse_name: gate.warehouse_name,
        performed_by_id:       me.id,
        performed_by_username: me.username,
        performed_by_role:     me.user_role,
        performed_by_position: me.emp_position,
        locator_count:         locatorSet.size,
        item_row_count:        cleanLines.length,
        total_qty:             round4(totalQty),
        total_value:           round4(totalValue),
        filename:              body.filename || null,
        file_hash:             fileHash,
        file_size_bytes:       body.file_size_bytes || null,
        notes:                 body.notes || 'Inventory sync from closing file',
        linked_export_id:      null,
      }, cleanLines);

      const result = await UndergroundModel.reconcileFromParsedFile({
        warehouse_id:           gate.warehouse_id,
        warehouse_code:         gate.warehouse_code,
        release_lines:          cleanLines,
        reconciled_by_username: me.username,
        reference_no:           reconLog.export_uid,
      });

      return res.status(200).json({
        success: true,
        message:
          `Sync recorded · ${reconLog.export_uid}. ` +
          `${result.reconciled_lines} line(s) applied.`,
        data: {
          reconciliation_uid: reconLog.export_uid,
          reconciled_lines:   result.reconciled_lines,
          verified_against:   null,
          path:               'offline-file',
        },
      });
    } catch (err) {
      console.error('❌ underground.reconcileFromFile:', err);
      const raw = String(err.message || '');
      const status = /Insufficient|must be Closed|already Reconciled|not found|requires|must be > 0|non-empty/i.test(raw) ? 400 : 500;
      return res.status(status).json({
        success: false,
        message:
          status === 400
            ? 'This closing file could not be applied. Please contact your administrator.'
            : 'Failed to reconcile closing file.',
        error: process.env.NODE_ENV === 'development' ? raw : undefined,
      });
    }
  },
};

module.exports = undergroundController;