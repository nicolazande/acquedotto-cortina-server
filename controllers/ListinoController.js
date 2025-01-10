const Listino = require('../models/Listino');
const Fascia = require('../models/Fascia');
const Contatore = require('../models/Contatore');

class ListinoController
{
    static async createListino(req, res)
    {
        try
        {
            const listino = new Listino(req.body);

            await listino.save();
            res.status(201).json(listino);
        }
        catch (error)
        {
            console.error(error);
            res.status(400).json({ error: 'Error creating listino' });
        }
    }

    static async getListini(req, res) {
        try {
            const page = parseInt(req.query.page, 10) || 1; // Default to page 1
            const limit = parseInt(req.query.limit, 10) || 50; // Default to 50 items per page
            const search = req.query.search || ''; // Search term, default empty string
            const sortField = req.query.sortField || 'categoria'; // Default sort field
            const sortOrder = req.query.sortOrder === 'desc' ? -1 : 1; // Default ascending order
    
            const skip = (page - 1) * limit;
    
            let query = {};
    
            if (search) {
                const searchRegex = { $regex: search, $options: 'i' };
    
                // Dynamically build a query for string fields
                query = {
                    $or: Object.keys(Listino.schema.paths).map((key) => {
                        const fieldType = Listino.schema.paths[key].instance;
    
                        // String fields use regex
                        if (fieldType === 'String') {
                            return { [key]: searchRegex };
                        }
    
                        // Skip unsupported field types
                        return null;
                    }).filter((condition) => condition !== null), // Remove null values
                };
            }
    
            console.log('Constructed Query:', JSON.stringify(query, null, 2)); // Log the constructed query
    
            // Fetch the total count of documents matching the search
            const totalItems = await Listino.countDocuments(query);
    
            // Fetch the paginated and sorted data
            const listini = await Listino.find(query)
                .sort({ [sortField]: sortOrder }) // Apply sorting
                .skip(skip)
                .limit(limit);
    
            res.status(200).json({
                data: listini,
                totalItems,
                totalPages: Math.ceil(totalItems / limit),
                currentPage: page,
            });
        } catch (error) {
            console.error('Error in getListini:', error); // Log the full error
            res.status(500).json({ error: 'Error fetching listini', details: error.message });
        }
    }    

    static async getListino(req, res)
    {
        try
        {
            const listino = await Listino.findById(req.params.id);
            if (!listino)
            {
                return res.status(404).json({ error: 'Listino not found' });
            }
            res.status(200).json(listino);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching listino' });
        }
    }

    static async updateListino(req, res)
    {
        try
        {
            const updateData = req.body;
            const listino = await Listino.findByIdAndUpdate(req.params.id, updateData, { new: true });

            res.status(200).json(listino);
        }
        catch (error)
        {
            console.error(error);
            res.status(400).json({ error: 'Error updating listino' });
        }
    }

    static async deleteListino(req, res)
    {
        try
        {
            const listino = await Listino.findByIdAndDelete(req.params.id);

            if (!listino)
            {
                return res.status(404).json({ error: 'Listino not found' });
            }

            res.status(204).json({ message: 'Listino deleted' });
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error deleting listino' });
        }
    }

    static async associateFascia(req, res)
    {
        try
        {
            const listino = await Listino.findById(req.params.listinoId);
            const fascia = await Fascia.findById(req.params.fasciaId);

            if (!listino || !fascia)
            {
                return res.status(404).json({ error: 'Listino or Fascia not found' });
            }

            fascia.listino = listino._id;
            await fascia.save();

            res.status(200).json({ message: 'Fascia associated to Listino', fascia });
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error associating fascia to listino' });
        }
    }

    static async getFasceAssociate(req, res)
    {
        try
        {
            const fasce = await Fascia.find({ listino: req.params.id });
            res.status(200).json(fasce);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching fasce associate' });
        }
    }

    static async associateContatore(req, res)
    {
        try
        {
            const listino = await Listino.findById(req.params.listinoId);
            const contatore = await Contatore.findById(req.params.contatoreId);

            if (!listino || !contatore)
            {
                return res.status(404).json({ error: 'Listino or Contatore not found' });
            }

            contatore.listino = listino._id;
            await contatore.save();

            res.status(200).json({ message: 'Contatore associated to Listino', contatore });
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error associating contatore to listino' });
        }
    }

    static async getContatoriAssociati(req, res)
    {
        try
        {
            const contatori = await Contatore.find({ listino: req.params.id });
            res.status(200).json(contatori);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching contatori associati' });
        }
    }
}

module.exports = ListinoController;