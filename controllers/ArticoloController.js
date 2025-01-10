const Articolo = require('../models/Articolo');
const Servizio = require('../models/Servizio');

class ArticoloController
{
    static async createArticolo(req, res)
    {
        try
        {
            const { codice, descrizione, iva } = req.body;
            const articolo = new Articolo({ codice, descrizione, iva });

            await articolo.save();
            res.status(201).json(articolo);
        }
        catch (error)
        {
            console.error(error);
            res.status(400).json({ error: 'Error creating articolo' });
        }
    }

    static async getArticoli(req, res) {
        try {
            const page = parseInt(req.query.page, 10) || 1; // Default to page 1
            const limit = parseInt(req.query.limit, 10) || 50; // Default to 50 items per page
            const search = req.query.search || ''; // Search term, default empty string
            const sortField = req.query.sortField || 'descrizione'; // Default sort field
            const sortOrder = req.query.sortOrder === 'desc' ? -1 : 1; // Default ascending order
    
            const skip = (page - 1) * limit;
    
            let query = {};
    
            if (search) {
                const searchRegex = { $regex: search, $options: 'i' };
    
                // Dynamically build a query for string, number, and date fields
                query = {
                    $or: Object.keys(Articolo.schema.paths).map((key) => {
                        const fieldType = Articolo.schema.paths[key].instance;
    
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
            const totalItems = await Articolo.countDocuments(query);
    
            // Fetch the paginated and sorted data
            const articoli = await Articolo.find(query)
                .sort({ [sortField]: sortOrder }) // Apply sorting
                .skip(skip)
                .limit(limit);
    
            res.status(200).json({
                data: articoli,
                totalItems,
                totalPages: Math.ceil(totalItems / limit),
                currentPage: page,
            });
        } catch (error) {
            console.error('Error in getArticoli:', error); // Log the full error
            res.status(500).json({ error: 'Error fetching articoli', details: error.message });
        }
    }    

    static async getArticolo(req, res)
    {
        try
        {
            const articolo = await Articolo.findById(req.params.id);
            if (!articolo)
            {
                return res.status(404).json({ error: 'Articolo not found' });
            }
            res.status(200).json(articolo);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching articolo' });
        }
    }

    static async updateArticolo(req, res)
    {
        try
        {
            const updateData = req.body;
            const articolo = await Articolo.findByIdAndUpdate(req.params.id, updateData, { new: true });

            res.status(200).json(articolo);
        }
        catch (error)
        {
            console.error(error);
            res.status(400).json({ error: 'Error updating articolo' });
        }
    }

    static async deleteArticolo(req, res)
    {
        try
        {
            const articolo = await Articolo.findByIdAndDelete(req.params.id);

            if (!articolo)
            {
                return res.status(404).json({ error: 'Articolo not found' });
            }

            res.status(204).json({ message: 'Articolo deleted' });
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error deleting articolo' });
        }
    }

    static async associateServizio(req, res)
    {
        try
        {
            const articolo = await Articolo.findById(req.params.articoloId);
            const servizio = await Servizio.findById(req.params.servizioId);

            if (!articolo || !servizio)
            {
                return res.status(404).json({ error: 'Articolo or Servizio not found' });
            }

            servizio.articolo = articolo._id;
            await servizio.save();

            res.status(200).json({ message: 'Servizio associated to Articolo', servizio });
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error associating servizio to articolo' });
        }
    }

    static async getServiziAssociati(req, res)
    {
        try
        {
            const servizi = await Servizio.find({ articolo: req.params.id });
            res.status(200).json(servizi);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching servizi associati' });
        }
    }
}

module.exports = ArticoloController;