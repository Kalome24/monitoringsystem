// controllers/lockedItemsController.js
const LockedItemsModel  = require('../models/lockedItemsModel');
const ItemMasterModel   = require('../models/itemMasterModel');
const WarehouseModel    = require('../models/warehouseModel');
const LocatorModel      = require('../models/locatorModel');

const ok  = (res, data, msg) => res.status(200).json({ success: true, message: msg, data });
const bad = (res, code, msg, extra = {}) =>
  res.status(code).json({ success: false, message: msg, ...extra });

const lockedItemsController = {
  // GET /api/locked-items
  list: async (req, res) => {
    try {
      const { warehouse_code, search, is_active, page, limit } = req.query;
      const { rows, total } = await LockedItemsModel.list({
        warehouse_code, search, is_active, page, limit,
      });
      res.status(200).json({
        success: true,
        data: rows,
        total,
        page:  Number(page)  || 1,
        limit: Number(limit) || 50,
        totalPages: Math.max(1, Math.ceil(total / (Number(limit) || 50))),
      });
    } catch (err) {
      console.error('❌ lockedItems.list:', err);
      bad(res, 500, 'Error fetching locked items');
    }
  },

  // GET /api/locked-items/:id
  getOne: async (req, res) => {
    try {
      const item = await LockedItemsModel.getById(req.params.id);
      if (!item) return bad(res, 404, 'Locked item not found');
      ok(res, item);
    } catch (err) {
      console.error('❌ lockedItems.getOne:', err);
      bad(res, 500, 'Error fetching locked item');
    }
  },

  // POST /api/locked-items
  create: async (req, res) => {
    try {
      const { item_code, warehouse_code, locator_code, remarks } = req.body;

      if (!item_code || !warehouse_code) {
        return bad(res, 400, 'item_code and warehouse_code are required.');
      }

      const item = await ItemMasterModel.getByItemCode(item_code);
      if (!item) return bad(res, 400, `Item "${item_code}" does not exist in item_master.`);

      const wh = await WarehouseModel.getWarehouseByCode(warehouse_code);
      if (!wh) return bad(res, 400, `Warehouse "${warehouse_code}" does not exist.`);
      if (wh.status !== 'Active') {
        return bad(res, 400, `Warehouse "${warehouse_code}" is not active.`);
      }

      if (locator_code) {
        const loc = await LocatorModel.getByCode(locator_code);
        if (!loc) return bad(res, 400, `Locator "${locator_code}" does not exist.`);
        if (loc.warehouse_code !== warehouse_code) {
          return bad(
            res, 400,
            `Locator "${locator_code}" belongs to warehouse "${loc.warehouse_code}", not "${warehouse_code}".`
          );
        }
      }

      const existing = await LockedItemsModel.getByItemCode(item_code);
      if (existing) {
        return bad(res, 409, `Item "${item_code}" is already locked (id ${existing.id}).`);
      }

      const created = await LockedItemsModel.create({
        item_code,
        warehouse_code,
        locator_code,
        remarks,
        created_by: req.user?.username || 'System',
      });

      res.status(201).json({
        success: true,
        message: 'Locked item created.',
        data: created,
      });
    } catch (err) {
      console.error('❌ lockedItems.create:', err);
      bad(res, 500, 'Error creating locked item');
    }
  },

  // PUT /api/locked-items/:id
  update: async (req, res) => {
    try {
      const { id } = req.params;
      const { warehouse_code, locator_code, remarks, is_active } = req.body;

      const existing = await LockedItemsModel.getById(id);
      if (!existing) return bad(res, 404, 'Locked item not found');

      if (!warehouse_code) return bad(res, 400, 'warehouse_code is required.');

      const wh = await WarehouseModel.getWarehouseByCode(warehouse_code);
      if (!wh) return bad(res, 400, `Warehouse "${warehouse_code}" does not exist.`);

      if (locator_code) {
        const loc = await LocatorModel.getByCode(locator_code);
        if (!loc) return bad(res, 400, `Locator "${locator_code}" does not exist.`);
        if (loc.warehouse_code !== warehouse_code) {
          return bad(
            res, 400,
            `Locator "${locator_code}" belongs to warehouse "${loc.warehouse_code}".`
          );
        }
      }

      const updated = await LockedItemsModel.update(id, {
        warehouse_code,
        locator_code,
        remarks,
        is_active: is_active !== undefined ? is_active : existing.is_active,
        updated_by: req.user?.username || 'System',
      });

      ok(res, updated, 'Locked item updated.');
    } catch (err) {
      console.error('❌ lockedItems.update:', err);
      bad(res, 500, 'Error updating locked item');
    }
  },

  // DELETE /api/locked-items/:id
  remove: async (req, res) => {
    try {
      const existing = await LockedItemsModel.getById(req.params.id);
      if (!existing) return bad(res, 404, 'Locked item not found');

      await LockedItemsModel.delete(req.params.id);
      ok(res, { id: Number(req.params.id) }, 'Locked item deleted.');
    } catch (err) {
      console.error('❌ lockedItems.remove:', err);
      bad(res, 500, 'Error deleting locked item');
    }
  },

  // POST /api/locked-items/bulk
  // Body: { items: [{ item_code, warehouse_code, locator_code?, remarks? }, ...] }
  bulkCreate: async (req, res) => {
    try {
      const { items = [] } = req.body;
      if (!Array.isArray(items) || items.length === 0) {
        return bad(res, 400, 'items[] is required.');
      }

      const results = { inserted: 0, failed: [] };
      const actor = req.user?.username || 'System';

      for (const it of items) {
        const item_code      = String(it.item_code || '').trim();
        const warehouse_code = String(it.warehouse_code || '').trim();
        try {
          if (!item_code || !warehouse_code) {
            throw new Error('item_code and warehouse_code required');
          }
          const exists = await LockedItemsModel.getByItemCode(item_code);
          if (exists) throw new Error(`already locked (id ${exists.id})`);
          await LockedItemsModel.create({
            item_code,
            warehouse_code,
            locator_code: it.locator_code || null,
            remarks: it.remarks || null,
            created_by: actor,
          });
          results.inserted++;
        } catch (e) {
          results.failed.push({ item_code, reason: e.message });
        }
      }

      res.status(200).json({ success: true, ...results });
    } catch (err) {
      console.error('❌ lockedItems.bulkCreate:', err);
      bad(res, 500, 'Error bulk-creating locked items');
    }
  },
};

module.exports = lockedItemsController;