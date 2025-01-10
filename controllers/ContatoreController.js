const Contatore = require('../models/Contatore');
const Cliente = require('../models/Cliente');
const Edificio = require('../models/Edificio');
const Listino = require('../models/Listino');
const Lettura = require('../models/Lettura');

class ContatoreController
{
    static async createContatore(req, res)
    {
        try
        {
            console.log('Request body:', req.body);
            const contatore = new Contatore(req.body);

            await contatore.save();
            res.status(201).json(contatore);
        }
        catch (error)
        {
            console.error(error);
            res.status(400).json({ error: 'Error creating contatore' });
        }
    }

    static async getContatori(req, res) {
        try {
            const page = parseInt(req.query.page, 10) || 1; // Default to page 1
            const limit = parseInt(req.query.limit, 10) || 50; // Default to 50 items per page
            const search = req.query.search || ''; // Search term, default empty string
            const sortField = req.query.sortField || 'nome_cliente'; // Default sort field
            const sortOrder = req.query.sortOrder === 'desc' ? -1 : 1; // Default ascending order
    
            const skip = (page - 1) * limit;
    
            let query = {};
    
            if (search) {
                const searchRegex = { $regex: search, $options: 'i' };
    
                // Dynamically build a query for string, number, and date fields
                query = {
                    $or: Object.keys(Contatore.schema.paths).map((key) => {
                        const fieldType = Contatore.schema.paths[key].instance;
    
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
            const totalItems = await Contatore.countDocuments(query);
    
            // Fetch the paginated and sorted data
            const contatori = await Contatore.find(query)
                .populate('edificio listino cliente') // Populate referenced fields
                .sort({ [sortField]: sortOrder }) // Apply sorting
                .skip(skip)
                .limit(limit);
    
            res.status(200).json({
                data: contatori,
                totalItems,
                totalPages: Math.ceil(totalItems / limit),
                currentPage: page,
            });
        } catch (error) {
            console.error('Error in getContatori:', error); // Log the full error
            res.status(500).json({ error: 'Error fetching contatori', details: error.message });
        }
    }
        

    static async getContatore(req, res)
    {
        try
        {
            const contatore = await Contatore.findById(req.params.id).populate('edificio listino cliente');
            if (!contatore)
            {
                return res.status(404).json({ error: 'Contatore not found' });
            }
            res.status(200).json(contatore);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching contatore' });
        }
    }

    static async updateContatore(req, res)
    {
        try
        {
            const updateData = req.body;
            const contatore = await Contatore.findByIdAndUpdate(req.params.id, updateData, { new: true });

            res.status(200).json(contatore);
        }
        catch (error)
        {
            console.error(error);
            res.status(400).json({ error: 'Error updating contatore' });
        }
    }

    static async deleteContatore(req, res)
    {
        try
        {
            const contatore = await Contatore.findByIdAndDelete(req.params.id);

            if (!contatore)
            {
                return res.status(404).json({ error: 'Contatore not found' });
            }

            res.status(204).json({ message: 'Contatore deleted' });
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error deleting contatore' });
        }
    }

    static async associateCliente(req, res)
    {
        try
        {
            const contatore = await Contatore.findById(req.params.contatoreId);
            const cliente = await Cliente.findById(req.params.clienteId);

            if (!contatore || !cliente)
            {
                return res.status(404).json({ error: 'Contatore or Cliente not found' });
            }

            contatore.cliente = cliente._id;
            await contatore.save();

            res.status(200).json({ message: 'Cliente associated to Contatore', contatore });
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error associating cliente to contatore' });
        }
    }

    static async associateEdificio(req, res)
    {
        try
        {
            const contatore = await Contatore.findById(req.params.contatoreId);
            const edificio = await Edificio.findById(req.params.edificioId);

            if (!contatore || !edificio)
            {
                return res.status(404).json({ error: 'Contatore or Edificio not found' });
            }

            contatore.edificio = edificio._id;
            await contatore.save();

            res.status(200).json({ message: 'Edificio associated to Contatore', contatore });
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error associating edificio to contatore' });
        }
    }

    static async associateListino(req, res)
    {
        try
        {
            const contatore = await Contatore.findById(req.params.contatoreId);
            const listino = await Listino.findById(req.params.listinoId);

            if (!contatore || !listino)
            {
                return res.status(404).json({ error: 'Contatore or Listino not found' });
            }

            contatore.listino = listino._id;
            await contatore.save();

            res.status(200).json({ message: 'Listino associated to Contatore', contatore });
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error associating listino to contatore' });
        }
    }

    static async associateLettura(req, res)
    {
        try
        {
            const contatore = await Contatore.findById(req.params.contatoreId);
            const lettura = await Lettura.findById(req.params.letturaId);

            if (!contatore || !lettura)
            {
                return res.status(404).json({ error: 'Contatore or Lettura not found' });
            }

            lettura.contatore = contatore._id;
            await lettura.save();

            res.status(200).json({ message: 'Lettura associated to Contatore', lettura });
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error associating lettura to contatore' });
        }
    }

    static async getListinoAssociato(req, res)
    {
        try
        {
            const contatore = await Contatore.findById(req.params.id).populate('listino');
            if (!contatore)
            {
                return res.status(404).json({ error: 'Contatore not found' });
            }
            res.status(200).json(contatore.listino);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching listino associato' });
        }
    }

    static async getEdificioAssociato(req, res)
    {
        try
        {
            const contatore = await Contatore.findById(req.params.id).populate('edificio');
            if (!contatore)
            {
                return res.status(404).json({ error: 'Contatore not found' });
            }
            res.status(200).json(contatore.edificio);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching edificio associato' });
        }
    }

    static async getLettureAssociate(req, res)
    {
        try
        {
            const letture = await Lettura.find({ contatore: req.params.id });
            res.status(200).json(letture);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching letture associate' });
        }
    }

    static async getClienteAssociato(req, res)
    {
        try
        {
            const contatore = await Contatore.findById(req.params.id).populate('cliente');
            if (!contatore)
            {
                return res.status(404).json({ error: 'Contatore not found' });
            }
            res.status(200).json(contatore.cliente);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching cliente associato' });
        }
    }
}

module.exports = ContatoreController;