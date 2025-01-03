const Servizio = require('../models/Servizio');
const Lettura = require('../models/Lettura');
const Articolo = require('../models/Articolo');
const Fattura = require('../models/Fattura');

class ServizioController
{
    static async createServizio(req, res)
    {
        try
        {
            const servizio = new Servizio(req.body);
            await servizio.save();
            res.status(201).json(servizio);
        }
        catch (error)
        {
            console.error(error);
            res.status(400).json({ error: 'Error creating servizio' });
        }
    }

    static async getServizi(req, res) {
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
                    $or: Object.keys(Servizio.schema.paths).map((key) => {
                        const fieldType = Servizio.schema.paths[key].instance;
    
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
            const totalItems = await Servizio.countDocuments(query);
    
            // Fetch the paginated data
            const servizi = await Servizio.find(query)
                .populate('lettura articolo fattura') // Populate referenced fields
                .skip(skip)
                .limit(limit);
    
            res.status(200).json({
                data: servizi,
                totalItems,
                totalPages: Math.ceil(totalItems / limit),
                currentPage: page,
            });
        } catch (error) {
            console.error('Error in getServizi:', error); // Log the full error
            res.status(500).json({ error: 'Error fetching servizi', details: error.message });
        }
    }
    
    static async getServizio(req, res)
    {
        try
        {
            const servizio = await Servizio.findById(req.params.id).populate('lettura articolo fattura');
            if (!servizio)
            {
                return res.status(404).json({ error: 'Servizio not found' });
            }
            res.status(200).json(servizio);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching servizio' });
        }
    }

    static async updateServizio(req, res)
    {
        try
        {
            const updateData = req.body;
            const servizio = await Servizio.findByIdAndUpdate(req.params.id, updateData, { new: true });

            res.status(200).json(servizio);
        }
        catch (error)
        {
            console.error(error);
            res.status(400).json({ error: 'Error updating servizio' });
        }
    }

    static async deleteServizio(req, res)
    {
        try
        {
            const servizio = await Servizio.findByIdAndDelete(req.params.id);

            if (!servizio)
            {
                return res.status(404).json({ error: 'Servizio not found' });
            }

            res.status(204).json({ message: 'Servizio deleted' });
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error deleting servizio' });
        }
    }

    static async associateLettura(req, res)
    {
        try
        {
            const servizio = await Servizio.findById(req.params.servizioId);
            const lettura = await Lettura.findById(req.params.letturaId);

            if (!servizio || !lettura)
            {
                return res.status(404).json({ error: 'Servizio or Lettura not found' });
            }

            servizio.lettura = lettura._id;
            await servizio.save();

            res.status(200).json({ message: 'Lettura associated to Servizio', servizio });
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error associating lettura to servizio' });
        }
    }

    static async associateArticolo(req, res)
    {
        try
        {
            const servizio = await Servizio.findById(req.params.servizioId);
            const articolo = await Articolo.findById(req.params.articoloId);

            if (!servizio || !articolo)
            {
                return res.status(404).json({ error: 'Servizio or Articolo not found' });
            }

            servizio.articolo = articolo._id;
            await servizio.save();

            res.status(200).json({ message: 'Articolo associated to Servizio', servizio });
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error associating articolo to servizio' });
        }
    }

    static async associateFattura(req, res)
    {
        try
        {
            const servizio = await Servizio.findById(req.params.servizioId);
            const fattura = await Fattura.findById(req.params.fatturaId);

            if (!servizio || !fattura)
            {
                return res.status(404).json({ error: 'Servizio or Fattura not found' });
            }

            servizio.fattura = fattura._id;
            await servizio.save();

            res.status(200).json({ message: 'Fattura associated to Servizio', servizio });
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error associating fattura to servizio' });
        }
    }

    static async getLetturaAssociata(req, res)
    {
        try
        {
            const servizio = await Servizio.findById(req.params.id).populate('lettura');
            if (!servizio)
            {
                return res.status(404).json({ error: 'Servizio not found' });
            }
            res.status(200).json(servizio.lettura);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching lettura associata' });
        }
    }

    static async getFatturaAssociata(req, res)
    {
        try
        {
            const servizio = await Servizio.findById(req.params.id).populate('fattura');
            if (!servizio)
            {
                return res.status(404).json({ error: 'Servizio not found' });
            }
            res.status(200).json(servizio.fattura);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching fattura associata' });
        }
    }

    static async getArticoloAssociato(req, res)
    {
        try
        {
            const servizio = await Servizio.findById(req.params.id).populate('articolo');
            if (!servizio)
            {
                return res.status(404).json({ error: 'Servizio not found' });
            }
            res.status(200).json(servizio.articolo);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching articolo associato' });
        }
    }
}

module.exports = ServizioController;