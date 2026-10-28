// controllers/underground/undergroundIssueFormController.js
'use strict';

const UndergroundIssueFormModel = require('../../models/underground/undergroundIssueFormModel');
const UndergroundModel          = require('../../models/underground/undergroundModel');
const UserModel                 = require('../../models/userModel');
const WarehouseModel            = require('../../models/warehouseModel');

/* ============================================================
   HELPERS
   ============================================================ */

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

const toDate = (v) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d;
};

/* ============================================================
   BODEGA SCOPE HELPER
   ============================================================ */
const getAssignedLocators = async (user) => {
  if (!user) return null;
  try {
    return await UserModel.getAssignedLocatorsForUser(user);
  } catch {
    return null;
  }
};

/* ------------------------------------------------------------
   ATTACHMENT SANITISATION
   ------------------------------------------------------------ */
const ATTACHMENT_MAX_BASE64 = 8_000_000;   // ~6 MB binary
const ATTACHMENT_MAX_NAME   = 255;
const ATTACHMENT_MAX_MIME   = 100;

const sanitiseAttachment = (body) => {
  const raw64   = body?.attachment_base64;
  const rawName = body?.attachment_name;
  const rawMime = body?.attachment_mime_type;

  const has64   = typeof raw64   === 'string' && raw64.trim().length   > 0;
  const hasName = typeof rawName === 'string' && rawName.trim().length > 0;
  const hasMime = typeof rawMime === 'string' && rawMime.trim().length > 0;

  if (!has64 && !hasName && !hasMime) {
    return {
      attachment_base64:    null,
      attachment_name:      null,
      attachment_mime_type: null,
    };
  }

  if (!has64)   throw new Error('Attachment image data is required.');
  if (!hasMime) throw new Error('Attachment mime type is required.');

  let base64 = String(raw64).trim();
  let mime   = String(rawMime).trim().toLowerCase();

  const dataUrlMatch = /^data:([^;]+);base64,(.+)$/i.exec(base64);
  if (dataUrlMatch) {
    if (!mime) mime = String(dataUrlMatch[1]).trim().toLowerCase();
    base64 = dataUrlMatch[2];
  }

  base64 = base64.replace(/\s+/g, '');

  if (!base64) {
    throw new Error('Attachment image data is required.');
  }
  if (base64.length > ATTACHMENT_MAX_BASE64) {
    throw new Error('Attachment image must be 6 MB or smaller.');
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw new Error('Attachment image data must be valid base64.');
  }
  if (mime.length > ATTACHMENT_MAX_MIME) {
    throw new Error('Attachment mime type is invalid.');
  }
  if (!mime.startsWith('image/')) {
    throw new Error('Attachment must be an image file.');
  }

  let name;
  if (hasName) {
    name = String(rawName).trim().replace(/[\\/]/g, '_');
    if (name.length > ATTACHMENT_MAX_NAME) {
      name = name.slice(0, ATTACHMENT_MAX_NAME);
    }
  } else {
    const ext = (mime.split('/')[1] || 'img').split('+')[0];
    name = `attachment.${ext}`;
  }

  return {
    attachment_base64:    base64,
    attachment_name:      name,
    attachment_mime_type: mime,
  };
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
    return { ok: false, message: 'This feature is only available at UG and LUMB warehouses.' };
  }

  return {
    ok: true,
    warehouse_id:   wh.warehouse_id,
    warehouse_code: wh.warehouse_code,
    warehouse_name: wh.warehouse_name,
  };
};

const checkReadGate = async (user) => {
  if (!user) return { ok: false, message: 'User not found.' };

  if (isAdminRole(user)) {
    return { ok: true, admin: true, warehouse_id: null, warehouse_code: null };
  }

  const pos = String(user.emp_position || '').trim();
  if (pos !== 'Underground Handler' && pos !== 'Surface Handler') {
    return { ok: false, message: 'Only Underground/Surface Handlers or admins may view issue forms.' };
  }
  if (!user.warehouse_assigned) {
    return { ok: false, message: 'Your account has no warehouse assignment.' };
  }

  const wh = await WarehouseModel.getWarehouseById(user.warehouse_assigned);
  if (!wh) return { ok: false, message: 'Assigned warehouse not found.' };

  const code = String(wh.warehouse_code || '').trim().toUpperCase();
  if (!UndergroundModel.isSyncWarehouse(code)) {
    return { ok: false, message: 'This feature is only available at UG and LUMB warehouses.' };
  }

  return {
    ok: true,
    admin: false,
    warehouse_id:   wh.warehouse_id,
    warehouse_code: wh.warehouse_code,
    warehouse_name: wh.warehouse_name,
  };
};

