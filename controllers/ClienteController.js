const Cliente = require('../models/Cliente');
const Contatore = require('../models/Contatore');
const Fattura = require('../models/Fattura');

class ClienteController
{
    static async createCliente(req, res)
    {
        try
        {
            const cliente = new Cliente(req.body);
            await cliente.save();
            res.status(201).json(cliente);
        }
        catch (error)
        {
            console.error(error);
            res.status(400).json({ error: 'Error creating cliente' });
        }
    }

    static async getClienti(req, res) {
        try {
            const page = parseInt(req.query.page, 10) || 1; // Default to page 1
            const limit = parseInt(req.query.limit, 10) || 50; // Default to 50 items per page
            const search = req.query.search || ''; // Search term, default empty string
            const sortField = req.query.sortField || 'nome'; // Default sort field
            const sortOrder = req.query.sortOrder === 'desc' ? -1 : 1; // Default ascending order

            const skip = (page - 1) * limit;

            let query = {};

            if (search) {
                const searchRegex = { $regex: search, $options: 'i' };

                // Dynamically build a query for string, number, and date fields
                query = {
                    $or: Object.keys(Cliente.schema.paths).map((key) => {
                        const fieldType = Cliente.schema.paths[key].instance;

                        // String fields use regex
                        if (fieldType === 'String') {
                            return { [key]: searchRegex };
                        }

                        // Number fields use direct equality if search is a valid number
                        if (fieldType === 'Number' && !isNaN(search)) {
                            return { [key]: Number(search) };
                        }

                        // Date fields use $eq with valid date
                        if (fieldType === 'Date' && !isNaN(Date.parse(search))) {
                            return { [key]: new Date(search) };
                        }

                        // Skip unsupported field types
                        return null;
                    }).filter((condition) => condition !== null), // Remove null values
                };
            }

            console.log('Constructed Query:', JSON.stringify(query, null, 2)); // Log the constructed query

            // Fetch the total count of documents matching the search
            const totalItems = await Cliente.countDocuments(query);

            // Fetch the paginated and sorted data
            const clienti = await Cliente.find(query)
                .sort({ [sortField]: sortOrder }) // Apply sorting
                .skip(skip)
                .limit(limit);

            res.status(200).json({
                data: clienti,
                totalItems,
                totalPages: Math.ceil(totalItems / limit),
                currentPage: page,
            });
        } catch (error) {
            console.error('Error in getClienti:', error); // Log the full error
            res.status(500).json({ error: 'Error fetching clienti', details: error.message });
        }
    }   

    static async getCliente(req, res)
    {
        try
        {
            const cliente = await Cliente.findById(req.params.id);
            if (!cliente)
            {
                return res.status(404).json({ error: 'Cliente not found' });
            }
            res.status(200).json(cliente);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching cliente' });
        }
    }

    static async updateCliente(req, res)
    {
        try
        {
            const updateData = req.body;
            const cliente = await Cliente.findByIdAndUpdate(req.params.id, updateData, { new: true });
            res.status(200).json(cliente);
        }
        catch (error)
        {
            console.error(error);
            res.status(400).json({ error: 'Error updating cliente' });
        }
    }

    static async deleteCliente(req, res)
    {
        try
        {
            const cliente = await Cliente.findByIdAndDelete(req.params.id);
            if (!cliente)
            {
                return res.status(404).json({ error: 'Cliente not found' });
            }
            res.status(204).json({ message: 'Cliente deleted' });
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error deleting cliente' });
        }
    }

    static async associateContatore(req, res)
    {
        try
        {
            const cliente = await Cliente.findById(req.params.clienteId);
            const contatore = await Contatore.findById(req.params.contatoreId);
            if (!cliente || !contatore)
            {
                return res.status(404).json({ error: 'Cliente or Contatore not found' });
            }
            contatore.cliente = cliente._id;
            await contatore.save();
            res.status(200).json({ message: 'Contatore associated to Cliente', contatore });
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error associating contatore to cliente' });
        }
    }

    static async associateFattura(req, res)
    {
        try
        {
            const cliente = await Cliente.findById(req.params.clienteId);
            const fattura = await Fattura.findById(req.params.fatturaId);
            if (!cliente || !fattura)
            {
                return res.status(404).json({ error: 'Cliente or Fattura not found' });
            }
            fattura.cliente = cliente._id;
            await fattura.save();
            res.status(200).json({ message: 'Fattura associated to Cliente', fattura });
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error associating fattura to cliente' });
        }
    }

    static async getContatoriAssociati(req, res)
    {
        try
        {
            const contatori = await Contatore.find({ cliente: req.params.id });
            res.status(200).json(contatori);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching contatori associati' });
        }
    }

    static async getFattureAssociate(req, res)
    {
        try
        {
            const fatture = await Fattura.find({ cliente: req.params.id });
            res.status(200).json(fatture);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching fatture associate' });
        }
    }
}

module.exports = ClienteController;