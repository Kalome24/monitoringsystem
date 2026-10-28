// src/components/underground/issueForms/IssueFormModal.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FiX, FiLoader, FiAlertTriangle, FiAlertCircle, FiCheckCircle,
  FiPlus, FiTrash2, FiSearch, FiPrinter, FiSave, FiMapPin,
  FiChevronDown, FiChevronUp, FiInfo, FiImage, FiUploadCloud,
  FiShield, FiBox,
} from 'react-icons/fi';
import {
  undergroundApi, issueFormApi, signatureConfigApi,
  locatorsApi, offlineConfigApi, uomConversionApi,
} from '../../../services/api';
import { getUser } from '../../../secure/auth';
import { useToast } from '../../shared/ToastProvider';
import LepantoLetterhead from './lepantoLetterhead';
import IssueFormPrint from './IssueFormPrint';
import { getTemplate, buildEmptyDraft, SHIFT_OPTIONS } from './formTemplates';

/* ============================================================
   Formatters — STRICT 4-DECIMAL PRECISION for money
   ============================================================ */
const intFmt = new Intl.NumberFormat('en-PH');
const curFmt = new Intl.NumberFormat('en-PH', {
  style: 'currency', currency: 'PHP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});
const fmtInt = (n) => intFmt.format(Number(n) || 0);
const fmtCur = (n) => curFmt.format(Number(n) || 0);

const fmtBytes = (b) => {
  const n = Number(b) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};

/* ============================================================
   Attachment constants
   ============================================================ */
const ATTACHMENT_MAX_BYTES = 6 * 1024 * 1024;
const ATTACHMENT_ACCEPTED_MIME = Object.freeze([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
]);
const ATTACHMENT_ACCEPT_ATTR = ATTACHMENT_ACCEPTED_MIME.join(',');

/* ============================================================
   Bodega helpers
   ============================================================ */
const parseBodega = (s) =>
  String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

const serializeBodega = (arr) =>
  Array.from(new Set((arr || []).filter(Boolean))).join(', ');

/* ============================================================
   Focus priority — BDM fields intentionally omitted (optional)
   ============================================================ */
const FOCUS_ORDER = [
  'dept_section', 'adh_dh_initials', 'activity_cc', 'level_field',
  'form_date', 'working_place', 'lhd_no', 'shift_label',
  'lines_empty',
  'authorized_name', 'issued_name', 'received_name', 'bodega_name', 'chapa_no',
  'attachment',
];

const pickFocusKey = (errorKeys) => {
  for (const key of FOCUS_ORDER) if (errorKeys.includes(key)) return key;
  const lineKey = errorKeys.find((k) => k.startsWith('line:'));
  if (lineKey) return lineKey;
  return errorKeys[0] || null;
};

/* ============================================================
   Footer slots — all required
   ============================================================ */
const FOOTER_ROWS = [
  { key: 'authorized', kind: 'dropdown', role: 'Authorized By', label: 'Authorized by',        required: true },
  { key: 'issued',     kind: 'readonly',                        label: 'Issued by',            required: true },
  { key: 'received',   kind: 'text',                            label: 'Received by',          required: true },
  { key: 'bodega',     kind: 'locator-multi',                   label: 'Bodega',               required: true },
  { key: 'chapa',      kind: 'text',                            label: 'Chapa (Employee No.)', required: true },
];

const userFullName = (u) => {
  if (!u) return '';
  const parts = [u.first_name, u.last_name].filter(Boolean);
  const joined = parts.join(' ').trim();
  return joined || u.username || '';
};

const readAsBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const m = /^data:([^;]+);base64,(.+)$/.exec(result);
      if (!m) return reject(new Error('Could not read image data.'));
      resolve({ mime: m[1], base64: m[2], preview: result });
    };
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.readAsDataURL(file);
  });

const isBlank = (v) => {
  if (v == null) return true;
  if (typeof v === 'string') {
    const t = v.trim();
    return t === '' || t === '__OTHER__';
  }
  return false;
};

/* ============================================================
   Component
   ============================================================ */