/* ============================================================
   CONTROLLER
   ============================================================ */
const undergroundIssueFormController = {

  create: async (req, res) => {
    try {
      const me = await getFreshUser(req);
      if (!me) return res.status(401).json({ success: false, message: 'User not found.' });

      const gate = await checkUndergroundGate(me);
      if (!gate.ok) return res.status(403).json({ success: false, message: gate.message });

      const body = req.body || {};
      const formType = String(body.form_type || '').trim().toUpperCase();
      if (!UndergroundIssueFormModel.isFormType(formType)) {
        return res.status(400).json({
          success: false,
          message: 'form_type must be one of: MER, MSR, MSF, MSB.',
        });
      }

      const lines    = Array.isArray(body.lines)     ? body.lines     : [];
      const bdmLines = Array.isArray(body.bdm_lines) ? body.bdm_lines : [];

      if (lines.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'At least one issue line is required.',
        });
      }
      if (formType !== 'MSF' && bdmLines.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'BDM lines are only allowed on MSF forms.',
        });
      }

      /* ---- Bodega scope pre-check (friendly 403) ---- */
      const assigned_locators = await getAssignedLocators(me);
      if (Array.isArray(assigned_locators) && assigned_locators.length > 0) {
        const allLines = [...lines, ...bdmLines];
        for (const l of allLines) {
          if (!l || !l.locator_code) continue;
          if (!assigned_locators.includes(String(l.locator_code).trim())) {
            return res.status(403).json({
              success: false,
              message:
                `You do not have access to locator "${l.locator_code}". ` +
                `Only your assigned bodegas can be used.`,
            });
          }
        }
      }

      const attachment = sanitiseAttachment(body);

      const shift = await UndergroundModel.getCurrentShift(
        gate.warehouse_id,
        me.username
      );
      if (!shift) {
        return res.status(400).json({
          success: false,
          message: 'No open shift. Import a surface export to begin a new shift.',
        });
      }

      const result = await UndergroundIssueFormModel.createForm({
        form_type:           formType,
        shift_id:            shift.shift_id,
        warehouse_id:        gate.warehouse_id,
        warehouse_code:      gate.warehouse_code,
        issued_by_username:  me.username,
        issued_by_position:  me.emp_position,

        dept_section:        body.dept_section,
        adh_dh_initials:     body.adh_dh_initials,
        activity_cc:         body.activity_cc,
        level_field:         body.level_field,
        form_date:           body.form_date,
        working_place:       body.working_place,
        lhd_no:              body.lhd_no,
        shift_label:         body.shift_label,

        bdm_rdm_no:          body.bdm_rdm_no,
        bdm_shift_label:     body.bdm_shift_label,

        authorized_name:     body.authorized_name,
        authorized_position: body.authorized_position,
        issued_name:         body.issued_name,
        issued_position:     body.issued_position,
        received_name:       body.received_name,
        received_position:   body.received_position,
        bodega_name:         body.bodega_name,
        bodega_position:     body.bodega_position,
        chapa_no:            body.chapa_no,

        remarks:   body.remarks,

        attachment_base64:    attachment.attachment_base64,
        attachment_name:      attachment.attachment_name,
        attachment_mime_type: attachment.attachment_mime_type,

        lines,
        bdm_lines: bdmLines,

        assigned_locators,
      });

      return res.status(201).json({
        success: true,
        message: `${formType} ${result.form_series_no} issued (${result.line_count} line(s)).`,
        data: result,
      });
    } catch (err) {
      console.error('❌ undergroundIssueForm.create:', err);
      const msg = String(err.message || '');
      const status = /do not have access/i.test(msg)
        ? 403
        : /Attachment|Insufficient|No underground stock|must be > 0|required|Unknown form_type|BDM lines|At least one|not Open|different warehouse/i.test(msg)
          ? 400
          : 500;
      return res.status(status).json({
        success: false,
        message: msg || 'Failed to create issue form.',
        error: process.env.NODE_ENV === 'development' ? msg : undefined,
      });
    }
  },

  getOne: async (req, res) => {
    try {
      const me = await getFreshUser(req);
      if (!me) return res.status(401).json({ success: false, message: 'User not found.' });

      const id = toInt(req.params.id);
      if (!id) return res.status(400).json({ success: false, message: 'Invalid form id.' });

      const form = await UndergroundIssueFormModel.getFormById(id);
      if (!form) return res.status(404).json({ success: false, message: 'Form not found.' });

      const gate = await checkReadGate(me);
      if (!gate.ok) return res.status(403).json({ success: false, message: gate.message });

      if (!gate.admin && Number(form.warehouse_id) !== Number(gate.warehouse_id)) {
        return res.status(403).json({
          success: false,
          message: 'Form belongs to another warehouse.',
        });
      }

      return res.status(200).json({ success: true, data: form });
    } catch (err) {
      console.error('❌ undergroundIssueForm.getOne:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  listForShift: async (req, res) => {
    try {
      const me = await getFreshUser(req);
      if (!me) return res.status(401).json({ success: false, message: 'User not found.' });

      const shift_id = toInt(req.params.shiftId);
      if (!shift_id) return res.status(400).json({ success: false, message: 'Invalid shift id.' });

      const shift = await UndergroundModel.getShiftById(shift_id);
      if (!shift) return res.status(404).json({ success: false, message: 'Shift not found.' });

      const gate = await checkReadGate(me);
      if (!gate.ok) return res.status(403).json({ success: false, message: gate.message });

      if (!gate.admin && Number(shift.warehouse_id) !== Number(gate.warehouse_id)) {
        return res.status(403).json({
          success: false,
          message: 'Shift belongs to another warehouse.',
        });
      }

      const rows = await UndergroundIssueFormModel.listFormsForShift(shift_id);
      return res.status(200).json({ success: true, data: rows, total: rows.length });
    } catch (err) {
      console.error('❌ undergroundIssueForm.listForShift:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  listHistory: async (req, res) => {
    try {
      const me = await getFreshUser(req);
      if (!me) return res.status(401).json({ success: false, message: 'User not found.' });

      const gate = await checkReadGate(me);
      if (!gate.ok) return res.status(403).json({ success: false, message: gate.message });

      let warehouse_id;
      if (gate.admin) {
        warehouse_id = toInt(req.query.warehouse_id);
        if (!warehouse_id) {
          return res.status(400).json({
            success: false,
            message: 'Admins must specify warehouse_id.',
          });
        }
      } else {
        warehouse_id = gate.warehouse_id;
      }

      const start_date = toDate(req.query.start_date);
      const end_date   = toDate(req.query.end_date);

      const assigned_locators = gate.admin ? null : await getAssignedLocators(me);

      const result = await UndergroundIssueFormModel.listFormsForWarehouse({
        warehouse_id,
        form_type:  req.query.form_type,
        start_date,
        end_date,
        assigned_locators,
        page:       req.query.page,
        limit:      req.query.limit || 50,
      });

      return res.status(200).json({
        success: true,
        data:       result.rows,
        total:      result.total,
        page:       result.page,
        limit:      result.limit,
        totalPages: result.totalPages,
        totals:     result.totals,
        scoped_bodegas: Array.isArray(assigned_locators) ? assigned_locators : null,
      });
    } catch (err) {
      console.error('❌ undergroundIssueForm.listHistory:', err);
      const status = /Invalid form_type/i.test(err.message) ? 400 : 500;
      return res.status(status).json({
        success: false,
        message: err.message || 'Failed to fetch history.',
      });
    }
  },

  formMeta: async (_req, res) => {
    try {
      const meta = {};
      for (const [k, v] of Object.entries(UndergroundIssueFormModel.FORM_META)) {
        meta[k] = { doc_code: v.doc_code, revision: v.revision, label: v.label };
      }
      return res.status(200).json({ success: true, data: meta });
    } catch (err) {
      console.error('❌ undergroundIssueForm.formMeta:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },
};

module.exports = undergroundIssueFormController;