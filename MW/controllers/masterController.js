// controllers/masterController.js
const MasterModel = require('../models/masterModel');

// Generic response helpers
const handleError = (res, error, customMessage = 'Operation failed') => {
    console.error(`❌ ${customMessage}:`, error);
    res.status(500).json({
        success: false,
        message: customMessage,
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
};

const handleNotFound = (res, entity) => {
    res.status(404).json({
        success: false,
        message: `${entity} not found`
    });
};

// ============================================
// GL CLASSES
// ============================================
const glController = {
    getAll: async (req, res) => {
        try {
            const data = await MasterModel.getAllGl();
            res.status(200).json({ success: true, data });
        } catch (error) {
            handleError(res, error, 'Error fetching GL classes');
        }
    },
    getOne: async (req, res) => {
        try {
            const { id } = req.params;
            const item = await MasterModel.getGlById(id);
            if (!item) return handleNotFound(res, 'GL class');
            res.status(200).json({ success: true, data: item });
        } catch (error) {
            handleError(res, error, 'Error fetching GL class');
        }
    },
    create: async (req, res) => {
        try {
            const { number, description, status } = req.body;
            if (!number || !description) {
                return res.status(400).json({ success: false, message: 'Number and Description are required' });
            }
            const exists = await MasterModel.glExists(number);
            if (exists) {
                return res.status(409).json({ success: false, message: 'GL number already exists' });
            }
            await MasterModel.createGl(number, description, status || 'Active');
            const newItem = await MasterModel.getGlById(number);
            res.status(201).json({ success: true, message: 'GL class created', data: newItem });
        } catch (error) {
            handleError(res, error, 'Error creating GL class');
        }
    },
    update: async (req, res) => {
        try {
            const { id } = req.params;
            const { description, status } = req.body;
            if (!description) {
                return res.status(400).json({ success: false, message: 'Description is required' });
            }
            const existing = await MasterModel.getGlById(id);
            if (!existing) return handleNotFound(res, 'GL class');
            await MasterModel.updateGl(id, description, status || existing.Status);
            const updated = await MasterModel.getGlById(id);
            res.status(200).json({ success: true, message: 'GL class updated', data: updated });
        } catch (error) {
            handleError(res, error, 'Error updating GL class');
        }
    },
    deactivate: async (req, res) => {
        try {
            const { id } = req.params;
            const existing = await MasterModel.getGlById(id);
            if (!existing) return handleNotFound(res, 'GL class');
            if (existing.Status === 'Inactive') {
                return res.status(400).json({ success: false, message: 'GL class is already inactive' });
            }
            await MasterModel.deactivateGl(id);
            const updated = await MasterModel.getGlById(id);
            res.status(200).json({ success: true, message: 'GL class deactivated', data: updated });
        } catch (error) {
            handleError(res, error, 'Error deactivating GL class');
        }
    },
    activate: async (req, res) => {
        try {
            const { id } = req.params;
            const existing = await MasterModel.getGlById(id);
            if (!existing) return handleNotFound(res, 'GL class');
            if (existing.Status === 'Active') {
                return res.status(400).json({ success: false, message: 'GL class is already active' });
            }
            await MasterModel.activateGl(id);
            const updated = await MasterModel.getGlById(id);
            res.status(200).json({ success: true, message: 'GL class activated', data: updated });
        } catch (error) {
            handleError(res, error, 'Error activating GL class');
        }
    }
};

// ============================================
// CATEGORIES
// ============================================
const categoryController = {
    getAll: async (req, res) => {
        try {
            const data = await MasterModel.getAllCategories();
            res.status(200).json({ success: true, data });
        } catch (error) {
            handleError(res, error, 'Error fetching categories');
        }
    },
    getOne: async (req, res) => {
        try {
            const { id } = req.params;
            const item = await MasterModel.getCategoryById(id);
            if (!item) return handleNotFound(res, 'Category');
            res.status(200).json({ success: true, data: item });
        } catch (error) {
            handleError(res, error, 'Error fetching category');
        }
    },
    create: async (req, res) => {
        try {
            const { name, status } = req.body;
            if (!name) {
                return res.status(400).json({ success: false, message: 'Category name is required' });
            }
            const exists = await MasterModel.categoryExists(name);
            if (exists) {
                return res.status(409).json({ success: false, message: 'Category already exists' });
            }
            await MasterModel.createCategory(name, status || 'Active');
            const newItem = await MasterModel.getCategoryById(name);
            res.status(201).json({ success: true, message: 'Category created', data: newItem });
        } catch (error) {
            handleError(res, error, 'Error creating category');
        }
    },
    update: async (req, res) => {
        try {
            const { id } = req.params;
            const { status } = req.body;
            if (!status) {
                return res.status(400).json({ success: false, message: 'Status is required' });
            }
            const existing = await MasterModel.getCategoryById(id);
            if (!existing) return handleNotFound(res, 'Category');
            await MasterModel.updateCategory(id, status);
            const updated = await MasterModel.getCategoryById(id);
            res.status(200).json({ success: true, message: 'Category updated', data: updated });
        } catch (error) {
            handleError(res, error, 'Error updating category');
        }
    },
    deactivate: async (req, res) => {
        try {
            const { id } = req.params;
            const existing = await MasterModel.getCategoryById(id);
            if (!existing) return handleNotFound(res, 'Category');
            if (existing.Status === 'Inactive') {
                return res.status(400).json({ success: false, message: 'Category is already inactive' });
            }
            await MasterModel.deactivateCategory(id);
            const updated = await MasterModel.getCategoryById(id);
            res.status(200).json({ success: true, message: 'Category deactivated', data: updated });
        } catch (error) {
            handleError(res, error, 'Error deactivating category');
        }
    },
    activate: async (req, res) => {
        try {
            const { id } = req.params;
            const existing = await MasterModel.getCategoryById(id);
            if (!existing) return handleNotFound(res, 'Category');
            if (existing.Status === 'Active') {
                return res.status(400).json({ success: false, message: 'Category is already active' });
            }
            await MasterModel.activateCategory(id);
            const updated = await MasterModel.getCategoryById(id);
            res.status(200).json({ success: true, message: 'Category activated', data: updated });
        } catch (error) {
            handleError(res, error, 'Error activating category');
        }
    }
};

// ============================================
// ITEM CODES
// ============================================
const itemCodeController = {
    getAll: async (req, res) => {
        try {
            const data = await MasterModel.getAllItemCodes();
            res.status(200).json({ success: true, data });
        } catch (error) {
            handleError(res, error, 'Error fetching item codes');
        }
    },
    getOne: async (req, res) => {
        try {
            const { id } = req.params;
            const item = await MasterModel.getItemCodeById(id);
            if (!item) return handleNotFound(res, 'Item code');
            res.status(200).json({ success: true, data: item });
        } catch (error) {
            handleError(res, error, 'Error fetching item code');
        }
    },
    create: async (req, res) => {
        try {
            const { code, description, status } = req.body;
            if (!code || !description) {
                return res.status(400).json({ success: false, message: 'Code and Description are required' });
            }
            const exists = await MasterModel.itemCodeExists(code);
            if (exists) {
                return res.status(409).json({ success: false, message: 'Item code already exists' });
            }
            await MasterModel.createItemCode(code, description, status || 'Active');
            const newItem = await MasterModel.getItemCodeById(code);
            res.status(201).json({ success: true, message: 'Item code created', data: newItem });
        } catch (error) {
            handleError(res, error, 'Error creating item code');
        }
    },
    update: async (req, res) => {
        try {
            const { id } = req.params;
            const { description, status } = req.body;
            if (!description) {
                return res.status(400).json({ success: false, message: 'Description is required' });
            }
            const existing = await MasterModel.getItemCodeById(id);
            if (!existing) return handleNotFound(res, 'Item code');
            await MasterModel.updateItemCode(id, description, status || existing.Status);
            const updated = await MasterModel.getItemCodeById(id);
            res.status(200).json({ success: true, message: 'Item code updated', data: updated });
        } catch (error) {
            handleError(res, error, 'Error updating item code');
        }
    },
    deactivate: async (req, res) => {
        try {
            const { id } = req.params;
            const existing = await MasterModel.getItemCodeById(id);
            if (!existing) return handleNotFound(res, 'Item code');
            if (existing.Status === 'Inactive') {
                return res.status(400).json({ success: false, message: 'Item code is already inactive' });
            }
            await MasterModel.deactivateItemCode(id);
            const updated = await MasterModel.getItemCodeById(id);
            res.status(200).json({ success: true, message: 'Item code deactivated', data: updated });
        } catch (error) {
            handleError(res, error, 'Error deactivating item code');
        }
    },
    activate: async (req, res) => {
        try {
            const { id } = req.params;
            const existing = await MasterModel.getItemCodeById(id);
            if (!existing) return handleNotFound(res, 'Item code');
            if (existing.Status === 'Active') {
                return res.status(400).json({ success: false, message: 'Item code is already active' });
            }
            await MasterModel.activateItemCode(id);
            const updated = await MasterModel.getItemCodeById(id);
            res.status(200).json({ success: true, message: 'Item code activated', data: updated });
        } catch (error) {
            handleError(res, error, 'Error activating item code');
        }
    }
};

// ============================================
// PURCHASE CLASSES
// ============================================
const purchaseClassController = {
    getAll: async (req, res) => {
        try {
            const data = await MasterModel.getAllPurchaseClasses();
            res.status(200).json({ success: true, data });
        } catch (error) {
            handleError(res, error, 'Error fetching purchase classes');
        }
    },
    getOne: async (req, res) => {
        try {
            const { id } = req.params;
            const item = await MasterModel.getPurchaseClassById(id);
            if (!item) return handleNotFound(res, 'Purchase class');
            res.status(200).json({ success: true, data: item });
        } catch (error) {
            handleError(res, error, 'Error fetching purchase class');
        }
    },
    create: async (req, res) => {
        try {
            const { name, status } = req.body;
            if (!name) {
                return res.status(400).json({ success: false, message: 'Purchase class name is required' });
            }
            const exists = await MasterModel.purchaseClassExists(name);
            if (exists) {
                return res.status(409).json({ success: false, message: 'Purchase class already exists' });
            }
            await MasterModel.createPurchaseClass(name, status || 'Active');
            const newItem = await MasterModel.getPurchaseClassById(name);
            res.status(201).json({ success: true, message: 'Purchase class created', data: newItem });
        } catch (error) {
            handleError(res, error, 'Error creating purchase class');
        }
    },
    update: async (req, res) => {
        try {
            const { id } = req.params;
            const { status } = req.body;
            if (!status) {
                return res.status(400).json({ success: false, message: 'Status is required' });
            }
            const existing = await MasterModel.getPurchaseClassById(id);
            if (!existing) return handleNotFound(res, 'Purchase class');
            await MasterModel.updatePurchaseClass(id, status);
            const updated = await MasterModel.getPurchaseClassById(id);
            res.status(200).json({ success: true, message: 'Purchase class updated', data: updated });
        } catch (error) {
            handleError(res, error, 'Error updating purchase class');
        }
    },
    deactivate: async (req, res) => {
        try {
            const { id } = req.params;
            const existing = await MasterModel.getPurchaseClassById(id);
            if (!existing) return handleNotFound(res, 'Purchase class');
            if (existing.Status === 'Inactive') {
                return res.status(400).json({ success: false, message: 'Purchase class is already inactive' });
            }
            await MasterModel.deactivatePurchaseClass(id);
            const updated = await MasterModel.getPurchaseClassById(id);
            res.status(200).json({ success: true, message: 'Purchase class deactivated', data: updated });
        } catch (error) {
            handleError(res, error, 'Error deactivating purchase class');
        }
    },
    activate: async (req, res) => {
        try {
            const { id } = req.params;
            const existing = await MasterModel.getPurchaseClassById(id);
            if (!existing) return handleNotFound(res, 'Purchase class');
            if (existing.Status === 'Active') {
                return res.status(400).json({ success: false, message: 'Purchase class is already active' });
            }
            await MasterModel.activatePurchaseClass(id);
            const updated = await MasterModel.getPurchaseClassById(id);
            res.status(200).json({ success: true, message: 'Purchase class activated', data: updated });
        } catch (error) {
            handleError(res, error, 'Error activating purchase class');
        }
    }
};

// ============================================
// UOM
// ============================================
const uomController = {
    getAll: async (req, res) => {
        try {
            const data = await MasterModel.getAllUom();
            res.status(200).json({ success: true, data });
        } catch (error) {
            handleError(res, error, 'Error fetching UOM');
        }
    },
    getOne: async (req, res) => {
        try {
            const { id } = req.params;
            const item = await MasterModel.getUomById(id);
            if (!item) return handleNotFound(res, 'UOM');
            res.status(200).json({ success: true, data: item });
        } catch (error) {
            handleError(res, error, 'Error fetching UOM');
        }
    },
    create: async (req, res) => {
        try {
            const { code, description, status } = req.body;
            if (!code || !description) {
                return res.status(400).json({ success: false, message: 'Code and Description are required' });
            }
            const exists = await MasterModel.uomExists(code);
            if (exists) {
                return res.status(409).json({ success: false, message: 'UOM code already exists' });
            }
            await MasterModel.createUom(code, description, status || 'Active');
            const newItem = await MasterModel.getUomById(code);
            res.status(201).json({ success: true, message: 'UOM created', data: newItem });
        } catch (error) {
            handleError(res, error, 'Error creating UOM');
        }
    },
    update: async (req, res) => {
        try {
            const { id } = req.params;
            const { description, status } = req.body;
            if (!description) {
                return res.status(400).json({ success: false, message: 'Description is required' });
            }
            const existing = await MasterModel.getUomById(id);
            if (!existing) return handleNotFound(res, 'UOM');
            await MasterModel.updateUom(id, description, status || existing.Status);
            const updated = await MasterModel.getUomById(id);
            res.status(200).json({ success: true, message: 'UOM updated', data: updated });
        } catch (error) {
            handleError(res, error, 'Error updating UOM');
        }
    },
    deactivate: async (req, res) => {
        try {
            const { id } = req.params;
            const existing = await MasterModel.getUomById(id);
            if (!existing) return handleNotFound(res, 'UOM');
            if (existing.Status === 'Inactive') {
                return res.status(400).json({ success: false, message: 'UOM is already inactive' });
            }
            await MasterModel.deactivateUom(id);
            const updated = await MasterModel.getUomById(id);
            res.status(200).json({ success: true, message: 'UOM deactivated', data: updated });
        } catch (error) {
            handleError(res, error, 'Error deactivating UOM');
        }
    },
    activate: async (req, res) => {
        try {
            const { id } = req.params;
            const existing = await MasterModel.getUomById(id);
            if (!existing) return handleNotFound(res, 'UOM');
            if (existing.Status === 'Active') {
                return res.status(400).json({ success: false, message: 'UOM is already active' });
            }
            await MasterModel.activateUom(id);
            const updated = await MasterModel.getUomById(id);
            res.status(200).json({ success: true, message: 'UOM activated', data: updated });
        } catch (error) {
            handleError(res, error, 'Error activating UOM');
        }
    }
};

module.exports = {
    glController,
    categoryController,
    itemCodeController,
    purchaseClassController,
    uomController
};