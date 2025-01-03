const Scadenza = require('../models/Scadenza');
const Fattura = require('../models/Fattura');

class ScadenzaController
{
    static async createScadenza(req, res)
    {
        try
        {
            const scadenza = new Scadenza(req.body);
            await scadenza.save();
            res.status(201).json(scadenza);
        }
        catch (error)
        {
            console.error(error);
            res.status(400).json({ error: 'Error creating scadenza' });
        }
    }

    static async getScadenze(req, res) {
        try {
            const page = parseInt(req.query.page, 10) || 1; // Default to page 1
            const limit = parseInt(req.query.limit, 10) || 100; // Default to 100 items per page
            const search = req.query.search || ''; // Search term, default empty string
    
            const skip = (page - 1) * limit;
    
            let query = {};
    
            if (search) {
                const searchRegex = { $regex: search, $options: 'i' };
    
                // Dynamically build a query for string, number, and date fields
                query = {
                    $or: Object.keys(Scadenza.schema.paths).map((key) => {
                        const fieldType = Scadenza.schema.paths[key].instance;
    
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
            const totalItems = await Scadenza.countDocuments(query);
    
            // Fetch the paginated data
            const scadenze = await Scadenza.find(query)
                .skip(skip)
                .limit(limit);
    
            res.status(200).json({
                data: scadenze,
                totalItems,
                totalPages: Math.ceil(totalItems / limit),
                currentPage: page,
            });
        } catch (error) {
            console.error('Error in getScadenze:', error); // Log the full error
            res.status(500).json({ error: 'Error fetching scadenze', details: error.message });
        }
    }
    
    static async getScadenza(req, res)
    {
        try
        {
            const scadenza = await Scadenza.findById(req.params.id);
            if (!scadenza)
            {
                return res.status(404).json({ error: 'Scadenza not found' });
            }
            res.status(200).json(scadenza);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching scadenza' });
        }
    }

    static async updateScadenza(req, res)
    {
        try
        {
            const updateData = req.body;
            const scadenza = await Scadenza.findByIdAndUpdate(req.params.id, updateData, { new: true });

            res.status(200).json(scadenza);
        }
        catch (error)
        {
            console.error(error);
            res.status(400).json({ error: 'Error updating scadenza' });
        }
    }

    static async deleteScadenza(req, res)
    {
        try
        {
            const scadenza = await Scadenza.findByIdAndDelete(req.params.id);

            if (!scadenza)
            {
                return res.status(404).json({ error: 'Scadenza not found' });
            }

            res.status(204).json({ message: 'Scadenza deleted' });
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error deleting scadenza' });
        }
    }

    static async associateFattura(req, res)
    {
        try
        {
            const scadenza = await Scadenza.findById(req.params.scadenzaId);
            const fattura = await Fattura.findById(req.params.fatturaId);

            if (!scadenza || !fattura)
            {
                return res.status(404).json({ error: 'Scadenza or Fattura not found' });
            }

            fattura.scadenza = scadenza._id;
            await fattura.save();

            res.status(200).json({ message: 'Fattura associated to Scadenza', scadenza });
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error associating fattura to scadenza' });
        }
    }

    static async getFatturaAssociata(req, res)
    {
        try
        {
            const fattura = await Fattura.findOne({ scadenza: req.params.id });
            res.status(200).json(fattura);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching fattura associata' });
        }
    }
}

module.exports = ScadenzaController;