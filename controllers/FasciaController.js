const Fascia = require('../models/Fascia');
const Listino = require('../models/Listino');

class FasciaController
{
    static async createFascia(req, res)
    {
        try
        {
            const { tipo, min, max, prezzo, scadenza, fisso } = req.body;
            const fascia = new Fascia({ tipo, min, max, prezzo, scadenza, fisso });

            await fascia.save();
            res.status(201).json(fascia);
        }
        catch (error)
        {
            console.error(error);
            res.status(400).json({ error: 'Error creating fascia' });
        }
    }

    static async getFasce(req, res) {
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
                    $or: Object.keys(Fascia.schema.paths).map((key) => {
                        const fieldType = Fascia.schema.paths[key].instance;
    
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
            const totalItems = await Fascia.countDocuments(query);
    
            // Fetch the paginated data
            const fasce = await Fascia.find(query)
                .skip(skip)
                .limit(limit);
    
            res.status(200).json({
                data: fasce,
                totalItems,
                totalPages: Math.ceil(totalItems / limit),
                currentPage: page,
            });
        } catch (error) {
            console.error('Error in getFasce:', error); // Log the full error
            res.status(500).json({ error: 'Error fetching fasce', details: error.message });
        }
    }    

    static async getFascia(req, res)
    {
        try
        {
            const fascia = await Fascia.findById(req.params.id);
            if (!fascia)
            {
                return res.status(404).json({ error: 'Fascia not found' });
            }
            res.status(200).json(fascia);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching fascia' });
        }
    }

    static async updateFascia(req, res)
    {
        try
        {
            const updateData = req.body;
            const fascia = await Fascia.findByIdAndUpdate(req.params.id, updateData, { new: true });

            res.status(200).json(fascia);
        }
        catch (error)
        {
            console.error(error);
            res.status(400).json({ error: 'Error updating fascia' });
        }
    }

    static async deleteFascia(req, res)
    {
        try
        {
            const fascia = await Fascia.findByIdAndDelete(req.params.id);

            if (!fascia)
            {
                return res.status(404).json({ error: 'Fascia not found' });
            }

            res.status(204).json({ message: 'Fascia deleted' });
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error deleting fascia' });
        }
    }

    static async associateListino(req, res)
    {
        try
        {
            const fascia = await Fascia.findById(req.params.fasciaId);
            const listino = await Listino.findById(req.params.listinoId);

            if (!fascia || !listino)
            {
                return res.status(404).json({ error: 'Fascia or Listino not found' });
            }

            fascia.listino = listino._id;
            await fascia.save();

            res.status(200).json({ message: 'Listino associated to Fascia', fascia });
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error associating listino to fascia' });
        }
    }

    static async getListinoAssociato(req, res)
    {
        try
        {
            const fascia = await Fascia.findById(req.params.id).populate('listino');
            if (!fascia)
            {
                return res.status(404).json({ error: 'Fascia not found' });
            }
            res.status(200).json(fascia.listino);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching listino associato' });
        }
    }
}

module.exports = FasciaController;