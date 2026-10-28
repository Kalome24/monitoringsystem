// controllers/uomConversionController.js
const UomConversionModel = require('../models/uomConversionModel');

const getAll = async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 50;
    const search = req.query.search || '';

    const result = await UomConversionModel.getAll(page, limit, search);
    
    res.status(200).json({ 
      success: true, 
      data: result.data,
      total: result.total,
      totalPages: result.totalPages,
      currentPage: result.currentPage
    });
  } catch (error) {
    console.error('Error fetching UOM conversions:', error);
    res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  }
};

const getById = async (req, res) => {
  try {
    const { id } = req.params;
    const item = await UomConversionModel.getById(id);
    if (!item) {
      return res.status(404).json({ success: false, message: 'Conversion not found' });
    }
    res.status(200).json({ success: true, data: item });
  } catch (error) {
    console.error('Error fetching UOM conversion:', error);
    res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  }
};

const create = async (req, res) => {
  try {
    const { box_item_code, piece_item_code, pieces_per_box, Status } = req.body;
    
    if (!box_item_code || !piece_item_code || !pieces_per_box) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }
    if (parseInt(pieces_per_box, 10) <= 0) {
      return res.status(400).json({ success: false, message: 'Pieces per box must be greater than 0' });
    }

    const id = await UomConversionModel.create(
      { box_item_code, piece_item_code, pieces_per_box, Status }, 
      req.user?.username || 'System'
    );
    
    const newItem = await UomConversionModel.getById(id);
    res.status(201).json({ success: true, message: 'UOM Conversion created', data: newItem });
  } catch (error) {
    console.error('Error creating UOM conversion:', error);
    
    // SQL Server unique constraint violation (e.g., duplicate box_item_code)
    const isDuplicate = error?.number === 2627 || error?.number === 2601 || /UNIQUE constraint/i.test(error.message);
    if (isDuplicate) {
      return res.status(409).json({ 
        success: false, 
        message: 'A conversion rule already exists for this Box Item Code.' 
      });
    }
    
    // Foreign Key violation (e.g., item code doesn't exist in item_master)
    const isFkViolation = error?.number === 547 || /REFERENCE constraint/i.test(error.message);
    if (isFkViolation) {
      return res.status(400).json({ 
        success: false, 
        message: 'One of the Item Codes does not exist in the Item Master.' 
      });
    }

    res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  }
};

const update = async (req, res) => {
  try {
    const { id } = req.params;
    const { box_item_code, piece_item_code, pieces_per_box, Status } = req.body;
    
    const existing = await UomConversionModel.getById(id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Conversion not found' });
    }

    if (parseInt(pieces_per_box, 10) <= 0) {
      return res.status(400).json({ success: false, message: 'Pieces per box must be greater than 0' });
    }

    await UomConversionModel.update(
      id, 
      { box_item_code, piece_item_code, pieces_per_box, Status }, 
      req.user?.username || 'System'
    );
    
    const updated = await UomConversionModel.getById(id);
    res.status(200).json({ success: true, message: 'UOM Conversion updated', data: updated });
  } catch (error) {
    console.error('Error updating UOM conversion:', error);
    
    const isDuplicate = error?.number === 2627 || error?.number === 2601 || /UNIQUE constraint/i.test(error.message);
    if (isDuplicate) {
      return res.status(409).json({ success: false, message: 'A conversion rule already exists for this Box Item Code.' });
    }

    res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  }
};

const remove = async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await UomConversionModel.getById(id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Conversion not found' });
    }

    await UomConversionModel.delete(id);
    res.status(200).json({ success: true, message: 'UOM Conversion deleted' });
  } catch (error) {
    console.error('Error deleting UOM conversion:', error);
    res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  }
};

module.exports = {
  getAll,
  getById,
  create,
  update,
  remove
};