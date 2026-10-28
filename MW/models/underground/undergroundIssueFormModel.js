// models/underground/undergroundIssueFormModel.js
'use strict';

const { sql, ensurePool, query } = require('../../db');

/* ============================================================
   FORM TYPE -> DOCUMENT METADATA
   ============================================================ */
const FORM_META = Object.freeze({
  MER: { doc_code: 'FRM-IMD-014', revision: '03', seq: 'seq_ug_form_mer', label: 'Mine Explosives Requisition' },
  MSR: { doc_code: 'FRM-IMD-057', revision: '03', seq: 'seq_ug_form_msr', label: 'Mine Supply Requisition (Rockbolts & Accessories)' },
  MSF: { doc_code: 'FRM-IMD-056', revision: '03', seq: 'seq_ug_form_msf', label: 'Mine Supply Requisition (Fuel and Lubricants)' },
  MSB: { doc_code: 'FRM-IMD-051', revision: '03', seq: 'seq_ug_form_msb', label: 'Mine Supply Requisition (Blank)' },
});

const isFormType = (t) =>
  Object.prototype.hasOwnProperty.call(FORM_META, String(t || '').toUpperCase());

/* ============================================================
   STRICT 4-DECIMAL ROUNDER
   ============================================================ */
const round4 = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10000) / 10000;
};

/* ============================================================
   BODEGA SCOPE GUARD
   ============================================================ */
const assertLocatorsAllowed = (lines, assignedLocators) => {
  if (!Array.isArray(assignedLocators) || assignedLocators.length === 0) return;
  for (const l of lines || []) {
    if (!l || !l.locator_code) continue;
    const code = String(l.locator_code).trim();
    if (!assignedLocators.includes(code)) {
      throw new Error(
        `You do not have access to locator "${code}". Only your assigned bodegas can be used.`
      );
    }
  }
};

