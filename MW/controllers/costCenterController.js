// controllers/costCenterController.js
const CostCenterModel = require('../models/costCenterModel');

const resolveActor = (req) => (req.user && req.user.username) || 'System';

/**
 * Strict integer parser. Accepts:
 *   • number    → returned if Number.isInteger
 *   • numeric str like "1000" → returned as 1000
 *   • '' / null / undefined   → returned as null (means "not provided")
 * Rejects:
 *   • "10.5"  → null (not an integer)
 *   • "abc"   → null
 *   • NaN     → null
 *
 * We wrap in a small helper object so the caller can distinguish
 * "empty" (OK to skip) from "invalid" (must 400).
 */
const parseOptionalInt = (raw) => {
  if (raw === '' || raw === null || raw === undefined) {
    return { kind: 'empty', value: null };
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    return { kind: 'invalid', value: null };
  }
  return { kind: 'ok', value: n };
};

const parseRequiredInt = (raw) => {
  const parsed = parseOptionalInt(raw);
  if (parsed.kind !== 'ok') return null;
  return parsed.value;
};

/* ---------- CREATE ---------- */
const createCostCenter = async (req, res) => {
  try {
    const value = parseRequiredInt(req.body.Cost_Center_Value);
    if (value === null) {
      return res.status(400).json({
        success: false,
        message: 'Cost Center Value must be a whole number (integer).',
      });
    }

    const dup = await CostCenterModel.checkDuplicate(value);
    if (dup) {
      return res.status(409).json({
        success: false,
        message: `Cost Center "${value}" already exists.`,
      });
    }

    await CostCenterModel.create({
      Cost_Center_Value: value,
      Description:       req.body.Description,
      Status:            req.body.Status,
      Creation_Date:     req.body.Creation_Date,
    }, resolveActor(req));

    return res.status(201).json({
      success: true,
      message: 'Cost Center created.',
      data: { Cost_Center_Value: value },
    });
  } catch (err) {
    console.error('❌ createCostCenter:', err);
    return res.status(500).json({
      success: false, message: 'Internal server error', error: err.message,
    });
  }
};

/* ---------- LIST ---------- */
const getAllCostCenters = async (req, res) => {
  try {
    const page   = parseInt(req.query.page, 10)  || 1;
    const limit  = parseInt(req.query.limit, 10) || 50;
    const search = req.query.search || '';

    const result = await CostCenterModel.getAll(page, limit, search);
    return res.status(200).json({
      success: true,
      data:         result.data,
      total:        result.total,
      totalPages:   result.totalPages,
      currentPage:  result.currentPage,
    });
  } catch (err) {
    console.error('❌ getAllCostCenters:', err);
    return res.status(500).json({
      success: false, message: 'Internal server error', error: err.message,
    });
  }
};

/* ---------- GET ONE ---------- */
const getCostCenterByValue = async (req, res) => {
  try {
    const value = parseRequiredInt(req.params.value);
    if (value === null) {
      return res.status(400).json({ success: false, message: 'Invalid Cost Center Value in URL.' });
    }
    const item = await CostCenterModel.getByValue(value);
    if (!item) return res.status(404).json({ success: false, message: 'Cost Center not found.' });
    return res.status(200).json({ success: true, data: item });
  } catch (err) {
    console.error('❌ getCostCenterByValue:', err);
    return res.status(500).json({
      success: false, message: 'Internal server error', error: err.message,
    });
  }
};

/* ---------- UPDATE ---------- */
const updateCostCenter = async (req, res) => {
  try {
    const value = parseRequiredInt(req.params.value);
    if (value === null) {
      return res.status(400).json({ success: false, message: 'Invalid Cost Center Value in URL.' });
    }

    const existing = await CostCenterModel.getByValue(value);
    if (!existing) return res.status(404).json({ success: false, message: 'Cost Center not found.' });

    await CostCenterModel.update(value, {
      Description:      req.body.Description,
      Status:           req.body.Status,
      Creation_Date:    req.body.Creation_Date,
    }, resolveActor(req));

    const updated = await CostCenterModel.getByValue(value);
    return res.status(200).json({
      success: true, message: 'Cost Center updated.', data: updated,
    });
  } catch (err) {
    console.error('❌ updateCostCenter:', err);
    return res.status(500).json({
      success: false, message: 'Internal server error', error: err.message,
    });
  }
};

/* ---------- ACTIVATE / DEACTIVATE ---------- */
const deactivateCostCenter = async (req, res) => {
  try {
    const value = parseRequiredInt(req.params.value);
    if (value === null) {
      return res.status(400).json({ success: false, message: 'Invalid Cost Center Value in URL.' });
    }
    const existing = await CostCenterModel.getByValue(value);
    if (!existing) return res.status(404).json({ success: false, message: 'Cost Center not found.' });
    await CostCenterModel.updateStatus(value, 'Inactive', resolveActor(req));
    return res.status(200).json({ success: true, message: 'Cost Center deactivated.' });
  } catch (err) {
    console.error('❌ deactivateCostCenter:', err);
    return res.status(500).json({
      success: false, message: 'Internal server error', error: err.message,
    });
  }
};

const activateCostCenter = async (req, res) => {
  try {
    const value = parseRequiredInt(req.params.value);
    if (value === null) {
      return res.status(400).json({ success: false, message: 'Invalid Cost Center Value in URL.' });
    }
    const existing = await CostCenterModel.getByValue(value);
    if (!existing) return res.status(404).json({ success: false, message: 'Cost Center not found.' });
    await CostCenterModel.updateStatus(value, 'Active', resolveActor(req));
    return res.status(200).json({ success: true, message: 'Cost Center activated.' });
  } catch (err) {
    console.error('❌ activateCostCenter:', err);
    return res.status(500).json({
      success: false, message: 'Internal server error', error: err.message,
    });
  }
};

/* ---------- DELETE ---------- */
const deleteCostCenter = async (req, res) => {
  try {
    const value = parseRequiredInt(req.params.value);
    if (value === null) {
      return res.status(400).json({ success: false, message: 'Invalid Cost Center Value in URL.' });
    }
    const existing = await CostCenterModel.getByValue(value);
    if (!existing) return res.status(404).json({ success: false, message: 'Cost Center not found.' });
    await CostCenterModel.delete(value);
    return res.status(200).json({
      success: true,
      message: `Cost Center "${value}" permanently deleted.`,
    });
  } catch (err) {
    console.error('❌ deleteCostCenter:', err);
    return res.status(500).json({
      success: false, message: 'Internal server error', error: err.message,
    });
  }
};

module.exports = {
  createCostCenter,
  getAllCostCenters,
  getCostCenterByValue,
  updateCostCenter,
  deactivateCostCenter,
  activateCostCenter,
  deleteCostCenter,
};