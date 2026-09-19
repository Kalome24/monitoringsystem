// models/masterModel.js
const { query } = require('../db');

const masterModel = {
    // ============================================
    // GL CLASSES (gl_description_list)
    // ============================================
    getAllGl: async () => {
        return await query('SELECT Gl_Class AS id, Gl_Description AS description, Status FROM gl_description_list ORDER BY Gl_Class');
    },
    getGlById: async (id) => {
        const result = await query('SELECT Gl_Class AS id, Gl_Description AS description, Status FROM gl_description_list WHERE Gl_Class = @param0', [id]);
        return result[0] || null;
    },
    glExists: async (number) => {
        const result = await query('SELECT Gl_Class FROM gl_description_list WHERE Gl_Class = @param0', [number]);
        return result.length > 0;
    },
    createGl: async (number, description, status = 'Active') => {
        await query(
            'INSERT INTO gl_description_list (Gl_Class, Gl_Description, Status) VALUES (@param0, @param1, @param2)',
            [number, description, status]
        );
        return true;
    },
    updateGl: async (number, description, status) => {
        await query(
            'UPDATE gl_description_list SET Gl_Description = @param1, Status = @param2 WHERE Gl_Class = @param0',
            [number, description, status]
        );
        return true;
    },
    deleteGl: async (number) => {
        await query('UPDATE gl_description_list SET Status = @param1 WHERE Gl_Class = @param0', [number, 'Inactive']);
        return true;
    },
    deactivateGl: async (number) => {
        await query('UPDATE gl_description_list SET Status = @param1 WHERE Gl_Class = @param0', [number, 'Inactive']);
        return true;
    },
    activateGl: async (number) => {
        await query('UPDATE gl_description_list SET Status = @param1 WHERE Gl_Class = @param0', [number, 'Active']);
        return true;
    },

    // ============================================
    // CATEGORY (category_list)
    // ============================================
    getAllCategories: async () => {
        return await query('SELECT Category AS id, Status FROM category_list ORDER BY Category');
    },
    getCategoryById: async (id) => {
        const result = await query('SELECT Category AS id, Status FROM category_list WHERE Category = @param0', [id]);
        return result[0] || null;
    },
    categoryExists: async (name) => {
        const result = await query('SELECT Category FROM category_list WHERE Category = @param0', [name]);
        return result.length > 0;
    },
    createCategory: async (name, status = 'Active') => {
        await query('INSERT INTO category_list (Category, Status) VALUES (@param0, @param1)', [name, status]);
        return true;
    },
    updateCategory: async (name, status) => {
        await query('UPDATE category_list SET Status = @param1 WHERE Category = @param0', [name, status]);
        return true;
    },
    deleteCategory: async (name) => {
        await query('UPDATE category_list SET Status = @param1 WHERE Category = @param0', [name, 'Inactive']);
        return true;
    },
    deactivateCategory: async (name) => {
        await query('UPDATE category_list SET Status = @param1 WHERE Category = @param0', [name, 'Inactive']);
        return true;
    },
    activateCategory: async (name) => {
        await query('UPDATE category_list SET Status = @param1 WHERE Category = @param0', [name, 'Active']);
        return true;
    },

    // ============================================
    // ITEM CODES (item_codes_description_list)
    // ============================================
    getAllItemCodes: async () => {
        // Note: column name is 'Item_Description' (typo) – match your DB
        return await query('SELECT Item_Code AS id, Item_Description AS description, Status FROM item_codes_description_list ORDER BY Item_Code');
    },
    getItemCodeById: async (id) => {
        const result = await query('SELECT Item_Code AS id, Item_Description AS description, Status FROM item_codes_description_list WHERE Item_Code = @param0', [id]);
        return result[0] || null;
    },
    itemCodeExists: async (code) => {
        const result = await query('SELECT Item_Code FROM item_codes_description_list WHERE Item_Code = @param0', [code]);
        return result.length > 0;
    },
    createItemCode: async (code, description, status = 'Active') => {
        await query(
            'INSERT INTO item_codes_description_list (Item_Code, Item_Description, Status) VALUES (@param0, @param1, @param2)',
            [code, description, status]
        );
        return true;
    },
    updateItemCode: async (code, description, status) => {
        await query(
            'UPDATE item_codes_description_list SET Item_Description = @param1, Status = @param2 WHERE Item_Code = @param0',
            [code, description, status]
        );
        return true;
    },
    deleteItemCode: async (code) => {
        await query('UPDATE item_codes_description_list SET Status = @param1 WHERE Item_Code = @param0', [code, 'Inactive']);
        return true;
    },
    deactivateItemCode: async (code) => {
        await query('UPDATE item_codes_description_list SET Status = @param1 WHERE Item_Code = @param0', [code, 'Inactive']);
        return true;
    },
    activateItemCode: async (code) => {
        await query('UPDATE item_codes_description_list SET Status = @param1 WHERE Item_Code = @param0', [code, 'Active']);
        return true;
    },

    // ============================================
    // PURCHASE CLASS (purchase_class_list)
    // ============================================
    getAllPurchaseClasses: async () => {
        return await query('SELECT Purchase_Class AS id, Status FROM purchase_class_list ORDER BY Purchase_Class');
    },
    getPurchaseClassById: async (id) => {
        const result = await query('SELECT Purchase_Class AS id, Status FROM purchase_class_list WHERE Purchase_Class = @param0', [id]);
        return result[0] || null;
    },
    purchaseClassExists: async (name) => {
        const result = await query('SELECT Purchase_Class FROM purchase_class_list WHERE Purchase_Class = @param0', [name]);
        return result.length > 0;
    },
    createPurchaseClass: async (name, status = 'Active') => {
        await query('INSERT INTO purchase_class_list (Purchase_Class, Status) VALUES (@param0, @param1)', [name, status]);
        return true;
    },
    updatePurchaseClass: async (name, status) => {
        await query('UPDATE purchase_class_list SET Status = @param1 WHERE Purchase_Class = @param0', [name, status]);
        return true;
    },
    deletePurchaseClass: async (name) => {
        await query('UPDATE purchase_class_list SET Status = @param1 WHERE Purchase_Class = @param0', [name, 'Inactive']);
        return true;
    },
    deactivatePurchaseClass: async (name) => {
        await query('UPDATE purchase_class_list SET Status = @param1 WHERE Purchase_Class = @param0', [name, 'Inactive']);
        return true;
    },
    activatePurchaseClass: async (name) => {
        await query('UPDATE purchase_class_list SET Status = @param1 WHERE Purchase_Class = @param0', [name, 'Active']);
        return true;
    },

    // ============================================
    // UOM (unit_of_measure_list)
    // ============================================
    getAllUom: async () => {
        return await query('SELECT Unit_of_Measure_Code AS id, Unit_of_Measure_Description AS description, Status FROM unit_of_measure_list ORDER BY Unit_of_Measure_Code');
    },
    getUomById: async (id) => {
        const result = await query('SELECT Unit_of_Measure_Code AS id, Unit_of_Measure_Description AS description, Status FROM unit_of_measure_list WHERE Unit_of_Measure_Code = @param0', [id]);
        return result[0] || null;
    },
    uomExists: async (code) => {
        const result = await query('SELECT Unit_of_Measure_Code FROM unit_of_measure_list WHERE Unit_of_Measure_Code = @param0', [code]);
        return result.length > 0;
    },
    createUom: async (code, description, status = 'Active') => {
        await query(
            'INSERT INTO unit_of_measure_list (Unit_of_Measure_Code, Unit_of_Measure_Description, Status) VALUES (@param0, @param1, @param2)',
            [code, description, status]
        );
        return true;
    },
    updateUom: async (code, description, status) => {
        await query(
            'UPDATE unit_of_measure_list SET Unit_of_Measure_Description = @param1, Status = @param2 WHERE Unit_of_Measure_Code = @param0',
            [code, description, status]
        );
        return true;
    },
    deleteUom: async (code) => {
        await query('UPDATE unit_of_measure_list SET Status = @param1 WHERE Unit_of_Measure_Code = @param0', [code, 'Inactive']);
        return true;
    },
    deactivateUom: async (code) => {
        await query('UPDATE unit_of_measure_list SET Status = @param1 WHERE Unit_of_Measure_Code = @param0', [code, 'Inactive']);
        return true;
    },
    activateUom: async (code) => {
        await query('UPDATE unit_of_measure_list SET Status = @param1 WHERE Unit_of_Measure_Code = @param0', [code, 'Active']);
        return true;
    }
};

module.exports = masterModel;