const UndergroundIssueFormModel = {
  FORM_META,
  isFormType,

  /* ============================================================
     CREATE — header + regular lines + optional BDM lines
     ============================================================ */
  createForm: async ({
    form_type,
    shift_id,
    warehouse_id,
    warehouse_code,
    issued_by_username,
    issued_by_position,

    dept_section,
    adh_dh_initials,
    activity_cc,
    level_field,
    form_date,
    working_place,
    lhd_no,
    shift_label,

    bdm_rdm_no,
    bdm_shift_label,

    authorized_name,
    authorized_position,
    issued_name,
    issued_position,
    received_name,
    received_position,
    bodega_name,
    bodega_position,
    chapa_no,

    remarks,

    attachment_base64    = null,
    attachment_name      = null,
    attachment_mime_type = null,

    lines = [],
    bdm_lines = [],

    assigned_locators = null,
  }) => {
    const type = String(form_type || '').toUpperCase();
    if (!isFormType(type))            throw new Error(`Unknown form_type: ${form_type}`);
    if (!shift_id)                    throw new Error('shift_id is required.');
    if (!warehouse_id)                throw new Error('warehouse_id is required.');
    if (!warehouse_code)              throw new Error('warehouse_code is required.');
    if (!issued_by_username)          throw new Error('issued_by_username is required.');
    if (!Array.isArray(lines) || lines.length === 0) {
      throw new Error('At least one regular line is required.');
    }
    if (type !== 'MSF' && Array.isArray(bdm_lines) && bdm_lines.length > 0) {
      throw new Error('BDM lines are only allowed on MSF forms.');
    }

    const meta = FORM_META[type];
    const pool = await ensurePool();
    const tx   = new sql.Transaction(pool);
    await tx.begin();

    try {
      /* ---- 1) Verify the shift is Open and matches the warehouse ---- */
      const sRes = await new sql.Request(tx)
        .input('shift_id', sql.Int, Number(shift_id))
        .query(`
          SELECT * FROM dbo.underground_shift WITH (UPDLOCK, HOLDLOCK)
           WHERE shift_id = @shift_id
        `);
      const shift = sRes.recordset[0];
      if (!shift)                                          throw new Error(`Shift ${shift_id} not found.`);
      if (Number(shift.warehouse_id) !== Number(warehouse_id)) throw new Error('Shift belongs to a different warehouse.');
      if (shift.status !== 'Open')                         throw new Error(`Shift ${shift_id} is not Open (status=${shift.status}).`);

      /* ---- 2) Snapshot the underground's current inventory for this shift ---- */
      const invRes = await new sql.Request(tx)
        .input('shift_id', sql.Int, Number(shift_id))
        .query(`
          SELECT locator_code, locator_name, item_code, item_name, uom, barcode,
                 category, purchase_class, gl_class, qty_on_hand, unit_cost, total_value
            FROM dbo.vw_underground_current_inventory
           WHERE shift_id = @shift_id
        `);

      const keyOf = (lc, ic) => `${lc}|${ic}`;
      const invMap = new Map();
      for (const r of invRes.recordset) invMap.set(keyOf(r.locator_code, r.item_code), r);

      /* ---- 3) Validate stock sufficiency across ALL lines (regular + BDM) ---- */
      const allIssueLines = [
        ...lines.map((l) => ({ ...l, _section: 'Regular' })),
        ...(type === 'MSF' ? bdm_lines.map((l) => ({ ...l, _section: 'BDM' })) : []),
      ];
      if (allIssueLines.length === 0) throw new Error('At least one issue line is required.');

      /* ---- 3a) Bodega scope guard ---- */
      assertLocatorsAllowed(allIssueLines, assigned_locators);

      /* ---- 3b) Fetch UOM Conversions for all items in the form ---- */
      const itemCodes = [...new Set(allIssueLines.map(l => String(l.item_code)))];
      const uomMap = new Map();

      if (itemCodes.length > 0) {
        const placeholders = itemCodes.map((_, i) => `@p${i}`).join(',');
        const req = new sql.Request(tx);
        itemCodes.forEach((code, i) => req.input(`p${i}`, sql.NVarChar(100), code));

        const uomRes = await req.query(`
          SELECT piece_item_code, pieces_per_box
            FROM dbo.uom_conversions
           WHERE piece_item_code IN (${placeholders}) AND Status = 'Active'
        `);
        for (const r of uomRes.recordset) {
          uomMap.set(r.piece_item_code, Number(r.pieces_per_box));
        }
      }

      const pending = new Map();
      for (const l of allIssueLines) {
        if (!l.locator_code) throw new Error('Each line requires locator_code.');
        if (!l.item_code)    throw new Error('Each line requires item_code.');

        const itemCode = String(l.item_code);
        const pieces_per_box = uomMap.get(itemCode) || null;

        let qtyIssued = Number(l.qty_issued);
        let qtyBoxes = l.qty_boxes != null ? Number(l.qty_boxes) : null;
        let qtyLoose = l.qty_loose_pieces != null ? Number(l.qty_loose_pieces) : null;

        if (pieces_per_box) {
          const boxes = qtyBoxes || 0;
          const loose = qtyLoose || 0;
          if (boxes > 0 || loose > 0) {
            qtyIssued = (boxes * pieces_per_box) + loose;
          }
        }

        if (!(qtyIssued > 0)) throw new Error(`Line qty_issued must be > 0 (got ${l.qty_issued}).`);

        const k = keyOf(l.locator_code, itemCode);
        const avail = invMap.get(k);
        if (!avail) {
          throw new Error(`No underground stock for locator=${l.locator_code} item=${itemCode}.`);
        }
        const already   = pending.get(k) || 0;
        const remaining = Number(avail.qty_on_hand) - already;
        if (qtyIssued > remaining) {
          throw new Error(
            `Insufficient underground stock for locator=${l.locator_code} item=${itemCode}. ` +
            `Available: ${remaining}, requested: ${qtyIssued}.`
          );
        }
        pending.set(k, already + qtyIssued);
      }

      /* ---- 4) Allocate the per-type form number ---- */
      const seqRes = await new sql.Request(tx).query(
        `SELECT NEXT VALUE FOR dbo.${meta.seq} AS seq_val`
      );
      const seqVal       = Number(seqRes.recordset[0].seq_val);
      const formSeriesNo = `${type}-${String(seqVal).padStart(5, '0')}`;

      /* ---- 5) Resolve per-line metadata + costs (STRICT 4 DECIMAL) ---- */
      const resolved = allIssueLines.map((l) => {
        const itemCode = String(l.item_code);
        const avail = invMap.get(keyOf(l.locator_code, itemCode));
        const pieces_per_box = uomMap.get(itemCode) || null;

        let qtyIssued = Number(l.qty_issued);
        let qtyBoxes = l.qty_boxes != null ? Number(l.qty_boxes) : null;
        let qtyLoose = l.qty_loose_pieces != null ? Number(l.qty_loose_pieces) : null;

        if (pieces_per_box) {
          const boxes = qtyBoxes || 0;
          const loose = qtyLoose || 0;
          if (boxes > 0 || loose > 0) {
            qtyIssued = (boxes * pieces_per_box) + loose;
          }
        }

        const exactTotalValue = Number(avail?.total_value) || 0;
        const exactQtyOnHand  = Number(avail?.qty_on_hand) || 0;

        let lineAmount;
        let unitCostForLine;

        if (exactQtyOnHand > 0) {
          // ✅ STRICT 4 DECIMAL: Round unit cost to 4 decimals before multiplying
          unitCostForLine = Math.round((exactTotalValue / exactQtyOnHand) * 10000) / 10000;
          lineAmount      = Math.round(qtyIssued * unitCostForLine * 10000) / 10000;
        } else {
          unitCostForLine = Number(avail?.unit_cost) || 0;
          lineAmount      = Math.round(qtyIssued * unitCostForLine * 10000) / 10000;
        }

        return {
          section:        l._section,
          locator_code:   String(l.locator_code),
          locator_name:   avail?.locator_name ?? null,
          item_code:      itemCode,
          item_name:      avail?.item_name ?? null,
          uom:            avail?.uom ?? null,
          barcode:        avail?.barcode ?? null,
          category:       avail?.category ?? null,
          purchase_class: avail?.purchase_class ?? null,
          gl_class:       avail?.gl_class ?? null,
          qty_required:   l.qty_required != null ? Number(l.qty_required) : null,
          qty_boxes:      qtyBoxes,
          qty_loose_pieces: qtyLoose,
          pieces_per_box_snapshot: pieces_per_box,
          qty_issued:     qtyIssued,
          unit_cost:      unitCostForLine,
          line_amount:    lineAmount,
          remarks:        l.remarks ?? null,
        };
      });

      // ✅ STRICT 4 DECIMAL: round the SUM
      const totalAmount = round4(resolved.reduce((s, r) => s + r.line_amount, 0));
      const lineCount = resolved.length;

      /* ---- 6) Insert header ---- */
      const hdrRes = await new sql.Request(tx)
        .input('form_type',           sql.NVarChar(10),  type)
        .input('form_series_no',      sql.NVarChar(30),  formSeriesNo)
        .input('form_document_code',  sql.NVarChar(20),  meta.doc_code)
        .input('form_revision',       sql.NVarChar(10),  meta.revision)
        .input('shift_id',            sql.Int,           Number(shift_id))
        .input('warehouse_id',        sql.Int,           Number(warehouse_id))
        .input('warehouse_code',      sql.NVarChar(20),  warehouse_code)
        .input('issued_by_username',  sql.NVarChar(50),  issued_by_username)
        .input('issued_by_position',  sql.NVarChar(100), issued_by_position ?? null)
        .input('dept_section',        sql.NVarChar(200), dept_section ?? null)
        .input('adh_dh_initials',     sql.NVarChar(100), adh_dh_initials ?? null)
        .input('activity_cc',         sql.NVarChar(100), activity_cc ?? null)
        .input('level_field',         sql.NVarChar(50),  level_field ?? null)
        .input('form_date',           sql.Date,          form_date ? new Date(form_date) : null)
        .input('working_place',       sql.NVarChar(200), working_place ?? null)
        .input('lhd_no',              sql.NVarChar(50),  lhd_no ?? null)
        .input('shift_label',         sql.NVarChar(10),  shift_label ?? null)
        .input('bdm_rdm_no',          sql.NVarChar(50),  bdm_rdm_no ?? null)
        .input('bdm_shift_label',     sql.NVarChar(10),  bdm_shift_label ?? null)
        .input('authorized_name',     sql.NVarChar(150), authorized_name ?? null)
        .input('authorized_position', sql.NVarChar(150), authorized_position ?? null)
        .input('issued_name',         sql.NVarChar(150), issued_name ?? null)
        .input('issued_position',     sql.NVarChar(150), issued_position ?? null)
        .input('received_name',       sql.NVarChar(150), received_name ?? null)
        .input('received_position',   sql.NVarChar(150), received_position ?? null)
        .input('bodega_name',         sql.NVarChar(150), bodega_name ?? null)
        .input('bodega_position',     sql.NVarChar(150), bodega_position ?? null)
        .input('chapa_no',            sql.NVarChar(40),  chapa_no ?? null)
        .input('attachment_base64',    sql.NVarChar(sql.MAX), attachment_base64 ?? null)
        .input('attachment_name',      sql.NVarChar(255),     attachment_name ?? null)
        .input('attachment_mime_type', sql.NVarChar(100),     attachment_mime_type ?? null)
        .input('total_amount',        sql.Decimal(18,4), totalAmount)
        .input('line_count',          sql.Int,           lineCount)
        .input('remarks',             sql.NVarChar(500), remarks ?? null)
        .query(`
          INSERT INTO dbo.underground_issue_forms (
            form_type, form_series_no, form_document_code, form_revision,
            shift_id, warehouse_id, warehouse_code,
            issued_by_username, issued_by_position,
            dept_section, adh_dh_initials, activity_cc, level_field,
            form_date, working_place, lhd_no, shift_label,
            bdm_rdm_no, bdm_shift_label,
            authorized_name, authorized_position,
            issued_name, issued_position,
            received_name, received_position,
            bodega_name, bodega_position,
            chapa_no,
            attachment_base64, attachment_name, attachment_mime_type,
            total_amount, line_count, remarks
          )
          OUTPUT INSERTED.form_id, INSERTED.issued_at
          VALUES (
            @form_type, @form_series_no, @form_document_code, @form_revision,
            @shift_id, @warehouse_id, @warehouse_code,
            @issued_by_username, @issued_by_position,
            @dept_section, @adh_dh_initials, @activity_cc, @level_field,
            @form_date, @working_place, @lhd_no, @shift_label,
            @bdm_rdm_no, @bdm_shift_label,
            @authorized_name, @authorized_position,
            @issued_name, @issued_position,
            @received_name, @received_position,
            @bodega_name, @bodega_position,
            @chapa_no,
            @attachment_base64, @attachment_name, @attachment_mime_type,
            @total_amount, @line_count, @remarks
          )
        `);

      const formId    = Number(hdrRes.recordset[0].form_id);
      const issuedAt  = hdrRes.recordset[0].issued_at;

      /* ---- 7) Bulk insert regular lines + BDM lines ---- */
      const buildLineTable = (target) => {
        const t = new sql.Table(target);
        t.create = false;
        t.columns.add('form_id',        sql.BigInt,        { nullable: false });
        t.columns.add('line_no',        sql.Int,           { nullable: false });
        t.columns.add('item_code',      sql.NVarChar(100), { nullable: false });
        t.columns.add('item_name',      sql.NVarChar(800), { nullable: true  });
        t.columns.add('uom',            sql.NVarChar(100), { nullable: true  });
        t.columns.add('barcode',        sql.NVarChar(200), { nullable: true  });
        t.columns.add('category',       sql.NVarChar(200), { nullable: true  });
        t.columns.add('purchase_class', sql.NVarChar(200), { nullable: true  });
        t.columns.add('gl_class',       sql.NVarChar(40),  { nullable: true  });
        t.columns.add('locator_code',   sql.NVarChar(100), { nullable: false });
        t.columns.add('locator_name',   sql.NVarChar(510), { nullable: true  });
        t.columns.add('qty_required',   sql.Decimal(18,4), { nullable: true  });
        t.columns.add('qty_boxes',      sql.Decimal(18,4), { nullable: true  });
        t.columns.add('qty_loose_pieces', sql.Decimal(18,4), { nullable: true });
        t.columns.add('pieces_per_box_snapshot', sql.Decimal(18,4), { nullable: true });
        t.columns.add('qty_issued',     sql.Decimal(18,4), { nullable: false });
        t.columns.add('unit_cost',      sql.Decimal(18,6), { nullable: false });
        t.columns.add('line_amount',    sql.Decimal(18,4), { nullable: false });
        t.columns.add('remarks',        sql.NVarChar(1000),{ nullable: true  });
        return t;
      };

      const pushRow = (t, r, i) => {
        t.rows.add(
          formId, i + 1,
          r.item_code, r.item_name, r.uom, r.barcode, r.category,
          r.purchase_class, r.gl_class,
          r.locator_code, r.locator_name,
          r.qty_required, r.qty_boxes, r.qty_loose_pieces, r.pieces_per_box_snapshot,
          r.qty_issued, r.unit_cost, r.line_amount, r.remarks
        );
      };

      const regularRows = resolved.filter((r) => r.section === 'Regular');
      const bdmRows     = resolved.filter((r) => r.section === 'BDM');

      if (regularRows.length) {
        const t = buildLineTable('dbo.underground_issue_form_lines');
        regularRows.forEach((r, i) => pushRow(t, r, i));
        await new sql.Request(tx).bulk(t);
      }
      if (bdmRows.length) {
        const t = buildLineTable('dbo.underground_issue_form_bdm_lines');
        bdmRows.forEach((r, i) => pushRow(t, r, i));
        await new sql.Request(tx).bulk(t);
      }

      /* ---- 8) Append Release rows to underground_shift_lines ---- */
      const shiftLines = new sql.Table('dbo.underground_shift_lines');
      shiftLines.create = false;
      shiftLines.columns.add('shift_id',       sql.Int,           { nullable: false });
      shiftLines.columns.add('line_kind',      sql.NVarChar(20),  { nullable: false });
      shiftLines.columns.add('locator_code',   sql.NVarChar(100), { nullable: false });
      shiftLines.columns.add('locator_name',   sql.NVarChar(510), { nullable: true  });
      shiftLines.columns.add('item_code',      sql.NVarChar(100), { nullable: false });
      shiftLines.columns.add('item_name',      sql.NVarChar(800), { nullable: true  });
      shiftLines.columns.add('uom',            sql.NVarChar(100), { nullable: true  });
      shiftLines.columns.add('barcode',        sql.NVarChar(200), { nullable: true  });
      shiftLines.columns.add('category',       sql.NVarChar(200), { nullable: true  });
      shiftLines.columns.add('purchase_class', sql.NVarChar(200), { nullable: true  });
      shiftLines.columns.add('gl_class',       sql.NVarChar(40),  { nullable: true  });
      shiftLines.columns.add('qty',            sql.Decimal(18,4), { nullable: false });
      shiftLines.columns.add('unit_cost',      sql.Decimal(18,6), { nullable: false });
      shiftLines.columns.add('line_total',     sql.Decimal(18,4), { nullable: false });
      shiftLines.columns.add('released_at',    sql.DateTime2,     { nullable: true  });
      shiftLines.columns.add('released_by',    sql.NVarChar(200), { nullable: true  });
      shiftLines.columns.add('destination',    sql.NVarChar(400), { nullable: true  });
      shiftLines.columns.add('remarks',        sql.NVarChar(1000),{ nullable: true  });

      const now = new Date();
      for (const r of resolved) {
        shiftLines.rows.add(
          Number(shift_id), 'Release',
          r.locator_code, r.locator_name,
          r.item_code, r.item_name,
          r.uom, r.barcode, r.category, r.purchase_class, r.gl_class,
          r.qty_issued, r.unit_cost, r.line_amount,
          now, issued_by_username,
          formSeriesNo, r.remarks
        );
      }
      await new sql.Request(tx).bulk(shiftLines);

      await tx.commit();

      return {
        form_id:            formId,
        form_type:          type,
        form_series_no:     formSeriesNo,
        form_document_code: meta.doc_code,
        form_revision:      meta.revision,
        issued_at:          issuedAt,
        line_count:         lineCount,
        total_amount:       totalAmount,
        has_attachment:     Boolean(attachment_base64),
      };
    } catch (err) {
      try { await tx.rollback(); } catch { /* noop */ }
      throw err;
    }
  },

  /* ============================================================
     READ — one form
     ============================================================ */
  getFormById: async (form_id) => {
    const headerRows = await query(
      `SELECT * FROM dbo.underground_issue_forms WHERE form_id = @param0`,
      [form_id]
    );
    if (!headerRows.length) return null;

    const [lines, bdm_lines] = await Promise.all([
      query(
        `SELECT * FROM dbo.underground_issue_form_lines
          WHERE form_id = @param0 ORDER BY line_no`,
        [form_id]
      ),
      query(
        `SELECT * FROM dbo.underground_issue_form_bdm_lines
          WHERE form_id = @param0 ORDER BY line_no`,
        [form_id]
      ),
    ]);

    return { ...headerRows[0], lines, bdm_lines };
  },

  /* ============================================================
     READ — all forms attached to a single shift
     ============================================================ */
  listFormsForShift: async (shift_id) => {
    return query(
      `SELECT form_id, form_type, form_series_no, form_document_code,
              form_revision, warehouse_id, warehouse_code,
              issued_at, issued_by_username,
              dept_section, working_place, lhd_no, shift_label,
              total_amount, line_count, remarks,
              CASE WHEN attachment_base64 IS NOT NULL THEN 1 ELSE 0 END AS has_attachment
         FROM dbo.underground_issue_forms
        WHERE shift_id = @param0
        ORDER BY issued_at ASC, form_id ASC`,
      [shift_id]
    );
  },

  /* ============================================================
     READ — paginated history for a warehouse
     ============================================================ */
  listFormsForWarehouse: async ({
    warehouse_id,
    form_type,
    start_date,
    end_date,
    assigned_locators = null,
    page = 1,
    limit = 50,
  } = {}) => {
    const params = [];
    const conds  = [];

    if (warehouse_id != null) {
      params.push(warehouse_id);
      conds.push(`f.warehouse_id = @param${params.length - 1}`);
    }
    if (form_type) {
      const t = String(form_type).toUpperCase();
      if (!isFormType(t)) throw new Error(`Invalid form_type: ${form_type}`);
      params.push(t);
      conds.push(`f.form_type = @param${params.length - 1}`);
    }

    if (start_date) {
      const d = start_date instanceof Date ? start_date : new Date(start_date);
      if (!Number.isNaN(d.getTime())) {
        params.push(d);
        conds.push(`f.issued_at >= @param${params.length - 1}`);
      }
    }
    if (end_date) {
      const d = end_date instanceof Date ? end_date : new Date(end_date);
      if (!Number.isNaN(d.getTime())) {
        params.push(d);
        conds.push(`f.issued_at <= @param${params.length - 1}`);
      }
    }

    if (Array.isArray(assigned_locators) && assigned_locators.length > 0) {
      const placeholders = assigned_locators.map((code) => {
        params.push(String(code));
        return `@param${params.length - 1}`;
      });
      const inList = placeholders.join(', ');
      conds.push(`(
        EXISTS (
          SELECT 1 FROM dbo.underground_issue_form_lines l
           WHERE l.form_id      = f.form_id
             AND l.locator_code IN (${inList})
        )
        OR
        EXISTS (
          SELECT 1 FROM dbo.underground_issue_form_bdm_lines b
           WHERE b.form_id      = f.form_id
             AND b.locator_code IN (${inList})
        )
      )`);
    }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 5000);
    const safePage  = Math.max(parseInt(page, 10) || 1, 1);
    const offset    = (safePage - 1) * safeLimit;

    const aggRows = await query(
      `SELECT
         COUNT(*)                      AS total_forms,
         ISNULL(SUM(f.line_count), 0)  AS total_lines,
         ISNULL(SUM(f.total_amount), 0) AS total_amount
       FROM dbo.underground_issue_forms f
       ${where}`,
      params
    );
    const agg = aggRows[0] || {};
    const total = Number(agg.total_forms) || 0;
    const totals = {
      forms:  total,
      lines:  Number(agg.total_lines)  || 0,
      amount: Number(agg.total_amount) || 0,
    };

    const listParams = [...params, offset, safeLimit];
    const offIdx     = listParams.length - 2;
    const limIdx     = listParams.length - 1;

    const rows = await query(
      `SELECT f.form_id, f.form_type, f.form_series_no, f.form_document_code,
              f.form_revision, f.shift_id, f.warehouse_id, f.warehouse_code,
              f.issued_at, f.issued_by_username,
              f.dept_section, f.working_place, f.lhd_no, f.shift_label,
              f.total_amount, f.line_count, f.remarks,
              CASE WHEN f.attachment_base64 IS NOT NULL THEN 1 ELSE 0 END AS has_attachment,
              s.status AS shift_status
         FROM dbo.underground_issue_forms f
         LEFT JOIN dbo.underground_shift s ON s.shift_id = f.shift_id
         ${where}
        ORDER BY f.issued_at DESC, f.form_id DESC
        OFFSET @param${offIdx} ROWS FETCH NEXT @param${limIdx} ROWS ONLY`,
      listParams
    );

    const totalPages = Math.max(Math.ceil(total / safeLimit), 1);
    return { rows, total, page: safePage, limit: safeLimit, totalPages, totals };
  },
};

module.exports = UndergroundIssueFormModel;