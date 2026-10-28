// src/components/underground/issueForms/formTemplates.js
export const FORM_TYPES = Object.freeze(['MER', 'MSR', 'MSF', 'MSB']);

export const DATE_EFFECTIVE = '09-1-2018';

export const HEADER_FIELDS = Object.freeze({
  dept_section:    { key: 'dept_section',    label: 'Dept/Section',            type: 'text', maxLength: 80 },
  dept_blank:      { key: 'dept_section',    label: 'Dept',                    type: 'text', maxLength: 80 },
  adh_dh_initials: { key: 'adh_dh_initials', label: 'Name of ADH/DH(Initials)', type: 'text', maxLength: 40 },
  activity_cc:     { key: 'activity_cc',     label: 'Activity/CC',             type: 'text', maxLength: 40 },
  level_field:     { key: 'level_field',     label: 'Level',                   type: 'text', maxLength: 40 },
  form_date:       { key: 'form_date',       label: 'Date',                    type: 'date' },
  working_place:   { key: 'working_place',   label: 'Working Place',           type: 'text', maxLength: 80 },
  lhd_no:          { key: 'lhd_no',          label: 'LHD No.',                 type: 'text', maxLength: 40 },
  shift_label:     { key: 'shift_label',     label: 'Shift',                   type: 'shift' },
});

export const FORM_TEMPLATES = Object.freeze({
  MER: {
    id: 'MER',
    form_document_code: 'FRM-IMD-014',
    form_revision: '03',
    date_effective: DATE_EFFECTIVE,
    series_prefix: 'MER',
    title: 'MINE EXPLOSIVES REQUISITION',
    subtitle: '(MER)',

    header_fields: [
      HEADER_FIELDS.dept_section,
      HEADER_FIELDS.adh_dh_initials,
      HEADER_FIELDS.activity_cc,
      HEADER_FIELDS.level_field,
      HEADER_FIELDS.form_date,
      HEADER_FIELDS.working_place,
      HEADER_FIELDS.shift_label,
    ],

    line_code_label: 'Code No.',
    last_col: 'remarks',
    last_col_label: 'Remarks',
    has_bdm_block: false,
  },

  MSR: {
    id: 'MSR',
    form_document_code: 'FRM-IMD-057',
    form_revision: '03',
    date_effective: DATE_EFFECTIVE,
    series_prefix: 'MSR',
    title: 'MINE SUPPLY REQUISITION',
    subtitle: 'Rockbolts & Accessories',

    header_fields: [
      HEADER_FIELDS.dept_section,
      HEADER_FIELDS.adh_dh_initials,
      HEADER_FIELDS.activity_cc,
      HEADER_FIELDS.level_field,
      HEADER_FIELDS.form_date,
      HEADER_FIELDS.working_place,
      HEADER_FIELDS.lhd_no,
      HEADER_FIELDS.shift_label,
    ],

    line_code_label: 'ORACODE',
    last_col: 'remarks',
    last_col_label: 'Remarks',
    has_bdm_block: false,
  },

  MSF: {
    id: 'MSF',
    form_document_code: 'FRM-IMD-056',
    form_revision: '03',
    date_effective: DATE_EFFECTIVE,
    series_prefix: 'MSF',
    title: 'MINE SUPPLY REQUISITION',
    subtitle: 'Fuel and Lubricants',

    header_fields: [
      HEADER_FIELDS.dept_section,
      HEADER_FIELDS.adh_dh_initials,
      HEADER_FIELDS.activity_cc,
      HEADER_FIELDS.level_field,
      HEADER_FIELDS.form_date,
      HEADER_FIELDS.working_place,
      HEADER_FIELDS.lhd_no,
      HEADER_FIELDS.shift_label,
    ],

    line_code_label: 'ORACODE',
    last_col: 'remarks',
    last_col_label: 'Remarks',
    has_bdm_block: true,
  },

  MSB: {
    id: 'MSB',
    form_document_code: 'FRM-IMD-051',
    form_revision: '03',
    date_effective: DATE_EFFECTIVE,
    series_prefix: 'MSB',
    title: 'MINE SUPPLY REQUISITION',
    subtitle: '(BLANK)',

    header_fields: [
      HEADER_FIELDS.dept_blank,
      HEADER_FIELDS.adh_dh_initials,
      HEADER_FIELDS.activity_cc,
      HEADER_FIELDS.level_field,
      HEADER_FIELDS.form_date,
      HEADER_FIELDS.working_place,
      HEADER_FIELDS.lhd_no,
      HEADER_FIELDS.shift_label,
    ],

    line_code_label: 'Code No.',
    last_col: 'amount',
    last_col_label: 'Amount',
    has_bdm_block: false,
  },
});

