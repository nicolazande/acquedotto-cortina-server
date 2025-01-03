const Edificio = require('../models/Edificio');
const Contatore = require('../models/Contatore');

class EdificioController
{
    static async createEdificio(req, res)
    {
        try
        {
            const edificio = new Edificio(req.body);
            await edificio.save();
            res.status(201).json(edificio);
        }
        catch (error)
        {
            console.error(error);
            res.status(400).json({ error: 'Error creating edificio' });
        }
    }

    static async getEdifici(req, res) {
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
                    $or: Object.keys(Edificio.schema.paths).map((key) => {
                        const fieldType = Edificio.schema.paths[key].instance;
    
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
            const totalItems = await Edificio.countDocuments(query);
    
            // Fetch the paginated data
            const edifici = await Edificio.find(query)
                .skip(skip)
                .limit(limit);
    
            res.status(200).json({
                data: edifici,
                totalItems,
                totalPages: Math.ceil(totalItems / limit),
                currentPage: page,
            });
        } catch (error) {
            console.error('Error in getEdifici:', error); // Log the full error
            res.status(500).json({ error: 'Error fetching edifici', details: error.message });
        }
    }    

    static async getEdificio(req, res)
    {
        try
        {
            const edificio = await Edificio.findById(req.params.id);
            if (!edificio)
            {
                return res.status(404).json({ error: 'Edificio not found' });
            }
            res.status(200).json(edificio);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching edificio' });
        }
    }

    static async updateEdificio(req, res)
    {
        try
        {
            const updateData = req.body;
            const edificio = await Edificio.findByIdAndUpdate(req.params.id, updateData, { new: true });
            res.status(200).json(edificio);
        }
        catch (error)
        {
            console.error(error);
            res.status(400).json({ error: 'Error updating edificio' });
        }
    }

    static async deleteEdificio(req, res)
    {
        try
        {
            const edificio = await Edificio.findByIdAndDelete(req.params.id);
            if (!edificio)
            {
                return res.status(404).json({ error: 'Edificio not found' });
            }
            res.status(204).json({ message: 'Edificio deleted' });
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error deleting edificio' });
        }
    }

    static async associateContatore(req, res)
    {
        try
        {
            const edificio = await Edificio.findById(req.params.edificioId);
            const contatore = await Contatore.findById(req.params.contatoreId);
            if (!edificio || !contatore)
            {
                return res.status(404).json({ error: 'Edificio or Contatore not found' });
            }
            contatore.edificio = edificio._id;
            await contatore.save();
            res.status(200).json({ message: 'Contatore associated to Edificio', contatore });
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error associating contatore to edificio' });
        }
    }

    static async getContatoriAssociati(req, res)
    {
        try
        {
            const contatori = await Contatore.find({ edificio: req.params.edificioId }).populate('cliente');
            res.status(200).json(contatori);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching contatori associati' });
        }
    }
}

module.exports = EdificioController;