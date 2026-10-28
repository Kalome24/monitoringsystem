// controllers/underground/offlineFeaturesController.js
'use strict';

const OfflineDamageModel = require('../../models/underground/offlineDamageModel');
const OfflineTransferModel = require('../../models/underground/offlineTransferModel');
const UndergroundModel = require('../../models/underground/undergroundModel');
const UserModel = require('../../models/userModel');
const WarehouseModel = require('../../models/warehouseModel');

const getFreshUser = async (req) => {
  if (!req.user?.id) return null;
  try { return await UserModel.getUserById(req.user.id); } catch { return null; }
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
  return { ok: true, warehouse_id: wh.warehouse_id, warehouse_code: wh.warehouse_code, warehouse_name: wh.warehouse_name };
};

const offlineFeaturesController = {
    // ==========================================
    // DAMAGE WRITE-OFFS
    // ==========================================
    recordDamage: async (req, res) => {
        try {
            const me = await getFreshUser(req);
            if (!me) return res.status(401).json({ success: false, message: 'User not found.' });

            const gate = await checkUndergroundGate(me);
            if (!gate.ok) return res.status(403).json({ success: false, message: gate.message });

            const { 
                locator_code, 
                item_code, 
                qty, 
                qty_boxes, 
                qty_loose_pieces, 
                reason 
            } = req.body;

            if (!locator_code || !item_code || !reason) {
                return res.status(400).json({ success: false, message: 'Missing required fields (locator, item, or reason).' });
            }

            const totalQty = Number(qty) || Number(qty_boxes) || Number(qty_loose_pieces);
            if (!(totalQty > 0)) {
                return res.status(400).json({ success: false, message: 'Quantity must be greater than 0.' });
            }

            const assigned_locators = await getAssignedLocators(me);
            if (Array.isArray(assigned_locators) && assigned_locators.length > 0) {
                if (!assigned_locators.includes(String(locator_code).trim())) {
                    return res.status(403).json({
                        success: false,
                        message: `You do not have access to locator "${locator_code}". Only your assigned bodegas can be used.`,
                    });
                }
            }

            const shift = await UndergroundModel.getCurrentShift(gate.warehouse_id, me.username);
            const shift_id = shift ? shift.shift_id : null;
            if (!shift_id) {
                return res.status(400).json({ success: false, message: 'No open shift found.' });
            }

            const result = await OfflineDamageModel.recordDamage({
                warehouse_id: gate.warehouse_id,
                warehouse_code: gate.warehouse_code,
                locator_code,
                item_code,
                qty,
                qty_boxes,
                qty_loose_pieces,
                reason,
                actor: me.username,
                shift_id,
                assigned_locators, 
            });

            res.status(201).json({ success: true, message: 'Damage recorded successfully.', data: result });
        } catch (error) {
            console.error('❌ offlineFeatures.recordDamage:', error);
            const msg = String(error.message || 'Server error');
            const status = /do not have access/i.test(msg) ? 403 : 500;
            res.status(status).json({ success: false, message: msg });
        }
    },

    getDamageHistory: async (req, res) => {
        try {
            const me = await getFreshUser(req);
            if (!me) return res.status(401).json({ success: false, message: 'User not found.' });

            const gate = await checkUndergroundGate(me);
            if (!gate.ok) return res.status(403).json({ success: false, message: gate.message });

            const assigned_locators = await getAssignedLocators(me);

            const result = await OfflineDamageModel.getHistory({
                warehouse_code: gate.warehouse_code,
                search: req.query.search,
                start_date: req.query.start_date,
                end_date: req.query.end_date,
                locator_codes: Array.isArray(assigned_locators) && assigned_locators.length > 0
                    ? assigned_locators
                    : undefined,
                page: parseInt(req.query.page) || 1,
                limit: 30,
            });

            res.status(200).json({
                success: true,
                ...result,
                scoped_bodegas: Array.isArray(assigned_locators) ? assigned_locators : null,
            });
        } catch (error) {
            console.error('❌ offlineFeatures.getDamageHistory:', error);
            res.status(500).json({ success: false, message: 'Server error' });
        }
    },

    // ==========================================
    // OFFLINE TRANSFERS (STS)
    // ==========================================
    getNextStsNo: async (req, res) => {
        try {
            const me = await getFreshUser(req);
            if (!me) return res.status(401).json({ success: false, message: 'User not found.' });

            const gate = await checkUndergroundGate(me);
            if (!gate.ok) return res.status(403).json({ success: false, message: gate.message });

            const nextStsNo = await OfflineTransferModel.getNextStsNo(me.username);
            res.status(200).json({ success: true, data: { sts_no: nextStsNo } });
        } catch (error) {
            console.error('❌ offlineFeatures.getNextStsNo:', error);
            res.status(500).json({ success: false, message: 'Server error' });
        }
    },

    /**
     * Fetch available destination locators (synced from Surface/UG config)
     * restricted to the handler's current warehouse (e.g., UG).
     */
    getDestinationLocators: async (req, res) => {
        try {
            const me = await getFreshUser(req);
            if (!me) return res.status(401).json({ success: false, message: 'User not found.' });

            const gate = await checkUndergroundGate(me);
            if (!gate.ok) return res.status(403).json({ success: false, message: gate.message });

            const assigned_locators = await getAssignedLocators(me);
            
            const data = await OfflineTransferModel.getDestinationLocators({ 
                warehouse_code: gate.warehouse_code,
                assigned_locators 
            });
            res.status(200).json({ success: true, data });
        } catch (error) {
            console.error('❌ offlineFeatures.getDestinationLocators:', error);
            res.status(500).json({ success: false, message: 'Server error' });
        }
    },

    getTransferItems: async (req, res) => {
        try {
            const me = await getFreshUser(req);
            if (!me) return res.status(401).json({ success: false, message: 'User not found.' });

            const gate = await checkUndergroundGate(me);
            if (!gate.ok) return res.status(403).json({ success: false, message: gate.message });

            const { locator_code } = req.query;
            if (!locator_code) return res.status(400).json({ success: false, message: 'Locator required.' });

            const assigned_locators = await getAssignedLocators(me);
            if (Array.isArray(assigned_locators) && assigned_locators.length > 0) {
                if (!assigned_locators.includes(String(locator_code).trim())) {
                    return res.status(403).json({
                        success: false,
                        message: `You do not have access to source bodega "${locator_code}".`,
                    });
                }
            }

            const shift = await UndergroundModel.getCurrentShift(gate.warehouse_id, me.username);
            const shift_id = shift ? shift.shift_id : null;
            if (!shift_id) {
                return res.status(400).json({ success: false, message: 'No open shift found. Cannot fetch items.' });
            }

            const data = await OfflineTransferModel.getItemsInLocator(
                gate.warehouse_code,
                locator_code,
                { assigned_locators, shift_id }
            );
            res.status(200).json({ success: true, data });
        } catch (error) {
            console.error('❌ offlineFeatures.getTransferItems:', error);
            const msg = String(error.message || 'Server error');
            const status = /do not have access/i.test(msg) ? 403 : 500;
            res.status(status).json({ success: false, message: msg });
        }
    },

    createTransfer: async (req, res) => {
        try {
            const me = await getFreshUser(req);
            if (!me) return res.status(401).json({ success: false, message: 'User not found.' });

            const gate = await checkUndergroundGate(me);
            if (!gate.ok) return res.status(403).json({ success: false, message: gate.message });

            const {
                sts_no, from_locator, to_locator, item_code, item_name, uom, qty, qty_boxes, qty_loose_pieces,
                approved_by, initiated_by, released_by, received_by, remarks
            } = req.body;

            if (!sts_no || !from_locator || !to_locator || !item_code) {
                return res.status(400).json({ success: false, message: 'Missing required fields.' });
            }

            const totalQty = Number(qty) || Number(qty_boxes) || Number(qty_loose_pieces);
            if (!(totalQty > 0)) {
                return res.status(400).json({ success: false, message: 'Quantity must be greater than 0.' });
            }
            if (from_locator === to_locator) {
                return res.status(400).json({ success: false, message: 'From and To Bodega cannot be the same.' });
            }

            const assigned_locators = await getAssignedLocators(me);
            if (Array.isArray(assigned_locators) && assigned_locators.length > 0) {
                // Only validate the source locator. The destination can be any synced locator (e.g., UG Warehouse).
                if (!assigned_locators.includes(String(from_locator).trim())) {
                    return res.status(403).json({
                        success: false,
                        message: `You do not have access to source bodega "${from_locator}". Only your assigned bodegas can be used.`,
                    });
                }
            }

            const shift = await UndergroundModel.getCurrentShift(gate.warehouse_id, me.username);
            const shift_id = shift ? shift.shift_id : null;
            if (!shift_id) {
                return res.status(400).json({ success: false, message: 'No open shift found.' });
            }

            const result = await OfflineTransferModel.createTransfer({
                sts_no,
                warehouse_id: gate.warehouse_id,
                warehouse_code: gate.warehouse_code,
                from_locator,
                to_locator,
                item_code,
                item_name,
                uom,
                qty,
                qty_boxes,
                qty_loose_pieces,
                approved_by,
                initiated_by: initiated_by || me.username,
                released_by: released_by || me.username,
                received_by,
                remarks,
                shift_id,
                assigned_locators,
            });

            res.status(201).json({ success: true, message: 'Transfer completed.', data: result });
        } catch (error) {
            console.error('❌ offlineFeatures.createTransfer:', error);
            const msg = String(error.message || 'Server error');
            if (/already exists/i.test(msg)) {
                return res.status(409).json({ success: false, message: msg });
            }
            if (/do not have access/i.test(msg)) {
                return res.status(403).json({ success: false, message: msg });
            }
            res.status(500).json({ success: false, message: msg });
        }
    },

    getTransferHistory: async (req, res) => {
        try {
            const me = await getFreshUser(req);
            if (!me) return res.status(401).json({ success: false, message: 'User not found.' });

            const gate = await checkUndergroundGate(me);
            if (!gate.ok) return res.status(403).json({ success: false, message: gate.message });

            const assigned_locators = await getAssignedLocators(me);

            const result = await OfflineTransferModel.getHistory({
                warehouse_code: gate.warehouse_code,
                search: req.query.search,
                start_date: req.query.start_date,
                end_date: req.query.end_date,
                locator_codes: Array.isArray(assigned_locators) && assigned_locators.length > 0
                    ? assigned_locators
                    : undefined,
                page: parseInt(req.query.page) || 1,
                limit: 30,
            });

            res.status(200).json({
                success: true,
                ...result,
                scoped_bodegas: Array.isArray(assigned_locators) ? assigned_locators : null,
            });
        } catch (error) {
            console.error('❌ offlineFeatures.getTransferHistory:', error);
            res.status(500).json({ success: false, message: 'Server error' });
        }
    }
};

module.exports = offlineFeaturesController;