const IssueFormModal = ({ formType, shift, onClose, onSuccess }) => {
  const toast = useToast();
  const tpl = useMemo(() => getTemplate(formType), [formType]);
  const currentUser = useMemo(() => getUser(), []);

  const [draft, setDraft] = useState(() => {
    const base = buildEmptyDraft(formType);
    return {
      ...base,
      issued_name: userFullName(currentUser),
      issued_position: currentUser?.emp_position || '',
    };
  });

  const [inventory, setInventory] = useState([]);
  const [inventoryLoading, setInventoryLoading] = useState(true);
  const [uomRules, setUomRules] = useState({});

  const [sigConfig, setSigConfig] = useState([]);
  const [sigLoading, setSigLoading] = useState(true);

  const [locators, setLocators] = useState([]);
  const [locatorsLoading, setLocatorsLoading] = useState(true);
  const [locatorsScoped, setLocatorsScoped] = useState(false);

  const [offlineConfigs, setOfflineConfigs] = useState([]);

  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [result, setResult] = useState(null);
  const [printOpen, setPrintOpen] = useState(false);

  const [attachment, setAttachment] = useState(null);
  const [attachError, setAttachError] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef(null);

  const [errors, setErrors] = useState({});
  const [hasSubmittedOnce, setHasSubmittedOnce] = useState(false);
  const [pulseField, setPulseField] = useState(null);

  /* ---------- Load UOM Conversion Rules ---------- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await uomConversionApi.getAll({ limit: 5000 });
        if (cancelled) return;
        if (res.ok && res.data?.data) {
          const map = {};
          res.data.data.forEach((r) => {
            if (r.Status === 'Active') {
              map[r.piece_item_code] = Number(r.pieces_per_box);
            }
          });
          setUomRules(map);
        }
      } catch (err) {
        console.warn('Could not load UOM rules:', err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /* ---------- Load underground inventory ---------- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setInventoryLoading(true);
      try {
        const res = await undergroundApi.currentInventory({ limit: 2000 });
        if (cancelled) return;
        setInventory(Array.isArray(res.data) ? res.data : []);
      } catch (err) {
        console.warn('Could not load underground inventory:', err);
        if (!cancelled) setInventory([]);
      } finally {
        if (!cancelled) setInventoryLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /* ---------- Load signature config ---------- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setSigLoading(true);
      try {
        const res = await signatureConfigApi.list({
          role_slot: 'Authorized By',
          is_active: true,
        });
        if (cancelled) return;
        setSigConfig(Array.isArray(res.data) ? res.data : []);
      } catch (err) {
        console.warn('Could not load signature config:', err);
        if (!cancelled) setSigConfig([]);
      } finally {
        if (!cancelled) setSigLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /* ---------- Load offline configs ---------- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const categories = ['ACTIVITY_CC', 'LEVEL', 'LHD_NO'];
        const results = await Promise.all(
          categories.map((cat) =>
            offlineConfigApi.getAll({ category: cat, page: 1, limit: 5000 })
          )
        );
        if (cancelled) return;
        const merged = [];
        for (const res of results) {
          if (!res?.ok) continue;
          const items = Array.isArray(res.data)
            ? res.data
            : Array.isArray(res.data?.data) ? res.data.data : [];
          merged.push(...items);
        }
        setOfflineConfigs(merged);
      } catch (err) {
        console.warn('Could not load offline configs:', err);
        if (!cancelled) setOfflineConfigs([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /* ---------- Load locators ---------- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLocatorsLoading(true);
      try {
        const whCode = currentUser?.warehouse_code;
        if (!whCode) {
          if (!cancelled) setLocators([]);
          return;
        }
        const res = await locatorsApi.list({
          warehouse_code: whCode,
          limit: 2000,
        });
        if (cancelled) return;
        setLocators(Array.isArray(res.data) ? res.data : []);
        setLocatorsScoped(!!res.scoped);
      } catch (err) {
        console.warn('Could not load locators:', err);
        if (!cancelled) setLocators([]);
      } finally {
        if (!cancelled) setLocatorsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [currentUser?.warehouse_code]);

  /* ============================================================
     Attachment
     ============================================================ */
  const processFile = useCallback(async (file) => {
    setAttachError(null);
    if (!file) return;
    if (!ATTACHMENT_ACCEPTED_MIME.includes(file.type)) {
      setAttachError('Only JPEG, PNG, WebP, or GIF images are allowed.');
      return;
    }
    if (file.size > ATTACHMENT_MAX_BYTES) {
      setAttachError(
        `Image is ${fmtBytes(file.size)} — the maximum is ${fmtBytes(ATTACHMENT_MAX_BYTES)}.`
      );
      return;
    }
    try {
      const { base64, mime, preview } = await readAsBase64(file);
      setAttachment({
        base64, mime,
        name: file.name || 'proof-image',
        size: file.size,
        preview,
      });
    } catch (err) {
      setAttachError(err?.message || 'Could not read the file.');
    }
  }, []);

  const clearAttachment = useCallback(() => {
    setAttachment(null);
    setAttachError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const onAttachClick = () => {
    if (submitting) return;
    fileInputRef.current?.click();
  };

  const onFileInputChange = (e) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = '';
  };

  const onDrop = (e) => {
    e.preventDefault(); e.stopPropagation();
    setDragActive(false);
    if (submitting) return;
    const file = e.dataTransfer?.files?.[0];
    if (file) processFile(file);
  };

  const onDragOver = (e) => {
    e.preventDefault(); e.stopPropagation();
    if (!submitting) setDragActive(true);
  };

  const onDragLeave = (e) => {
    e.preventDefault(); e.stopPropagation();
    setDragActive(false);
  };

  /* ============================================================
     Bodega
     ============================================================ */
  const activeItemCodes = useMemo(() => {
    const s = new Set();
    for (const l of draft.lines     || []) if (l.item_code) s.add(l.item_code);
    for (const l of draft.bdm_lines || []) if (l.item_code) s.add(l.item_code);
    return s;
  }, [draft.lines, draft.bdm_lines]);

  const locatorHoldings = useMemo(() => {
    const m = new Map();
    for (const row of inventory) {
      if (!row.locator_code || !row.item_code) continue;
      if ((Number(row.qty_on_hand) || 0) <= 0) continue;
      if (!m.has(row.locator_code)) m.set(row.locator_code, new Set());
      m.get(row.locator_code).add(row.item_code);
    }
    return m;
  }, [inventory]);

  const eligibleBodegaLocators = useMemo(() => {
    if (activeItemCodes.size === 0) return locators;
    return locators.filter((l) => {
      const held = locatorHoldings.get(l.locator_code);
      if (!held) return false;
      for (const ic of activeItemCodes) if (held.has(ic)) return true;
      return false;
    });
  }, [locators, locatorHoldings, activeItemCodes]);

  const bodegaFilterActive = activeItemCodes.size > 0;

  const itemLocators = useMemo(() => {
    const s = new Set();
    for (const l of draft.lines     || []) if (l.locator_code) s.add(l.locator_code);
    for (const l of draft.bdm_lines || []) if (l.locator_code) s.add(l.locator_code);
    return Array.from(s);
  }, [draft.lines, draft.bdm_lines]);

  const selectedBodega = useMemo(
    () => parseBodega(draft.bodega_name),
    [draft.bodega_name]
  );

  const missingBodegaLocators = useMemo(() => {
    if (itemLocators.length === 0) return [];
    const sel = new Set(selectedBodega);
    return itemLocators.filter((code) => !sel.has(code));
  }, [itemLocators, selectedBodega]);

  const setHeader = useCallback((key, value) => {
    setDraft((d) => ({ ...d, [key]: value }));
  }, []);

  /* ============================================================
     Lines
     ============================================================ */
  const addLine = useCallback((row, kind = 'lines') => {
    setDraft((d) => {
      const list = d[kind] || [];
      const exists = list.some(
        (l) => l.locator_code === row.locator_code && l.item_code === row.item_code
      );
      if (exists) return d;

      const line = {
        locator_code: row.locator_code,
        item_code:    row.item_code,
        item_name:    row.item_name || '',
        uom:          row.uom || '',
        qty_on_hand:  Number(row.qty_on_hand) || 0,
        unit_cost:    Number(row.unit_cost)   || 0,
        qty_required: '',
        qty_issued:   '',
        qty_boxes:    '',
        qty_loose_pieces: '',
        remarks:      '',
      };

      const bodegaList = parseBodega(d.bodega_name);
      const nextBodega = bodegaList.includes(row.locator_code)
        ? bodegaList
        : [...bodegaList, row.locator_code];

      return {
        ...d,
        [kind]: [...list, line],
        bodega_name: serializeBodega(nextBodega),
      };
    });
  }, []);

  const removeLine = useCallback((idx, kind = 'lines') => {
    setDraft((d) => ({
      ...d,
      [kind]: (d[kind] || []).filter((_, i) => i !== idx),
    }));
  }, []);

  const updateLine = useCallback((idx, patch, kind = 'lines') => {
    setDraft((d) => ({
      ...d,
      [kind]: (d[kind] || []).map((l, i) => (i === idx ? { ...l, ...patch } : l)),
    }));
  }, []);

  const hasLineOverflow = useMemo(() => {
    const check = (list) =>
      (list || []).some((l) => {
        const iss = Number(l.qty_issued) || 0;
        return iss > (Number(l.qty_on_hand) || 0);
      });
    if (check(draft.lines)) return true;
    if (tpl?.has_bdm_block && check(draft.bdm_lines)) return true;
    return false;
  }, [draft.lines, draft.bdm_lines, tpl?.has_bdm_block]);

  const fieldLabelFor = useCallback((key) => {
    const h = (tpl?.header_fields || []).find((f) => f.key === key);
    if (h) return h.label;
    for (const slot of FOOTER_ROWS) {
      if (key === `${slot.key}_name`) return slot.label;
      if (slot.key === 'chapa' && key === 'chapa_no') return slot.label;
    }
    return key;
  }, [tpl]);

  /* ============================================================
     Error builder
     ============================================================ */
  const buildErrors = useCallback(() => {
    const errs = {};

    for (const f of (tpl?.header_fields || [])) {
      if (isBlank(draft[f.key])) {
        errs[f.key] = `${fieldLabelFor(f.key)} is required.`;
      }
    }

    const regularLines = draft.lines || [];
    if (regularLines.length === 0) {
      errs.lines_empty = 'Add at least one line item.';
    } else {
      const sums = {};
      for (let i = 0; i < regularLines.length; i++) {
        const l = regularLines[i];
        const key = `line:regular:${i}`;
        const iss = Number(l.qty_issued) || 0;
        if (iss <= 0) {
          errs[key] = `${l.item_code || 'Item'}: issued quantity must be greater than 0.`;
        }
        const k = `${l.locator_code}||${l.item_code}`;
        sums[k] = (sums[k] || 0) + iss;
      }
      for (const [k, total] of Object.entries(sums)) {
        const [loc, item] = k.split('||');
        const line = regularLines.find(
          (l) => l.locator_code === loc && l.item_code === item
        );
        if (line && total > line.qty_on_hand) {
          for (let i = 0; i < regularLines.length; i++) {
            const l = regularLines[i];
            if (l.locator_code !== loc || l.item_code !== item) continue;
            const key = `line:regular:${i}`;
            if (!errs[key]) {
              errs[key] = `${item}: total issued ${total} exceeds ${line.qty_on_hand} on hand.`;
            }
          }
        }
      }
    }

    // BDM block intentionally NOT validated — it's optional.

    if (isBlank(draft.authorized_name)) {
      errs.authorized_name = 'Authorized by is required.';
    }
    if (isBlank(draft.issued_name)) {
      errs.issued_name = 'Issued by is missing (no logged-in user context).';
    }
    if (isBlank(draft.received_name)) {
      errs.received_name = 'Received by is required.';
    }
    if (!parseBodega(draft.bodega_name).length) {
      errs.bodega_name = 'Bodega is required — add at least one locator.';
    }
    if (isBlank(draft.chapa_no)) {
      errs.chapa_no = 'Chapa (Employee No.) is required.';
    }

    if (attachError) {
      errs.attachment = attachError;
    }

    return errs;
  }, [draft, tpl, attachError, fieldLabelFor]);

  useEffect(() => {
    if (!hasSubmittedOnce) return;
    const next = buildErrors();
    setErrors(next);
  }, [buildErrors, hasSubmittedOnce]);

  useEffect(() => {
    if (!pulseField) return undefined;
    const t = setTimeout(() => setPulseField(null), 1600);
    return () => clearTimeout(t);
  }, [pulseField]);

  const scrollToError = useCallback((errs) => {
    const keys = Object.keys(errs || {});
    if (keys.length === 0) return;
    const targetKey = pickFocusKey(keys);
    if (!targetKey) return;

    requestAnimationFrame(() => {
      const selector = `[data-error-field="${targetKey}"]`;
      const el = document.querySelector(selector);
      if (!el) return;
      try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      catch { el.scrollIntoView(); }
      setPulseField(targetKey);
      setTimeout(() => {
        try { el.focus({ preventScroll: true }); } catch { /* noop */ }
      }, 380);
    });
  }, []);

  /* ============================================================
     Submit
     ============================================================ */
  const handleSubmit = async () => {
    if (hasLineOverflow) {
      const nextErrs = buildErrors();
      setHasSubmittedOnce(true);
      setErrors(nextErrs);
      setFeedback({
        type: 'error',
        message:
          'One or more lines exceed the maximum on-hand quantity. ' +
          'Fix the highlighted Issued values before saving.',
      });
      scrollToError(nextErrs);
      return;
    }

    const errs = buildErrors();
    setHasSubmittedOnce(true);
    setErrors(errs);

    if (Object.keys(errs).length > 0) {
      setFeedback({
        type: 'error',
        message:
          Object.keys(errs).length === 1
            ? 'Please fix the highlighted field before saving.'
            : `Please fix ${Object.keys(errs).length} highlighted fields before saving.`,
      });
      scrollToError(errs);
      return;
    }

    setSubmitting(true);
    setFeedback(null);

    try {
      const mapLine = (l) => {
        const totalPieces = Number(l.qty_issued) || 0;
        const piecesPerBox = uomRules[l.item_code] || null;

        let qty_boxes = null;
        let qty_loose_pieces = null;
        if (piecesPerBox && totalPieces > 0) {
          qty_boxes = Math.floor(totalPieces / piecesPerBox);
          qty_loose_pieces = totalPieces % piecesPerBox;
        }

        return {
          locator_code: l.locator_code,
          item_code:    l.item_code,
          qty_required: l.qty_required === '' ? null : Number(l.qty_required),
          qty_issued:   totalPieces,
          qty_boxes,
          qty_loose_pieces,
          remarks:      l.remarks ? String(l.remarks) : null,
        };
      };

      const payload = {
        form_type:       formType,
        dept_section:    draft.dept_section    || null,
        adh_dh_initials: draft.adh_dh_initials || null,
        activity_cc:     draft.activity_cc === '__OTHER__' ? null : (draft.activity_cc || null),
        level_field:     draft.level_field === '__OTHER__' ? null : (draft.level_field || null),
        form_date:       draft.form_date       || null,
        working_place:   draft.working_place   || null,
        lhd_no:          draft.lhd_no === '__OTHER__' ? null : (draft.lhd_no || null),
        shift_label:     draft.shift_label     || null,
        bdm_rdm_no:      draft.bdm_rdm_no      || null,
        bdm_shift_label: draft.bdm_shift_label || null,
        authorized_name:     draft.authorized_name     || null,
        authorized_position: draft.authorized_position || null,
        issued_name:         draft.issued_name         || null,
        issued_position:     draft.issued_position     || null,
        received_name:       draft.received_name ? draft.received_name.trim() : null,
        received_position:   null,
        bodega_name:         serializeBodega(parseBodega(draft.bodega_name)) || null,
        bodega_position:     null,
        chapa_no:            draft.chapa_no ? draft.chapa_no.trim() : null,
        remarks: draft.remarks || null,
        attachment_base64:    attachment?.base64 || null,
        attachment_name:      attachment?.name   || null,
        attachment_mime_type: attachment?.mime   || null,
        lines:     draft.lines.map(mapLine),
        bdm_lines: (draft.bdm_lines || []).map(mapLine),
      };

      const res = await issueFormApi.create(payload);
      if (!res.ok || !res.data) {
        setFeedback({
          type: 'error',
          message: res?.data?.message || 'Failed to save the form.',
        });
        return;
      }

      const d = res.data;
      setResult({
        form_id:            d.form_id,
        form_type:          d.form_type || formType,
        form_series_no:     d.form_series_no,
        form_document_code: d.form_document_code || tpl.form_document_code,
        form_revision:      d.form_revision      || tpl.form_revision,
        issued_at:          d.issued_at || new Date().toISOString(),
        line_count:         d.line_count,
        total_amount:       d.total_amount,
      });
      toast.success(`Saved as ${d.form_series_no || 'issue form'}.`);
    } catch (err) {
      console.error('Issue form submit error:', err);
      setFeedback({
        type: 'error',
        message: err?.message || 'Unexpected error while saving the form.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  /* ============================================================
     Success screen
     ============================================================ */
  if (result) {
    return (
      <>
        <SuccessScreen
          result={result}
          tpl={tpl}
          onClose={() => { onSuccess?.(result); onClose?.(); }}
          onPrint={() => setPrintOpen(true)}
        />
        {printOpen && (
          <IssueFormPrint
            formData={{
              ...draft,
              ...result,
              attachment_base64:    attachment?.base64 || null,
              attachment_name:      attachment?.name   || null,
              attachment_mime_type: attachment?.mime   || null,
            }}
            onClose={() => setPrintOpen(false)}
          />
        )}
      </>
    );
  }

  const errorCount = Object.keys(errors).length;
  const bannerVisible = hasSubmittedOnce && errorCount > 0;

  /* ============================================================
     Config select
     ============================================================ */
  const renderConfigSelect = (key, label, category, maxLength) => {
    const options = (offlineConfigs || [])
      .filter((c) => c.category === category)
      .map((o) => ({
        value:       String(o.item_value),
        label:       String(o.item_value),
        description: o.description || '',
      }));

    const currentValue = draft[key] === '__OTHER__' ? '' : (draft[key] || '');
    const isErr = Boolean(errors[key]);
    const isPulsing = pulseField === key;

    return (
      <div key={key} className="ugmodal-field ugif-field">
        <label className={`ugmodal-label ${isErr ? 'is-error' : ''}`}>
          {label} <span className="ugif-req">*</span>
        </label>
        <SearchableCombobox
          value={currentValue}
          onChange={(opt) => setHeader(key, opt.value)}
          options={options}
          allowCustom
          placeholder={`Search or pick ${label}…`}
          disabled={submitting}
          maxLength={maxLength}
          hasError={isErr}
          dataErrorField={key}
          isPulsing={isPulsing}
        />
        {isErr && (
          <div className="ugif-field-error-msg">
            <FiAlertCircle /> <span>{errors[key]}</span>
          </div>
        )}
      </div>
    );
  };

  /* ============================================================
     Footer slot renderers
     ============================================================ */
  const renderFooterSlot = (slot) => {
    const isErr = (key) => Boolean(errors[key]);
    const fieldPulse = (key) => pulseField === key ? 'is-pulsing' : '';

    const labelNode = (key) => (
      <label className={`ugmodal-label ${isErr(key) ? 'is-error' : ''}`}>
        {slot.label}
        {slot.required && <span className="ugif-req"> *</span>}
      </label>
    );

    if (slot.kind === 'dropdown') {
      const options = sigConfig
        .filter((s) => s.role_slot === slot.role)
        .map((s) => ({
          value:       s.full_name,
          label:       s.full_name,
          description: s.position_title || '',
          meta:        s,
        }));
      const key = `${slot.key}_name`;
      const selected = draft[key] || '';
      return (
        <div key={slot.key} className="ugmodal-field ugif-field">
          {labelNode(key)}
          <SearchableCombobox
            value={selected}
            onChange={(opt) => {
              setDraft((d) => ({
                ...d,
                [`${slot.key}_name`]:     opt.value,
                [`${slot.key}_position`]: opt.meta?.position_title || '',
              }));
            }}
            options={options}
            allowCustom={false}
            placeholder={
              options.length === 0
                ? 'No authorized signatories configured'
                : 'Search or pick signatory…'
            }
            disabled={submitting || options.length === 0}
            hasError={isErr(key)}
            dataErrorField={key}
            isPulsing={pulseField === key}
            emptyLabel="No matching signatories"
            renderHint={(opt) => opt?.description || null}
          />
          {isErr(key) && (
            <div className="ugif-field-error-msg">
              <FiAlertCircle /> <span>{errors[key]}</span>
            </div>
          )}
        </div>
      );
    }

    if (slot.kind === 'readonly') {
      const key = `${slot.key}_name`;
      return (
        <div
          key={slot.key}
          className={`ugmodal-field ugif-field ugif-field--auto ${fieldPulse(key)}`}
        >
          <label className="ugmodal-label">
            {slot.label}
            <span className="ugif-auto-badge">Auto</span>
          </label>
          <div className={`ugif-auto-display ${isErr(key) ? 'is-error' : ''}`}>
            <div className="ugif-auto-name">
              {draft[`${slot.key}_name`] || '— no user context —'}
            </div>
            {draft[`${slot.key}_position`] && (
              <div className="ugif-auto-pos">{draft[`${slot.key}_position`]}</div>
            )}
          </div>
          {isErr(key) && (
            <div className="ugif-field-error-msg">
              <FiAlertCircle /> <span>{errors[key]}</span>
            </div>
          )}
        </div>
      );
    }

    if (slot.kind === 'locator-multi') {
      const key = 'bodega_name';
      const missingCount = missingBodegaLocators.length;
      return (
        <div
          key={slot.key}
          className={`ugmodal-field ugif-field ugif-field--bodega ${fieldPulse(key)}`}
        >
          {labelNode(key)}
          <BodegaMultiSelect
            errorField={key}
            hasError={isErr(key)}
            value={draft.bodega_name || ''}
            onChange={(arr) => setHeader('bodega_name', serializeBodega(arr))}
            eligibleLocators={eligibleBodegaLocators}
            allLocators={locators}
            filterActive={bodegaFilterActive}
            loading={locatorsLoading}
            disabled={submitting}
            isScoped={locatorsScoped}
          />
          {missingCount > 0 && (
            <div className="ugif-bodega-warn" role="status" aria-live="polite">
              <FiAlertTriangle className="ugif-bodega-warn-icon" />
              <div className="ugif-bodega-warn-text">
                <div className="ugif-bodega-warn-title">
                  {missingCount === 1
                    ? '1 locator on this form is not in Bodega'
                    : `${missingCount} locators on this form are not in Bodega`}
                </div>
                <div className="ugif-bodega-warn-sub">
                  Missing:{' '}
                  <span className="ugif-bodega-warn-codes">
                    {missingBodegaLocators.join(' · ')}
                  </span>
                  {' — '}you can still save. Add them above to keep the form
                  fully covered.
                </div>
              </div>
            </div>
          )}
          {isErr(key) && (
            <div className="ugif-field-error-msg">
              <FiAlertCircle /> <span>{errors[key]}</span>
            </div>
          )}
          {!isErr(key) && bodegaFilterActive && (
            <div className="ugmodal-hint">
              Only locators stocking items on this form are offered — auto-filled
              from your line items.
            </div>
          )}
        </div>
      );
    }

    const isChapa = slot.key === 'chapa';
    const key = isChapa ? 'chapa_no' : `${slot.key}_name`;
    const value = isChapa ? (draft.chapa_no || '') : (draft[key] || '');
    const setValue = (v) => setHeader(key, v);

    return (
      <div key={slot.key} className="ugmodal-field ugif-field">
        {labelNode(key)}
        <input
          type="text"
          data-error-field={key}
          className={`ugmodal-input ${isErr(key) ? 'is-error' : ''} ${fieldPulse(key)}`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={isChapa ? 40 : 150}
          disabled={submitting}
          placeholder={isChapa ? 'e.g. 12345' : 'Name of person receiving'}
          inputMode={isChapa ? 'numeric' : 'text'}
        />
        {isErr(key) && (
          <div className="ugif-field-error-msg">
            <FiAlertCircle /> <span>{errors[key]}</span>
          </div>
        )}
      </div>
    );
  };

  /* ============================================================
     Main render
     ============================================================ */
  const allLinesForExclude = [...draft.lines, ...(draft.bdm_lines || [])];
  const linesEmptyError = errors.lines_empty;

  return (
    <div className="ugmodal-overlay" onClick={submitting ? undefined : onClose}>
      <div
        className="ugmodal-card ugif-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <style>{modalCss}</style>

        <div className="ugif-letterhead-wrap">
          <LepantoLetterhead template={tpl} mode="screen" />
          <button
            type="button"
            className="ugmodal-close ugif-letterhead-close"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close"
          ><FiX /></button>
        </div>

        <div className="ugmodal-body">
          {bannerVisible && (
            <div
              key={`err-banner-${errorCount}-${Object.keys(errors).join('|')}`}
              className="ugif-error-banner"
              role="alert"
              aria-live="assertive"
            >
              <FiAlertTriangle className="ugif-error-banner-icon" />
              <div className="ugif-error-banner-text">
                <div className="ugif-error-banner-title">
                  {errorCount === 1
                    ? '1 field needs attention'
                    : `${errorCount} fields need attention`}
                </div>
                <div className="ugif-error-banner-sub">
                  {feedback?.message || 'Please review the highlighted fields below.'}
                </div>
              </div>
            </div>
          )}

          {feedback && feedback.type === 'error' && !bannerVisible && (
            <div className="ugmodal-feedback ugmodal-feedback--error">
              <FiAlertTriangle />
              <span>{feedback.message}</span>
            </div>
          )}

          <section className="ugif-section">
            <h4 className="ugif-section-title">Header</h4>
            <div className="ugif-header-grid">
              {tpl.header_fields.map((f) => {
                const configCategory = {
                  activity_cc: 'ACTIVITY_CC',
                  level_field: 'LEVEL',
                  lhd_no: 'LHD_NO',
                }[f.key];
                if (configCategory)
                  return renderConfigSelect(f.key, f.label, configCategory, f.maxLength);

                if (f.type === 'shift') {
                  const isErr = Boolean(errors[f.key]);
                  return (
                    <div
                      key={f.key}
                      className="ugmodal-field ugif-field ugif-field--shift"
                    >
                      <label className={`ugmodal-label ${isErr ? 'is-error' : ''}`}>
                        {f.label} <span className="ugif-req">*</span>
                      </label>
                      <div
                        data-error-field={f.key}
                        className={`ugif-shift-group ${isErr ? 'is-error' : ''} ${pulseField === f.key ? 'is-pulsing' : ''}`}
                        tabIndex={-1}
                      >
                        {SHIFT_OPTIONS.map((s) => (
                          <button
                            key={s.value}
                            type="button"
                            className={`ugif-shift-btn ${draft[f.key] === s.value ? 'is-active' : ''}`}
                            onClick={() => setHeader(f.key, s.value)}
                            disabled={submitting}
                          >{s.label}</button>
                        ))}
                      </div>
                      {isErr && (
                        <div className="ugif-field-error-msg">
                          <FiAlertCircle /> <span>{errors[f.key]}</span>
                        </div>
                      )}
                    </div>
                  );
                }
                const isErr = Boolean(errors[f.key]);
                return (
                  <div
                    key={f.key}
                    className={`ugmodal-field ugif-field ${f.key === 'working_place' ? 'ugif-field--wide' : ''}`}
                  >
                    <label className={`ugmodal-label ${isErr ? 'is-error' : ''}`}>
                      {f.label} <span className="ugif-req">*</span>
                    </label>
                    <input
                      type={f.type}
                      data-error-field={f.key}
                      className={`ugmodal-input ${isErr ? 'is-error' : ''} ${pulseField === f.key ? 'is-pulsing' : ''}`}
                      value={draft[f.key] || ''}
                      onChange={(e) => setHeader(f.key, e.target.value)}
                      maxLength={f.maxLength || 120}
                      disabled={submitting}
                    />
                    {isErr && (
                      <div className="ugif-field-error-msg">
                        <FiAlertCircle /> <span>{errors[f.key]}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="ugif-section">
            <h4 className="ugif-section-title">
              Line items
              <span className="ugif-count">
                {draft.lines.length} item{draft.lines.length === 1 ? '' : 's'}
              </span>
            </h4>

            <ItemSearchBox
              dataField="lines_empty"
              hasError={Boolean(linesEmptyError)}
              isPulsing={pulseField === 'lines_empty'}
              inventory={inventory}
              loading={inventoryLoading}
              exclude={allLinesForExclude}
              onPick={(row) => addLine(row, 'lines')}
              disabled={submitting}
            />

            {linesEmptyError && (
              <div className="ugif-field-error-msg">
                <FiAlertCircle /> <span>{linesEmptyError}</span>
              </div>
            )}

            <LineTable
              tpl={tpl}
              kind="regular"
              lines={draft.lines}
              disabled={submitting}
              onChange={updateLine}
              onRemove={(idx) => removeLine(idx, 'lines')}
              errors={errors}
              pulseField={pulseField}
              uomRules={uomRules}
            />
          </section>

          {tpl.has_bdm_block && (
            <section className="ugif-section ugif-section--bdm">
              <h4 className="ugif-section-title ugif-section-title--bdm">
                FOR BDM ONLY
                <span className="ugif-count ugif-count--muted">Optional</span>
              </h4>

              <div className="ugif-header-grid">
                <div className="ugmodal-field ugif-field">
                  <label className="ugmodal-label">RDM No.</label>
                  <input
                    type="text"
                    className="ugmodal-input"
                    value={draft.bdm_rdm_no || ''}
                    onChange={(e) => setHeader('bdm_rdm_no', e.target.value)}
                    maxLength={50}
                    disabled={submitting}
                    placeholder="Enter RDM No."
                  />
                </div>

                <div className="ugmodal-field ugif-field ugif-field--shift">
                  <label className="ugmodal-label">Shift</label>
                  <div className="ugif-shift-group">
                    {SHIFT_OPTIONS.map((s) => (
                      <button
                        key={s.value}
                        type="button"
                        className={`ugif-shift-btn ${draft.bdm_shift_label === s.value ? 'is-active' : ''}`}
                        onClick={() => setHeader('bdm_shift_label', s.value)}
                        disabled={submitting}
                      >{s.label}</button>
                    ))}
                  </div>
                </div>
              </div>

              <ItemSearchBox
                inventory={inventory}
                loading={inventoryLoading}
                exclude={allLinesForExclude}
                onPick={(row) => addLine(row, 'bdm_lines')}
                disabled={submitting}
                placeholder="Search underground inventory for BDM items…"
              />

              <LineTable
                tpl={tpl}
                kind="bdm"
                lines={draft.bdm_lines}
                disabled={submitting}
                onChange={(idx, patch) => updateLine(idx, patch, 'bdm_lines')}
                onRemove={(idx) => removeLine(idx, 'bdm_lines')}
                errors={errors}
                pulseField={pulseField}
                uomRules={uomRules}
              />
            </section>
          )}

          <section className="ugif-section">
            <h4 className="ugif-section-title">
              Signatures
              <span className="ugif-count ugif-count--muted">
                Issued by auto-fills from the logged-in user
              </span>
            </h4>

            {sigLoading ? (
              <div className="ugif-loading-inline">
                <FiLoader className="ug-spin" /> <span>Loading signatories…</span>
              </div>
            ) : (
              <div className="ugif-footer-grid">
                {FOOTER_ROWS.map(renderFooterSlot)}
              </div>
            )}
          </section>

          <section className="ugif-section">
            <div className="ugmodal-field">
              <label className="ugmodal-label">
                Remarks <span style={{ fontWeight: 400, color: '#94a3b8' }}>(optional)</span>
              </label>
              <textarea
                className="ugmodal-textarea"
                value={draft.remarks || ''}
                onChange={(e) => setHeader('remarks', e.target.value)}
                maxLength={500}
                placeholder="Any context worth recording for the audit trail…"
                disabled={submitting}
              />
              <div className="ugmodal-hint">{(draft.remarks || '').length} / 500</div>
            </div>
          </section>

          <section className="ugif-section">
            <h4 className="ugif-section-title">
              Proof picture
              <span className="ugif-count ugif-count--muted">
                Optional · Max 6 MB
              </span>
            </h4>

            <input
              ref={fileInputRef}
              type="file"
              accept={ATTACHMENT_ACCEPT_ATTR}
              className="ugif-attach-file"
              onChange={onFileInputChange}
              disabled={submitting}
              tabIndex={-1}
            />

            {!attachment ? (
              <button
                type="button"
                data-error-field="attachment"
                className={[
                  'ugif-attach-drop',
                  dragActive ? 'is-drag' : '',
                  attachError ? 'is-error' : '',
                  pulseField === 'attachment' ? 'is-pulsing' : '',
                ].filter(Boolean).join(' ')}
                onClick={onAttachClick}
                onDragOver={onDragOver}
                onDragEnter={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
                disabled={submitting}
                aria-label="Upload a proof picture"
              >
                <span className="ugif-attach-drop-icon" aria-hidden="true">
                  <FiUploadCloud />
                </span>
                <span className="ugif-attach-drop-text">
                  <span className="ugif-attach-drop-title">
                    {dragActive ? 'Drop the image here' : 'Click to browse or drag & drop'}
                  </span>
                  <span className="ugif-attach-drop-sub">
                    JPEG · PNG · WebP · GIF — up to 6 MB
                  </span>
                </span>
              </button>
            ) : (
              <div className="ugif-attach-preview">
                <img
                  className="ugif-attach-thumb"
                  src={attachment.preview}
                  alt={attachment.name}
                />
                <div className="ugif-attach-info">
                  <div className="ugif-attach-name" title={attachment.name}>
                    {attachment.name}
                  </div>
                  <div className="ugif-attach-meta">
                    <span className="ugif-attach-meta-chip">
                      {attachment.mime.replace('image/', '').toUpperCase()}
                    </span>
                    <span className="ugif-attach-size">
                      {fmtBytes(attachment.size)}
                    </span>
                  </div>
                </div>
                <div className="ugif-attach-actions">
                  <button
                    type="button"
                    className="ugif-attach-btn"
                    onClick={onAttachClick}
                    disabled={submitting}
                    title="Replace this image"
                  >
                    <FiImage /> <span>Replace</span>
                  </button>
                  <button
                    type="button"
                    className="ugif-attach-btn ugif-attach-btn--danger"
                    onClick={clearAttachment}
                    disabled={submitting}
                    title="Remove this image"
                  >
                    <FiTrash2 /> <span>Remove</span>
                  </button>
                </div>
              </div>
            )}

            {attachError && (
              <div className="ugif-attach-err" role="alert">
                <FiAlertCircle /> <span>{attachError}</span>
              </div>
            )}

            {!attachError && !attachment && (
              <div className="ugmodal-hint">
                Attach a photo of the released items as proof of issue. It will
                be saved with the form and travel with the closing file.
              </div>
            )}
          </section>
        </div>

        <div className="ugmodal-footer">
          <button
            type="button"
            className="ug-btn ug-btn--secondary"
            onClick={onClose}
            disabled={submitting}
          >Cancel</button>
          <button
            type="button"
            className={`ug-btn ${hasLineOverflow ? 'ug-btn--danger' : 'ug-btn--primary'}`}
            onClick={handleSubmit}
            disabled={submitting || hasLineOverflow}
            title={
              hasLineOverflow
                ? 'Fix the Issued quantities that exceed the maximum before saving'
                : 'Save this issue form'
            }
          >
            {submitting ? (
              <><FiLoader className="ug-spin" /><span>Saving…</span></>
            ) : hasLineOverflow ? (
              <><FiAlertTriangle /><span>Fix overflow</span></>
            ) : (
              <><FiSave /><span>Save &amp; Issue</span></>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default IssueFormModal;

/* ============================================================
   SearchableCombobox
   ============================================================ */
const SearchableCombobox = ({
  value, onChange, options, allowCustom = false,
  placeholder = 'Search or select…', disabled = false,
  hasError = false, dataErrorField, isPulsing = false,
  maxLength, emptyLabel = 'No matches', renderHint,
}) => {
  const panelId = useMemo(
    () => `ugif-combo-${Math.random().toString(36).slice(2, 10)}`,
    []
  );
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const committedRef = useRef(false);
  const navigatedRef = useRef(false);

  const [open, setOpen] = useState(false);
  const [inputText, setInputText] = useState(value || '');
  const [filterText, setFilterText] = useState('');
  const [highlight, setHighlight] = useState(0);

  useEffect(() => {
    if (!open) setInputText(value || '');
  }, [value, open]);

  const filtered = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => {
      const v = String(o.value ?? '').toLowerCase();
      const d = String(o.description ?? '').toLowerCase();
      return v.includes(q) || d.includes(q);
    });
  }, [options, filterText]);

  const currentOption = useMemo(
    () => options.find((o) => String(o.value) === String(value)),
    [options, value]
  );

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
        setFilterText('');
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const openPanel = () => {
    if (disabled) return;
    setOpen(true);
    setFilterText('');
    navigatedRef.current = false;
    const idx = options.findIndex((o) => String(o.value) === String(value));
    setHighlight(idx >= 0 ? idx : 0);
  };

  const closePanel = (revert = true) => {
    setOpen(false);
    setFilterText('');
    if (revert) setInputText(value || '');
  };

  const commitOption = (opt) => {
    committedRef.current = true;
    onChange({
      value:       opt.value,
      label:       opt.label || opt.value,
      description: opt.description || '',
      meta:        opt.meta || null,
    });
    setInputText(opt.value);
    setOpen(false);
    setFilterText('');
  };

  const commitCustom = () => {
    const trimmed = inputText.trim();
    if (!trimmed) return;
    committedRef.current = true;
    onChange({
      value: trimmed, label: trimmed, description: '', meta: null,
    });
    setOpen(false);
    setFilterText('');
  };

  const handleFocus = () => { if (!disabled) openPanel(); };
  const handleClick = () => { if (!disabled && !open) openPanel(); };

  const handleChange = (e) => {
    setInputText(e.target.value);
    setFilterText(e.target.value);
    setHighlight(0);
    navigatedRef.current = false;
    committedRef.current = false;
    if (!open) setOpen(true);
  };

  const handleKeyDown = (e) => {
    if (disabled) return;
    if (e.key === 'Escape') {
      e.preventDefault(); closePanel(true); inputRef.current?.blur(); return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) openPanel();
      else {
        navigatedRef.current = true;
        setHighlight((h) => Math.min(h + 1, Math.max(0, filtered.length - 1)));
      }
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (open) {
        navigatedRef.current = true;
        setHighlight((h) => Math.max(h - 1, 0));
      }
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const trimmed = inputText.trim();
      if (!trimmed) return;
      if (open && navigatedRef.current && filtered[highlight]) {
        commitOption(filtered[highlight]); return;
      }
      const exact = options.find(
        (o) => String(o.value).toLowerCase() === trimmed.toLowerCase()
      );
      if (exact) { commitOption(exact); return; }
      if (filtered.length === 1) { commitOption(filtered[0]); return; }
      if (allowCustom) { commitCustom(); return; }
    }
  };

  const handleBlur = () => {
    setTimeout(() => {
      if (committedRef.current) { committedRef.current = false; return; }
      if (wrapRef.current?.contains(document.activeElement)) return;
      const trimmed = inputText.trim();
      const current = String(value || '');
      if (trimmed === current) { setOpen(false); setFilterText(''); return; }
      const exact = options.find(
        (o) => String(o.value).toLowerCase() === trimmed.toLowerCase()
      );
      if (exact) { commitOption(exact); return; }
      setInputText(current);
      setOpen(false);
      setFilterText('');
    }, 150);
  };

  const handleCaretMouseDown = (e) => {
    e.preventDefault();
    if (disabled) return;
    if (open) closePanel(true);
    else { inputRef.current?.focus(); openPanel(); }
  };

  const hint = typeof renderHint === 'function'
    ? renderHint(currentOption)
    : (currentOption?.description || null);

  return (
    <div className="ugif-combo" ref={wrapRef}>
      <div
        className={[
          'ugif-combo-field',
          open ? 'is-open' : '',
          hasError ? 'is-error' : '',
          isPulsing ? 'is-pulsing' : '',
        ].filter(Boolean).join(' ')}
      >
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={panelId}
          aria-autocomplete="list"
          data-error-field={dataErrorField}
          className="ugif-combo-input"
          value={inputText}
          onChange={handleChange}
          onFocus={handleFocus}
          onClick={handleClick}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          placeholder={placeholder}
          disabled={disabled}
          maxLength={maxLength}
          autoComplete="off"
          spellCheck={false}
        />
        <FiChevronDown
          className={`ugif-combo-caret ${open ? 'is-open' : ''}`}
          onMouseDown={handleCaretMouseDown}
          aria-hidden="true"
        />
      </div>

      {open && (
        <div className="ugif-combo-panel" id={panelId} role="listbox">
          {filtered.length === 0 ? (
            <div className="ugif-combo-empty">
              {allowCustom && inputText.trim() ? (
                <>
                  Press <strong>Enter</strong> to use{' '}
                  <strong>&ldquo;{inputText.trim()}&rdquo;</strong> as a custom value
                </>
              ) : emptyLabel}
            </div>
          ) : (
            filtered.map((opt, idx) => (
              <button
                key={`${opt.value}-${idx}`}
                type="button"
                role="option"
                aria-selected={idx === highlight}
                className={`ugif-combo-option ${idx === highlight ? 'is-active' : ''}`}
                onMouseDown={(e) => { e.preventDefault(); commitOption(opt); }}
                onMouseEnter={() => setHighlight(idx)}
              >
                <span className="ugif-combo-opt-value">{opt.label || opt.value}</span>
                {opt.description && (
                  <span className="ugif-combo-opt-desc">{opt.description}</span>
                )}
              </button>
            ))
          )}
        </div>
      )}

      {hint && !open && <div className="ugmodal-hint">{hint}</div>}
    </div>
  );
};

/* ============================================================
   BodegaMultiSelect
   ============================================================ */
const BodegaMultiSelect = ({
  value, onChange, eligibleLocators, allLocators, filterActive,
  loading, disabled, errorField, hasError, isScoped,
}) => {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  const selected = useMemo(() => parseBodega(value), [value]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const pool = filterActive ? eligibleLocators : allLocators;
  const available = useMemo(
    () => pool.filter((l) => !selectedSet.has(l.locator_code)),
    [pool, selectedSet]
  );

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const add = (code) => {
    if (!code || selectedSet.has(code)) return;
    onChange([...selected, code]);
    setOpen(false);
  };
  const remove = (code) => onChange(selected.filter((c) => c !== code));
  const findLocator = (code) => pool.find((l) => l.locator_code === code);

  const emptyPoolLabel = loading
    ? 'Loading locators…'
    : available.length === 0
      ? (selected.length > 0
          ? 'All eligible locators added'
          : (filterActive
              ? 'No locators stock the picked items'
              : 'No locators in this warehouse'))
      : null;

  return (
    <div className="ugif-bodega" ref={wrapRef}>
      <div
        data-error-field={errorField}
        tabIndex={-1}
        className={`ugif-bodega-chips ${hasError ? 'is-error' : ''}`}
      >
        {selected.length === 0 && (
          <div className="ugif-bodega-empty">
            {loading ? 'Loading…' : 'No locators selected yet — auto-fills as you add items.'}
          </div>
        )}
        {selected.map((code) => {
          const loc = findLocator(code);
          const title = loc
            ? `${code}${loc.locator_name || loc.description ? ` — ${loc.locator_name || loc.description}` : ''}`
            : code;
          return (
            <span key={code} className="ugif-bodega-chip" title={title}>
              <FiMapPin className="ugif-bodega-chip-icon" />
              <span className="ugif-bodega-chip-code">{code}</span>
              <button
                type="button"
                className="ugif-bodega-chip-remove"
                onClick={() => remove(code)}
                disabled={disabled}
                aria-label={`Remove ${code}`}
              ><FiX /></button>
            </span>
          );
        })}
      </div>

      {isScoped && (
        <div className="ugif-bodega-hint">
          <FiShield size={12} />
          <span>Showing only your assigned bodegas.</span>
        </div>
      )}

      <div className="ugif-bodega-add">
        <button
          type="button"
          className={`ugif-bodega-add-btn ${open ? 'is-open' : ''}`}
          onClick={() => setOpen((v) => !v)}
          disabled={disabled || loading}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <FiPlus />
          <span>Add locator</span>
          <FiChevronDown className={`ugif-bodega-caret ${open ? 'is-open' : ''}`} />
        </button>

        {open && (
          <div className="ugif-bodega-panel" role="listbox">
            {emptyPoolLabel ? (
              <div className="ugif-bodega-panel-msg">{emptyPoolLabel}</div>
            ) : (
              available.map((l) => (
                <button
                  key={l.locator_code}
                  type="button"
                  role="option"
                  aria-selected="false"
                  className="ugif-bodega-option"
                  onMouseDown={(e) => { e.preventDefault(); add(l.locator_code); }}
                >
                  <div className="ugif-bodega-option-code">{l.locator_code}</div>
                  {(l.locator_name || l.description) && (
                    <div className="ugif-bodega-option-name">
                      {l.locator_name || l.description}
                    </div>
                  )}
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};

/* ============================================================
   ItemSearchBox
   ============================================================ */
const ItemSearchBox = ({
  inventory, loading, exclude, onPick, disabled,
  placeholder = 'Scan barcode or search by code, name, or locator…',
  dataField, hasError, isPulsing,
}) => {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [scanFeedback, setScanFeedback] = useState(null);
  const [showHint, setShowHint] = useState(false);
  const inputRef = useRef(null);
  const wrapRef = useRef(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const excluded = new Set(
      (exclude || []).map((l) => `${l.locator_code}||${l.item_code}`)
    );
    return inventory
      .filter((r) => {
        if (excluded.has(`${r.locator_code}||${r.item_code}`)) return false;
        if ((Number(r.qty_on_hand) || 0) <= 0) return false;
        return (
          (r.item_code || '').toLowerCase().includes(q) ||
          (r.item_name || '').toLowerCase().includes(q) ||
          (r.locator_code || '').toLowerCase().includes(q) ||
          (r.barcode || '').toLowerCase().includes(q)
        );
      })
      .slice(0, 25);
  }, [inventory, query, exclude]);

  useEffect(() => {
    const onDoc = (e) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const findExact = useCallback((raw) => {
    const value = String(raw || '').trim();
    if (!value) return null;
    const upper = value.toUpperCase();
    const stripped = upper.startsWith('BC-') ? value.slice(3) : value;
    const strippedUpper = stripped.toUpperCase();
    const excluded = new Set(
      (exclude || []).map((l) => `${l.locator_code}||${l.item_code}`)
    );
    const isEligible = (r) => {
      if (excluded.has(`${r.locator_code}||${r.item_code}`)) return false;
      if ((Number(r.qty_on_hand) || 0) <= 0) return false;
      return true;
    };

    let hit = inventory.find(
      (r) => isEligible(r) && String(r.barcode || '').toUpperCase() === upper
    );
    if (hit) return hit;

    hit = inventory.find(
      (r) => isEligible(r) && String(r.item_code || '').toUpperCase() === upper
    );
    if (hit) return hit;

    if (strippedUpper !== upper) {
      hit = inventory.find(
        (r) => isEligible(r) && String(r.item_code || '').toUpperCase() === strippedUpper
      );
      if (hit) return hit;
    }
    return null;
  }, [inventory, exclude]);

  const commitPick = useCallback((row) => {
    if (!row) return;
    onPick(row);
    setQuery('');
    setOpen(false);
    setHighlight(0);
  }, [onPick]);

  const handleScan = useCallback(() => {
    if (disabled || loading) return;
    const raw = query.trim();
    if (!raw) {
      setScanFeedback('empty');
      setTimeout(() => {
        setScanFeedback(null);
        inputRef.current?.focus();
      }, 1400);
      return;
    }
    setScanFeedback('scanning');
    setTimeout(() => {
      const exact = findExact(raw);
      if (exact) {
        commitPick(exact);
        setScanFeedback('ok');
        setTimeout(() => { setScanFeedback(null); inputRef.current?.focus(); }, 1200);
        return;
      }
      if (matches.length === 1) {
        commitPick(matches[0]);
        setScanFeedback('ok');
        setTimeout(() => { setScanFeedback(null); inputRef.current?.focus(); }, 1200);
        return;
      }
      if (open && matches.length > 0 && matches[highlight]) {
        commitPick(matches[highlight]);
        setScanFeedback('ok');
        setTimeout(() => { setScanFeedback(null); inputRef.current?.focus(); }, 1200);
        return;
      }
      setScanFeedback('not-found');
      setTimeout(() => { setScanFeedback(null); inputRef.current?.focus(); }, 1700);
    }, 70);
  }, [query, disabled, loading, findExact, matches, open, highlight, commitPick]);

  const onKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); handleScan(); return; }
    if (e.key === 'Escape') { setOpen(false); return; }
    if (!open || matches.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    }
  };

  const onInputChange = (e) => {
    setQuery(e.target.value);
    setOpen(true);
    setHighlight(0);
    if (scanFeedback) setScanFeedback(null);
  };

  const onInputFocus = () => { if (query.trim()) setOpen(true); };
  const pick = (row) => commitPick(row);

  const feedbackNode = (() => {
    if (!scanFeedback) return null;
    if (scanFeedback === 'scanning') {
      return (
        <div className="ugif-scan-feedback ugif-scan-feedback--scanning" role="status">
          <FiLoader className="ugif-scan-feedback-icon ug-spin" />
          <span>Looking up…</span>
        </div>
      );
    }
    if (scanFeedback === 'ok') {
      return (
        <div className="ugif-scan-feedback ugif-scan-feedback--ok" role="status">
          <FiCheckCircle className="ugif-scan-feedback-icon" />
          <span>Found — added to lines</span>
        </div>
      );
    }
    if (scanFeedback === 'empty') {
      return (
        <div className="ugif-scan-feedback ugif-scan-feedback--error" role="alert">
          <FiAlertCircle className="ugif-scan-feedback-icon" />
          <span>Type or scan a barcode first.</span>
        </div>
      );
    }
    return (
      <div className="ugif-scan-feedback ugif-scan-feedback--error" role="alert">
        <FiAlertCircle className="ugif-scan-feedback-icon" />
        <span>No item matched that barcode or code.</span>
      </div>
    );
  })();

  return (
    <div className="ugif-scan-area" ref={wrapRef}>
      <label className="ugif-scan-label" htmlFor="ugif-scan-input">
        <FiSearch className="ugif-scan-label-icon" aria-hidden="true" />
        <span>Scan or type barcode</span>
      </label>

      <div className="ugif-scan-row">
        <div className="ugif-scan-input-wrap">
          <FiSearch className="ugif-scan-input-icon" aria-hidden="true" />
          <input
            id="ugif-scan-input"
            ref={inputRef}
            type="text"
            data-error-field={dataField}
            className={[
              'ugif-scan-input',
              hasError ? 'is-error' : '',
              isPulsing ? 'is-pulsing' : '',
            ].filter(Boolean).join(' ')}
            placeholder={loading ? 'Loading inventory…' : placeholder}
            value={query}
            onChange={onInputChange}
            onFocus={onInputFocus}
            onKeyDown={onKey}
            disabled={disabled || loading}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <button
          type="button"
          className="ugif-scan-btn"
          onClick={handleScan}
          disabled={disabled || loading}
          title="Look up the entered barcode or item code"
        >
          <FiSearch className="ugif-scan-btn-icon" aria-hidden="true" />
          <span>Scan</span>
        </button>
      </div>

      {feedbackNode}

      {open && query.trim() && matches.length > 0 && (
        <div className="ugif-search-panel" role="listbox">
          {matches.map((r, idx) => (
            <button
              key={`${r.locator_code}-${r.item_code}`}
              type="button"
              role="option"
              aria-selected={idx === highlight ? 'true' : 'false'}
              className={`ugif-search-item ${idx === highlight ? 'is-active' : ''}`}
              onMouseEnter={() => setHighlight(idx)}
              onMouseDown={(e) => { e.preventDefault(); pick(r); }}
            >
              <div className="ugif-search-item-code">{r.item_code}</div>
              <div className="ugif-search-item-name">{r.item_name || '—'}</div>
              <div className="ugif-search-item-meta">
                <span className="ugif-chip ugif-chip--loc">{r.locator_code}</span>
                {r.uom && <span className="ugif-chip">{r.uom}</span>}
                <span className="ugif-chip ugif-chip--qty">
                  {fmtInt(r.qty_on_hand)} on hand
                </span>
                {r.barcode && (
                  <span className="ugif-chip ugif-chip--bc">{r.barcode}</span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {open && query.trim() && matches.length === 0 && (
        <div className="ugif-search-panel">
          <div className="ugif-search-msg">
            No matching items with stock available.
          </div>
        </div>
      )}

      <button
        type="button"
        className={`ugif-scan-hint-toggle${showHint ? ' is-open' : ''}`}
        onClick={() => setShowHint((s) => !s)}
        aria-expanded={showHint}
        aria-controls="ugif-scan-hint-panel"
      >
        <FiInfo className="ugif-scan-hint-toggle-icon" aria-hidden="true" />
        <span>Know more</span>
        {showHint
          ? <FiChevronUp className="ugif-scan-hint-toggle-caret" aria-hidden="true" />
          : <FiChevronDown className="ugif-scan-hint-toggle-caret" aria-hidden="true" />}
      </button>

      {showHint && (
        <div id="ugif-scan-hint-panel" className="ugif-scan-hint-panel">
          <small className="ugif-scan-hint-text">
            Hardware scanners work by typing <strong>BC-"itemcode"</strong> then
            pressing Enter — the lookup fires automatically. Live search also
            works as you type: start typing an item code, description, barcode,
            or locator, then pick a result from the dropdown.
          </small>
        </div>
      )}
    </div>
  );
};

/* ============================================================
   LineTable — single piece input, box hint is display-only
   ============================================================ */
const LineTable = ({
  tpl,
  kind = 'regular',
  lines,
  disabled,
  onChange,
  onRemove,
  errors = {},
  pulseField,
  uomRules = {},
}) => {
  if (!lines || lines.length === 0) {
    return (
      <div className="ugif-empty-lines">
        No lines yet — scan or search above to add the first item.
      </div>
    );
  }
  return (
    <div className="ugif-lines">
      <div className="ugif-lines-head">
        <div className="ugif-col ugif-col--info">{tpl.line_code_label}</div>
        <div className="ugif-col ugif-col--unit">Unit</div>
        <div className="ugif-col ugif-col--qty">Req'd</div>
        <div className="ugif-col ugif-col--qty">Issued (Pcs)</div>
        <div className="ugif-col ugif-col--last">
          {tpl.last_col_label}
        </div>
        <div className="ugif-col ugif-col--x"></div>
      </div>

      {lines.map((l, i) => {
        const qtyIssued = Number(l.qty_issued) || 0;
        const maxQty = Number(l.qty_on_hand) || 0;
        const overflow = qtyIssued > maxQty;

        const amount = (qtyIssued * (Number(l.unit_cost) || 0)).toFixed(4);

        const errKey = `line:${kind}:${i}`;
        const fieldErr = errors[errKey];
        const isPulsing = pulseField === errKey;

        const piecesPerBox = uomRules[l.item_code] || null;
        const boxHint = (() => {
          if (!piecesPerBox || qtyIssued <= 0) return null;
          const boxes = Math.floor(qtyIssued / piecesPerBox);
          const loose = qtyIssued % piecesPerBox;
          const parts = [];
          if (boxes > 0) parts.push(`${fmtInt(boxes)} Box${boxes === 1 ? '' : 'es'}`);
          if (loose > 0) parts.push(`${fmtInt(loose)} Pc${loose === 1 ? '' : 's'}`);
          return parts.length ? parts.join(' + ') : null;
        })();

        const handleIssuedBlur = (e) => {
          const raw = e.target.value;
          if (raw === '') return;
          const n = Number(raw);
          if (!Number.isFinite(n)) return;
          if (n < 0) {
            onChange(i, { qty_issued: '0' });
          } else if (n > maxQty) {
            onChange(i, { qty_issued: String(maxQty) });
          }
        };

        return (
          <div
            key={`${l.locator_code}-${l.item_code}`}
            className={`ugif-lines-row ${fieldErr ? 'is-error' : ''}`}
          >
            <div className="ugif-col ugif-col--info">
              <div className="ugif-line-code">{l.item_code}</div>
              <div className="ugif-line-name" title={l.item_name}>{l.item_name || '—'}</div>
              <div className="ugif-line-locator">
                {l.locator_code} · {fmtInt(maxQty)} on hand
              </div>
            </div>

            <div className="ugif-col ugif-col--unit">
              <span className="ugif-unit-tag">{l.uom || '—'}</span>
            </div>

            <div className="ugif-col ugif-col--qty">
              <input
                type="number"
                inputMode="decimal"
                className="ugif-num-input"
                value={l.qty_required}
                onChange={(e) => onChange(i, { qty_required: e.target.value })}
                min={0}
                step="any"
                placeholder="—"
                disabled={disabled}
              />
            </div>

            <div className="ugif-col ugif-col--qty">
              <input
                type="number"
                inputMode="decimal"
                data-error-field={errKey}
                className={`ugif-num-input ugif-num-input--strong ${overflow || fieldErr ? 'is-overflow' : ''} ${isPulsing ? 'is-pulsing' : ''}`}
                value={l.qty_issued}
                onChange={(e) => onChange(i, { qty_issued: e.target.value })}
                onBlur={handleIssuedBlur}
                min={0}
                max={maxQty}
                step="any"
                placeholder={`max ${fmtInt(maxQty)}`}
                disabled={disabled}
                aria-invalid={overflow || fieldErr ? 'true' : 'false'}
              />
              {boxHint && (
                <div className="ugif-box-input-hint">
                  ≈ {boxHint}
                </div>
              )}
              {(overflow || fieldErr) && (
                <div className="ugif-line-warn">
                  {fieldErr
                    ? fieldErr
                    : `Max ${fmtInt(maxQty)} · you entered ${fmtInt(qtyIssued)}`}
                </div>
              )}
            </div>

            <div className="ugif-col ugif-col--last">
              {tpl.last_col === 'amount' ? (
                <span className="ugif-amount">
                  {qtyIssued > 0 ? fmtCur(amount) : '—'}
                </span>
              ) : (
                <input
                  type="text"
                  className="ugif-text-input"
                  value={l.remarks}
                  onChange={(e) => onChange(i, { remarks: e.target.value })}
                  maxLength={120}
                  disabled={disabled}
                  placeholder="—"
                />
              )}
            </div>

            <div className="ugif-col ugif-col--x">
              <button
                type="button"
                className="ugif-line-remove"
                onClick={() => onRemove(i)}
                disabled={disabled}
                aria-label={`Remove ${l.item_code}`}
              ><FiTrash2 /></button>
            </div>
          </div>
        );
      })}
    </div>
  );
};

/* ============================================================
   Success screen
   ============================================================ */
const SuccessScreen = ({ result, tpl, onClose, onPrint }) => {
  return (
    <div className="ugmodal-overlay" onClick={onClose}>
      <div className="ugmodal-card" onClick={(e) => e.stopPropagation()}>
        <style>{modalCss}</style>

        <div className="ugmodal-header">
          <div className="ugmodal-header-left">
            <div
              className="ugmodal-header-icon"
              style={{ background: 'linear-gradient(135deg, #34d399 0%, #047857 100%)' }}
            >
              <FiCheckCircle />
            </div>
            <div style={{ minWidth: 0 }}>
              <h3 className="ugmodal-title">Issue Form Saved</h3>
              <div className="ugmodal-sub">
                Added to shift totals. Print for wet signatures.
              </div>
            </div>
          </div>
          <button
            type="button"
            className="ugmodal-close"
            onClick={onClose}
            aria-label="Close"
          ><FiX /></button>
        </div>

        <div className="ugmodal-body">
          <div className="ugmodal-summary">
            <dt>Form</dt>
            <dd style={{ fontFamily: "'JetBrains Mono', monospace" }}>
              {result.form_series_no || '—'}
            </dd>
            <dt>Document</dt>
            <dd style={{ fontFamily: "'JetBrains Mono', monospace" }}>
              {result.form_document_code} rev {result.form_revision}
            </dd>
            <dt>Type</dt>
            <dd>{tpl?.title || result.form_type}</dd>
            <dt>Lines</dt>
            <dd>{fmtInt(result.line_count || 0)}</dd>
            {result.total_amount != null && Number(result.total_amount) > 0 && (
              <>
                <dt>Total Amount</dt>
                <dd className="ugmodal-summary--cur">{fmtCur(result.total_amount)}</dd>
              </>
            )}
          </div>

          <div className="ugmodal-warn">
            <FiAlertTriangle />
            <div>
              This form has been added to the shift's release list.
              Print it, sign it, and file it with the shift paperwork.
            </div>
          </div>
        </div>

        <div className="ugmodal-footer">
          <button type="button" className="ug-btn ug-btn--secondary" onClick={onPrint}>
            <FiPrinter /> <span>Print</span>
          </button>
          <button type="button" className="ug-btn ug-btn--primary" onClick={onClose}>
            <span>Done</span>
          </button>
        </div>
      </div>
    </div>
  );
};

/* ============================================================
   FULLY RESPONSIVE CSS — 320px → 4K
   ============================================================ */
const modalCss = `
/* ---------- Modal size ---------- */
.ugif-modal { max-width: min(1120px, 98vw); }

/* ============================================================
   SHAKE + PULSE KEYFRAMES
   ============================================================ */
@keyframes ugifShake {
  0%   { transform: translateX(0); }
  15%  { transform: translateX(-5px); }
  30%  { transform: translateX(4px); }
  45%  { transform: translateX(-3px); }
  60%  { transform: translateX(2px); }
  80%  { transform: translateX(-1px); }
  100% { transform: translateX(0); }
}
@keyframes ugifPulse {
  0%   { box-shadow: 0 0 0 0 rgba(220, 38, 38, 0.55); }
  60%  { box-shadow: 0 0 0 14px rgba(220, 38, 38, 0); }
  100% { box-shadow: 0 0 0 0 rgba(220, 38, 38, 0); }
}
@keyframes ugifBannerSlide {
  from { opacity: 0; transform: translateY(-8px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes ugifHintIn {
  from { opacity: 0; transform: translateY(-4px); }
  to   { opacity: 1; transform: translateY(0); }
}

.is-pulsing { animation: ugifPulse 1.4s ease-out 1 !important; }

/* ============================================================
   STICKY ERROR BANNER
   ============================================================ */
.ugif-error-banner {
  position: sticky; top: 0; z-index: 40;
  display: flex; align-items: flex-start; gap: 12px;
  padding: 14px 16px;
  background: linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%);
  border: 1.5px solid #fca5a5; border-left: 5px solid #dc2626;
  border-radius: 12px; color: #991b1b;
  box-shadow: 0 8px 22px rgba(220, 38, 38, 0.18);
  animation: ugifBannerSlide 220ms ease-out;
}
.ugif-error-banner-icon {
  width: 22px; height: 22px; flex-shrink: 0; margin-top: 1px;
  color: #dc2626; animation: ugifShake 0.55s ease-out;
}
.ugif-error-banner-text { flex: 1; min-width: 0; }
.ugif-error-banner-title {
  font-size: 13.5px; font-weight: 800; letter-spacing: 0.01em;
  color: #7f1d1d; line-height: 1.25;
}
.ugif-error-banner-sub {
  margin-top: 3px; font-size: 12.5px; color: #991b1b; line-height: 1.4;
}

/* ============================================================
   FIELD STYLING — smoky gray fill
   ============================================================ */
.ugif-modal .ugmodal-input,
.ugif-modal .ugmodal-select,
.ugif-modal .ugmodal-textarea {
  background: #f1f5f9; border-color: #cbd5e1;
  transition: background 150ms ease, border-color 150ms ease, box-shadow 150ms ease;
}
.ugif-modal .ugmodal-input:hover:not(:disabled),
.ugif-modal .ugmodal-select:hover:not(:disabled),
.ugif-modal .ugmodal-textarea:hover:not(:disabled) {
  background: #e2e8f0; border-color: #94a3b8;
}
.ugif-modal .ugmodal-input:focus,
.ugif-modal .ugmodal-select:focus,
.ugif-modal .ugmodal-textarea:focus {
  background: #ffffff; border-color: #00b8b0;
  box-shadow: 0 0 0 3px rgba(0, 210, 200, 0.20);
}
.ugif-modal .ugmodal-input:disabled,
.ugif-modal .ugmodal-select:disabled,
.ugif-modal .ugmodal-textarea:disabled {
  background: #f8fafc; color: #94a3b8;
}
.ugif-modal .ugmodal-input.is-error,
.ugif-modal .ugmodal-select.is-error,
.ugif-modal .ugmodal-textarea.is-error {
  background: #fef2f2; border-color: #dc2626; color: #7f1d1d;
  box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.14);
}
.ugif-modal .ugmodal-input.is-error:hover:not(:disabled),
.ugif-modal .ugmodal-select.is-error:hover:not(:disabled),
.ugif-modal .ugmodal-textarea.is-error:hover:not(:disabled) {
  background: #fee2e2; border-color: #dc2626;
}
.ugif-modal .ugmodal-input.is-error:focus,
.ugif-modal .ugmodal-select.is-error:focus,
.ugif-modal .ugmodal-textarea.is-error:focus {
  background: #ffffff; border-color: #dc2626;
  box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.24);
}

.ugmodal-label.is-error { color: #b91c1c; }
.ugmodal-label.is-error .ugif-req { color: #b91c1c; }

.ugif-field-error-msg {
  display: flex; align-items: flex-start; gap: 6px;
  margin-top: 4px; padding: 0 2px;
  font-size: 12px; font-weight: 700; color: #b91c1c; line-height: 1.35;
}
.ugif-field-error-msg svg {
  width: 13px; height: 13px; flex-shrink: 0; margin-top: 2px;
  color: #dc2626; stroke-width: 2.4;
}

/* ---------- Letterhead wrap ---------- */
.ugif-letterhead-wrap {
  position: relative; padding: 16px 56px 12px 20px;
  background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
  border-bottom: 1px solid #e2e8f0; flex-shrink: 0;
}
.ugif-letterhead-close { position: absolute; top: 12px; right: 12px; }

/* ---------- Section ---------- */
.ugif-section {
  display: flex; flex-direction: column; gap: 10px;
  padding: 14px 16px; background: #ffffff;
  border: 1px solid #e2e8f0; border-radius: 12px;
}
.ugif-section--bdm {
  background: linear-gradient(180deg, #fffdf5 0%, #fffefb 100%);
  border-color: #fcd34d;
}
.ugif-section-title {
  display: flex; align-items: center; gap: 10px;
  margin: 0 0 4px;
  font-size: 12px; font-weight: 800;
  letter-spacing: 0.08em; text-transform: uppercase;
  color: #0f766e; padding-bottom: 8px;
  border-bottom: 1px dashed #e2e8f0;
}
.ugif-section-title::before {
  content: ''; display: inline-block; width: 4px; height: 14px;
  background: linear-gradient(180deg, #00e0d4 0%, #008a82 100%);
  border-radius: 2px;
}
.ugif-section-title--bdm { color: #92400e; }
.ugif-section-title--bdm::before {
  background: linear-gradient(180deg, #fbbf24 0%, #b45309 100%);
}
.ugif-count {
  margin-left: auto; font-size: 11px; font-weight: 700;
  color: #0f766e; background: #f0fdfa;
  border: 1px solid #99f6e4; border-radius: 999px;
  padding: 2px 10px; letter-spacing: 0.02em; text-transform: none;
}
.ugif-count--muted {
  color: #64748b; background: #f8fafc; border-color: #e2e8f0;
}
.ugif-req { color: #dc2626; }

/* ---------- Header field grid ---------- */
.ugif-header-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px 12px;
}
.ugif-field--wide { grid-column: span 2; }
.ugif-field--shift { grid-column: span 1; }
.ugif-field--bodega { grid-column: span 2; }

/* ---------- Shift segmented control ---------- */
.ugif-shift-group {
  display: inline-flex; padding: 3px;
  background: #f1f5f9; border: 1px solid #cbd5e1;
  border-radius: 8px; gap: 2px; outline: none;
  transition: background 140ms ease, border-color 140ms ease, box-shadow 140ms ease;
}
.ugif-shift-group.is-error {
  background: #fef2f2; border-color: #dc2626;
  box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.14);
}
.ugif-shift-btn {
  min-width: 44px; min-height: 32px;
  padding: 4px 10px; border: none; border-radius: 6px;
  background: transparent;
  font-family: inherit; font-size: 12.5px; font-weight: 700;
  color: #64748b; cursor: pointer;
  transition: background 140ms ease, color 140ms ease, box-shadow 140ms ease;
}
.ugif-shift-btn:hover:not(:disabled):not(.is-active) {
  color: #0f172a; background: rgba(255, 255, 255, 0.6);
}
.ugif-shift-btn.is-active {
  background: #ffffff; color: #007a72;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08),
              0 0 0 1px rgba(0, 184, 176, 0.35);
}
.ugif-shift-group.is-error .ugif-shift-btn.is-active {
  color: #991b1b;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08), 0 0 0 1px #dc2626;
}
.ugif-shift-btn:disabled { opacity: 0.5; cursor: not-allowed; }

/* ============================================================
   SEARCHABLE COMBOBOX
   ============================================================ */
.ugif-combo {
  position: relative; display: flex; flex-direction: column;
  gap: 4px; width: 100%;
}
.ugif-combo-field {
  position: relative; display: flex; align-items: center; width: 100%;
}
.ugif-combo-input {
  width: 100%; min-height: 42px;
  padding: 8px 36px 8px 12px;
  font-family: inherit; font-size: 13.5px; font-weight: 500;
  color: #0f172a; background: #f1f5f9;
  border: 1.5px solid #cbd5e1; border-radius: 8px;
  outline: none; box-sizing: border-box;
  transition: background 150ms ease, border-color 150ms ease, box-shadow 150ms ease;
}
.ugif-combo-input::placeholder { color: #64748b; opacity: 1; font-weight: 500; }
.ugif-combo-input:hover:not(:disabled):not(:focus) {
  background: #e2e8f0; border-color: #94a3b8;
}
.ugif-combo-input:focus {
  background: #ffffff; border-color: #00b8b0;
  box-shadow: 0 0 0 3px rgba(0, 210, 200, 0.20);
}
.ugif-combo-input:disabled {
  background: #f8fafc; color: #94a3b8; cursor: not-allowed;
}
.ugif-combo-field.is-open .ugif-combo-input {
  background: #ffffff; border-color: #00b8b0;
  box-shadow: 0 0 0 3px rgba(0, 210, 200, 0.20);
}
.ugif-combo-field.is-error .ugif-combo-input {
  background: #fef2f2; border-color: #dc2626; color: #7f1d1d;
  box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.14);
}
.ugif-combo-field.is-error.is-open .ugif-combo-input,
.ugif-combo-field.is-error .ugif-combo-input:focus {
  border-color: #dc2626;
  box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.24);
}
.ugif-combo-caret {
  position: absolute; right: 10px; top: 50%;
  transform: translateY(-50%);
  width: 16px; height: 16px; color: #64748b;
  stroke-width: 2.6; pointer-events: auto; cursor: pointer;
  transition: transform 180ms ease, color 140ms ease;
}
.ugif-combo-caret.is-open {
  transform: translateY(-50%) rotate(180deg); color: #00b8b0;
}
.ugif-combo-panel {
  position: absolute; top: calc(100% + 4px);
  left: 0; right: 0; z-index: 50;
  max-height: 260px; overflow-y: auto;
  padding: 4px; background: #ffffff;
  border: 1px solid #cbd5e1; border-radius: 10px;
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.14);
}
.ugif-combo-empty {
  padding: 14px 12px; text-align: center;
  font-size: 12.5px; color: #64748b; line-height: 1.45;
}
.ugif-combo-empty strong { color: #0f766e; font-weight: 800; }
.ugif-combo-option {
  display: flex; flex-direction: column;
  align-items: flex-start; gap: 2px;
  width: 100%; padding: 8px 12px;
  border: none; border-left: 3px solid transparent;
  border-radius: 6px; background: transparent;
  text-align: left; font-family: inherit; cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease;
}
.ugif-combo-option:hover,
.ugif-combo-option.is-active {
  background: linear-gradient(90deg, #ecfeff 0%, #f0fdfa 100%);
  border-left-color: #00b8b0; outline: none;
}
.ugif-combo-opt-value {
  font-size: 13px; font-weight: 700;
  color: #0f172a; line-height: 1.3; word-break: break-word;
}
.ugif-combo-opt-desc {
  font-size: 11.5px; color: #64748b;
  line-height: 1.35; word-break: break-word;
}

/* ============================================================
   ITEM SCANNER
   ============================================================ */
.ugif-scan-area {
  position: relative; display: flex; flex-direction: column; gap: 8px;
}
.ugif-scan-label {
  display: inline-flex; align-items: center; gap: 10px;
  font-size: 16px; font-weight: 800; color: #0f172a;
  letter-spacing: -0.005em; line-height: 1.25; margin: 0;
}
.ugif-scan-label-icon {
  width: 18px; height: 18px; stroke-width: 2.6;
  color: #0f766e; flex-shrink: 0;
}
.ugif-scan-row { display: flex; gap: 10px; align-items: stretch; min-width: 0; }
.ugif-scan-input-wrap {
  position: relative; flex: 1 1 auto; min-width: 0;
  display: flex; align-items: center;
}
.ugif-scan-input-icon {
  position: absolute; left: 12px; top: 50%;
  transform: translateY(-50%);
  width: 16px; height: 16px; stroke-width: 2.4;
  color: #94a3b8; pointer-events: none;
}
.ugif-scan-input {
  flex: 1 1 auto; min-width: 0; width: 100%;
  min-height: 52px; padding: 12px 14px 12px 40px;
  font-family: inherit; font-size: 15.5px; font-weight: 500;
  color: #0f172a; background: #f1f5f9;
  border: 1.5px solid #cbd5e1; border-radius: 10px;
  outline: none; box-sizing: border-box;
  transition: background 150ms ease, border-color 150ms ease, box-shadow 150ms ease;
}
.ugif-scan-input::placeholder { color: #64748b; opacity: 1; font-weight: 500; }
.ugif-scan-input:hover:not(:disabled):not(:focus) {
  background: #e2e8f0; border-color: #94a3b8;
}
.ugif-scan-input:focus {
  background: #ffffff; border-color: #00b8b0;
  box-shadow: 0 0 0 4px rgba(0, 184, 176, 0.22);
}
.ugif-scan-input.is-error {
  background: #fef2f2; border-color: #dc2626; color: #7f1d1d;
  box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.14);
}
.ugif-scan-input.is-error:focus {
  background: #ffffff; border-color: #dc2626;
  box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.24);
}
.ugif-scan-input:disabled {
  background: #f8fafc; color: #94a3b8; cursor: not-allowed;
}
.ugif-scan-btn {
  flex: 0 0 auto; display: inline-flex;
  align-items: center; justify-content: center; gap: 8px;
  min-height: 52px; padding: 0 22px;
  border: none; border-radius: 10px;
  background: linear-gradient(135deg, #00d2c8 0%, #007a72 100%);
  color: #ffffff; font-family: inherit;
  font-size: 14.5px; font-weight: 800; letter-spacing: 0.005em;
  cursor: pointer; white-space: nowrap;
  box-shadow: 0 2px 6px rgba(0, 122, 114, 0.24);
  transition: transform 120ms ease, box-shadow 140ms ease, filter 140ms ease;
}
.ugif-scan-btn:hover:not(:disabled) {
  filter: brightness(1.05);
  box-shadow: 0 4px 12px rgba(0, 122, 114, 0.32);
}
.ugif-scan-btn:active:not(:disabled) {
  transform: translateY(1px);
  box-shadow: 0 1px 3px rgba(0, 122, 114, 0.3);
}
.ugif-scan-btn:disabled {
  opacity: 0.55; cursor: not-allowed; filter: grayscale(20%);
}
.ugif-scan-btn-icon { width: 15px; height: 15px; stroke-width: 2.6; }

.ugif-scan-feedback {
  display: inline-flex; align-items: center; gap: 8px;
  font-size: 13px; font-weight: 700; line-height: 1.3; padding: 2px 2px;
}
.ugif-scan-feedback-icon {
  width: 15px; height: 15px; flex-shrink: 0; stroke-width: 2.6;
}
.ugif-scan-feedback--ok       { color: #047857; }
.ugif-scan-feedback--error    { color: #b91c1c; }
.ugif-scan-feedback--scanning { color: #334155; }

.ugif-scan-hint-toggle {
  display: inline-flex; align-items: center; gap: 8px;
  align-self: flex-start; width: fit-content; max-width: 100%;
  margin-top: 4px; padding: 7px 14px;
  border-radius: 999px; border: 1.5px solid #99f6e4;
  background: #f0fdfa; color: #0f766e;
  font-family: inherit; font-size: 13.5px; font-weight: 800;
  letter-spacing: 0.005em; line-height: 1.3;
  cursor: pointer; white-space: nowrap;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}
.ugif-scan-hint-toggle:hover {
  background: #ccfbf1; border-color: #5eead4; color: #0d5f58;
}
.ugif-scan-hint-toggle.is-open {
  background: #ffffff; border-color: #cbd5e1; color: #334155;
}
.ugif-scan-hint-toggle.is-open:hover {
  background: #f8fafc; border-color: #94a3b8;
}
.ugif-scan-hint-toggle:focus-visible {
  outline: 2px solid #00b8b0; outline-offset: 2px;
}
.ugif-scan-hint-toggle-icon {
  width: 14px; height: 14px; stroke-width: 2.4; flex-shrink: 0;
}
.ugif-scan-hint-toggle-caret {
  width: 13px; height: 13px; stroke-width: 2.8;
  flex-shrink: 0; opacity: 0.85;
}
.ugif-scan-hint-panel { animation: ugifHintIn 0.22s ease; }
.ugif-scan-hint-text {
  display: block; margin-top: 4px; color: #1e293b;
  font-size: 13px; line-height: 1.55; font-weight: 500;
}
.ugif-scan-hint-text strong {
  font-weight: 800; color: #0f766e;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
}

/* ============================================================
   BODEGA multi-select
   ============================================================ */
.ugif-bodega {
  position: relative; display: flex; flex-direction: column; gap: 6px;
}
.ugif-bodega-chips {
  display: flex; flex-wrap: wrap; gap: 6px;
  padding: 8px; min-height: 44px;
  background: #f1f5f9; border: 1.5px solid #cbd5e1; border-radius: 8px;
  transition: border-color 150ms ease, background 150ms ease, box-shadow 150ms ease;
  outline: none;
}
.ugif-bodega-chips:hover { background: #e2e8f0; border-color: #94a3b8; }
.ugif-bodega-chips.is-error {
  background: #fef2f2; border-color: #dc2626;
  box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.14);
}
.ugif-bodega-empty {
  display: flex; align-items: center; padding: 4px 6px;
  font-size: 12.5px; color: #94a3b8; font-style: italic;
}
.ugif-bodega-hint {
  display: inline-flex; align-items: center; gap: 6px;
  margin-top: 2px; font-size: 11.5px; font-weight: 600; color: #0f766e;
}
.ugif-bodega-hint svg {
  width: 12px; height: 12px; stroke-width: 2.4; flex-shrink: 0;
}
.ugif-bodega-chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 4px 4px 10px; border-radius: 999px;
  background: linear-gradient(135deg, #ecfeff 0%, #f0fdfa 100%);
  border: 1px solid #99f6e4; color: #0f766e;
  font-size: 12.5px; font-weight: 700; line-height: 1.2;
  transition: box-shadow 140ms ease, transform 140ms ease;
}
.ugif-bodega-chip:hover { box-shadow: 0 2px 6px rgba(0, 184, 176, 0.18); }
.ugif-bodega-chip-icon {
  width: 12px; height: 12px; flex-shrink: 0; color: #00b8b0;
}
.ugif-bodega-chip-code {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  letter-spacing: 0.01em;
}
.ugif-bodega-chip-remove {
  display: inline-flex; align-items: center; justify-content: center;
  width: 18px; height: 18px; padding: 0;
  border: none; border-radius: 50%;
  background: rgba(0, 184, 176, 0.12); color: #0f766e;
  cursor: pointer;
  transition: background 140ms ease, color 140ms ease;
}
.ugif-bodega-chip-remove:hover:not(:disabled) {
  background: #dc2626; color: #ffffff;
}
.ugif-bodega-chip-remove:disabled { opacity: 0.4; cursor: not-allowed; }
.ugif-bodega-chip-remove svg { width: 11px; height: 11px; stroke-width: 3; }

.ugif-bodega-add { position: relative; }
.ugif-bodega-add-btn {
  display: inline-flex; align-items: center; gap: 6px;
  min-height: 34px; padding: 6px 12px;
  border: 1.5px dashed #94a3b8; border-radius: 8px;
  background: #ffffff; font-family: inherit;
  font-size: 12.5px; font-weight: 700; color: #475569;
  cursor: pointer;
  transition: border-color 140ms ease, background 140ms ease, color 140ms ease;
}
.ugif-bodega-add-btn:hover:not(:disabled),
.ugif-bodega-add-btn.is-open {
  border-color: #00b8b0; background: #f0fdfa; color: #007a72;
}
.ugif-bodega-add-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.ugif-bodega-add-btn svg { width: 13px; height: 13px; stroke-width: 2.6; }
.ugif-bodega-caret { margin-left: 2px; transition: transform 160ms ease; }
.ugif-bodega-caret.is-open { transform: rotate(180deg); }
.ugif-bodega-panel {
  position: absolute; top: calc(100% + 4px);
  left: 0; right: 0; z-index: 30;
  max-height: 240px; overflow-y: auto;
  padding: 4px; background: #ffffff;
  border: 1px solid #cbd5e1; border-radius: 10px;
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.14);
}
.ugif-bodega-panel-msg {
  padding: 14px; text-align: center;
  font-size: 12.5px; color: #64748b;
}
.ugif-bodega-option {
  display: flex; flex-direction: column;
  align-items: flex-start; gap: 2px;
  width: 100%; padding: 9px 12px;
  border: none; background: transparent;
  border-left: 3px solid transparent; border-radius: 6px;
  text-align: left; font-family: inherit; cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease;
}
.ugif-bodega-option:hover,
.ugif-bodega-option:focus-visible {
  outline: none;
  background: linear-gradient(90deg, #ecfeff 0%, #f0fdfa 100%);
  border-left-color: #00b8b0;
}
.ugif-bodega-option-code {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-size: 13px; font-weight: 800; color: #008a82;
}
.ugif-bodega-option-name { font-size: 12px; color: #475569; }

.ugif-bodega-warn {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 9px 11px;
  background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%);
  border: 1px solid #fcd34d; border-left: 4px solid #f59e0b;
  border-radius: 8px; color: #78350f;
}
.ugif-bodega-warn-icon {
  width: 15px; height: 15px; flex-shrink: 0; margin-top: 1px;
  color: #d97706; stroke-width: 2.4;
}
.ugif-bodega-warn-text { flex: 1; min-width: 0; }
.ugif-bodega-warn-title {
  font-size: 12.5px; font-weight: 800; color: #78350f; line-height: 1.25;
}
.ugif-bodega-warn-sub {
  margin-top: 2px; font-size: 11.5px; color: #92400e; line-height: 1.4;
}
.ugif-bodega-warn-codes {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-weight: 800; color: #7c2d12;
}

/* ============================================================
   ITEM SEARCH DROPDOWN
   ============================================================ */
.ugif-search-panel {
  position: absolute; top: 92px; left: 0; right: 0;
  max-height: 320px; overflow-y: auto;
  background: #ffffff; border: 1px solid #cbd5e1;
  border-radius: 10px;
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.14);
  z-index: 20; padding: 4px;
}
.ugif-search-msg {
  padding: 14px; text-align: center; font-size: 13px; color: #64748b;
}
.ugif-search-item {
  display: flex; flex-direction: column;
  align-items: flex-start; gap: 3px;
  width: 100%; padding: 10px 12px;
  border: none; background: transparent;
  border-left: 3px solid transparent; border-radius: 6px;
  text-align: left; font-family: inherit; cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease;
}
.ugif-search-item:hover,
.ugif-search-item.is-active {
  background: linear-gradient(90deg, #ecfeff 0%, #f0fdfa 100%);
  border-left-color: #00b8b0;
}
.ugif-search-item-code {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-size: 13px; font-weight: 800; color: #008a82;
}
.ugif-search-item-name { font-size: 12.5px; color: #475569; }
.ugif-search-item-meta {
  display: flex; flex-wrap: wrap; gap: 5px; margin-top: 2px;
}
.ugif-chip {
  display: inline-block; padding: 2px 8px; border-radius: 999px;
  font-size: 10.5px; font-weight: 700;
  background: #f1f5f9; color: #334155;
  border: 1px solid #cbd5e1;
}
.ugif-chip--loc {
  background: #e0f2fe; color: #075985; border-color: #7dd3fc;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
}
.ugif-chip--qty {
  background: #dcfce7; color: #166534; border-color: #86efac;
}
.ugif-chip--bc {
  background: #fef3c7; color: #92400e; border-color: #fcd34d;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
}

/* ============================================================
   LINES TABLE (desktop)
   ============================================================ */
.ugif-lines {
  display: flex; flex-direction: column;
  border: 1px solid #e2e8f0; border-radius: 10px;
  overflow: hidden; background: #ffffff;
}
.ugif-lines-head {
  display: grid;
  grid-template-columns: minmax(200px, 1.8fr) 68px 80px 140px minmax(150px, 1.4fr) 40px;
  gap: 8px; padding: 10px 12px;
  background: #f8fafc; border-bottom: 1px solid #e2e8f0;
  font-size: 10.5px; font-weight: 800; letter-spacing: 0.06em;
  text-transform: uppercase; color: #475569; align-items: center;
}
.ugif-lines-row {
  display: grid;
  grid-template-columns: minmax(200px, 1.8fr) 68px 80px 140px minmax(150px, 1.4fr) 40px;
  gap: 8px; padding: 10px 12px;
  border-bottom: 1px solid #f1f5f9;
  align-items: center;
  border-left: 3px solid transparent;
  transition: background 140ms ease, border-color 140ms ease;
}
.ugif-lines-row:last-child { border-bottom: none; }
.ugif-lines-row:hover { background: #f0fdfa; }
.ugif-lines-row.is-error {
  background: linear-gradient(90deg, #fef2f2 0%, #fff5f5 100%);
  border-left-color: #dc2626;
}
.ugif-lines-row.is-error:hover {
  background: linear-gradient(90deg, #fee2e2 0%, #fef2f2 100%);
}
.ugif-col { min-width: 0; }
.ugif-col--qty { text-align: right; }
.ugif-col--x  { display: flex; justify-content: flex-end; }
.ugif-col--last { min-width: 0; }
.ugif-line-code {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-size: 12.5px; font-weight: 800; color: #0f172a; line-height: 1.2;
}
.ugif-line-name {
  font-size: 11.5px; color: #475569;
  overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; margin-top: 1px;
}
.ugif-line-locator {
  font-size: 10.5px; color: #64748b; margin-top: 2px;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
}
.ugif-unit-tag {
  display: inline-block; padding: 3px 8px; border-radius: 6px;
  background: #f1f5f9; color: #334155;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-size: 11px; font-weight: 700;
}
.ugif-num-input,
.ugif-text-input {
  width: 100%; min-height: 34px;
  padding: 6px 10px;
  border: 1.5px solid #cbd5e1; border-radius: 6px;
  font-family: inherit; font-size: 13px;
  color: #0f172a; background: #f1f5f9;
  outline: none; box-sizing: border-box; text-align: right;
  transition: background 150ms ease, border-color 140ms ease, box-shadow 140ms ease;
}
.ugif-text-input { text-align: left; }
.ugif-num-input:hover:not(:disabled):not(:focus):not(.is-overflow),
.ugif-text-input:hover:not(:disabled):not(:focus) {
  background: #e2e8f0; border-color: #94a3b8;
}
.ugif-num-input:focus,
.ugif-text-input:focus {
  background: #ffffff; border-color: #00b8b0;
  box-shadow: 0 0 0 3px rgba(0, 210, 200, 0.15);
}
.ugif-num-input--strong { font-weight: 700; }
.ugif-num-input:disabled,
.ugif-text-input:disabled {
  background: #f8fafc; color: #94a3b8; cursor: not-allowed;
}
.ugif-box-input-hint {
  font-size: 10px; font-weight: 700; color: #0f766e;
  text-align: right; line-height: 1.2; margin-top: 2px;
}
.ugif-num-input.is-overflow {
  background: #fef2f2; border-color: #dc2626; color: #991b1b;
  box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.14);
}
.ugif-num-input.is-overflow:hover:not(:disabled) {
  background: #fee2e2; border-color: #dc2626;
}
.ugif-num-input.is-overflow:focus {
  background: #ffffff; border-color: #dc2626;
  box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.22);
}
.ugif-line-warn {
  margin-top: 3px; font-size: 10px; font-weight: 800;
  color: #b91c1c; text-align: right;
  letter-spacing: 0.02em; line-height: 1.35;
}
.ugif-amount {
  display: block; padding: 6px 10px;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-size: 13px; font-weight: 700; color: #065f46; text-align: right;
}
.ugif-line-remove {
  width: 32px; height: 32px;
  border: 1px solid #fecaca; border-radius: 8px;
  background: #ffffff; color: #dc2626; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  transition: background 140ms ease, border-color 140ms ease;
}
.ugif-line-remove:hover:not(:disabled) {
  background: #fef2f2; border-color: #dc2626;
}
.ugif-line-remove:disabled { opacity: 0.5; cursor: not-allowed; }
.ugif-line-remove svg { width: 14px; height: 14px; stroke-width: 2.4; }
.ugif-empty-lines {
  padding: 20px 16px; text-align: center;
  font-size: 13px; color: #94a3b8;
  border: 1px dashed #cbd5e1; border-radius: 10px; background: #f8fafc;
}

/* ============================================================
   FOOTER SIGNATURES
   ============================================================ */
.ugif-footer-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px 12px;
}
.ugif-field--auto .ugif-auto-display {
  min-height: 42px; padding: 8px 12px;
  background: linear-gradient(135deg, #ecfeff 0%, #f0fdfa 100%);
  border: 1.5px solid #99f6e4; border-radius: 8px;
  display: flex; flex-direction: column; gap: 2px; justify-content: center;
  transition: border-color 140ms ease, box-shadow 140ms ease, background 140ms ease;
}
.ugif-field--auto .ugif-auto-display.is-error {
  background: #fef2f2; border-color: #dc2626;
  box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.14);
}
.ugif-auto-name {
  font-size: 13.5px; font-weight: 700; color: #0f172a;
  line-height: 1.25; word-break: break-word;
}
.ugif-auto-pos {
  font-size: 11.5px; color: #0f766e; font-weight: 600; line-height: 1.3;
}
.ugif-auto-badge {
  display: inline-block; margin-left: 8px;
  padding: 1px 8px; border-radius: 999px;
  font-size: 9.5px; font-weight: 800; letter-spacing: 0.08em;
  color: #0f766e; background: #f0fdfa;
  border: 1px solid #99f6e4; text-transform: uppercase; vertical-align: middle;
}
.ugif-loading-inline {
  display: flex; align-items: center; gap: 8px;
  padding: 12px 0; font-size: 13px; color: #64748b;
}

/* ============================================================
   ATTACHMENT
   ============================================================ */
.ugif-attach-file {
  position: absolute; width: 1px; height: 1px;
  padding: 0; margin: -1px; overflow: hidden;
  clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
}
.ugif-attach-drop {
  display: flex; align-items: center; gap: 14px;
  width: 100%; padding: 18px 16px; min-height: 96px;
  border: 2px dashed #cbd5e1; border-radius: 10px;
  background: #f8fafc; cursor: pointer;
  font-family: inherit; text-align: left;
  transition: border-color 150ms ease, background 150ms ease, box-shadow 150ms ease;
}
.ugif-attach-drop:hover:not(:disabled) {
  border-color: #00b8b0; background: #f0fdfa;
}
.ugif-attach-drop.is-drag {
  border-color: #00b8b0; background: #ecfeff;
  box-shadow: 0 0 0 4px rgba(0, 210, 200, 0.15);
}
.ugif-attach-drop.is-error {
  border-color: #dc2626; background: #fef2f2;
  box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.14);
}
.ugif-attach-drop:disabled { opacity: 0.55; cursor: not-allowed; }
.ugif-attach-drop-icon {
  width: 44px; height: 44px; border-radius: 10px;
  background: linear-gradient(135deg, #ecfeff 0%, #f0fdfa 100%);
  border: 1px solid #99f6e4; color: #00b8b0;
  display: inline-flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.ugif-attach-drop-icon svg { width: 20px; height: 20px; stroke-width: 2.2; }
.ugif-attach-drop-text {
  display: flex; flex-direction: column; gap: 3px;
  min-width: 0; flex: 1;
}
.ugif-attach-drop-title {
  font-size: 13.5px; font-weight: 700; color: #0f172a; line-height: 1.25;
}
.ugif-attach-drop-sub {
  font-size: 11.5px; color: #64748b; line-height: 1.4;
}
.ugif-attach-preview {
  display: grid; grid-template-columns: 80px minmax(0, 1fr) auto;
  gap: 14px; align-items: center; padding: 12px 14px;
  background: #ffffff; border: 1.5px solid #99f6e4;
  border-radius: 10px; box-shadow: 0 1px 3px rgba(15, 23, 42, 0.04);
}
.ugif-attach-thumb {
  width: 80px; height: 80px; object-fit: cover;
  border-radius: 8px; background: #f1f5f9;
  border: 1px solid #e2e8f0; display: block;
}
.ugif-attach-info { min-width: 0; }
.ugif-attach-name {
  font-size: 13px; font-weight: 700; color: #0f172a;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ugif-attach-meta {
  font-size: 11.5px; color: #64748b; margin-top: 6px;
  display: flex; flex-wrap: wrap; gap: 6px; align-items: center;
}
.ugif-attach-meta-chip {
  display: inline-block; padding: 2px 8px; border-radius: 999px;
  font-size: 10.5px; font-weight: 800; letter-spacing: 0.04em;
  background: #f0fdfa; color: #0f766e; border: 1px solid #99f6e4;
}
.ugif-attach-size {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-size: 11px; color: #64748b;
}
.ugif-attach-actions { display: flex; gap: 6px; align-items: center; flex-shrink: 0; }
.ugif-attach-btn {
  display: inline-flex; align-items: center; justify-content: center;
  gap: 6px; padding: 8px 12px; min-height: 36px;
  border-radius: 8px; border: 1.5px solid #cbd5e1;
  background: #ffffff; color: #334155;
  font-family: inherit; font-size: 12px; font-weight: 700;
  cursor: pointer;
  transition: background 140ms ease, border-color 140ms ease, color 140ms ease;
}
.ugif-attach-btn:hover:not(:disabled) {
  background: #f0fdfa; border-color: #00b8b0; color: #007a72;
}
.ugif-attach-btn--danger { color: #dc2626; border-color: #fecaca; }
.ugif-attach-btn--danger:hover:not(:disabled) {
  background: #fef2f2; border-color: #dc2626; color: #991b1b;
}
.ugif-attach-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.ugif-attach-btn svg { width: 13px; height: 13px; stroke-width: 2.4; }
.ugif-attach-err {
  display: flex; align-items: flex-start; gap: 6px;
  margin-top: 8px; padding: 8px 10px;
  border-radius: 8px;
  background: #fef2f2; border: 1px solid #fecaca;
  color: #991b1b; font-size: 12px; font-weight: 700; line-height: 1.4;
}
.ugif-attach-err svg {
  width: 14px; height: 14px; flex-shrink: 0; margin-top: 1px;
  color: #dc2626; stroke-width: 2.4;
}

/* ============================================================
   RESPONSIVE
   ============================================================ */

/* ----- Very large desktops (≥ 1600 px) ----- */
@media (min-width: 1600px) {
  .ugif-scan-input { min-height: 56px; font-size: 16.5px; padding: 14px 16px 14px 44px; }
  .ugif-scan-input-icon { left: 14px; width: 18px; height: 18px; }
  .ugif-scan-btn { min-height: 56px; font-size: 15.5px; padding: 0 26px; }
  .ugif-scan-label { font-size: 17px; }
}

/* ----- Small laptops / iPad landscape (≤ 1024 px) ----- */
@media (max-width: 1024px) {
  .ugif-scan-input { font-size: 15px; min-height: 50px; padding: 11px 12px 11px 38px; }
  .ugif-scan-input-icon { left: 11px; width: 15px; height: 15px; }
  .ugif-scan-btn { min-height: 50px; font-size: 14px; padding: 0 18px; }
  .ugif-lines-head,
  .ugif-lines-row {
    grid-template-columns: minmax(180px, 1.8fr) 60px 70px 130px minmax(130px, 1.4fr) 36px;
  }
}

/* ----- Tablets (≤ 900 px) ----- */
@media (max-width: 900px) {
  .ugif-header-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .ugif-field--wide { grid-column: span 2; }
  .ugif-field--bodega { grid-column: span 2; }
  .ugif-footer-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

/* ----- Small tablets (≤ 768 px) ----- */
@media (max-width: 768px) {
  .ugif-scan-label { font-size: 15px; gap: 8px; }
  .ugif-scan-label-icon { width: 16px; height: 16px; }
  .ugif-scan-input { min-height: 48px; font-size: 14.5px; padding: 10px 12px 10px 36px; }
  .ugif-scan-input-icon { left: 10px; width: 15px; height: 15px; }
  .ugif-scan-btn { min-height: 48px; font-size: 13.5px; padding: 0 16px; }
  .ugif-scan-btn span { display: none; }
  .ugif-scan-btn { padding: 0 14px; }
  .ugif-scan-btn-icon { width: 16px; height: 16px; }
  .ugif-scan-feedback { font-size: 12.5px; }
  .ugif-scan-hint-toggle { font-size: 13px; padding: 6px 12px; }
  .ugif-scan-hint-text { font-size: 12.5px; }
}

/* ----- Large phones (≤ 640 px) ----- */
@media (max-width: 640px) {
  .ugif-scan-row { flex-wrap: wrap; }
  .ugif-scan-input-wrap { flex: 1 1 100%; width: 100%; }
  .ugif-scan-btn {
    flex: 1 1 100%; width: 100%;
    min-height: 46px; padding: 0 16px;
  }
  .ugif-scan-btn span { display: inline; }
  .ugif-search-panel { top: 140px; }
  .ugif-scan-hint-toggle {
    align-self: stretch; width: 100%; justify-content: center;
  }
}

/* ----- Standard phones (≤ 480 px) ----- */
@media (max-width: 480px) {
  .ugif-letterhead-wrap { padding: 12px 44px 10px 14px; }
  .ugif-section { padding: 12px; }
  .ugif-scan-label { font-size: 14.5px; }
  .ugif-scan-input { min-height: 46px; font-size: 14px; }
  .ugif-scan-btn { min-height: 44px; font-size: 13px; }
  .ugif-scan-btn-icon { width: 15px; height: 15px; }
  .ugif-scan-feedback { font-size: 12px; gap: 6px; }
  .ugif-scan-feedback-icon { width: 13px; height: 13px; }
  .ugif-scan-hint-toggle { font-size: 12.5px; padding: 6px 10px; }
  .ugif-scan-hint-text { font-size: 12px; }
  .ugif-header-grid,
  .ugif-footer-grid { grid-template-columns: 1fr; }
  .ugif-field--wide,
  .ugif-field--bodega { grid-column: span 1; }
  .ugif-shift-group { width: 100%; }
  .ugif-shift-btn { flex: 1; }
  .ugif-bodega-add-btn { width: 100%; justify-content: center; }
  .ugif-bodega-panel { max-height: 200px; }
  .ugif-combo-input { min-height: 44px; font-size: 14.5px; }
  .ugif-combo-panel { max-height: 220px; }
  .ugif-combo-option { padding: 10px 12px; }
  .ugif-combo-opt-value { font-size: 13.5px; }
  .ugif-attach-drop {
    flex-direction: column; text-align: center;
    gap: 10px; padding: 16px 12px; min-height: 140px; align-items: center;
  }
  .ugif-attach-drop-text { align-items: center; text-align: center; }
  .ugif-attach-drop-title { font-size: 13px; }
  .ugif-attach-drop-sub { font-size: 11px; }
  .ugif-attach-preview { padding: 10px; grid-template-columns: 1fr; gap: 10px; }
  .ugif-attach-thumb { width: 100%; height: 140px; }
  .ugif-attach-name { font-size: 12.5px; }
  .ugif-attach-actions { justify-content: space-between; }
  .ugif-attach-btn { min-height: 42px; font-size: 12.5px; padding: 8px 10px; }
}

/* ----- Very small phones (≤ 380 px) ----- */
@media (max-width: 380px) {
  .ugif-section { padding: 10px; }
  .ugif-scan-label { font-size: 14px; }
  .ugif-scan-input { min-height: 44px; font-size: 13.5px; padding: 10px 10px 10px 32px; }
  .ugif-scan-input-icon { left: 9px; width: 14px; height: 14px; }
  .ugif-scan-btn { min-height: 42px; font-size: 12.5px; padding: 0 12px; }
  .ugif-scan-feedback { font-size: 11.5px; }
  .ugif-scan-hint-toggle { font-size: 12px; }
  .ugif-combo-input { font-size: 14px; padding: 8px 32px 8px 10px; }
  .ugif-combo-caret { right: 8px; width: 14px; height: 14px; }
  .ugif-attach-drop { padding: 14px 10px; min-height: 130px; }
  .ugif-attach-drop-icon { width: 38px; height: 38px; }
  .ugif-attach-drop-icon svg { width: 18px; height: 18px; }
  .ugif-attach-drop-title { font-size: 12.5px; }
  .ugif-attach-drop-sub { font-size: 10.5px; }
  .ugif-attach-thumb { height: 120px; }
  .ugif-attach-actions { flex-wrap: wrap; }
  .ugif-attach-actions .ugif-attach-btn { flex: 1 1 100%; }
}

/* ----- Tiny phones (≤ 360 px) ----- */
@media (max-width: 360px) {
  .ugif-section { padding: 10px; }
  .ugif-scan-row { gap: 8px; }
  .ugif-scan-btn span { display: none; }
  .ugif-scan-btn { padding: 0 12px; }
}

/* ----- Landscape phones (height ≤ 500 px) ----- */
@media (max-height: 500px) and (orientation: landscape) {
  .ugif-modal .ugmodal-body { padding: 10px; }
}

/* ----- Phones (≤ 720 px): line items become cards ----- */
@media (max-width: 720px) {
  .ugif-error-banner { padding: 12px 14px; gap: 10px; }
  .ugif-error-banner-icon { width: 20px; height: 20px; }
  .ugif-error-banner-title { font-size: 13px; }
  .ugif-error-banner-sub { font-size: 12px; }

  .ugif-lines-head { display: none; }
  .ugif-lines-row {
    grid-template-columns: 1fr; gap: 8px; padding: 12px;
    border-bottom: 1px dashed #e2e8f0; border-left-width: 4px;
  }
  .ugif-lines-row .ugif-col--unit,
  .ugif-lines-row .ugif-col--qty {
    display: grid; grid-template-columns: 70px 1fr;
    align-items: center; gap: 8px;
  }
  .ugif-lines-row .ugif-col--unit::before {
    content: 'Unit'; font-size: 11px; font-weight: 700;
    color: #64748b; text-transform: uppercase; letter-spacing: 0.06em;
  }
  .ugif-lines-row .ugif-col--qty:nth-of-type(3)::before {
    content: "Req'd"; font-size: 11px; font-weight: 700;
    color: #64748b; text-transform: uppercase; letter-spacing: 0.06em;
  }
  .ugif-lines-row .ugif-col--qty:nth-of-type(4)::before {
    content: 'Issued'; font-size: 11px; font-weight: 700;
    color: #64748b; text-transform: uppercase; letter-spacing: 0.06em;
  }
  .ugif-lines-row .ugif-col--last {
    display: grid; grid-template-columns: 70px 1fr;
    align-items: center; gap: 8px;
  }
  .ugif-lines-row .ugif-col--last::before {
    content: attr(data-label); font-size: 11px; font-weight: 700;
    color: #64748b; text-transform: uppercase; letter-spacing: 0.06em;
  }
  .ugif-lines-row .ugif-col--x { justify-content: flex-start; }
  .ugif-num-input, .ugif-text-input { text-align: left; }
  .ugif-line-warn { text-align: left; }
  .ugif-box-input-hint { text-align: left; }
  .ugif-attach-actions { width: 100%; }
  .ugif-attach-actions .ugif-attach-btn { flex: 1; }
}

/* ----- 4K / ultra-wide (≥ 1921 px) ----- */
@media (min-width: 1921px) {
  .ugif-combo-input {
    min-height: 46px; font-size: 14.5px; padding: 10px 40px 10px 14px;
  }
  .ugif-combo-panel { max-height: 320px; }
  .ugif-combo-option { padding: 10px 14px; }
  .ugif-combo-opt-value { font-size: 14px; }
  .ugif-combo-opt-desc { font-size: 12.5px; }
}

/* ----- Reduced motion ----- */
@media (prefers-reduced-motion: reduce) {
  .ugif-shift-btn, .ugif-scan-input, .ugif-scan-btn,
  .ugif-scan-hint-toggle, .ugif-num-input, .ugif-text-input,
  .ugif-line-remove, .ugif-bodega-chip, .ugif-bodega-chip-remove,
  .ugif-bodega-add-btn, .ugif-bodega-caret, .ugif-bodega-option,
  .ugif-attach-drop, .ugif-attach-btn, .ugif-modal .ugmodal-input,
  .ugif-modal .ugmodal-select, .ugif-modal .ugmodal-textarea,
  .ugif-lines-row, .ugif-combo-input, .ugif-combo-caret,
  .ugif-combo-option { transition: none !important; }
  .ugif-error-banner, .ugif-error-banner-icon,
  .ugif-scan-hint-panel, .is-pulsing { animation: none !important; }
}

/* ----- Focus-visible outlines ----- */
.ugif-scan-input:focus-visible,
.ugif-scan-btn:focus-visible,
.ugif-scan-hint-toggle:focus-visible { outline: none; }
.ugif-scan-hint-toggle:focus-visible { outline: 2px solid #00b8b0; outline-offset: 2px; }
.ugif-scan-btn:focus-visible { outline: 2px solid #00b8b0; outline-offset: 2px; }
.ugif-combo-input:focus-visible { outline: none; }
`;