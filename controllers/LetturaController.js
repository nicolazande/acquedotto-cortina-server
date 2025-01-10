const Lettura = require('../models/Lettura');
const Contatore = require('../models/Contatore');
const Servizio = require('../models/Servizio');

class LetturaController
{
    static async createLettura(req, res)
    {
        try
        {
            const lettura = new Lettura(req.body);
            await lettura.save();
            res.status(201).json(lettura);
        }
        catch (error)
        {
            console.error(error);
            res.status(400).json({ error: 'Error creating lettura' });
        }
    }

    static async getLetture(req, res) {
        try {
            const page = parseInt(req.query.page, 10) || 1; // Default to page 1
            const limit = parseInt(req.query.limit, 10) || 50; // Default to 50 items per page
            const search = req.query.search || ''; // Search term, default empty string
            const sortField = req.query.sortField || 'data_lettura'; // Default sort field
            const sortOrder = req.query.sortOrder === 'desc' ? -1 : 1; // Default ascending order

            const skip = (page - 1) * limit;

            let query = {};

            if (search) {
                const searchRegex = { $regex: search, $options: 'i' };

                // Dynamically build a query for string, number, and date fields
                query = {
                    $or: Object.keys(Lettura.schema.paths).map((key) => {
                        const fieldType = Lettura.schema.paths[key].instance;

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
            const totalItems = await Lettura.countDocuments(query);

            // Fetch the paginated and sorted data
            const letture = await Lettura.find(query)
                .populate('contatore') // Populate referenced fields
                .sort({ [sortField]: sortOrder }) // Apply sorting
                .skip(skip)
                .limit(limit);

            res.status(200).json({
                data: letture,
                totalItems,
                totalPages: Math.ceil(totalItems / limit),
                currentPage: page,
            });
        } catch (error) {
            console.error('Error in getLetture:', error); // Log the full error
            res.status(500).json({ error: 'Error fetching letture', details: error.message });
        }
    }

    static async getLettura(req, res)
    {
        try
        {
            const lettura = await Lettura.findById(req.params.id).populate('contatore');
            if (!lettura)
            {
                return res.status(404).json({ error: 'Lettura not found' });
            }
            res.status(200).json(lettura);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching lettura' });
        }
    }

    static async updateLettura(req, res)
    {
        try
        {
            const updateData = req.body;
            const lettura = await Lettura.findByIdAndUpdate(req.params.id, updateData, { new: true });
            res.status(200).json(lettura);
        }
        catch (error)
        {
            console.error(error);
            res.status(400).json({ error: 'Error updating lettura' });
        }
    }

    static async deleteLettura(req, res)
    {
        try
        {
            const lettura = await Lettura.findByIdAndDelete(req.params.id);
            if (!lettura)
            {
                return res.status(404).json({ error: 'Lettura not found' });
            }
            res.status(204).json({ message: 'Lettura deleted' });
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error deleting lettura' });
        }
    }

    static async associateContatore(req, res)
    {
        try
        {
            const lettura = await Lettura.findById(req.params.letturaId);
            const contatore = await Contatore.findById(req.params.contatoreId);
            if (!lettura || !contatore)
            {
                return res.status(404).json({ error: 'Lettura or Contatore not found' });
            }
            lettura.contatore = contatore._id;
            await lettura.save();
            res.status(200).json({ message: 'Contatore associated to Lettura', lettura });
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error associating contatore to lettura' });
        }
    }

    static async associateServizio(req, res)
    {
        try
        {
            const lettura = await Lettura.findById(req.params.letturaId);
            const servizio = await Servizio.findById(req.params.servizioId);
            if (!lettura || !servizio)
            {
                return res.status(404).json({ error: 'Lettura or Servizio not found' });
            }
            servizio.lettura = lettura._id;
            await servizio.save();
            res.status(200).json({ message: 'Servizio associated to Lettura', servizio });
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error associating servizio to lettura' });
        }
    }

    static async getContatoreAssociato(req, res)
    {
        try
        {
            const lettura = await Lettura.findById(req.params.id).populate('contatore');
            if (!lettura)
            {
                return res.status(404).json({ error: 'Lettura not found' });
            }
            res.status(200).json(lettura.contatore);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching contatore associato' });
        }
    }

    static async getServiziAssociati(req, res)
    {
        try
        {
            const servizi = await Servizio.find({ lettura: req.params.id });
            res.status(200).json(servizi);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching servizi associati' });
        }
    }
}

module.exports = LetturaController;