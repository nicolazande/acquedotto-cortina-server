const Fattura = require('../models/Fattura');
const Cliente = require('../models/Cliente');
const Servizio = require('../models/Servizio');
const Scadenza = require('../models/Scadenza');

class FatturaController
{
    static async createFattura(req, res)
    {
        try
        {
            const fattura = new Fattura(req.body);

            await fattura.save();
            res.status(201).json(fattura);
        }
        catch (error)
        {
            console.error(error);
            res.status(400).json({ error: 'Error creating fattura' });
        }
    }

    static async getFatture(req, res) {
        try {
            const page = parseInt(req.query.page, 10) || 1; // Default to page 1
            const limit = parseInt(req.query.limit, 10) || 50; // Default to 50 items per page
            const search = req.query.search || ''; // Search term, default empty string
    
            const skip = (page - 1) * limit;
    
            let query = {};
    
            if (search) {
                const searchRegex = { $regex: search, $options: 'i' };
    
                // Dynamically build a query for string, number, and date fields
                query = {
                    $or: Object.keys(Fattura.schema.paths).map((key) => {
                        const fieldType = Fattura.schema.paths[key].instance;
    
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
            const totalItems = await Fattura.countDocuments(query);
    
            // Fetch the paginated data
            const fatture = await Fattura.find(query)
                .populate('cliente') // Populate referenced fields
                .skip(skip)
                .limit(limit);
    
            res.status(200).json({
                data: fatture,
                totalItems,
                totalPages: Math.ceil(totalItems / limit),
                currentPage: page,
            });
        } catch (error) {
            console.error('Error in getFatture:', error); // Log the full error
            res.status(500).json({ error: 'Error fetching fatture', details: error.message });
        }
    }    

    static async getFattura(req, res)
    {
        try
        {
            const fattura = await Fattura.findById(req.params.id).populate('cliente');
            if (!fattura)
            {
                return res.status(404).json({ error: 'Fattura not found' });
            }
            res.status(200).json(fattura);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching fattura' });
        }
    }

    static async updateFattura(req, res)
    {
        try
        {
            const updateData = req.body;
            const fattura = await Fattura.findByIdAndUpdate(req.params.id, updateData, { new: true });

            res.status(200).json(fattura);
        }
        catch (error)
        {
            console.error(error);
            res.status(400).json({ error: 'Error updating fattura' });
        }
    }

    static async deleteFattura(req, res)
    {
        try
        {
            const fattura = await Fattura.findByIdAndDelete(req.params.id);

            if (!fattura)
            {
                return res.status(404).json({ error: 'Fattura not found' });
            }

            res.status(204).json({ message: 'Fattura deleted' });
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error deleting fattura' });
        }
    }

    static async associateCliente(req, res)
    {
        try
        {
            const fattura = await Fattura.findById(req.params.fatturaId);
            const cliente = await Cliente.findById(req.params.clienteId);

            if (!fattura || !cliente)
            {
                return res.status(404).json({ error: 'Fattura or Cliente not found' });
            }

            fattura.cliente = cliente._id;
            await fattura.save();

            res.status(200).json({ message: 'Cliente associated to Fattura', fattura });
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error associating cliente to fattura' });
        }
    }

    static async associateServizio(req, res)
    {
        try
        {
            const fattura = await Fattura.findById(req.params.fatturaId);
            const servizio = await Servizio.findById(req.params.servizioId);

            if (!fattura || !servizio)
            {
                return res.status(404).json({ error: 'Fattura or Servizio not found' });
            }

            servizio.fattura = fattura._id;
            await servizio.save();

            res.status(200).json({ message: 'Servizio associated to Fattura', servizio });
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error associating servizio to fattura' });
        }
    }

    static async associateScadenza(req, res)
    {
        try
        {
            const fattura = await Fattura.findById(req.params.fatturaId);
            const scadenza = await Scadenza.findById(req.params.scadenzaId);

            if (!fattura || !scadenza)
            {
                return res.status(404).json({ error: 'Fattura or Scadenza not found' });
            }

            await scadenza.save();

            res.status(200).json({ message: 'Scadenza associated to Fattura', scadenza });
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error associating scadenza to fattura' });
        }
    }

    static async getServiziAssociati(req, res)
    {
        try
        {
            const servizi = await Servizio.find({ fattura: req.params.id });
            res.status(200).json(servizi);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching servizi associati' });
        }
    }

    static async getClienteAssociato(req, res)
    {
        try
        {
            const fattura = await Fattura.findById(req.params.id).populate('cliente');
            if (!fattura || !fattura.cliente)
            {
                return res.status(404).json({ error: 'Cliente not found' });
            }
            res.status(200).json(fattura.cliente);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching cliente associato' });
        }
    }

    static async getScadenzaAssociata(req, res)
    {
        try
        {
            const fattura = await Fattura.findById(req.params.id).populate('scadenza');
            if (!fattura || !fattura.scadenza)
            {
                return res.status(404).json({ error: 'Cliente not found' });
            }
            res.status(200).json(fattura.scadenza);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching scadenza associato' });
        }
    }
}

module.exports = FatturaController;