export const PICKER_CARDS = Object.freeze([
  {
    form_type: 'MER',
    title: 'Mine Explosives Requisition',
    form_no: 'FRM-IMD-014',
    revision: '03',
    blurb: 'Explosives, caps, dynamite, fuses, and related blasting consumables.',
    accent: 'amber',
    icon: 'explosive',
  },
  {
    form_type: 'MSR',
    title: 'Mine Supply Requisition',
    subtitle: 'Rockbolts & Accessories',
    form_no: 'FRM-IMD-057',
    revision: '03',
    blurb: 'Rockbolts, washers, capsules, friction bolts, and pushers.',
    accent: 'teal',
    icon: 'rockbolt',
  },
  {
    form_type: 'MSF',
    title: 'Mine Supply Requisition',
    subtitle: 'Fuel and Lubricants',
    form_no: 'FRM-IMD-056',
    revision: '03',
    blurb: 'Diesel, lubricating oils, and greases — includes a secondary FOR BDM ONLY block.',
    accent: 'blue',
    icon: 'fuel',
  },
  {
    form_type: 'MSB',
    title: 'Mine Supply Requisition',
    subtitle: '(Blank)',
    form_no: 'FRM-IMD-051',
    revision: '03',
    blurb: 'General-purpose requisition. Amount column replaces Remarks.',
    accent: 'slate',
    icon: 'blank',
  },
]);

export const FOOTER_SLOTS = Object.freeze([
  { role_slot: 'Authorized By', key: 'authorized', label: 'Authorized by' },
  { role_slot: 'Issued By',     key: 'issued',     label: 'Issued by'     },
  { role_slot: 'Received By',   key: 'received',   label: 'Received by'   },
  { role_slot: 'Bodega',        key: 'bodega',     label: 'Bodega'        },
]);

export const CHAPA_SLOT = Object.freeze({
  role_slot: 'Chapa',
  key: 'chapa',
  label: 'Chapa',
});

export const isFormType = (t) => typeof t === 'string' && FORM_TYPES.includes(t.toUpperCase());

export const getTemplate = (t) => {
  if (!isFormType(t)) return null;
  return FORM_TEMPLATES[String(t).toUpperCase()] || null;
};

export const isShiftLabel = (v) => v === '1st' || v === '2nd' || v === '3rd';

export const SHIFT_OPTIONS = Object.freeze([
  { value: '1st', label: '1st' },
  { value: '2nd', label: '2nd' },
  { value: '3rd', label: '3rd' },
]);

export const buildEmptyDraft = (formType) => {
  const tpl = getTemplate(formType);
  if (!tpl) return null;

  const header = {};
  for (const f of tpl.header_fields) {
    header[f.key] = f.key === 'shift_label' ? '' : '';
  }

  return {
    form_type: tpl.id,
    form_document_code: tpl.form_document_code,
    form_revision: tpl.form_revision,
    ...header,
    bdm_rdm_no: '',
    bdm_shift_label: '',
    authorized_name: '', authorized_position: '',
    issued_name: '',     issued_position: '',
    received_name: '',   received_position: '',
    bodega_name: '',     bodega_position: '',
    chapa_name: '',
    remarks: '',
    lines:     [],
    bdm_lines: [],
  };
};

export const lineColumns = (tpl) => {
  if (!tpl) return [];
  return [
    { key: 'code',         label: tpl.line_code_label, align: 'left'  },
    { key: 'description',  label: 'Item Description',  align: 'left'  },
    { key: 'uom',          label: 'Unit',              align: 'center'},
    { key: 'qty_required', label: "Req'd",             align: 'right' },
    { key: 'qty_issued',   label: 'Issued',            align: 'right' },
    { key: 'last',         label: tpl.last_col_label,  align: 'left'  },
  ];
};

export const DEFAULT_LINES = 10;